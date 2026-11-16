import { describe, expect, it } from 'vitest';
import { backoffMs, MemoryOutboxStore, Outbox, rotateAnonSessionId, type OutboxEvent, type SendResult } from '../src';

let seq = 0;
const ev = (occurredAt = '2026-11-16T03:00:00.000Z', extra: Partial<OutboxEvent> = {}): OutboxEvent => ({
  eventId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  facilityId: 'f',
  anonSessionId: 'anon',
  type: 'map_view',
  occurredAt,
  ...extra,
});
const NOW = new Date('2026-11-16T04:00:00.000Z');

/** サーバーの重複排除（event_id の一意制約）を模擬 */
function fakeServer() {
  const saved = new Map<string, OutboxEvent>();
  let failNext = 0;
  let dropAfterSave = false;
  const send = async (events: OutboxEvent[]): Promise<SendResult> => {
    if (failNext > 0) {
      failNext--;
      throw new Error('network down');
    }
    const accepted: string[] = [];
    const rejected: SendResult['rejected'] = [];
    for (const e of events) {
      if (e.type === ('bogus' as never)) {
        rejected.push({ eventId: e.eventId, reason: 'invalid_type' });
        continue;
      }
      if (!saved.has(e.eventId)) saved.set(e.eventId, e); // ON CONFLICT DO NOTHING
      accepted.push(e.eventId);
    }
    if (dropAfterSave) {
      dropAfterSave = false;
      // サーバーは保存したが、応答が端末に届かなかった（通信切断）
      throw new Error('connection reset after commit');
    }
    return { accepted, rejected };
  };
  return {
    saved,
    send,
    failTimes: (n: number) => (failNext = n),
    dropResponseOnce: () => (dropAfterSave = true),
  };
}

describe('Outbox（行動データの一時保存と再送）', () => {
  it('同意がなければキューに入れない', async () => {
    const store = new MemoryOutboxStore();
    const box = new Outbox(store, fakeServer().send, () => false);
    expect(await box.enqueue(ev())).toBe(false);
    expect(await store.count()).toBe(0);
  });

  it('オフライン中は保存し、通信復旧後に送信して削除する', async () => {
    const store = new MemoryOutboxStore();
    const server = fakeServer();
    const box = new Outbox(store, server.send, () => true);
    await box.enqueue(ev());
    await box.enqueue(ev());
    server.failTimes(1);
    const r1 = await box.flush(NOW);
    expect(r1.status).toBe('failed');
    expect(r1.remaining).toBe(2);
    // 再送待ち中は送らない
    expect((await box.flush(new Date(NOW.getTime() + 1000))).status).toBe('waiting_backoff');
    // 待ち時間経過後に送信
    const r2 = await box.flush(new Date(NOW.getTime() + 31_000));
    expect(r2).toMatchObject({ status: 'sent', sent: 2, remaining: 0 });
    expect(server.saved.size).toBe(2);
  });

  it('応答が届かず再送しても、サーバー上で重複しない', async () => {
    const store = new MemoryOutboxStore();
    const server = fakeServer();
    const box = new Outbox(store, server.send, () => true);
    await box.enqueue(ev());
    await box.enqueue(ev());
    server.dropResponseOnce();
    expect((await box.flush(NOW)).status).toBe('failed');
    expect(server.saved.size).toBe(2); // サーバー側は保存済み
    expect(await store.count()).toBe(2); // 端末側は成功を確認できていないので残っている
    const r = await box.flush(NOW, { ignoreBackoff: true });
    expect(r).toMatchObject({ status: 'sent', remaining: 0 });
    expect(server.saved.size).toBe(2); // 重複していない
  });

  it('サーバーが拒否したデータは再送しない（キューから外す）', async () => {
    const store = new MemoryOutboxStore();
    const box = new Outbox(store, fakeServer().send, () => true);
    await box.enqueue(ev(undefined, { type: 'bogus' as never }));
    await box.enqueue(ev());
    const r = await box.flush(NOW);
    expect(r).toMatchObject({ sent: 1, rejected: 1, remaining: 0 });
  });

  it('大量データはバッチに分けて送る', async () => {
    const store = new MemoryOutboxStore();
    const server = fakeServer();
    const batches: number[] = [];
    const box = new Outbox(
      store,
      async (e) => {
        batches.push(e.length);
        return server.send(e);
      },
      () => true,
      { batchSize: 10 },
    );
    for (let i = 0; i < 25; i++) await box.enqueue(ev());
    await box.flush(NOW);
    expect(batches).toEqual([10, 10, 5]);
  });

  it('件数上限を超えたら古いものから破棄する', async () => {
    const store = new MemoryOutboxStore();
    const box = new Outbox(store, fakeServer().send, () => true, { maxItems: 3 });
    for (let m = 0; m < 5; m++) await box.enqueue(ev(`2026-11-16T03:0${m}:00.000Z`));
    expect(store.items.map((e) => e.occurredAt)).toEqual([
      '2026-11-16T03:02:00.000Z',
      '2026-11-16T03:03:00.000Z',
      '2026-11-16T03:04:00.000Z',
    ]);
  });

  it('保存期間（7日）を過ぎたものは送信前に破棄する', async () => {
    const store = new MemoryOutboxStore();
    const server = fakeServer();
    const box = new Outbox(store, server.send, () => true);
    await box.enqueue(ev('2026-11-01T00:00:00.000Z'));
    await box.enqueue(ev('2026-11-15T00:00:00.000Z'));
    const r = await box.flush(NOW);
    expect(r.sent).toBe(1);
  });

  it('同意を撤回したら未送信データを端末から削除する', async () => {
    const store = new MemoryOutboxStore();
    let consent = true;
    const box = new Outbox(store, fakeServer().send, () => consent);
    await box.enqueue(ev());
    consent = false;
    await box.onConsentRevoked();
    expect(await store.count()).toBe(0);
  });

  it('同時に flush しても二重送信しない', async () => {
    const store = new MemoryOutboxStore();
    let calls = 0;
    const server = fakeServer();
    const box = new Outbox(
      store,
      async (e) => {
        calls++;
        return server.send(e);
      },
      () => true,
    );
    await box.enqueue(ev());
    await Promise.all([box.flush(NOW), box.flush(NOW), box.flush(NOW)]);
    expect(calls).toBe(1);
  });
});

describe('backoffMs', () => {
  it('30秒から倍々で増え、30分で頭打ち', () => {
    const o = { baseBackoffMs: 30_000, maxBackoffMs: 1_800_000 };
    expect([0, 1, 2, 3, 10].map((n) => backoffMs(n, o))).toEqual([0, 30_000, 60_000, 120_000, 1_800_000]);
  });
});

describe('rotateAnonSessionId（匿名IDの日替わり）', () => {
  it('同じ日は同じID、日付が変わると新しいID', () => {
    let n = 0;
    const gen = () => `id${++n}`;
    const a = rotateAnonSessionId(null, new Date(2026, 10, 16, 9), gen);
    const b = rotateAnonSessionId(a, new Date(2026, 10, 16, 23), gen);
    const c = rotateAnonSessionId(b, new Date(2026, 10, 17, 0, 1), gen);
    expect(a.id).toBe('id1');
    expect(b).toBe(a);
    expect(c.id).toBe('id2');
  });
});
