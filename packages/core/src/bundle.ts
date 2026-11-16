import { BUNDLE_SCHEMA_VERSION, type FacilityBundle } from './types';

/**
 * 施設データ一式の形式チェック。
 * ダウンロードしたデータが壊れていた場合に、保存済みの正常なデータを上書きしないために使う。
 */
export function validateBundle(data: unknown): { ok: true; bundle: FacilityBundle } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(data)) return { ok: false, errors: ['データがオブジェクトではありません'] };
  if (data.schemaVersion !== BUNDLE_SCHEMA_VERSION) errors.push(`schemaVersion が ${BUNDLE_SCHEMA_VERSION} ではありません`);
  const f = data.facility;
  if (!isObj(f) || typeof f.id !== 'string' || typeof f.name !== 'string') errors.push('facility が不正です');
  else if (!isObj(f.origin) || !isObj(f.freshness)) errors.push('facility.origin / freshness が不正です');
  const v = data.version;
  if (!isObj(v) || typeof v.versionNo !== 'number' || typeof v.publishedAt !== 'string') errors.push('version が不正です');
  for (const key of ['floors', 'features', 'categories', 'stores', 'beacons'] as const) {
    if (!Array.isArray(data[key])) errors.push(`${key} が配列ではありません`);
  }
  const nav = data.nav;
  if (!isObj(nav) || !Array.isArray(nav.nodes) || !Array.isArray(nav.edges)) errors.push('nav が不正です');
  if (errors.length > 0) return { ok: false, errors };

  // 参照整合性（店舗→フロア・入口点・カテゴリー）
  const b = data as unknown as FacilityBundle;
  const floorIds = new Set(b.floors.map((x) => x.id));
  const nodeIds = new Set(b.nav.nodes.map((x) => x.id));
  const catIds = new Set(b.categories.map((x) => x.id));
  for (const s of b.stores) {
    if (!floorIds.has(s.floorId)) errors.push(`店舗 ${s.id} のフロアが存在しません`);
    if (!nodeIds.has(s.entranceNodeId)) errors.push(`店舗 ${s.id} の入口点が存在しません`);
    if (!catIds.has(s.categoryId)) errors.push(`店舗 ${s.id} のカテゴリーが存在しません`);
  }
  for (const e of b.nav.edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) errors.push(`通路線 ${e.id} の端点が存在しません`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, bundle: b };
}
