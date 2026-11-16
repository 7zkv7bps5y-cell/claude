import type { FacilityInfo, Vec2 } from './types';

/**
 * ローカル座標（m）⇔ 緯度経度 の変換。
 *
 * 施設規模（数百m以内）では、原点まわりの局所的な平面近似（正距円筒近似）で
 * 誤差は数cm程度に収まるため、この方式を採用する。
 */
const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

export function localToLngLat(p: Vec2, facility: Pick<FacilityInfo, 'origin' | 'rotationDeg'>): [number, number] {
  const r = facility.rotationDeg * DEG;
  // ローカル座標を回転して「東・北」成分にする（y 軸が北から時計回りに rotationDeg 回っている）
  const east = p.x * Math.cos(r) + p.y * Math.sin(r);
  const north = -p.x * Math.sin(r) + p.y * Math.cos(r);
  const lat = facility.origin.lat + (north / EARTH_RADIUS_M) / DEG;
  const lng = facility.origin.lng + (east / (EARTH_RADIUS_M * Math.cos(facility.origin.lat * DEG))) / DEG;
  return [lng, lat];
}

export function lngLatToLocal(
  [lng, lat]: [number, number],
  facility: Pick<FacilityInfo, 'origin' | 'rotationDeg'>,
): Vec2 {
  const north = (lat - facility.origin.lat) * DEG * EARTH_RADIUS_M;
  const east = (lng - facility.origin.lng) * DEG * EARTH_RADIUS_M * Math.cos(facility.origin.lat * DEG);
  const r = facility.rotationDeg * DEG;
  return {
    x: east * Math.cos(r) - north * Math.sin(r),
    y: east * Math.sin(r) + north * Math.cos(r),
  };
}
