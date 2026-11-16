import type { FacilityBundle, NavEdge, RouteRule } from '../src';

/**
 * テスト用の小さな施設（2フロア）。
 *
 *  1F:  A(0,0) ── B(10,0) ── C(20,0)
 *                  │
 *                 D(10,10) ── E(20,10)
 *  縦の壁 x=15（y=-5〜5）が B-C を遮る位置にあるが、B-C の通路線は壁の切れ目(y=0付近)を通らないので
 *  壁あり版では B-C 線を使わず、テストで「壁と交差する通路線」を検出させる。
 *  2F:  F(10,0)。エレベーターで B と接続（isVertical）。
 */
export function makeBundle(opts: { wallAcrossBC?: boolean; extraEdges?: NavEdge[] } = {}): FacilityBundle {
  const edges: NavEdge[] = [
    { id: 'AB', from: 'A', to: 'B', direction: 'both' },
    { id: 'BC', from: 'B', to: 'C', direction: 'both' },
    { id: 'BD', from: 'B', to: 'D', direction: 'both' },
    { id: 'DE', from: 'D', to: 'E', direction: 'both' },
    { id: 'EC', from: 'E', to: 'C', direction: 'both' },
    { id: 'BF', from: 'B', to: 'F', direction: 'both', isVertical: true, lengthM: 8 },
    ...(opts.extraEdges ?? []),
  ];
  return {
    schemaVersion: 1,
    facility: {
      id: 'fac-test',
      name: 'テスト施設',
      isSample: true,
      origin: { lat: 35, lng: 135 },
      rotationDeg: 0,
      freshness: { freshMinutes: 15, restrictMinutes: 360, highSeverityRestrictMinutes: 60, restrictMode: 'confirm', eventMode: false },
    },
    version: { versionNo: 1, publishedAt: '2026-01-01T00:00:00Z' },
    floors: [
      { id: '1F', level: 1, name: '1F' },
      { id: '2F', level: 2, name: '2F' },
    ],
    features: opts.wallAcrossBC
      ? [{ id: 'wall1', floorId: '1F', kind: 'wall', geometry: { type: 'LineString', coordinates: [[15, -5], [15, 5]] } }]
      : [],
    categories: [{ id: 'cat1', name: '飲食', icon: 'x', color: '#000' }],
    stores: [
      {
        id: 's1',
        floorId: '1F',
        categoryId: 'cat1',
        name: 'カフェ',
        nameKana: 'かふぇ',
        description: '',
        openingHours: '',
        featureId: 'u1',
        entranceNodeId: 'C',
        isVisible: true,
      },
    ],
    nav: {
      nodes: [
        { id: 'A', floorId: '1F', x: 0, y: 0, kind: 'entrance' },
        { id: 'B', floorId: '1F', x: 10, y: 0, kind: 'normal' },
        { id: 'C', floorId: '1F', x: 20, y: 0, kind: 'store_entrance' },
        { id: 'D', floorId: '1F', x: 10, y: 10, kind: 'normal' },
        { id: 'E', floorId: '1F', x: 20, y: 10, kind: 'normal' },
        { id: 'F', floorId: '2F', x: 10, y: 0, kind: 'elevator' },
      ],
      edges,
    },
    beacons: [],
  };
}

export const rule = (kind: RouteRule['kind'], edgeIds: string[], extra: Partial<RouteRule> = {}): RouteRule => ({
  id: `r-${kind}-${edgeIds.join('-')}`,
  kind,
  severity: 'normal',
  edgeIds,
  startsAt: null,
  endsAt: null,
  ...extra,
});
