import { describeRoute, findRoute, nextVenueState, routeFloors, searchStores, validateBundle, validateNavGraph } from '@facility-nav/core';
import { describe, expect, it } from 'vitest';
import { sampleFacility as b } from '../src';

const F1 = b.floors[0]!.id;
const F2 = b.floors[1]!.id;
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe('【サンプル】テストモールのデータ', () => {
  it('サンプルであることが明示されている', () => {
    expect(b.facility.isSample).toBe(true);
    expect(b.facility.name).toContain('【サンプル】');
    for (const s of b.stores) expect(s.description).toMatch(/^【サンプル】/);
  });

  it('2フロア・40店舗・敷地範囲あり', () => {
    expect(b.floors.map((f) => f.name)).toEqual(['1F', '2F']);
    expect(b.stores).toHaveLength(40);
    expect(b.facility.boundary?.length).toBeGreaterThanOrEqual(3);
  });

  it('形式チェックに合格する', () => {
    expect(validateBundle(b)).toMatchObject({ ok: true });
  });

  it('通路ネットワークに問題がない（壁・吹き抜けと交差する通路線・孤立点なし）', () => {
    expect(validateNavGraph(b)).toEqual([]);
  });

  it('すべての出入口からすべての店舗へ経路がある（2Fへはフロア移動を含む）', () => {
    const entrances = b.nav.nodes.filter((n) => n.kind === 'entrance');
    expect(entrances.map((e) => e.name).sort()).toEqual(['南口', '東口', '西口'].sort());
    for (const e of entrances) {
      for (const s of b.stores) expect(findRoute(b, { nodeId: e.id }, s.entranceNodeId).ok, `${e.name} → ${s.name}`).toBe(true);
    }
  });

  it('2Fの店舗から1Fの出口へも戻れる（下りはエスカレーター東・エレベーター・階段）', () => {
    const r = ok(findRoute(b, { nodeId: 'door-2F-N1' }, 'ent-south'));
    expect(routeFloors(r)).toEqual([F2, F1]);
    expect(r.edgeIds).not.toContain(b.nav.edges.find((e) => e.from === '1F-es-w')!.id); // 上りエスカレーターは逆走しない
  });

  it('エスカレーターが止まっていてもエレベーターか階段で行ける', () => {
    const esEdges = b.nav.edges.filter((e) => e.isVertical && e.from.includes('-es-')).map((e) => e.id);
    const r = ok(findRoute(b, { nodeId: 'ent-south' }, 'door-2F-N1', [
      { id: 'r', kind: 'closed', severity: 'normal', edgeIds: esEdges, startsAt: null, endsAt: null },
    ]));
    expect(routeFloors(r)).toEqual([F1, F2]);
  });

  it('2Fでは吹き抜けを避けて回り込む', () => {
    const r = ok(findRoute(b, { nodeId: 'door-2F-N5' }, 'door-2F-N6'));
    const ys = r.path.map((p) => p.y);
    expect(ys.some((y) => y === 31.5 || y === 38.5)).toBe(true);
  });

  it('店舗の中から出発しても壁を越えずに入口経由で経路が出る', () => {
    const r = ok(findRoute(b, { floorId: F1, point: { x: 5, y: 60 } }, 'door-1F-S10'));
    expect(r.edgeIds[0]).toBe(b.nav.edges.find((e) => e.from === 'door-1F-N1' && e.to === 'in-1F-N1')!.id);
  });

  it('案内文にフロア移動が含まれる', () => {
    const r = ok(findRoute(b, { nodeId: 'ent-south' }, 'door-2F-S1'));
    const steps = describeRoute(b, r, { start: '南口', destination: 'ラーメン・テスト' });
    expect(steps.map((s) => s.text).join(' / ')).toMatch(/1F 南口から出発.*エスカレーターで2Fへ.*2F ラーメン・テストに到着/);
  });

  it('検索：読み仮名・カテゴリーで見つかる', () => {
    expect(searchStores(b, 'かふぇ')[0]?.store.name).toBe('カフェ・テスト');
    expect(searchStores(b, '飲食').length).toBe(12);
  });

  it('屋内・屋外の判定（敷地の内外・境界付近は前の状態を維持）', () => {
    expect(nextVenueState('unknown', b, { x: 80, y: 35 }, 10)).toBe('inside');
    expect(nextVenueState('inside', b, { x: 400, y: 35 }, 10)).toBe('outside');
    expect(nextVenueState('inside', b, { x: 185, y: 35 }, 10)).toBe('inside'); // 敷地から5mは維持
    expect(nextVenueState('outside', b, { x: 80, y: 35 }, 200)).toBe('outside'); // 誤差が大きいときは切り替えない
  });
});
