import { describe, expect, it } from 'vitest';
import {
  FacilityDataSync,
  lngLatToLocal,
  localToLngLat,
  MemoryKeyValueStore,
  normalizeForSearch,
  searchStores,
  segmentsIntersect,
  validateBundle,
  type FacilityApi,
} from '../src';
import { makeBundle, rule } from './fixtures';

describe('座標変換', () => {
  it('ローカル座標 ⇔ 緯度経度 が往復で一致する（回転あり）', () => {
    const fac = { origin: { lat: 35.68, lng: 139.76 }, rotationDeg: 30 };
    for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: -50, y: 200 }]) {
      const back = lngLatToLocal(localToLngLat(p, fac), fac);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });
  it('北に111m ≒ 緯度0.001度', () => {
    const [, lat] = localToLngLat({ x: 0, y: 111.32 }, { origin: { lat: 35, lng: 135 }, rotationDeg: 0 });
    expect(lat - 35).toBeCloseTo(0.001, 5);
  });
});

describe('幾何', () => {
  it('線分の交差判定', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 })).toBe(true);
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: -1 }, { x: 5, y: 1 })).toBe(false);
  });
});

describe('検索（日本語の正規化）', () => {
  it('カタカナ・ひらがな・全角半角の違いを吸収する', () => {
    expect(normalizeForSearch('カフェ')).toBe(normalizeForSearch('かふぇ'));
    expect(normalizeForSearch('ｶﾌｪ')).toBe('かふぇ');
    expect(normalizeForSearch('ＡＢＣ ｄｅｆ')).toBe('abcdef');
  });
  it('名前・読み・カテゴリーで検索でき、非表示の店舗は出ない', () => {
    const b = makeBundle();
    expect(searchStores(b, 'カフ').map((h) => h.store.id)).toEqual(['s1']);
    expect(searchStores(b, '飲食').map((h) => h.store.id)).toEqual(['s1']);
    expect(searchStores(b, 'ない')).toEqual([]);
    b.stores[0]!.isVisible = false;
    expect(searchStores(b, 'カフェ')).toEqual([]);
  });
});

describe('validateBundle', () => {
  it('正しいデータは合格', () => {
    expect(validateBundle(makeBundle()).ok).toBe(true);
  });
  it('壊れたデータは不合格', () => {
    expect(validateBundle(null).ok).toBe(false);
    expect(validateBundle({ schemaVersion: 99 }).ok).toBe(false);
    const b = makeBundle();
    b.stores[0]!.entranceNodeId = 'nope';
    expect(validateBundle(b)).toMatchObject({ ok: false });
  });
});

describe('FacilityDataSync（施設データのオフライン保存）', () => {
  const embedded = makeBundle();
  const at = new Date('2026-11-16T03:00:00.000Z');

  function api(versionNo: number, overrides: Partial<FacilityApi> = {}): FacilityApi & { bundleCalls: number } {
    const self = {
      bundleCalls: 0,
      async getVersion() {
        return { versionNo, publishedAt: at.toISOString() };
      },
      async getBundle() {
        self.bundleCalls++;
        const b = makeBundle();
        b.version.versionNo = versionNo;
        return b;
      },
      async getRules() {
        return { serverTime: at.toISOString(), rules: [rule('closed', ['BC'])] };
      },
      ...overrides,
    };
    return self;
  }

  it('保存データがなく通信もできない場合は内蔵データで表示する', async () => {
    const s = new FacilityDataSync(new MemoryKeyValueStore(), null, 'fac-test', embedded);
    expect((await s.loadBundle())?.source).toBe('embedded');
    expect(await s.loadRules()).toBeNull();
  });

  it('新しい版を取得して保存し、オフラインでも保存データで表示できる', async () => {
    const kv = new MemoryKeyValueStore();
    const online = new FacilityDataSync(kv, api(3), 'fac-test', embedded, () => at);
    const rep = await online.refresh();
    expect(rep).toMatchObject({ online: true, bundle: 'updated', rules: 'updated' });

    const offline = new FacilityDataSync(kv, null, 'fac-test', embedded);
    const loaded = await offline.loadBundle();
    expect(loaded).toMatchObject({ source: 'cache' });
    expect(loaded?.bundle.version.versionNo).toBe(3);
    expect((await offline.loadRules())?.rules).toHaveLength(1);
    expect((await offline.loadRules())?.fetchedAt).toBe(at.toISOString());
  });

  it('版番号が同じなら全体を取得しない', async () => {
    const kv = new MemoryKeyValueStore();
    const a = api(3);
    const s = new FacilityDataSync(kv, a, 'fac-test', embedded, () => at);
    await s.refresh();
    const rep = await s.refresh();
    expect(rep.bundle).toBe('up_to_date');
    expect(a.bundleCalls).toBe(1);
  });

  it('壊れたデータを受け取っても保存済みデータを上書きしない', async () => {
    const kv = new MemoryKeyValueStore();
    await new FacilityDataSync(kv, api(3), 'fac-test', embedded, () => at).refresh();
    const bad = api(4, { getBundle: async () => ({ schemaVersion: 1, broken: true }) });
    const rep = await new FacilityDataSync(kv, bad, 'fac-test', embedded, () => at).refresh();
    expect(rep.bundle).toBe('invalid');
    const loaded = await new FacilityDataSync(kv, null, 'fac-test', embedded).loadBundle();
    expect(loaded?.bundle.version.versionNo).toBe(3);
  });

  it('取得途中で通信が切れても古い版で動き続ける', async () => {
    const kv = new MemoryKeyValueStore();
    await new FacilityDataSync(kv, api(3), 'fac-test', embedded, () => at).refresh();
    const failing = api(4, {
      getBundle: async () => {
        throw new Error('network lost');
      },
      getRules: async () => {
        throw new Error('network lost');
      },
    });
    const rep = await new FacilityDataSync(kv, failing, 'fac-test', embedded, () => at).refresh();
    expect(rep).toMatchObject({ bundle: 'error', rules: 'error' });
    const s = new FacilityDataSync(kv, null, 'fac-test', embedded);
    expect((await s.loadBundle())?.bundle.version.versionNo).toBe(3);
    // 規制情報も前回取得分が残り、取得時刻で鮮度判定できる
    expect((await s.loadRules())?.fetchedAt).toBe(at.toISOString());
  });

  it('直前の版に戻せる', async () => {
    const kv = new MemoryKeyValueStore();
    await new FacilityDataSync(kv, api(3), 'fac-test', embedded, () => at).refresh();
    const s = new FacilityDataSync(kv, api(4), 'fac-test', embedded, () => at);
    await s.refresh();
    expect((await s.loadBundle())?.bundle.version.versionNo).toBe(4);
    expect(await s.rollbackToPrevious()).toBe(true);
    expect((await s.loadBundle())?.bundle.version.versionNo).toBe(3);
  });

  it('オフラインを模擬した場合は通信しない', async () => {
    const a = api(3);
    const rep = await new FacilityDataSync(new MemoryKeyValueStore(), a, 'fac-test', embedded).refresh({ simulateOffline: true });
    expect(rep).toMatchObject({ online: false, bundle: 'skipped', rules: 'skipped' });
    expect(a.bundleCalls).toBe(0);
  });
});
