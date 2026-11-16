// 【サンプル】架空フロアのデータを生成するスクリプト。
// 実在の施設ではありません。開発・テスト専用です。
//
// 実行: npm run build --workspace @facility-nav/sample-data
// 出力: packages/sample-data/src/sample-facility.json
//
// 座標はローカル座標（メートル）。x = 東, y = 北。フロアは 60m × 30m。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SAMPLE_FACILITY_ID = '00000000-0000-4000-8000-000000000001';
const FLOOR = '00000000-0000-4000-8000-000000000101'; // 1F（DBの floors.id と同じUUID）
const DOOR_HALF = 1.5; // 出入口の幅の半分（m）

const features = [];
const nodes = [];
const edges = [];
let edgeSeq = 0;

const wall = (id, coords) => features.push({ id, floorId: FLOOR, kind: 'wall', geometry: { type: 'LineString', coordinates: coords } });
const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const node = (id, x, y, kind = 'normal', extra = {}) => nodes.push({ id, floorId: FLOOR, x, y, kind, ...extra });
const edge = (from, to, extra = {}) => edges.push({ id: `e${String(++edgeSeq).padStart(3, '0')}`, from, to, direction: 'both', widthM: 6, hasSteps: false, ...extra });

// ---- 外壁（出入口の部分は開けておく） ----
wall('w-west-1', [[0, 0], [0, 15 - DOOR_HALF]]);
wall('w-west-2', [[0, 15 + DOOR_HALF], [0, 30]]);
wall('w-east-1', [[60, 0], [60, 15 - DOOR_HALF]]);
wall('w-east-2', [[60, 15 + DOOR_HALF], [60, 30]]);
wall('w-north', [[0, 30], [60, 30]]);
wall('w-south-1', [[0, 0], [30 - DOOR_HALF, 0]]);
wall('w-south-2', [[30 + DOOR_HALF, 0], [60, 0]]);

// ---- 通路（塗りつぶし用の多角形） ----
features.push({
  id: 'corridor-main',
  floorId: FLOOR,
  kind: 'corridor',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 12], [27, 12], [27, 0], [33, 0], [33, 12], [60, 12], [60, 18], [33, 18], [33, 26], [27, 26], [27, 18], [0, 18], [0, 12]]],
  },
});

// ---- 店舗 ----
const categories = [
  { id: 'cat-food', name: '飲食', icon: 'restaurant', color: '#F2A65A' },
  { id: 'cat-fashion', name: 'ファッション', icon: 'shirt', color: '#8E7CC3' },
  { id: 'cat-goods', name: '雑貨・書籍', icon: 'gift', color: '#6AA84F' },
  { id: 'cat-service', name: 'サービス', icon: 'medical', color: '#5B9BD5' },
];

const storeDefs = [
  // id, 名前, 読み, カテゴリ, x0, x1, 北側?, 説明, 営業時間
  ['A', 'ブックス・サンプル', 'ぶっくすさんぷる', 'cat-goods', 0, 13, true, '書籍・文具を扱う架空の書店です。', '10:00〜20:00'],
  ['B', 'カフェ・テスト', 'かふぇてすと', 'cat-food', 13, 27, true, 'コーヒーと軽食の架空のカフェです。', '9:00〜21:00'],
  ['C', 'ファッション・デモ', 'ふぁっしょんでも', 'cat-fashion', 33, 46, true, '衣料品の架空の店舗です。', '10:00〜20:00'],
  ['D', 'ベーカリー・ダミー', 'べーかりーだみー', 'cat-food', 46, 60, true, 'パンの架空の店舗です。', '8:00〜19:00'],
  ['E', '雑貨店モック', 'ざっかてんもっく', 'cat-goods', 0, 13, false, '生活雑貨の架空の店舗です。', '10:00〜20:00'],
  ['F', 'クリニック・サンプル', 'くりにっくさんぷる', 'cat-service', 13, 27, false, '架空の診療所です（実在しません）。', '9:00〜18:00（水曜休診）'],
  ['G', 'シューズ・テスト', 'しゅーずてすと', 'cat-fashion', 33, 46, false, '靴の架空の店舗です。', '10:00〜20:00'],
  ['H', '和食処ためし', 'わしょくどころためし', 'cat-food', 46, 60, false, '和食の架空の飲食店です。', '11:00〜22:00'],
];

const stores = [];
for (const [key, name, kana, categoryId, x0, x1, north, desc, hours] of storeDefs) {
  const cx = Math.round(((x0 + x1) / 2) * 10) / 10;
  const frontY = north ? 18 : 12;
  const backY = north ? 30 : 0;
  const innerY = north ? 24 : 6;
  const unitId = `unit-${key}`;
  features.push({
    id: unitId,
    floorId: FLOOR,
    kind: 'unit',
    geometry: { type: 'Polygon', coordinates: rect(x0, Math.min(frontY, backY), x1, Math.max(frontY, backY)) },
    name,
    storeId: `store-${key}`,
  });
  // 店舗正面の壁（出入口部分は開ける）
  wall(`w-front-${key}-1`, [[x0, frontY], [cx - DOOR_HALF, frontY]]);
  wall(`w-front-${key}-2`, [[cx + DOOR_HALF, frontY], [x1, frontY]]);
  features.push({ id: `door-${key}`, floorId: FLOOR, kind: 'door', geometry: { type: 'Point', coordinates: [cx, frontY] }, storeId: `store-${key}` });
  node(`door-${key}`, cx, frontY, 'store_entrance', { storeId: `store-${key}`, name: `${name} 入口` });
  node(`in-${key}`, cx, innerY, 'normal', { storeId: `store-${key}` });
  edge(`door-${key}`, `in-${key}`, { widthM: 3 });
  stores.push({
    id: `store-${key}`,
    floorId: FLOOR,
    categoryId,
    name,
    nameKana: kana,
    description: `【サンプル】${desc}`,
    openingHours: hours,
    featureId: unitId,
    entranceNodeId: `door-${key}`,
    isVisible: true,
  });
}

// 店舗間の仕切り壁
for (const x of [13, 27, 33, 46]) {
  wall(`w-split-n-${x}`, [[x, 18], [x, 30]]);
  wall(`w-split-s-${x}`, [[x, 0], [x, 12]]);
}

// ---- 北側の共用部（トイレ・階段・エレベーター） ----
features.push({ id: 'toilet-1', floorId: FLOOR, kind: 'toilet', geometry: { type: 'Polygon', coordinates: rect(27, 26, 29, 30) }, name: 'トイレ' });
features.push({ id: 'stairs-1', floorId: FLOOR, kind: 'stairs', geometry: { type: 'Polygon', coordinates: rect(29, 26, 31, 30) }, name: '階段' });
features.push({ id: 'elevator-1', floorId: FLOOR, kind: 'elevator', geometry: { type: 'Polygon', coordinates: rect(31, 26, 33, 30) }, name: 'エレベーター' });
for (const [id, x, y, kind] of [['ent-west', 0, 15, 'entrance'], ['ent-east', 60, 15, 'entrance'], ['ent-south', 30, 0, 'entrance']]) {
  features.push({ id: `f-${id}`, floorId: FLOOR, kind, geometry: { type: 'Point', coordinates: [x, y] }, name: { 'ent-west': '西口', 'ent-east': '東口', 'ent-south': '南口' }[id] });
}

// ---- 通路ネットワーク ----
node('ent-west', 0, 15, 'entrance', { name: '西口' });
node('ent-east', 60, 15, 'entrance', { name: '東口' });
node('ent-south', 30, 0, 'entrance', { name: '南口' });
node('c-6.5', 6.5, 15);
node('c-20', 20, 15);
node('c-30', 30, 15);
node('c-39.5', 39.5, 15);
node('c-53', 53, 15);
node('s-6', 30, 6);
node('n-22', 30, 22);
node('n-25', 30, 25);
node('toilet', 28, 27, 'toilet', { name: 'トイレ' });
node('stairs', 30, 27, 'stairs', { name: '階段' });
node('elevator', 32, 27, 'elevator', { name: 'エレベーター' });

const chain = ['ent-west', 'c-6.5', 'c-20', 'c-30', 'c-39.5', 'c-53', 'ent-east'];
for (let i = 0; i + 1 < chain.length; i++) edge(chain[i], chain[i + 1]);
edge('c-30', 's-6');
edge('s-6', 'ent-south');
edge('c-30', 'n-22');
edge('n-22', 'n-25');
edge('n-25', 'toilet', { widthM: 2 });
edge('n-25', 'stairs', { widthM: 2, hasSteps: true });
edge('n-25', 'elevator', { widthM: 2 });
for (const [key, cnode] of [['A', 'c-6.5'], ['E', 'c-6.5'], ['B', 'c-20'], ['F', 'c-20'], ['C', 'c-39.5'], ['G', 'c-39.5'], ['D', 'c-53'], ['H', 'c-53']]) {
  edge(cnode, `door-${key}`, { widthM: 3 });
}

// ---- ビーコン（サンプル。実在の機器ではありません） ----
const SAMPLE_UUID = '00000000-0000-4000-8000-0000000000be';
const beaconPos = [[5, 15], [15, 15], [25, 15], [35, 15], [45, 15], [55, 15], [30, 5], [30, 25]];
const beacons = beaconPos.map(([x, y], i) => ({
  id: `beacon-${i + 1}`,
  floorId: FLOOR,
  uuid: SAMPLE_UUID,
  major: 1,
  minor: i + 1,
  x,
  y,
  z: 2.5,
  txPower: -59,
}));

const bundle = {
  schemaVersion: 1,
  facility: {
    id: SAMPLE_FACILITY_ID,
    name: '【サンプル】テストモール',
    isSample: true,
    origin: { lat: 35.0, lng: 135.0 },
    rotationDeg: 0,
    freshness: { freshMinutes: 15, restrictMinutes: 360, highSeverityRestrictMinutes: 60, restrictMode: 'confirm', eventMode: false },
  },
  version: { versionNo: 1, publishedAt: '2026-11-16T00:00:00.000Z' },
  floors: [{ id: FLOOR, level: 1, name: '1F' }],
  features,
  categories,
  stores,
  nav: { nodes, edges },
  beacons,
};

writeFileSync(join(here, '..', 'src', 'sample-facility.json'), JSON.stringify(bundle, null, 2) + '\n');
console.log(`sample-facility.json を出力しました（地図要素 ${features.length} / 店舗 ${stores.length} / 通路点 ${nodes.length} / 通路線 ${edges.length}）`);
