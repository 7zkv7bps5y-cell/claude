import type { Geometry, Vec2 } from './types';

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

const EPS = 1e-9;

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1;
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - EPS <= p.x &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= p.y &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

/** 線分 p1-p2 と q1-q2 が交差（接触含む）するか */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

/** 点 p から線分 a-b への最近点と、線分上の位置 t（0〜1） */
export function projectToSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: distance(p, point) };
}

/** 点が多角形（外周リング）の内側にあるか（境界上は不定） */
export function pointInRing(p: Vec2, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 図形を構成する線分の一覧（壁との交差判定用） */
export function geometrySegments(g: Geometry): [Vec2, Vec2][] {
  const toV = ([x, y]: [number, number]): Vec2 => ({ x, y });
  const fromLine = (coords: [number, number][]): [Vec2, Vec2][] => {
    const segs: [Vec2, Vec2][] = [];
    for (let i = 0; i + 1 < coords.length; i++) segs.push([toV(coords[i]!), toV(coords[i + 1]!)]);
    return segs;
  };
  if (g.type === 'LineString') return fromLine(g.coordinates);
  if (g.type === 'Polygon') return g.coordinates.flatMap(fromLine);
  return [];
}

export function boundsOf(points: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function geometryPoints(g: Geometry): Vec2[] {
  if (g.type === 'Point') return [{ x: g.coordinates[0], y: g.coordinates[1] }];
  if (g.type === 'LineString') return g.coordinates.map(([x, y]) => ({ x, y }));
  return g.coordinates.flat().map(([x, y]) => ({ x, y }));
}

/** 多角形の重心（ラベル位置用の簡易版：頂点平均ではなく面積重心） */
export function ringCentroid(ring: [number, number][]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j]!;
    const [x1, y1] = ring[i]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < EPS) {
    const n = ring.length || 1;
    return {
      x: ring.reduce((s, [x]) => s + x, 0) / n,
      y: ring.reduce((s, [, y]) => s + y, 0) / n,
    };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}
