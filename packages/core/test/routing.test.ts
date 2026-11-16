import { describe, expect, it } from 'vitest';
import { activeRulesAt, findRoute, validateNavGraph } from '../src';
import { makeBundle, rule } from './fixtures';

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(`経路が見つからない: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('findRoute（A*経路探索）', () => {
  it('最短経路を返す', () => {
    const r = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C'));
    expect(r.path.map((p) => p.nodeId)).toEqual(['A', 'B', 'C']);
    expect(r.distanceM).toBeCloseTo(20);
  });

  it('通行禁止の通路を通らない（迂回する）', () => {
    const r = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('closed', ['BC'])]));
    expect(r.edgeIds).not.toContain('BC');
    expect(r.path.map((p) => p.nodeId)).toEqual(['A', 'B', 'D', 'E', 'C']);
  });

  it('一時封鎖・立入制限も通らない', () => {
    for (const kind of ['temporary_closure', 'restricted'] as const) {
      const r = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule(kind, ['BC'])]));
      expect(r.edgeIds).not.toContain('BC');
    }
  });

  it('立入制限は allowRestricted で通行可能にできる', () => {
    const r = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('restricted', ['BC'])], { allowRestricted: true }));
    expect(r.edgeIds).toContain('BC');
  });

  it('一方通行を逆走しない', () => {
    // C→B 方向に進む必要がある経路（C から A へ）で、BC を B→C のみに制限
    const r = ok(findRoute(makeBundle(), { nodeId: 'C' }, 'A', [rule('one_way', ['BC'])]));
    expect(r.edgeIds).not.toContain('BC');
    // 順方向なら通れる
    const r2 = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('one_way', ['BC'])]));
    expect(r2.edgeIds).toContain('BC');
  });

  it('恒常的な一方通行（direction=forward）も逆走しない', () => {
    const b = makeBundle();
    b.nav.edges.find((e) => e.id === 'BC')!.direction = 'forward';
    const r = ok(findRoute(b, { nodeId: 'C' }, 'A'));
    expect(r.edgeIds).not.toContain('BC');
  });

  it('推奨ルートを優先する', () => {
    // 通常は B-C(10m)。B-D-E-C(30m) は既定の係数0.6では18相当で、B-C の方が短い
    const normal = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('preferred', ['BD', 'DE', 'EC'])]));
    expect(normal.edgeIds).toContain('BC');
    // 係数0.3なら 9 相当になり、推奨ルートが優先される
    const r = ok(
      findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('preferred', ['BD', 'DE', 'EC'])], { preferredFactor: 0.3 }),
    );
    expect(r.path.map((p) => p.nodeId)).toEqual(['A', 'B', 'D', 'E', 'C']);
    expect(r.distanceM).toBeCloseTo(40); // 表示する距離は実際の距離
  });

  it('経路がない場合は理由つきで失敗する', () => {
    const r = findRoute(makeBundle(), { nodeId: 'A' }, 'C', [rule('closed', ['AB'])]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no_route');
      expect(r.message).toContain('通行できる経路');
    }
  });

  it('存在しない目的地・出発地はエラー', () => {
    expect(findRoute(makeBundle(), { nodeId: 'A' }, 'ZZZ')).toMatchObject({ ok: false, reason: 'unknown_destination' });
    expect(findRoute(makeBundle(), { nodeId: 'ZZZ' }, 'A')).toMatchObject({ ok: false, reason: 'unknown_start' });
  });

  it('任意地点から出発できる（最寄りの通路線に接続）', () => {
    const r = ok(findRoute(makeBundle(), { floorId: '1F', point: { x: 5, y: 1 } }, 'C'));
    expect(r.path[0]).toMatchObject({ nodeId: null, x: 5, y: 1 });
    expect(r.path.at(-1)?.nodeId).toBe('C');
    // 5,1 → AB上の(5,0)へ1m → Bへ5m → Cへ10m
    expect(r.distanceM).toBeCloseTo(16);
  });

  it('任意地点からの接続で壁を越えない', () => {
    // 壁 x=15（y=-5〜5）。点(16,1) から最寄りの BC 線上 (16,0) へは壁を越えないので接続できる
    const b = makeBundle({ wallAcrossBC: true });
    b.nav.edges = b.nav.edges.filter((e) => e.id !== 'BC'); // 壁と交差する線は使わない
    const r = ok(findRoute(b, { floorId: '1F', point: { x: 14, y: 1 } }, 'A'));
    // (14,1) の最寄りは AB 線上 (10,0)... ただし AB 線は x<=10。壁は x=15 なので越えない
    expect(r.path.at(-1)?.nodeId).toBe('A');
  });

  it('壁の向こう側の通路線には接続しない', () => {
    const b = makeBundle({ wallAcrossBC: true });
    // 通路線は BC のみ残し、x=16 の点から x<15 側の線へは壁で遮られる構成にする
    b.nav.edges = [{ id: 'CE', from: 'C', to: 'E', direction: 'both' }, { id: 'AB', from: 'A', to: 'B', direction: 'both' }];
    // 点(14,0.5)：AB線(10,0)まで壁なし → 接続可、CE線(20,0.5)は壁 x=15 を越えるので不可
    const r = ok(findRoute(b, { floorId: '1F', point: { x: 14, y: 0.5 } }, 'A'));
    expect(r.edgeIds).toEqual(['AB']);
    // CE へは壁越えになるので接続されず、到達不能
    const r2 = findRoute(b, { floorId: '1F', point: { x: 14, y: 0.5 } }, 'E');
    expect(r2.ok).toBe(false);
  });

  it('通路がまったくない場所からはエラー', () => {
    const b = makeBundle();
    const r = findRoute(b, { floorId: '2F', point: { x: 0, y: 0 } }, 'A');
    expect(r).toMatchObject({ ok: false, reason: 'start_not_connected' });
  });

  it('複数フロア：エレベーター（isVertical）経由で別フロアへ行ける', () => {
    const r = ok(findRoute(makeBundle(), { nodeId: 'A' }, 'F'));
    expect(r.path.map((p) => p.nodeId)).toEqual(['A', 'B', 'F']);
    expect(r.path.at(-1)?.floorId).toBe('2F');
    expect(r.distanceM).toBeCloseTo(18);
  });
});

describe('activeRulesAt（期間つき規制）', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  it('期間外の規制は除外し、期間内の規制だけを返す', () => {
    const rules = [
      rule('closed', ['a'], { id: 'past', endsAt: '2026-11-16T11:00:00Z' }),
      rule('closed', ['b'], { id: 'future', startsAt: '2026-11-16T13:00:00Z' }),
      rule('closed', ['c'], { id: 'now', startsAt: '2026-11-16T11:00:00Z', endsAt: '2026-11-16T13:00:00Z' }),
      rule('closed', ['d'], { id: 'open-ended' }),
    ];
    expect(activeRulesAt(rules, now).map((r) => r.id)).toEqual(['now', 'open-ended']);
  });

  it('オフラインでも時刻経過で規制が自動解除・自動適用される', () => {
    const b = makeBundle();
    const rules = [rule('temporary_closure', ['BC'], { startsAt: '2026-11-16T10:00:00Z', endsAt: '2026-11-16T14:00:00Z' })];
    const during = ok(findRoute(b, { nodeId: 'A' }, 'C', activeRulesAt(rules, now)));
    expect(during.edgeIds).not.toContain('BC');
    const after = ok(findRoute(b, { nodeId: 'A' }, 'C', activeRulesAt(rules, new Date('2026-11-16T15:00:00Z'))));
    expect(after.edgeIds).toContain('BC');
  });
});

describe('validateNavGraph（通路ネットワークの検査）', () => {
  it('壁と交差する通路線を検出する', () => {
    const issues = validateNavGraph(makeBundle({ wallAcrossBC: true }));
    expect(issues.filter((i) => i.type === 'edge_crosses_wall').map((i) => i.id)).toEqual(['BC']);
  });

  it('問題がなければ空', () => {
    expect(validateNavGraph(makeBundle())).toEqual([]);
  });

  it('端点のない線・孤立点・入口のない店舗を検出する', () => {
    const b = makeBundle({ extraEdges: [{ id: 'X', from: 'A', to: 'NOPE', direction: 'both' }] });
    b.nav.nodes.push({ id: 'LONELY', floorId: '1F', x: 99, y: 99, kind: 'normal' });
    b.stores[0]!.entranceNodeId = 'MISSING';
    const types = validateNavGraph(b).map((i) => i.type).sort();
    expect(types).toEqual(['dangling_edge', 'isolated_node', 'store_entrance_missing']);
  });
});
