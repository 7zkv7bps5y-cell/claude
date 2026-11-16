import { findRoute, searchStores, validateBundle, validateNavGraph } from '@facility-nav/core';
import { describe, expect, it } from 'vitest';
import { sampleFacility } from '../src';

describe('【サンプル】テストモールのデータ', () => {
  it('サンプルであることが明示されている', () => {
    expect(sampleFacility.facility.isSample).toBe(true);
    expect(sampleFacility.facility.name).toContain('【サンプル】');
    for (const s of sampleFacility.stores) expect(s.description).toMatch(/^【サンプル】/);
  });

  it('形式チェックに合格する', () => {
    expect(validateBundle(sampleFacility)).toMatchObject({ ok: true });
  });

  it('通路ネットワークに問題がない（壁と交差する通路線・孤立点なし）', () => {
    expect(validateNavGraph(sampleFacility)).toEqual([]);
  });

  it('すべての出入口からすべての店舗へ経路がある', () => {
    const entrances = sampleFacility.nav.nodes.filter((n) => n.kind === 'entrance');
    expect(entrances.length).toBe(3);
    for (const e of entrances) {
      for (const s of sampleFacility.stores) {
        const r = findRoute(sampleFacility, { nodeId: e.id }, s.entranceNodeId);
        expect(r.ok, `${e.id} → ${s.name}`).toBe(true);
      }
    }
  });

  it('店舗の中から出発しても壁を越えずに経路が出る', () => {
    // 店舗A（北西）の内部から、店舗H（南東）へ
    const r = findRoute(sampleFacility, { floorId: sampleFacility.floors[0]!.id, point: { x: 3, y: 27 } }, 'door-H');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 最初の接続先は店舗A内の通路線（扉経由）
      expect(r.edgeIds[0]).toBe(sampleFacility.nav.edges.find((e) => e.from === 'door-A' && e.to === 'in-A')!.id);
    }
  });

  it('検索：読み仮名・カテゴリーで見つかる', () => {
    expect(searchStores(sampleFacility, 'かふぇ')[0]?.store.name).toBe('カフェ・テスト');
    expect(searchStores(sampleFacility, '飲食').length).toBe(3);
  });
});
