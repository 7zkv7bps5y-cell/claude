import type { UserLocation } from '../components/FacilityMap.types';

/** ブラウザ版（確認用）では現在地・住所検索は使わない。iPhone / Android は useLocation.native.ts */
export type LocationPermission = 'unknown' | 'undetermined' | 'granted' | 'denied' | 'unavailable';

export function useLocation(): { permission: LocationPermission; location: UserLocation | null; request: () => Promise<boolean> } {
  return { permission: 'unavailable', location: null, request: async () => false };
}

export async function geocode(_query: string): Promise<{ latitude: number; longitude: number }[]> {
  return [];
}

export async function currentPositionOnce(): Promise<UserLocation | null> {
  return null;
}
