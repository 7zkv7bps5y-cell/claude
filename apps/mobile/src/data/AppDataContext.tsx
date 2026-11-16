import {
  activeRulesAt,
  assessRuleFreshness,
  effectiveFreshnessSettings,
  FacilityDataSync,
  Outbox,
  rotateAnonSessionId,
  type AnalyticsEventType,
  type BundleSource,
  type FacilityBundle,
  type FlushReport,
  type FreshnessAssessment,
  type KeyValueStore,
  type RefreshReport,
  type RouteRule,
  type RouteRulesSnapshot,
} from '@facility-nav/core';
import { sampleFacility } from '@facility-nav/sample-data';
import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { config, hasServer } from '../config';
import { facilityApi, sendEvents } from './api';
import { createKeyValueStore, createOutboxStore } from './storage';

/**
 * アプリ全体のデータ（施設データ・規制情報・送信キュー・検証用設定）を管理する。
 */

const REFRESH_INTERVAL_MS = 15 * 60_000; // 施設データ・規制情報の確認間隔
const TICK_MS = 30_000; // 鮮度表示の更新・送信キューの送信間隔

const K_CONSENT = 'settings:analytics_consent';
const K_SIM_OFFLINE = 'debug:simulate_offline';
const K_CLOCK_OFFSET = 'debug:clock_offset_minutes';
const K_ANON = 'settings:anon_session';

export interface AppData {
  ready: boolean;
  bundle: FacilityBundle | null;
  bundleSource: BundleSource | null;
  bundleSavedAt: string | null;
  rules: RouteRulesSnapshot | null;
  /** 現在時刻で有効な規制 */
  activeRules: RouteRule[];
  freshness: FreshnessAssessment | null;
  lastRefresh: RefreshReport | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** 分析データ送信の同意（初期値：同意しない） */
  analyticsConsent: boolean;
  setAnalyticsConsent: (v: boolean) => Promise<void>;
  track: (type: AnalyticsEventType, data?: { floorId?: string; x?: number; y?: number; payload?: Record<string, unknown> }) => void;
  outboxCount: number;
  flushOutbox: () => Promise<FlushReport | null>;
  lastFlush: FlushReport | null;
  /** 検証用：通信できない状態を模擬 */
  simulateOffline: boolean;
  setSimulateOffline: (v: boolean) => Promise<void>;
  /** 検証用：鮮度判定に使う時刻を進める（分） */
  clockOffsetMinutes: number;
  setClockOffsetMinutes: (v: number) => Promise<void>;
  now: () => Date;
  anonSessionId: string | null;
  rollbackBundle: () => Promise<boolean>;
}

const Ctx = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppDataProvider の内側で使用してください');
  return v;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const kvRef = useRef<KeyValueStore | null>(null);
  const syncRef = useRef<FacilityDataSync | null>(null);
  const outboxRef = useRef<Outbox | null>(null);
  const consentRef = useRef(false);
  const simOfflineRef = useRef(false);
  const offsetRef = useRef(0);
  const anonRef = useRef<{ id: string; day: string } | null>(null);

  const [ready, setReady] = useState(false);
  const [bundle, setBundle] = useState<FacilityBundle | null>(null);
  const [bundleSource, setBundleSource] = useState<BundleSource | null>(null);
  const [bundleSavedAt, setBundleSavedAt] = useState<string | null>(null);
  const [rules, setRules] = useState<RouteRulesSnapshot | null>(null);
  const [lastRefresh, setLastRefresh] = useState<RefreshReport | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [analyticsConsent, setConsentState] = useState(false);
  const [outboxCount, setOutboxCount] = useState(0);
  const [lastFlush, setLastFlush] = useState<FlushReport | null>(null);
  const [simulateOffline, setSimOfflineState] = useState(false);
  const [clockOffsetMinutes, setOffsetState] = useState(0);
  const [tick, setTick] = useState(0);
  const [anonSessionId, setAnonSessionId] = useState<string | null>(null);

  const now = useCallback(() => new Date(Date.now() + offsetRef.current * 60_000), []);

  const reloadFromStorage = useCallback(async () => {
    const sync = syncRef.current!;
    const b = await sync.loadBundle();
    setBundle(b?.bundle ?? null);
    setBundleSource(b?.source ?? null);
    setBundleSavedAt(b?.savedAt ?? null);
    setRules(await sync.loadRules());
  }, []);

  const updateOutboxCount = useCallback(async () => {
    if (outboxRef.current) setOutboxCount(await outboxRef.current.count());
  }, []);

  const flushOutbox = useCallback(async () => {
    const box = outboxRef.current;
    if (!box) return null;
    if (!hasServer || simOfflineRef.current) {
      await updateOutboxCount();
      return null;
    }
    const r = await box.flush(new Date());
    setLastFlush(r);
    await updateOutboxCount();
    return r;
  }, [updateOutboxCount]);

  const refresh = useCallback(async () => {
    const sync = syncRef.current;
    if (!sync) return;
    setRefreshing(true);
    try {
      const report = await sync.refresh({ simulateOffline: simOfflineRef.current });
      setLastRefresh(report);
      await reloadFromStorage();
      await flushOutbox();
    } finally {
      setRefreshing(false);
    }
  }, [reloadFromStorage, flushOutbox]);

  // 初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kv = createKeyValueStore();
      kvRef.current = kv;
      consentRef.current = (await kv.getItem(K_CONSENT)) === 'true';
      simOfflineRef.current = (await kv.getItem(K_SIM_OFFLINE)) === 'true';
      offsetRef.current = Number((await kv.getItem(K_CLOCK_OFFSET)) ?? '0') || 0;
      try {
        anonRef.current = JSON.parse((await kv.getItem(K_ANON)) ?? 'null');
      } catch {
        anonRef.current = null;
      }
      syncRef.current = new FacilityDataSync(kv, hasServer ? facilityApi : null, config.facilityId, sampleFacility);
      outboxRef.current = new Outbox(await createOutboxStore(), sendEvents, () => consentRef.current);
      if (cancelled) return;
      setConsentState(consentRef.current);
      setSimOfflineState(simOfflineRef.current);
      setOffsetState(offsetRef.current);
      await reloadFromStorage();
      await updateOutboxCount();
      setReady(true);
      void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadFromStorage, refresh, updateOutboxCount]);

  // 定期処理：鮮度表示の更新・送信・施設データの確認
  useEffect(() => {
    if (!ready) return;
    let lastRefreshAt = Date.now();
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() - lastRefreshAt > REFRESH_INTERVAL_MS) {
        lastRefreshAt = Date.now();
        void refresh();
      } else {
        void flushOutbox();
      }
    }, TICK_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        lastRefreshAt = Date.now();
        void refresh();
      }
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [ready, refresh, flushOutbox]);

  const track = useCallback<AppData['track']>(
    (type, data = {}) => {
      const box = outboxRef.current;
      const kv = kvRef.current;
      if (!box || !kv || !consentRef.current) return; // 同意がなければ記録しない
      const t = new Date();
      const anon = rotateAnonSessionId(anonRef.current, t, randomUUID);
      if (anon !== anonRef.current) {
        anonRef.current = anon;
        void kv.setItem(K_ANON, JSON.stringify(anon));
      }
      setAnonSessionId(anon.id);
      void box
        .enqueue({
          eventId: randomUUID(),
          facilityId: config.facilityId,
          anonSessionId: anon.id,
          type,
          occurredAt: t.toISOString(),
          floorId: data.floorId ?? null,
          x: data.x ?? null,
          y: data.y ?? null,
          payload: data.payload ?? {},
          platform: Platform.OS,
          appVersion: config.appVersion,
        })
        .then(updateOutboxCount);
    },
    [updateOutboxCount],
  );

  const setAnalyticsConsent = useCallback(
    async (v: boolean) => {
      consentRef.current = v;
      setConsentState(v);
      await kvRef.current?.setItem(K_CONSENT, String(v));
      if (!v) await outboxRef.current?.onConsentRevoked(); // 撤回時は未送信データを削除
      await updateOutboxCount();
    },
    [updateOutboxCount],
  );

  const setSimulateOffline = useCallback(async (v: boolean) => {
    simOfflineRef.current = v;
    setSimOfflineState(v);
    await kvRef.current?.setItem(K_SIM_OFFLINE, String(v));
  }, []);

  const setClockOffsetMinutes = useCallback(async (v: number) => {
    offsetRef.current = v;
    setOffsetState(v);
    await kvRef.current?.setItem(K_CLOCK_OFFSET, String(v));
  }, []);

  const rollbackBundle = useCallback(async () => {
    const ok = (await syncRef.current?.rollbackToPrevious()) ?? false;
    await reloadFromStorage();
    return ok;
  }, [reloadFromStorage]);

  const value = useMemo<AppData>(() => {
    const t = now();
    const freshness = bundle
      ? assessRuleFreshness(rules, effectiveFreshnessSettings(rules, bundle.facility.freshness), t)
      : null;
    return {
      ready,
      bundle,
      bundleSource,
      bundleSavedAt,
      rules,
      activeRules: rules ? activeRulesAt(rules.rules, t) : [],
      freshness,
      lastRefresh,
      refreshing,
      refresh,
      analyticsConsent,
      setAnalyticsConsent,
      track,
      outboxCount,
      flushOutbox,
      lastFlush,
      simulateOffline,
      setSimulateOffline,
      clockOffsetMinutes,
      setClockOffsetMinutes,
      now,
      anonSessionId,
      rollbackBundle,
    };
    // tick は鮮度表示を定期的に再計算するために依存に含める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    bundle,
    bundleSource,
    bundleSavedAt,
    rules,
    lastRefresh,
    refreshing,
    refresh,
    analyticsConsent,
    setAnalyticsConsent,
    track,
    outboxCount,
    flushOutbox,
    lastFlush,
    simulateOffline,
    setSimulateOffline,
    clockOffsetMinutes,
    setClockOffsetMinutes,
    now,
    anonSessionId,
    rollbackBundle,
    tick,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
