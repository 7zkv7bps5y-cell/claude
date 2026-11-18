import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserLocation } from '../components/FacilityMap.types';

/**
 * 現在地（GPS）の取得。設計書 5章の「1. 位置情報の利用許可」に対応。
 * 許可は利用者が「許可する」を押したときにだけ求める（起動直後に勝手に求めない）。
 */
export type LocationPermission = 'unknown' | 'undetermined' | 'granted' | 'denied' | 'unavailable';

export function useLocation() {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [location, setLocation] = useState<UserLocation | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  const startWatching = useCallback(async () => {
    if (sub.current) return;
    sub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 3000 },
      (pos) =>
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 999 }),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then(async (p) => {
        if (cancelled) return;
        if (p.granted) {
          setPermission('granted');
          await startWatching();
        } else setPermission(p.canAskAgain ? 'undetermined' : 'denied');
      })
      .catch(() => setPermission('unavailable'));
    return () => {
      cancelled = true;
      sub.current?.remove();
      sub.current = null;
    };
  }, [startWatching]);

  const request = useCallback(async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    if (p.granted) {
      setPermission('granted');
      await startWatching();
      return true;
    }
    setPermission('denied');
    return false;
  }, [startWatching]);

  return { permission, location, request };
}

/** 住所・地名の検索（iPhone は端末標準の機能を使用。費用なし） */
export async function geocode(query: string): Promise<{ latitude: number; longitude: number }[]> {
  try {
    const r = await Location.geocodeAsync(query);
    return r.slice(0, 5).map((x) => ({ latitude: x.latitude, longitude: x.longitude }));
  } catch {
    return [];
  }
}

export async function currentPositionOnce(): Promise<UserLocation | null> {
  const p = await Location.getForegroundPermissionsAsync();
  if (!p.granted) return null;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 999 };
}
