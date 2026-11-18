/**
 * 施設データ一式（バンドル）の型定義。
 *
 * - 座標は「施設ごとのローカル座標（メートル）」: x = 東方向, y = 北方向。
 * - サーバーの公開版（map_versions.snapshot）と、端末に保存するデータは同じ形式。
 * - schemaVersion を上げるときは validateBundle と移行処理を必ず更新する。
 */

export const BUNDLE_SCHEMA_VERSION = 1 as const;

export type Vec2 = { x: number; y: number };

/** 鮮度しきい値など、経路規制情報の扱いに関する施設ごとの設定 */
export interface RuleFreshnessSettings {
  /** この分数以内なら「正常」 */
  freshMinutes: number;
  /** この分数を超えたら「制限」（それまでは「注意」） */
  restrictMinutes: number;
  /** 重要度「高」の規制がある場合、またはイベント中の場合の「制限」しきい値（分） */
  highSeverityRestrictMinutes: number;
  /** 「制限」時の動作: confirm=確認後に参考案内 / block=経路案内を停止 */
  restrictMode: 'confirm' | 'block';
  /** イベント中（規制が頻繁に変わる）なら true */
  eventMode: boolean;
}

export interface FacilityInfo {
  id: string;
  name: string;
  /** サンプルデータなら true（実データと混同しないための印） */
  isSample: boolean;
  /** ローカル座標原点の緯度経度 */
  origin: { lat: number; lng: number };
  /** ローカル座標の y 軸が真北から時計回りに何度回っているか */
  rotationDeg: number;
  freshness: RuleFreshnessSettings;
  /** 敷地の範囲（ローカル座標の多角形）。屋内・屋外の自動切替に使う */
  boundary?: [number, number][];
  /** 施設外からの経路案内（地図アプリ）の目的地にする出入口の通路点 */
  mainEntranceNodeId?: string;
  /** 施設の住所（表示用） */
  address?: string;
}

export interface Floor {
  id: string;
  level: number;
  name: string;
}

export type FeatureKind =
  | 'wall'
  | 'corridor'
  | 'unit'
  | 'door'
  | 'entrance'
  | 'elevator'
  | 'stairs'
  | 'escalator'
  | 'toilet'
  | 'obstacle'
  | 'building' // 建物の外形（フロアの床面）
  | 'atrium' // 吹き抜け（通行不可）
  | 'parking' // 駐車場（屋外）
  | 'info' // インフォメーション
  | 'facility_other';

export type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export interface MapFeature {
  id: string;
  floorId: string;
  kind: FeatureKind;
  geometry: Geometry;
  name?: string;
  storeId?: string;
}

export interface StoreCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface Store {
  id: string;
  floorId: string;
  categoryId: string;
  name: string;
  /** 読み仮名（ひらがな/カタカナ） */
  nameKana: string;
  description: string;
  openingHours: string;
  imageUrl?: string;
  /** 店舗区画（map_features.kind = 'unit'）の ID */
  featureId: string;
  /** 経路の目的地となる通路ネットワーク上の点 */
  entranceNodeId: string;
  isVisible: boolean;
}

export type NavNodeKind =
  | 'normal'
  | 'entrance'
  | 'store_entrance'
  | 'elevator'
  | 'stairs'
  | 'escalator'
  | 'toilet';

export interface NavNode {
  id: string;
  floorId: string;
  x: number;
  y: number;
  kind: NavNodeKind;
  name?: string;
  storeId?: string;
}

export interface NavEdge {
  id: string;
  from: string;
  to: string;
  /** both = 双方向, forward = from→to のみ（恒常的な一方通行） */
  direction: 'both' | 'forward';
  /** 距離に掛ける係数（既定 1） */
  costFactor?: number;
  /** フロア間の移動（エレベーター・階段）なら true */
  isVertical?: boolean;
  /** isVertical の場合など、座標から距離が求まらないときの長さ（m） */
  lengthM?: number;
  /** --- バリアフリー属性（PoCではデータのみ。案内機能は将来） --- */
  hasSteps?: boolean;
  widthM?: number;
  slopePercent?: number;
}

export interface Beacon {
  id: string;
  floorId: string;
  uuid: string;
  major: number;
  minor: number;
  x: number;
  y: number;
  z: number;
  /** 1m 地点での受信強度（dBm、較正値） */
  txPower: number;
}

export interface FacilityBundle {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  facility: FacilityInfo;
  version: { versionNo: number; publishedAt: string };
  floors: Floor[];
  features: MapFeature[];
  categories: StoreCategory[];
  stores: Store[];
  nav: { nodes: NavNode[]; edges: NavEdge[] };
  beacons: Beacon[];
}

/** 経路規制（管理者指定。公開操作なしで即時反映し、期間を持てる） */
export type RouteRuleKind =
  | 'closed' // 通行禁止
  | 'temporary_closure' // 一時封鎖
  | 'restricted' // 立入制限
  | 'one_way' // 一方通行（edge の from→to のみ通行可）
  | 'preferred'; // 推奨ルート

export interface RouteRule {
  id: string;
  kind: RouteRuleKind;
  severity: 'normal' | 'high';
  edgeIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  note?: string;
}

/** 端末に保存する経路規制情報 */
export interface RouteRulesSnapshot {
  facilityId: string;
  /** 端末が最後に取得に成功した時刻（端末時計, ISO8601） */
  fetchedAt: string;
  /** 取得時のサーバー時刻（ISO8601） */
  serverTime: string;
  rules: RouteRule[];
  /**
   * 取得時点の施設の鮮度しきい値。地図の再公開なしで管理者が変更できるよう、規制情報と一緒に配信する。
   * 未設定なら施設データ（bundle.facility.freshness）の値を使う。
   */
  freshness?: RuleFreshnessSettings;
}
