// 【サンプル】架空のショッピングモール（2フロア・40店舗）のデータを生成するスクリプト。
// 実在の施設・店舗ではありません。開発・テスト専用です。
//
// 実行: npm run build --workspace @facility-nav/sample-data
// 出力: packages/sample-data/src/sample-facility.json
//
// 座標はローカル座標（メートル）。x = 東, y = 北。建物は 160m × 70m。
//
//   y=70 ┌──────────────┬────┬──────────────┐
//        │ 北側の店舗×5 │共用│ 北側の店舗×5 │  共用部：エスカレーター・トイレ・EV・階段
//   y=40 ├──────────────┘    └──────────────┤
//   西口 │        メインモール（通路）        │ 東口   2F は中央が吹き抜け
//   y=30 ├──────────────┐    ┌──────────────┤
//        │ 南側の店舗×5 │広場│ 南側の店舗×5 │  1F：南口へ／2F：フードコート
//   y=0  └──────────────┴南口┴──────────────┘
//        x=0           x=72  x=88          x=160
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SAMPLE_FACILITY_ID = '00000000-0000-4000-8000-000000000001';
const F1 = '00000000-0000-4000-8000-000000000101';
const F2 = '00000000-0000-4000-8000-000000000102';
const DOOR = 1.75; // 出入口の幅の半分（m）
const r1 = (n) => Math.round(n * 10) / 10;

const features = [];
const nodes = [];
const edges = [];
let edgeSeq = 0;
const nodeIds = new Set();

const rect = (x0, y0, x1, y1) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const wall = (floorId, id, coords) =>
  features.push({ id, floorId, kind: 'wall', geometry: { type: 'LineString', coordinates: coords } });
const poly = (floorId, id, kind, coords, extra = {}) =>
  features.push({ id, floorId, kind, geometry: { type: 'Polygon', coordinates: coords }, ...extra });
const point = (floorId, id, kind, x, y, extra = {}) =>
  features.push({ id, floorId, kind, geometry: { type: 'Point', coordinates: [x, y] }, ...extra });
const node = (floorId, id, x, y, kind = 'normal', extra = {}) => {
  if (nodeIds.has(id)) throw new Error(`duplicate node ${id}`);
  nodeIds.add(id);
  nodes.push({ id, floorId, x: r1(x), y: r1(y), kind, ...extra });
};
const edge = (from, to, extra = {}) =>
  edges.push({ id: `e${String(++edgeSeq).padStart(3, '0')}`, from, to, direction: 'both', widthM: 6, hasSteps: false, ...extra });

// ---- カテゴリー ----
const categories = [
  { id: 'cat-food', name: '飲食', icon: 'restaurant', color: '#F28C38' },
  { id: 'cat-fashion', name: 'ファッション', icon: 'shirt', color: '#8B6FD6' },
  { id: 'cat-goods', name: '雑貨・書籍', icon: 'gift', color: '#2FA36B' },
  { id: 'cat-beauty', name: 'ビューティー', icon: 'sparkles', color: '#E5609A' },
  { id: 'cat-grocery', name: '食品', icon: 'basket', color: '#D9A400' },
  { id: 'cat-service', name: 'サービス', icon: 'construct', color: '#3D8BD9' },
];

// ---- 店舗（すべて架空） ----
// [名前, 読み, カテゴリ, 営業時間, 説明]
const STORES = {
  [F1]: {
    north: [
      ['ブックス・サンプル', 'ぶっくすさんぷる', 'cat-goods', '10:00〜21:00', '書籍・文具・雑誌を扱う架空の書店です。'],
      ['カフェ・テスト', 'かふぇてすと', 'cat-food', '9:00〜21:00', 'コーヒーと焼き菓子の架空のカフェです。'],
      ['ドラッグ・モック', 'どらっぐもっく', 'cat-beauty', '10:00〜21:00', '医薬品・化粧品の架空のドラッグストアです。'],
      ['フラワー・デモ', 'ふらわーでも', 'cat-goods', '10:00〜20:00', '切り花・鉢植えの架空の花屋です。'],
      ['ベーカリー・ダミー', 'べーかりーだみー', 'cat-food', '8:00〜20:00', '焼きたてパンの架空のベーカリーです。'],
      ['雑貨店モック', 'ざっかてんもっく', 'cat-goods', '10:00〜20:00', '生活雑貨・インテリアの架空の店舗です。'],
      ['スイーツ・サンプル', 'すいーつさんぷる', 'cat-food', '10:00〜21:00', 'ケーキ・和菓子の架空の店舗です。'],
      ['メガネ・テスト', 'めがねてすと', 'cat-service', '10:00〜20:00', '眼鏡・コンタクトの架空の店舗です。'],
      ['スマホショップ・デモ', 'すまほしょっぷでも', 'cat-service', '10:00〜20:00', '携帯電話の架空のショップです。'],
      ['コスメ・ダミー', 'こすめだみー', 'cat-beauty', '10:00〜21:00', '化粧品の架空の店舗です。'],
    ],
    south: [
      ['スーパー・サンプル', 'すーぱーさんぷる', 'cat-grocery', '9:00〜22:00', '食料品の架空のスーパーマーケットです。'],
      ['精肉テスト', 'せいにくてすと', 'cat-grocery', '9:00〜21:00', '精肉・惣菜の架空の店舗です。'],
      ['鮮魚モック', 'せんぎょもっく', 'cat-grocery', '9:00〜21:00', '鮮魚の架空の店舗です。'],
      ['クリーニング・デモ', 'くりーにんぐでも', 'cat-service', '10:00〜19:00', 'クリーニングの架空の店舗です。'],
      ['ATMコーナー（サンプル）', 'えーてぃーえむこーなー', 'cat-service', '8:00〜22:00', '架空のATMコーナーです。'],
      ['キッズ・テスト', 'きっずてすと', 'cat-fashion', '10:00〜20:00', '子ども服の架空の店舗です。'],
      ['シューズ・サンプル', 'しゅーずさんぷる', 'cat-fashion', '10:00〜20:00', '靴の架空の店舗です。'],
      ['リカー・モック', 'りかーもっく', 'cat-grocery', '10:00〜21:00', '酒類の架空の店舗です。'],
      ['クリニック・デモ', 'くりにっくでも', 'cat-service', '9:00〜18:00', '架空の診療所です（実在しません）。'],
      ['ペット・ダミー', 'ぺっとだみー', 'cat-goods', '10:00〜20:00', 'ペット用品の架空の店舗です。'],
    ],
  },
  [F2]: {
    north: [
      ['ファッション・デモ', 'ふぁっしょんでも', 'cat-fashion', '10:00〜20:00', 'レディース衣料の架空の店舗です。'],
      ['メンズ・サンプル', 'めんずさんぷる', 'cat-fashion', '10:00〜20:00', 'メンズ衣料の架空の店舗です。'],
      ['スポーツ・テスト', 'すぽーつてすと', 'cat-fashion', '10:00〜20:00', 'スポーツ用品の架空の店舗です。'],
      ['アクセサリー・モック', 'あくせさりーもっく', 'cat-fashion', '10:00〜20:00', 'アクセサリーの架空の店舗です。'],
      ['ヘアサロン・ダミー', 'へあさろんだみー', 'cat-beauty', '10:00〜19:00', '架空のヘアサロンです。'],
      ['おもちゃ・サンプル', 'おもちゃさんぷる', 'cat-goods', '10:00〜20:00', '玩具の架空の店舗です。'],
      ['家電・テスト', 'かでんてすと', 'cat-goods', '10:00〜20:00', '家電の架空の店舗です。'],
      ['インテリア・デモ', 'いんてりあでも', 'cat-goods', '10:00〜20:00', '家具の架空の店舗です。'],
      ['バッグ・モック', 'ばっぐもっく', 'cat-fashion', '10:00〜20:00', 'バッグの架空の店舗です。'],
      ['時計・ダミー', 'とけいだみー', 'cat-service', '10:00〜20:00', '時計・修理の架空の店舗です。'],
    ],
    south: [
      ['ラーメン・テスト', 'らーめんてすと', 'cat-food', '11:00〜21:00', 'フードコート内の架空のラーメン店です。'],
      ['うどん・サンプル', 'うどんさんぷる', 'cat-food', '11:00〜21:00', 'フードコート内の架空のうどん店です。'],
      ['カレー・デモ', 'かれーでも', 'cat-food', '11:00〜21:00', 'フードコート内の架空のカレー店です。'],
      ['バーガー・ダミー', 'ばーがーだみー', 'cat-food', '10:00〜21:00', 'フードコート内の架空のハンバーガー店です。'],
      ['クレープ・モック', 'くれーぷもっく', 'cat-food', '10:00〜21:00', 'フードコート内の架空のクレープ店です。'],
      ['和食処ためし', 'わしょくどころためし', 'cat-food', '11:00〜22:00', '和食の架空のレストランです。'],
      ['イタリアン・サンプル', 'いたりあんさんぷる', 'cat-food', '11:00〜22:00', 'パスタ・ピザの架空のレストランです。'],
      ['中華・テスト', 'ちゅうかてすと', 'cat-food', '11:00〜22:00', '中華料理の架空のレストランです。'],
      ['回転寿司・デモ', 'かいてんずしでも', 'cat-food', '11:00〜22:00', '架空の回転寿司店です。'],
      ['カラオケ・ダミー', 'からおけだみー', 'cat-service', '10:00〜24:00', '架空のカラオケ店です。'],
    ],
  },
};

const W = 160;
const H = 70;
const CORR_S = 30; // メインモールの南端
const CORR_N = 40; // メインモールの北端
const MID = 35;
const CORE_W = 72; // 共用部の西端
const CORE_E = 88; // 共用部の東端
const westXs = [0, 14.4, 28.8, 43.2, 57.6, 72];
const eastXs = [88, 102.4, 116.8, 131.2, 145.6, 160];
const stores = [];

for (const [fi, floorId] of [F1, F2].entries()) {
  const P = fi === 0 ? '1F' : '2F';
  const is1F = fi === 0;

  // 床（建物の外形）と通路
  poly(floorId, `${P}-building`, 'building', rect(0, 0, W, H));
  poly(floorId, `${P}-mall`, 'corridor', [[[0, CORR_S], [CORE_W, CORR_S], [CORE_W, is1F ? 0 : 6], [CORE_E, is1F ? 0 : 6], [CORE_E, CORR_S], [W, CORR_S], [W, CORR_N], [CORE_E, CORR_N], [CORE_E, H], [CORE_W, H], [CORE_W, CORR_N], [0, CORR_N], [0, CORR_S]]], { name: is1F ? 'センターコート' : undefined });

  // 外壁（1F は西口・東口・南口を開ける）
  if (is1F) {
    wall(floorId, `${P}-w-west-1`, [[0, 0], [0, MID - DOOR * 2]]);
    wall(floorId, `${P}-w-west-2`, [[0, MID + DOOR * 2], [0, H]]);
    wall(floorId, `${P}-w-east-1`, [[W, 0], [W, MID - DOOR * 2]]);
    wall(floorId, `${P}-w-east-2`, [[W, MID + DOOR * 2], [W, H]]);
    wall(floorId, `${P}-w-south-1`, [[0, 0], [80 - DOOR * 2, 0]]);
    wall(floorId, `${P}-w-south-2`, [[80 + DOOR * 2, 0], [W, 0]]);
  } else {
    wall(floorId, `${P}-w-outer`, [[0, 0], [W, 0], [W, H], [0, H], [0, 0]]);
  }
  wall(floorId, `${P}-w-north`, [[0, H], [W, H]]);

  // 店舗
  for (const side of ['north', 'south']) {
    const north = side === 'north';
    const frontY = north ? CORR_N : CORR_S;
    const backY = north ? H : 0;
    const list = STORES[floorId][side];
    const segs = [...westXs.slice(0, -1).map((x, i) => [x, westXs[i + 1]]), ...eastXs.slice(0, -1).map((x, i) => [x, eastXs[i + 1]])];
    segs.forEach(([x0, x1], i) => {
      const [name, kana, categoryId, hours, desc] = list[i];
      const key = `${P}-${north ? 'N' : 'S'}${i + 1}`;
      const cx = r1((x0 + x1) / 2);
      const storeId = `store-${key}`;
      poly(floorId, `unit-${key}`, 'unit', rect(x0, Math.min(frontY, backY), x1, Math.max(frontY, backY)), { name, storeId });
      wall(floorId, `w-front-${key}-1`, [[x0, frontY], [cx - DOOR, frontY]]);
      wall(floorId, `w-front-${key}-2`, [[cx + DOOR, frontY], [x1, frontY]]);
      point(floorId, `door-${key}`, 'door', cx, frontY, { storeId });
      node(floorId, `door-${key}`, cx, frontY, 'store_entrance', { storeId, name: `${name} 入口` });
      node(floorId, `in-${key}`, cx, north ? frontY + 12 : frontY - 12, 'normal', { storeId });
      edge(`door-${key}`, `in-${key}`, { widthM: 3 });
      stores.push({
        id: storeId,
        floorId,
        categoryId,
        name,
        nameKana: kana,
        description: `【サンプル】${desc}`,
        openingHours: hours,
        featureId: `unit-${key}`,
        entranceNodeId: `door-${key}`,
        isVisible: true,
      });
    });
    // 店舗間の仕切り
    for (const x of [...westXs.slice(1), ...eastXs.slice(0, -1)]) {
      wall(floorId, `${P}-w-split-${side}-${x}`, north ? [[x, CORR_N], [x, H]] : [[x, is1F || x === CORE_W || x === CORE_E ? 0 : 0], [x, CORR_S]]);
    }
  }

  // 北側の共用部：エスカレーター×2・トイレ・エレベーター・階段
  poly(floorId, `${P}-es-w`, 'escalator', rect(74, 44, 77, 54), { name: 'エスカレーター' });
  poly(floorId, `${P}-es-e`, 'escalator', rect(83, 44, 86, 54), { name: 'エスカレーター' });
  poly(floorId, `${P}-toilet`, 'toilet', rect(72, 60, 77.5, 70), { name: 'トイレ' });
  poly(floorId, `${P}-elevator`, 'elevator', rect(77.5, 63, 82.5, 70), { name: 'エレベーター' });
  poly(floorId, `${P}-stairs`, 'stairs', rect(82.5, 60, 88, 70), { name: '階段' });

  // 南側：1F は南口前の広場とインフォメーション、2F はフードコートの客席
  if (is1F) {
    point(floorId, `${P}-info`, 'info', 80, 20, { name: 'インフォメーション' });
  } else {
    poly(floorId, `${P}-foodcourt`, 'facility_other', rect(73, 8, 87, 27), { name: 'フードコート客席' });
    wall(floorId, `${P}-w-fc-s`, [[CORE_W, 6], [CORE_E, 6]]);
  }
  if (!is1F) {
    // 吹き抜け（メインモール中央）。通路線が横切らないように周囲を回る
    poly(floorId, `${P}-atrium`, 'atrium', rect(68, 33, 92, 37), { name: '吹き抜け' });
  }

  // ---- 通路ネットワーク ----
  const corridorXs = [...westXs.slice(0, -1).map((x, i) => r1((x + westXs[i + 1]) / 2)), ...eastXs.slice(0, -1).map((x, i) => r1((x + eastXs[i + 1]) / 2))];
  const cid = (x) => `${P}-c-${x}`;
  for (const x of corridorXs) node(floorId, cid(x), x, MID);
  const westChain = corridorXs.slice(0, 5);
  const eastChain = corridorXs.slice(5);
  for (let i = 0; i + 1 < westChain.length; i++) edge(cid(westChain[i]), cid(westChain[i + 1]), { widthM: 10 });
  for (let i = 0; i + 1 < eastChain.length; i++) edge(cid(eastChain[i]), cid(eastChain[i + 1]), { widthM: 10 });
  // 店舗の入口と通路をつなぐ
  for (const s of stores.filter((st) => st.floorId === floorId)) {
    const d = nodes.find((n) => n.id === s.entranceNodeId);
    edge(cid(d.x), d.id, { widthM: 3 });
  }
  const wEnd = cid(westChain[4]);
  const eEnd = cid(eastChain[0]);
  if (is1F) {
    node(floorId, `${P}-center`, 80, MID);
    edge(wEnd, `${P}-center`, { widthM: 10 });
    edge(`${P}-center`, eEnd, { widthM: 10 });
    node(floorId, 'ent-west', 0, MID, 'entrance', { name: '西口' });
    node(floorId, 'ent-east', W, MID, 'entrance', { name: '東口' });
    node(floorId, 'ent-south', 80, 0, 'entrance', { name: '南口' });
    node(floorId, `${P}-s-plaza`, 80, 15);
    edge('ent-west', cid(westChain[0]), { widthM: 10 });
    edge(cid(eastChain[4]), 'ent-east', { widthM: 10 });
    edge(`${P}-center`, `${P}-s-plaza`, { widthM: 16 });
    edge(`${P}-s-plaza`, 'ent-south', { widthM: 16 });
    node(floorId, `${P}-n-hall`, 80, 42);
    edge(`${P}-center`, `${P}-n-hall`, { widthM: 16 });
  } else {
    // 吹き抜けの南側・北側を回る
    for (const [suffix, y] of [['s', 31.5], ['n', 38.5]]) {
      node(floorId, `${P}-a${suffix}-w`, 66, y);
      node(floorId, `${P}-a${suffix}-m`, 80, y);
      node(floorId, `${P}-a${suffix}-e`, 94, y);
      edge(wEnd, `${P}-a${suffix}-w`, { widthM: 3 });
      edge(`${P}-a${suffix}-w`, `${P}-a${suffix}-m`, { widthM: 3 });
      edge(`${P}-a${suffix}-m`, `${P}-a${suffix}-e`, { widthM: 3 });
      edge(`${P}-a${suffix}-e`, eEnd, { widthM: 3 });
    }
    node(floorId, `${P}-n-hall`, 80, 42);
    edge(`${P}-an-m`, `${P}-n-hall`, { widthM: 8 });
    node(floorId, `${P}-foodcourt`, 80, 18, 'normal', { name: 'フードコート' });
    edge(`${P}-as-m`, `${P}-foodcourt`, { widthM: 10 });
  }
  // 北側の共用部
  node(floorId, `${P}-es-w`, 75.5, 43, 'escalator', { name: 'エスカレーター（西）' });
  node(floorId, `${P}-es-e`, 84.5, 43, 'escalator', { name: 'エスカレーター（東）' });
  node(floorId, `${P}-n-core`, 80, 57);
  node(floorId, `${P}-toilet`, 75, 59, 'toilet', { name: 'トイレ' });
  node(floorId, `${P}-elevator`, 80, 62, 'elevator', { name: 'エレベーター' });
  node(floorId, `${P}-stairs`, 85, 59, 'stairs', { name: '階段' });
  edge(`${P}-n-hall`, `${P}-es-w`, { widthM: 4 });
  edge(`${P}-n-hall`, `${P}-es-e`, { widthM: 4 });
  edge(`${P}-n-hall`, `${P}-n-core`, { widthM: 6 });
  edge(`${P}-n-core`, `${P}-toilet`, { widthM: 3 });
  edge(`${P}-n-core`, `${P}-elevator`, { widthM: 3 });
  edge(`${P}-n-core`, `${P}-stairs`, { widthM: 3 });
}

// フロア間の移動（エスカレーター：西が上り・東が下り、エレベーター・階段は双方向）
edge('1F-es-w', '2F-es-w', { direction: 'forward', isVertical: true, lengthM: 15, costFactor: 1, widthM: 1.2 });
edge('2F-es-e', '1F-es-e', { direction: 'forward', isVertical: true, lengthM: 15, costFactor: 1, widthM: 1.2 });
edge('1F-elevator', '2F-elevator', { isVertical: true, lengthM: 20, costFactor: 1.5, widthM: 1.5 });
edge('1F-stairs', '2F-stairs', { isVertical: true, lengthM: 15, costFactor: 1.3, widthM: 1.5, hasSteps: true });

// ---- 屋外：駐車場 ----
poly(F1, 'parking-south', 'parking', rect(10, -55, 150, -12), { name: '駐車場' });

// ---- ビーコン（サンプル。実在の機器ではありません） ----
const SAMPLE_UUID = '00000000-0000-4000-8000-0000000000be';
const beacons = [];
for (const [fi, floorId] of [F1, F2].entries()) {
  const xs = [8, 24, 40, 56, 72, 88, 104, 120, 136, 152];
  xs.forEach((x, i) =>
    beacons.push({ id: `beacon-${fi + 1}-${i + 1}`, floorId, uuid: SAMPLE_UUID, major: fi + 1, minor: i + 1, x, y: MID, z: 2.5, txPower: -59 }),
  );
  beacons.push({ id: `beacon-${fi + 1}-n`, floorId, uuid: SAMPLE_UUID, major: fi + 1, minor: 11, x: 80, y: 55, z: 2.5, txPower: -59 });
  beacons.push({ id: `beacon-${fi + 1}-s`, floorId, uuid: SAMPLE_UUID, major: fi + 1, minor: 12, x: 80, y: 15, z: 2.5, txPower: -59 });
}

const bundle = {
  schemaVersion: 1,
  facility: {
    id: SAMPLE_FACILITY_ID,
    name: '【サンプル】テストモール',
    isSample: true,
    // 架空の施設の配置場所（実在の建物とは無関係。検証画面で現在地へ移動可能）
    origin: { lat: 35.7012, lng: 139.3955 },
    rotationDeg: 0,
    freshness: { freshMinutes: 15, restrictMinutes: 360, highSeverityRestrictMinutes: 60, restrictMode: 'confirm', eventMode: false },
    boundary: [[-20, -65], [180, -65], [180, 85], [-20, 85]],
    mainEntranceNodeId: 'ent-south',
    address: '（架空の施設のため住所はありません）',
  },
  version: { versionNo: 1, publishedAt: '2026-11-18T00:00:00.000Z' },
  floors: [
    { id: F1, level: 1, name: '1F' },
    { id: F2, level: 2, name: '2F' },
  ],
  features,
  categories,
  stores,
  nav: { nodes, edges },
  beacons,
};

writeFileSync(join(here, '..', 'src', 'sample-facility.json'), JSON.stringify(bundle, null, 2) + '\n');
console.log(
  `sample-facility.json を出力しました（フロア ${bundle.floors.length} / 地図要素 ${features.length} / 店舗 ${stores.length} / 通路点 ${nodes.length} / 通路線 ${edges.length}）`,
);
