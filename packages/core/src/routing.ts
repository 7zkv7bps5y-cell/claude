import { distance, geometrySegments, projectToSegment, segmentsIntersect } from './geometry';
import type { FacilityBundle, NavEdge, NavNode, RouteRule, Vec2 } from './types';

/**
 * 通路ネットワーク上の経路探索（A*）。
 *
 * - 経路は通路ネットワーク（点と線）の上だけを通るため、壁は通過しない。
 *   さらに validateNavGraph() で「壁と交差する通路線」がないことを検査する。
 * - 経路規制（通行禁止・一時封鎖・立入制限・一方通行・推奨ルート）を反映する。
 * - フロア間の移動（isVertical）も同じグラフで扱えるため、複数フロアにそのまま対応できる。
 */

export interface RouteOptions {
  /** 立入制限区域の通行を許可するか（既定: false） */
  allowRestricted?: boolean;
  /** 推奨ルートのコスト係数（既定: 0.6 = 推奨ルートを優先） */
  preferredFactor?: number;
}

export type RouteStart = { nodeId: string } | { floorId: string; point: Vec2 };

export interface RouteResult {
  ok: true;
  /** 経路上の点（出発点が任意地点の場合は先頭が仮の点） */
  path: { x: number; y: number; floorId: string; nodeId: string | null }[];
  distanceM: number;
  edgeIds: string[];
}

export interface RouteFailure {
  ok: false;
  reason: 'unknown_destination' | 'unknown_start' | 'start_not_connected' | 'no_route';
  message: string;
}

interface Arc {
  to: string;
  edgeId: string;
  cost: number;
  length: number;
}

const START_ID = '__start__';

function edgeLength(e: NavEdge, a: NavNode, b: NavNode): number {
  if (e.lengthM !== undefined) return e.lengthM;
  return distance(a, b);
}

function wallSegments(bundle: FacilityBundle, floorId: string): [Vec2, Vec2][] {
  return bundle.features
    .filter((f) => f.floorId === floorId && (f.kind === 'wall' || f.kind === 'obstacle' || f.kind === 'atrium'))
    .flatMap((f) => geometrySegments(f.geometry));
}

function crossesWall(a: Vec2, b: Vec2, walls: [Vec2, Vec2][]): boolean {
  return walls.some(([w1, w2]) => segmentsIntersect(a, b, w1, w2));
}

/** 規制を反映した隣接リストを作る */
function buildGraph(bundle: FacilityBundle, rules: RouteRule[], opts: RouteOptions) {
  const nodes = new Map(bundle.nav.nodes.map((n) => [n.id, n]));
  const blocked = new Set<string>();
  const oneWay = new Set<string>();
  const preferred = new Set<string>();
  for (const r of rules) {
    for (const id of r.edgeIds) {
      if (r.kind === 'closed' || r.kind === 'temporary_closure') blocked.add(id);
      else if (r.kind === 'restricted' && !opts.allowRestricted) blocked.add(id);
      else if (r.kind === 'one_way') oneWay.add(id);
      else if (r.kind === 'preferred') preferred.add(id);
    }
  }
  const pf = opts.preferredFactor ?? 0.6;
  const adj = new Map<string, Arc[]>();
  const push = (from: string, arc: Arc) => {
    const list = adj.get(from);
    if (list) list.push(arc);
    else adj.set(from, [arc]);
  };
  for (const e of bundle.nav.edges) {
    if (blocked.has(e.id)) continue;
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) continue;
    const len = edgeLength(e, a, b);
    const cost = len * (e.costFactor ?? 1) * (preferred.has(e.id) ? pf : 1);
    push(e.from, { to: e.to, edgeId: e.id, cost, length: len });
    if (e.direction === 'both' && !oneWay.has(e.id)) push(e.to, { to: e.from, edgeId: e.id, cost, length: len });
  }
  // A* のヒューリスティックが実コストを超えないよう、最小のコスト係数を求める
  let minFactor = Math.min(1, preferred.size > 0 ? pf : 1);
  for (const e of bundle.nav.edges) minFactor = Math.min(minFactor, (e.costFactor ?? 1) * (preferred.has(e.id) ? pf : 1));
  return { nodes, adj, blocked, oneWay, minFactor: Math.max(0, minFactor) };
}

/** 二分ヒープ（優先度付きキュー） */
class MinHeap<T> {
  private items: { k: number; v: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(k: number, v: T) {
    const a = this.items;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.k <= a[i]!.k) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!.v;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.k < a[m]!.k) m = l;
        if (r < a.length && a[r]!.k < a[m]!.k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function findRoute(
  bundle: FacilityBundle,
  start: RouteStart,
  destinationNodeId: string,
  rules: RouteRule[] = [],
  opts: RouteOptions = {},
): RouteResult | RouteFailure {
  const { nodes, adj, blocked, oneWay, minFactor } = buildGraph(bundle, rules, opts);
  const goal = nodes.get(destinationNodeId);
  if (!goal) return { ok: false, reason: 'unknown_destination', message: '目的地が見つかりません。' };

  let startId: string;
  let startPos: { x: number; y: number; floorId: string };
  if ('nodeId' in start) {
    const s = nodes.get(start.nodeId);
    if (!s) return { ok: false, reason: 'unknown_start', message: '出発地が見つかりません。' };
    startId = s.id;
    startPos = { x: s.x, y: s.y, floorId: s.floorId };
  } else {
    // 任意地点からの出発: 壁を越えずに到達できる最寄りの通路線へ接続する
    const walls = wallSegments(bundle, start.floorId);
    let best: { edge: NavEdge; point: Vec2; t: number; dist: number } | null = null;
    for (const e of bundle.nav.edges) {
      if (blocked.has(e.id) || e.isVertical) continue;
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b || a.floorId !== start.floorId || b.floorId !== start.floorId) continue;
      const pr = projectToSegment(start.point, a, b);
      if (best && pr.dist >= best.dist) continue;
      if (pr.dist > 1e-6 && crossesWall(start.point, pr.point, walls)) continue;
      best = { edge: e, ...pr };
    }
    if (!best) {
      return {
        ok: false,
        reason: 'start_not_connected',
        message: '出発地の近くに通れる通路が見つかりません。出発地を通路の近くに指定してください。',
      };
    }
    startId = START_ID;
    startPos = { x: start.point.x, y: start.point.y, floorId: start.floorId };
    const a = nodes.get(best.edge.from)!;
    const b = nodes.get(best.edge.to)!;
    const factor = best.edge.costFactor ?? 1;
    const toA = best.dist + distance(best.point, a);
    const toB = best.dist + distance(best.point, b);
    const arcs: Arc[] = [{ to: b.id, edgeId: best.edge.id, cost: toB * factor, length: toB }];
    // from→to のみの通路では、逆方向（from 側）へは進めない
    if (best.edge.direction === 'both' && !oneWay.has(best.edge.id)) {
      arcs.push({ to: a.id, edgeId: best.edge.id, cost: toA * factor, length: toA });
    }
    adj.set(START_ID, arcs);
  }

  const posOf = (id: string) => (id === START_ID ? startPos : nodes.get(id)!);
  const h = (id: string) => {
    const p = posOf(id);
    // 直線距離 × 最小コスト係数 は実コスト以下なので、最短経路を正しく求められる（許容的ヒューリスティック）。
    // 別フロアの場合も直線距離（平面上）は実際の移動距離以下。
    return distance(p, goal) * minFactor;
  };

  const g = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, { from: string; edgeId: string; length: number }>();
  const closed = new Set<string>();
  const heap = new MinHeap<string>();
  heap.push(h(startId), startId);

  while (heap.size > 0) {
    const cur = heap.pop()!;
    if (closed.has(cur)) continue;
    if (cur === goal.id) break;
    closed.add(cur);
    const gc = g.get(cur)!;
    for (const arc of adj.get(cur) ?? []) {
      if (closed.has(arc.to)) continue;
      const ng = gc + arc.cost;
      if (ng < (g.get(arc.to) ?? Infinity)) {
        g.set(arc.to, ng);
        prev.set(arc.to, { from: cur, edgeId: arc.edgeId, length: arc.length });
        heap.push(ng + h(arc.to), arc.to);
      }
    }
  }

  if (!g.has(goal.id)) {
    return {
      ok: false,
      reason: 'no_route',
      message: '通行できる経路が見つかりません。通行止めや立入制限の可能性があります。',
    };
  }

  const ids: string[] = [];
  const edgeIds: string[] = [];
  let distanceM = 0;
  for (let id: string | undefined = goal.id; id !== undefined; ) {
    ids.push(id);
    const p = prev.get(id);
    if (!p) break;
    edgeIds.push(p.edgeId);
    distanceM += p.length;
    id = p.from;
  }
  ids.reverse();
  edgeIds.reverse();
  return {
    ok: true,
    path: ids.map((id) => {
      const p = posOf(id);
      return { x: p.x, y: p.y, floorId: p.floorId, nodeId: id === START_ID ? null : id };
    }),
    distanceM,
    edgeIds,
  };
}

export interface NavGraphIssue {
  type: 'edge_crosses_wall' | 'dangling_edge' | 'isolated_node' | 'store_entrance_missing';
  id: string;
  message: string;
}

/** 通路ネットワークの検査（管理画面での警告・自動テストに使用） */
export function validateNavGraph(bundle: FacilityBundle): NavGraphIssue[] {
  const issues: NavGraphIssue[] = [];
  const nodes = new Map(bundle.nav.nodes.map((n) => [n.id, n]));
  const wallsByFloor = new Map<string, [Vec2, Vec2][]>();
  const used = new Set<string>();
  for (const e of bundle.nav.edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    if (!a || !b) {
      issues.push({ type: 'dangling_edge', id: e.id, message: `通路線 ${e.id} の端点が存在しません` });
      continue;
    }
    used.add(a.id);
    used.add(b.id);
    if (e.isVertical || a.floorId !== b.floorId) continue;
    let walls = wallsByFloor.get(a.floorId);
    if (!walls) {
      walls = wallSegments(bundle, a.floorId);
      wallsByFloor.set(a.floorId, walls);
    }
    if (crossesWall(a, b, walls)) {
      issues.push({ type: 'edge_crosses_wall', id: e.id, message: `通路線 ${e.id} が壁と交差しています` });
    }
  }
  for (const n of bundle.nav.nodes) {
    if (!used.has(n.id)) issues.push({ type: 'isolated_node', id: n.id, message: `通路点 ${n.id} がどこにもつながっていません` });
  }
  for (const s of bundle.stores) {
    if (!nodes.has(s.entranceNodeId)) {
      issues.push({ type: 'store_entrance_missing', id: s.id, message: `店舗 ${s.name} の入口点が存在しません` });
    }
  }
  return issues;
}
