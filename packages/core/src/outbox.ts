/**
 * 行動データの送信待ちキュー（オフライン対応・重複防止）。設計書 4-4。
 *
 * - イベントごとに一意な eventId を端末で発行する
 * - サーバーは eventId の一意制約で重複を排除し、「受け付けた（＝保存済みまたは既に保存されていた）ID」と
 *   「拒否したID（形式不正など。再送しても無駄なもの）」を返す
 * - 端末は返ってきたIDだけをキューから削除する → 途中で通信が切れても、再送で重複しない
 * - 分析データ送信に同意していない場合は、キューに入れない。同意撤回時は未送信分を削除する
 * - 保存件数・保存期間に上限を設け、超えたら古いものから破棄する
 */

export type AnalyticsEventType =
  | 'app_open'
  | 'map_view'
  | 'store_click'
  | 'store_search'
  | 'route_search'
  | 'position_correction'
  | 'beacon_seen';

export interface OutboxEvent {
  eventId: string;
  facilityId: string;
  anonSessionId: string;
  type: AnalyticsEventType;
  /** 端末時計での発生時刻（ISO8601） */
  occurredAt: string;
  floorId?: string | null;
  x?: number | null;
  y?: number | null;
  payload?: Record<string, unknown>;
  platform?: string;
  appVersion?: string;
}

/** 保存先（端末ではSQLite、テストではメモリ、Webでは localStorage など） */
export interface OutboxStore {
  add(event: OutboxEvent): Promise<void>;
  /** 古い順に最大 limit 件 */
  peek(limit: number): Promise<OutboxEvent[]>;
  remove(eventIds: string[]): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
  /** occurredAt が cutoff より古いものを削除し、削除件数を返す */
  deleteOlderThan(cutoffIso: string): Promise<number>;
  /** 件数が max を超えた分を古い順に削除し、削除件数を返す */
  trimToMax(max: number): Promise<number>;
}

export interface SendResult {
  accepted: string[];
  rejected: { eventId: string; reason: string }[];
}

export type OutboxSender = (events: OutboxEvent[]) => Promise<SendResult>;

export interface OutboxOptions {
  maxItems: number;
  maxAgeDays: number;
  batchSize: number;
  /** 再送待ちの初回（ミリ秒） */
  baseBackoffMs: number;
  /** 再送待ちの上限（ミリ秒） */
  maxBackoffMs: number;
}

export const DEFAULT_OUTBOX_OPTIONS: OutboxOptions = {
  maxItems: 5000,
  maxAgeDays: 7,
  batchSize: 100,
  baseBackoffMs: 30_000,
  maxBackoffMs: 30 * 60_000,
};

export function backoffMs(failures: number, opts: Pick<OutboxOptions, 'baseBackoffMs' | 'maxBackoffMs'>): number {
  if (failures <= 0) return 0;
  return Math.min(opts.baseBackoffMs * 2 ** (failures - 1), opts.maxBackoffMs);
}

export interface FlushReport {
  status: 'sent' | 'nothing_to_send' | 'no_consent' | 'waiting_backoff' | 'failed';
  sent: number;
  rejected: number;
  remaining: number;
  error?: string;
  nextRetryAt?: string;
}

export class Outbox {
  private failures = 0;
  private nextAttemptAt = 0;
  private flushing: Promise<FlushReport> | null = null;
  readonly opts: OutboxOptions;

  constructor(
    private readonly store: OutboxStore,
    private readonly sender: OutboxSender,
    private readonly hasConsent: () => boolean,
    opts: Partial<OutboxOptions> = {},
  ) {
    this.opts = { ...DEFAULT_OUTBOX_OPTIONS, ...opts };
  }

  /** 同意がある場合のみ追加する。追加したら true */
  async enqueue(event: OutboxEvent): Promise<boolean> {
    if (!this.hasConsent()) return false;
    await this.store.add(event);
    await this.store.trimToMax(this.opts.maxItems);
    return true;
  }

  /** 同意撤回時：未送信データを端末から削除 */
  async onConsentRevoked(): Promise<void> {
    await this.store.clear();
    this.failures = 0;
    this.nextAttemptAt = 0;
  }

  count(): Promise<number> {
    return this.store.count();
  }

  /** 送信を試みる。同時に複数回呼ばれても送信は1本にまとめる */
  flush(now: Date = new Date(), opts: { ignoreBackoff?: boolean } = {}): Promise<FlushReport> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush(now, opts).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(now: Date, opts: { ignoreBackoff?: boolean }): Promise<FlushReport> {
    if (!this.hasConsent()) {
      await this.store.clear();
      return { status: 'no_consent', sent: 0, rejected: 0, remaining: 0 };
    }
    const cutoff = new Date(now.getTime() - this.opts.maxAgeDays * 86_400_000).toISOString();
    await this.store.deleteOlderThan(cutoff);

    if (!opts.ignoreBackoff && now.getTime() < this.nextAttemptAt) {
      return {
        status: 'waiting_backoff',
        sent: 0,
        rejected: 0,
        remaining: await this.store.count(),
        nextRetryAt: new Date(this.nextAttemptAt).toISOString(),
      };
    }

    let sent = 0;
    let rejected = 0;
    for (;;) {
      const batch = await this.store.peek(this.opts.batchSize);
      if (batch.length === 0) break;
      let result: SendResult;
      try {
        result = await this.sender(batch);
      } catch (e) {
        this.failures += 1;
        this.nextAttemptAt = now.getTime() + backoffMs(this.failures, this.opts);
        return {
          status: 'failed',
          sent,
          rejected,
          remaining: await this.store.count(),
          error: e instanceof Error ? e.message : String(e),
          nextRetryAt: new Date(this.nextAttemptAt).toISOString(),
        };
      }
      const batchIds = new Set(batch.map((b) => b.eventId));
      const done = [...result.accepted, ...result.rejected.map((r) => r.eventId)].filter((id) => batchIds.has(id));
      await this.store.remove(done);
      sent += result.accepted.filter((id) => batchIds.has(id)).length;
      rejected += result.rejected.filter((r) => batchIds.has(r.eventId)).length;
      // サーバーが何も処理しなかった場合は無限ループを避けて中断
      if (done.length === 0) {
        this.failures += 1;
        this.nextAttemptAt = now.getTime() + backoffMs(this.failures, this.opts);
        return {
          status: 'failed',
          sent,
          rejected,
          remaining: await this.store.count(),
          error: 'サーバーが送信データを処理しませんでした',
          nextRetryAt: new Date(this.nextAttemptAt).toISOString(),
        };
      }
    }
    this.failures = 0;
    this.nextAttemptAt = 0;
    return {
      status: sent + rejected > 0 ? 'sent' : 'nothing_to_send',
      sent,
      rejected,
      remaining: await this.store.count(),
    };
  }
}

/** テスト・Web用のメモリ保存 */
export class MemoryOutboxStore implements OutboxStore {
  items: OutboxEvent[] = [];
  async add(event: OutboxEvent) {
    if (!this.items.some((e) => e.eventId === event.eventId)) this.items.push(event);
  }
  async peek(limit: number) {
    return [...this.items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(0, limit);
  }
  async remove(ids: string[]) {
    const s = new Set(ids);
    this.items = this.items.filter((e) => !s.has(e.eventId));
  }
  async count() {
    return this.items.length;
  }
  async clear() {
    this.items = [];
  }
  async deleteOlderThan(cutoffIso: string) {
    const before = this.items.length;
    this.items = this.items.filter((e) => e.occurredAt >= cutoffIso);
    return before - this.items.length;
  }
  async trimToMax(max: number) {
    if (this.items.length <= max) return 0;
    const sorted = [...this.items].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const drop = new Set(sorted.slice(0, this.items.length - max).map((e) => e.eventId));
    this.items = this.items.filter((e) => !drop.has(e.eventId));
    return drop.size;
  }
}

/**
 * 匿名セッションID（1日ごとに作り直す）。設計書 5-4。
 * 同じ日の間は同じIDを返し、日付が変わったら新しいIDを発行する。
 */
export function rotateAnonSessionId(
  current: { id: string; day: string } | null,
  now: Date,
  newId: () => string,
): { id: string; day: string } {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  if (current && current.day === day) return current;
  return { id: newId(), day };
}
