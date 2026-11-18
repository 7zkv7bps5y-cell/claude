import type { FacilityBundle, RouteResult, Vec2 } from '@facility-nav/core';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface UserLocation extends LatLng {
  accuracy: number;
}

export interface MapStart {
  floorId: string;
  point: Vec2;
}

export interface FacilityMapProps {
  bundle: FacilityBundle;
  floorId: string;
  selectedStoreId: string | null;
  /** カテゴリー絞り込み中の店舗（null なら全店舗を通常表示） */
  highlightStoreIds: Set<string> | null;
  route: RouteResult | null;
  /** 規制で通れない通路線（赤の破線） */
  blockedEdgeIds: Set<string>;
  start: MapStart | null;
  userLocation: UserLocation | null;
  /** 地図アプリ風の地点（住所検索の結果など） */
  placePin: (LatLng & { title: string }) | null;
  onStorePress: (storeId: string) => void;
  /** 建物の中（表示中のフロア）をタップした */
  onIndoorPress: (p: Vec2) => void;
  /** 屋内の地図が見える縮尺かどうか */
  onIndoorVisibleChange?: (visible: boolean) => void;
}

export interface FacilityMapHandle {
  focusFacility(): void;
  focusUser(): void;
  focusStore(storeId: string): void;
  focusLatLng(p: LatLng, zoomedIn?: boolean): void;
  focusLocalPoints(points: Vec2[]): void;
}
