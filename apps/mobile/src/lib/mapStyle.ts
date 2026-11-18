import { ringCentroid, type FacilityBundle, type MapFeature, type Vec2 } from '@facility-nav/core';
import { colors } from '../theme';

/** 地図要素の描画順と色（ネイティブ地図・ブラウザ版の両方で使う） */
export const FILL_ORDER: MapFeature['kind'][] = ['parking', 'building', 'corridor', 'atrium', 'unit', 'facility_other', 'escalator', 'elevator', 'stairs', 'toilet'];

export function fillColor(kind: MapFeature['kind']): string {
  switch (kind) {
    case 'building':
      return colors.building;
    case 'corridor':
      return colors.corridor;
    case 'atrium':
      return colors.atrium;
    case 'parking':
      return colors.parking;
    case 'facility_other':
      return '#FFF4E5';
    default:
      return colors.amenity;
  }
}

/** 設備のアイコン（Ionicons の名前） */
export const AMENITY_ICON: Partial<Record<MapFeature['kind'], string>> = {
  toilet: 'male-female',
  elevator: 'swap-vertical',
  escalator: 'trending-up',
  stairs: 'footsteps',
  info: 'information-circle',
  entrance: 'enter',
};

export interface Label {
  id: string;
  text: string;
  at: Vec2;
  kind: MapFeature['kind'];
  storeId?: string;
  categoryId?: string;
}

/** 表示中のフロアのラベル（店舗名・設備名） */
export function floorLabels(bundle: FacilityBundle, floorId: string): Label[] {
  const storeById = new Map(bundle.stores.map((s) => [s.id, s]));
  const out: Label[] = [];
  for (const f of bundle.features) {
    if (f.floorId !== floorId) continue;
    if (f.kind === 'unit' && f.storeId && f.geometry.type === 'Polygon') {
      const s = storeById.get(f.storeId);
      if (!s || !s.isVisible) continue;
      out.push({ id: f.id, text: s.name, at: ringCentroid(f.geometry.coordinates[0]!), kind: f.kind, storeId: s.id, categoryId: s.categoryId });
    } else if (AMENITY_ICON[f.kind] || f.kind === 'facility_other' || f.kind === 'atrium') {
      const at =
        f.geometry.type === 'Polygon'
          ? ringCentroid(f.geometry.coordinates[0]!)
          : f.geometry.type === 'Point'
            ? { x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] }
            : null;
      if (at) out.push({ id: f.id, text: f.name ?? '', at, kind: f.kind });
    }
  }
  for (const n of bundle.nav.nodes) {
    if (n.floorId === floorId && n.kind === 'entrance') {
      out.push({ id: `ent-${n.id}`, text: n.name ?? '出入口', at: { x: n.x, y: n.y }, kind: 'entrance' });
    }
  }
  return out;
}
