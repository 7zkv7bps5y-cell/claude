import { validateBundle } from './bundle';
import type { FacilityBundle, RouteRule, RouteRulesSnapshot, RuleFreshnessSettings } from './types';

/**
 * 施設データ・経路規制情報の取得と端末保存（オフライン対応）。設計書 4-3。
 *
 * - 起動時は端末に保存済みのデータで即座に表示（なければアプリ内蔵のサンプル）
 * - 通信できるときにサーバーの公開版番号だけを確認し、新しければ全体を取得
 * - 取得したデータは形式チェックに合格した場合のみ保存（壊れたデータで上書きしない）
 * - 直前の版を1つ保持する
 * - 経路規制情報は取得時刻つきで保存し、鮮度判定（rules.ts）に使う
 */

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface FacilityApi {
  getVersion(facilityId: string): Promise<{ versionNo: number; publishedAt: string } | null>;
  getBundle(facilityId: string): Promise<unknown>;
  getRules(facilityId: string): Promise<{ serverTime: string; rules: RouteRule[]; freshness?: RuleFreshnessSettings }>;
}

export type BundleSource = 'cache' | 'embedded';

export interface StoredBundle {
  bundle: FacilityBundle;
  savedAt: string;
}

export interface RefreshReport {
  online: boolean;
  bundle: 'updated' | 'up_to_date' | 'not_published' | 'invalid' | 'error' | 'skipped';
  rules: 'updated' | 'error' | 'skipped';
  errors: string[];
}

const kBundle = (id: string) => `facility:${id}:bundle`;
const kPrevBundle = (id: string) => `facility:${id}:bundle_prev`;
const kRules = (id: string) => `facility:${id}:rules`;

export class FacilityDataSync {
  constructor(
    private readonly kv: KeyValueStore,
    private readonly api: FacilityApi | null,
    readonly facilityId: string,
    private readonly embedded: FacilityBundle | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadBundle(): Promise<{ bundle: FacilityBundle; source: BundleSource; savedAt: string | null } | null> {
    const raw = await this.kv.getItem(kBundle(this.facilityId));
    if (raw) {
      try {
        const stored = JSON.parse(raw) as StoredBundle;
        const v = validateBundle(stored.bundle);
        if (v.ok) return { bundle: v.bundle, source: 'cache', savedAt: stored.savedAt };
      } catch {
        // 壊れた保存データは無視して内蔵データにフォールバック
      }
    }
    if (this.embedded && this.embedded.facility.id === this.facilityId) {
      return { bundle: this.embedded, source: 'embedded', savedAt: null };
    }
    return null;
  }

  async loadRules(): Promise<RouteRulesSnapshot | null> {
    const raw = await this.kv.getItem(kRules(this.facilityId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RouteRulesSnapshot;
    } catch {
      return null;
    }
  }

  /** 保存済みの直前の版に戻す（新しい版に問題があった場合） */
  async rollbackToPrevious(): Promise<boolean> {
    const prev = await this.kv.getItem(kPrevBundle(this.facilityId));
    if (!prev) return false;
    await this.kv.setItem(kBundle(this.facilityId), prev);
    await this.kv.removeItem(kPrevBundle(this.facilityId));
    return true;
  }

  async refresh(opts: { simulateOffline?: boolean } = {}): Promise<RefreshReport> {
    const report: RefreshReport = { online: false, bundle: 'skipped', rules: 'skipped', errors: [] };
    if (!this.api || opts.simulateOffline) return report;

    // 1) 公開版番号の確認 → 必要なら全体取得
    try {
      const remote = await this.api.getVersion(this.facilityId);
      report.online = true;
      if (!remote) {
        report.bundle = 'not_published';
      } else {
        const current = await this.loadBundle();
        const currentNo = current?.source === 'cache' ? current.bundle.version.versionNo : -1;
        if (remote.versionNo === currentNo) {
          report.bundle = 'up_to_date';
        } else {
          const data = await this.api.getBundle(this.facilityId);
          const v = validateBundle(data);
          if (!v.ok) {
            report.bundle = 'invalid';
            report.errors.push(...v.errors);
          } else if (v.bundle.facility.id !== this.facilityId) {
            report.bundle = 'invalid';
            report.errors.push('別の施設のデータが返されました');
          } else {
            const prev = await this.kv.getItem(kBundle(this.facilityId));
            if (prev) await this.kv.setItem(kPrevBundle(this.facilityId), prev);
            const stored: StoredBundle = { bundle: v.bundle, savedAt: this.now().toISOString() };
            // 1回の書き込みで差し替える（途中で失敗しても古い版が残る）
            await this.kv.setItem(kBundle(this.facilityId), JSON.stringify(stored));
            report.bundle = 'updated';
          }
        }
      }
    } catch (e) {
      report.bundle = 'error';
      report.errors.push(`施設データ: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2) 経路規制情報（地図とは別に、毎回取得を試みる）
    try {
      const r = await this.api.getRules(this.facilityId);
      report.online = true;
      const snapshot: RouteRulesSnapshot = {
        facilityId: this.facilityId,
        fetchedAt: this.now().toISOString(),
        serverTime: r.serverTime,
        rules: r.rules,
        ...(r.freshness ? { freshness: r.freshness } : {}),
      };
      await this.kv.setItem(kRules(this.facilityId), JSON.stringify(snapshot));
      report.rules = 'updated';
    } catch (e) {
      report.rules = 'error';
      report.errors.push(`通行規制情報: ${e instanceof Error ? e.message : String(e)}`);
    }
    return report;
  }
}

export class MemoryKeyValueStore implements KeyValueStore {
  map = new Map<string, string>();
  async getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  async removeItem(k: string) {
    this.map.delete(k);
  }
}
