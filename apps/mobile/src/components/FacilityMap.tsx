/**
 * ブラウザ版の地図（確認用）。屋外地図は表示せず、屋内図のみ SVG で描画する。
 * iPhone / Android では FacilityMap.native.tsx が使われる。
 */
export { IndoorMap as FacilityMap } from './IndoorMap';
