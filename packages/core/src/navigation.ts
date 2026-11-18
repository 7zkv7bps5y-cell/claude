import { pointInRing } from './geometry';
import type { RouteResult } from './routing';
import type { FacilityBundle, Vec2 } from './types';

/**
 * 経路の案内文（フロアの移動を含む）と、屋内・屋外の判定。
 */

export interface RouteStep {
  kind: 'start' | 'walk' | 'floor_change' | 'arrive';
  floorId: string;
  text: string;
}

const VERTICAL_LABEL: Record<string, string> = {
  escalator: 'エスカレーター',
  elevator: 'エレベーター',
  stairs: '階段',
};

/** 経路を「出発 → 歩く → フロア移動 → … → 到着」の案内文にまとめる */
export function describeRoute(
  bundle: FacilityBundle,
  route: RouteResult,
  labels: { start: string; destination: string },
): RouteStep[] {
  const floorName = new Map(bundle.floors.map((f) => [f.id, f.name]));
  const nodes = new Map(bundle.nav.nodes.map((n) => [n.id, n]));
  const steps: RouteStep[] = [];
  const first = route.path[0];
  const last = route.path[route.path.length - 1];
  if (!first || !last) return steps;
  steps.push({ kind: 'start', floorId: first.floorId, text: `${floorName.get(first.floorId) ?? ''} ${labels.start}から出発` });
  let segStart = 0;
  for (let i = 1; i < route.path.length; i++) {
    const a = route.path[i - 1]!;
    const b = route.path[i]!;
    if (a.floorId !== b.floorId) {
      const meters = segmentLength(route.path.slice(segStart, i));
      if (meters >= 1) steps.push({ kind: 'walk', floorId: a.floorId, text: `約${Math.round(meters)}m 進む` });
      const via = (a.nodeId && nodes.get(a.nodeId)?.kind) || '';
      steps.push({
        kind: 'floor_change',
        floorId: b.floorId,
        text: `${VERTICAL_LABEL[via] ?? '移動手段'}で${floorName.get(b.floorId) ?? ''}へ`,
      });
      segStart = i;
    }
  }
  const meters = segmentLength(route.path.slice(segStart));
  if (meters >= 1) steps.push({ kind: 'walk', floorId: last.floorId, text: `約${Math.round(meters)}m 進む` });
  steps.push({ kind: 'arrive', floorId: last.floorId, text: `${floorName.get(last.floorId) ?? ''} ${labels.destination}に到着` });
  return steps;
}

function segmentLength(pts: { x: number; y: number }[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return d;
}

/** 経路が通るフロアの一覧（順番どおり、重複なし） */
export function routeFloors(route: RouteResult): string[] {
  const out: string[] = [];
  for (const p of route.path) if (out[out.length - 1] !== p.floorId) out.push(p.floorId);
  return out;
}

/**
 * 屋内・屋外の判定（ちらつき防止つき）。
 * - 敷地の内側で、GPSの誤差が大きすぎない場合に「屋内」へ切替
 * - 敷地から outsideMarginM 以上離れた場合に「屋外」へ切替（境界付近では前の状態を維持）
 */
export function nextVenueState(
  prev: 'inside' | 'outside' | 'unknown',
  bundle: FacilityBundle,
  p: Vec2,
  accuracyM: number,
  opts: { maxAccuracyM?: number; outsideMarginM?: number } = {},
): 'inside' | 'outside' | 'unknown' {
  const ring = bundle.facility.boundary;
  if (!ring || ring.length < 3) return 'unknown';
  const maxAcc = opts.maxAccuracyM ?? 60;
  const margin = opts.outsideMarginM ?? 15;
  const inside = pointInRing(p, ring);
  if (inside) return accuracyM <= maxAcc ? 'inside' : prev;
  const dist = distanceToRing(p, ring);
  if (dist >= margin) return 'outside';
  return prev === 'unknown' ? 'outside' : prev;
}

function distanceToRing(p: Vec2, ring: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
  }
  return best;
}

/**
 * 営業時間の文字列（例 "10:00〜20:00"）から営業中かどうかを判定する。
 * 解釈できない場合は null（表示しない）。
 */
export function isOpenNow(openingHours: string, now: Date): boolean | null {
  const m = openingHours.match(/(\d{1,2}):(\d{2})\s*[〜~～-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  const t = now.getHours() * 60 + now.getMinutes();
  return close > open ? t >= open && t < close : t >= open || t < close;
}
