import {
  describeRoute,
  findRoute,
  isOpenNow,
  lngLatToLocal,
  localToLngLat,
  nextVenueState,
  routeFloors,
  searchStores,
  type RouteFailure,
  type RouteResult,
  type RouteStep,
  type Vec2,
} from '@facility-nav/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FacilityMap } from '../components/FacilityMap';
import type { FacilityMapHandle, LatLng } from '../components/FacilityMap.types';
import { StatusBanner } from '../components/StatusBanner';
import { Badge, Card, Chip, PrimaryButton, RoundButton } from '../components/ui';
import { useAppData } from '../data/AppDataContext';
import { geocode, useLocation } from '../data/useLocation';
import { confirmAsync, notify } from '../lib/dialog';
import { openDirections } from '../lib/directions';
import { walkMinutes } from '../lib/format';
import { colors, radius, shadow } from '../theme';

type Start = { floorId: string; point: Vec2; label: string };
type ActiveRoute = { label: string; storeId: string | null; result: RouteResult | RouteFailure; reference: boolean; steps: RouteStep[] };

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  restaurant: 'restaurant',
  shirt: 'shirt',
  gift: 'gift',
  sparkles: 'sparkles',
  basket: 'basket',
  construct: 'construct',
};

export default function MapScreen() {
  const d = useAppData();
  const { bundle } = d;
  const insets = useSafeAreaInsets();
  const mapRef = useRef<FacilityMapHandle>(null);
  const loc = useLocation();

  const [floorId, setFloorId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<(LatLng & { title: string })[] | null>(null);
  const [placePin, setPlacePin] = useState<(LatLng & { title: string }) | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const [route, setRoute] = useState<ActiveRoute | null>(null);
  const [indoorVisible, setIndoorVisible] = useState(true);
  const [venue, setVenue] = useState<'inside' | 'outside' | 'unknown'>('unknown');
  const [toast, setToast] = useState<string | null>(null);
  const [locPromptDismissed, setLocPromptDismissed] = useState(false);
  const trackedOpen = useRef(false);

  const showToast = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3000);
  }, []);

  // 初期値：最初のフロア・正面入口を出発地に
  useEffect(() => {
    if (!bundle) return;
    if (!floorId || !bundle.floors.some((f) => f.id === floorId)) setFloorId(bundle.floors[0]?.id ?? '');
    if (!start) {
      const ent =
        bundle.nav.nodes.find((n) => n.id === bundle.facility.mainEntranceNodeId) ?? bundle.nav.nodes.find((n) => n.kind === 'entrance');
      if (ent) setStart({ floorId: ent.floorId, point: { x: ent.x, y: ent.y }, label: ent.name ?? '出入口' });
    }
  }, [bundle, floorId, start]);

  useEffect(() => {
    if (!d.ready || trackedOpen.current) return;
    trackedOpen.current = true;
    d.track('app_open');
    d.track('map_view', { floorId });
  }, [d, floorId]);

  // 施設への出入りで屋内・屋外を自動切替（境界付近ではちらつかない）
  useEffect(() => {
    if (!bundle || !loc.location) return;
    const p = lngLatToLocal([loc.location.longitude, loc.location.latitude], bundle.facility);
    const next = nextVenueState(venue, bundle, p, loc.location.accuracy);
    if (next !== venue) {
      if (venue !== 'unknown' || next === 'inside') {
        if (next === 'inside') {
          showToast('施設に入りました。屋内の地図を表示します');
          mapRef.current?.focusFacility();
        } else showToast('施設の外に出ました');
      }
      setVenue(next);
    }
  }, [bundle, loc.location, venue, showToast]);

  const blockedEdgeIds = useMemo(
    () => new Set(d.activeRules.filter((r) => r.kind === 'closed' || r.kind === 'temporary_closure' || r.kind === 'restricted').flatMap((r) => r.edgeIds)),
    [d.activeRules],
  );
  const hits = useMemo(() => (bundle && query.trim() ? searchStores(bundle, query) : []), [bundle, query]);
  const highlight = useMemo(
    () => (bundle && categoryId ? new Set(bundle.stores.filter((s) => s.categoryId === categoryId).map((s) => s.id)) : null),
    [bundle, categoryId],
  );

  // 規制情報が更新されたら表示中の経路を計算し直す
  const activeRulesKey = d.activeRules.map((r) => r.id).join(',');
  useEffect(() => {
    if (!bundle || !route || !start || !route.result.ok) return;
    const last = route.result.path[route.result.path.length - 1];
    if (!last?.nodeId) return;
    const result = findRoute(bundle, { floorId: start.floorId, point: start.point }, last.nodeId, d.activeRules);
    setRoute((r) => (r ? { ...r, result, steps: result.ok ? describeRoute(bundle, result, { start: start.label, destination: r.label }) : [] } : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRulesKey]);

  if (!d.ready || !bundle || !floorId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>施設データを読み込んでいます…</Text>
      </View>
    );
  }

  const fac = bundle.facility;
  const selected = bundle.stores.find((s) => s.id === selectedStoreId) ?? null;
  const category = (id: string) => bundle.categories.find((c) => c.id === id);
  const floorName = (id: string) => bundle.floors.find((f) => f.id === id)?.name ?? '';

  const selectStore = (id: string) => {
    const s = bundle.stores.find((x) => x.id === id);
    if (!s) return;
    Keyboard.dismiss();
    setSelectedStoreId(id);
    setQuery('');
    setPlaces(null);
    setRoute(null);
    setFloorId(s.floorId);
    mapRef.current?.focusStore(id);
    d.track('store_click', { floorId: s.floorId, payload: { storeId: id } });
  };

  const runRoute = async (destNodeId: string, label: string, storeId: string | null) => {
    if (!start || !d.freshness) return;
    const f = d.freshness;
    if (f.routing === 'block') {
      notify('経路案内を停止しています', f.message);
      d.track('route_search', { floorId: start.floorId, payload: { destination: destNodeId, result: 'blocked_by_freshness' } });
      return;
    }
    if (f.routing === 'confirm' && !(await confirmAsync('参考案内になります', f.message, '参考案内を表示'))) return;
    const result = findRoute(bundle, { floorId: start.floorId, point: start.point }, destNodeId, d.activeRules);
    const steps = result.ok ? describeRoute(bundle, result, { start: start.label, destination: label }) : [];
    setRoute({ label, storeId, result, reference: f.isReferenceOnly, steps });
    if (result.ok) {
      setFloorId(start.floorId);
      mapRef.current?.focusLocalPoints(result.path.filter((p) => p.floorId === start.floorId));
    }
    d.track('route_search', {
      floorId: start.floorId,
      x: start.point.x,
      y: start.point.y,
      payload: { destination: destNodeId, storeId, result: result.ok ? 'ok' : result.reason },
    });
  };

  /** いちばん近いトイレへ */
  const routeToNearestToilet = async () => {
    if (!start) return;
    const toilets = bundle.nav.nodes.filter((n) => n.kind === 'toilet');
    let best: { id: string; d: number } | null = null;
    for (const t of toilets) {
      const r = findRoute(bundle, { floorId: start.floorId, point: start.point }, t.id, d.activeRules);
      if (r.ok && (!best || r.distanceM < best.d)) best = { id: t.id, d: r.distanceM };
    }
    if (!best) return notify('トイレ', '通行できる経路が見つかりません。');
    setSelectedStoreId(null);
    await runRoute(best.id, 'トイレ', null);
  };

  const searchPlaces = async () => {
    const q = query.trim();
    if (!q) return;
    d.track('store_search', { payload: { keyword: q, hits: hits.length } });
    const r = await geocode(q);
    setPlaces(r.map((p) => ({ ...p, title: q })));
  };

  const facilityLatLng = (nodeId?: string): LatLng => {
    const n = bundle.nav.nodes.find((x) => x.id === (nodeId ?? fac.mainEntranceNodeId)) ?? bundle.nav.nodes[0]!;
    const [longitude, latitude] = localToLngLat(n, fac);
    return { latitude, longitude };
  };
  const distanceToFacilityM = loc.location
    ? (() => {
        const p = lngLatToLocal([loc.location.longitude, loc.location.latitude], fac);
        return Math.hypot(p.x - 80, p.y - 35);
      })()
    : null;

  const routeOk = route?.result.ok ? route.result : null;
  const routeFloorIds = routeOk ? routeFloors(routeOk) : [];

  return (
    <View style={styles.root}>
      <FacilityMap
        ref={mapRef}
        bundle={bundle}
        floorId={floorId}
        selectedStoreId={selectedStoreId}
        highlightStoreIds={highlight}
        route={routeOk}
        blockedEdgeIds={blockedEdgeIds}
        start={start}
        userLocation={loc.permission === 'granted' ? loc.location : null}
        placePin={placePin}
        onStorePress={selectStore}
        onIndoorPress={(p) => {
          setStart({ floorId, point: p, label: '指定した地点' });
          setRoute(null);
          showToast(`出発地を ${floorName(floorId)} の指定した地点にしました`);
        }}
        onIndoorVisibleChange={setIndoorVisible}
      />

      {/* 上部：検索バー・カテゴリー・状態表示 */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textSub} />
          <TextInput
            style={styles.searchInput}
            placeholder="店舗・住所・地名で検索"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setPlaces(null);
            }}
            returnKeyType="search"
            onSubmitEditing={searchPlaces}
            testID="search-input"
          />
          {query !== '' && (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="検索をクリア">
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={() => router.push('/debug')} accessibilityLabel="検証画面を開く" style={styles.debugBtn}>
            <Text style={styles.debugText}>検証</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          <Chip label="トイレ" icon="male-female" onPress={routeToNearestToilet} />
          {bundle.categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              icon={CATEGORY_ICON[c.icon]}
              color={c.color}
              selected={categoryId === c.id}
              onPress={() => {
                setCategoryId((v) => (v === c.id ? null : c.id));
                setSelectedStoreId(null);
                setRoute(null);
              }}
            />
          ))}
        </ScrollView>

        <StatusBanner />
        {fac.isSample && <Text style={styles.sampleNote}>【サンプル】実在の施設ではありません</Text>}

        {loc.permission === 'undetermined' && !locPromptDismissed && (
          <Card style={styles.locPrompt}>
            <Text style={styles.locTitle}>現在地を使いますか？</Text>
            <Text style={styles.muted}>施設の外では地図アプリのように現在地を表示し、施設に入ると屋内の地図に切り替えます。分析データの送信とは別の設定です。</Text>
            <View style={styles.row}>
              <PrimaryButton label="あとで" kind="secondary" onPress={() => setLocPromptDismissed(true)} />
              <PrimaryButton label="許可する" onPress={() => void loc.request()} />
            </View>
          </Card>
        )}

        {toast && (
          <View style={styles.toast}>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>

      {/* 検索結果 */}
      {query.trim() !== '' && (
        <View style={[styles.results, { top: insets.top + 64 }]} testID="search-results">
          <ScrollView keyboardShouldPersistTaps="handled">
            {hits.map((h) => (
              <Pressable key={h.store.id} style={styles.resultItem} onPress={() => selectStore(h.store.id)}>
                <View style={[styles.resultIcon, { backgroundColor: category(h.store.categoryId)?.color ?? '#999' }]}>
                  <Ionicons name={CATEGORY_ICON[category(h.store.categoryId)?.icon ?? ''] ?? 'storefront'} size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{h.store.name}</Text>
                  <Text style={styles.muted}>
                    {h.categoryName}・{floorName(h.store.floorId)}
                  </Text>
                </View>
              </Pressable>
            ))}
            {hits.length === 0 && <Text style={[styles.muted, { padding: 12 }]}>施設内に該当する店舗はありません</Text>}
            <Pressable style={styles.resultItem} onPress={searchPlaces}>
              <View style={[styles.resultIcon, { backgroundColor: colors.textSub }]}>
                <Ionicons name="location" size={14} color="#fff" />
              </View>
              <Text style={styles.resultName}>「{query.trim()}」を地図で探す（住所・地名）</Text>
            </Pressable>
            {places?.length === 0 && <Text style={[styles.muted, { padding: 12 }]}>見つかりませんでした（ブラウザ版では使えません）</Text>}
            {places?.map((p, i) => (
              <Pressable
                key={i}
                style={styles.resultItem}
                onPress={() => {
                  setPlacePin(p);
                  setQuery('');
                  setPlaces(null);
                  setSelectedStoreId(null);
                  setRoute(null);
                  Keyboard.dismiss();
                  mapRef.current?.focusLatLng(p);
                }}
              >
                <Ionicons name="pin" size={18} color={colors.primary} />
                <Text style={styles.resultName}>
                  {p.title}（{p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}）
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 右側：フロア切替・現在地・施設表示 */}
      <View style={[styles.side, { bottom: 230 + insets.bottom }]} pointerEvents="box-none">
        {indoorVisible && (
          <View style={styles.floors} testID="floor-switcher">
            {[...bundle.floors].reverse().map((f) => (
              <Pressable key={f.id} onPress={() => setFloorId(f.id)} style={[styles.floorBtn, f.id === floorId && styles.floorBtnOn]} accessibilityLabel={`${f.name}を表示`}>
                <Text style={[styles.floorText, f.id === floorId && styles.floorTextOn]}>{f.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <RoundButton icon="business" label="施設全体を表示" onPress={() => mapRef.current?.focusFacility()} />
        {loc.permission !== 'unavailable' && (
          <RoundButton
            icon="locate"
            label="現在地"
            onPress={async () => {
              if (loc.permission !== 'granted' && !(await loc.request())) return notify('現在地', '位置情報の利用が許可されていません。iPhone の「設定」から変更できます。');
              mapRef.current?.focusUser();
            }}
          />
        )}
      </View>

      {/* 下部カード */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} pointerEvents="box-none">
        {route ? (
          <Card testID="route-card">
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {route.label} への経路
              </Text>
              <Pressable onPress={() => setRoute(null)} accessibilityLabel="案内を終了">
                <Ionicons name="close" size={22} color={colors.textSub} />
              </Pressable>
            </View>
            {route.result.ok ? (
              <>
                <Text style={styles.routeSummary}>
                  徒歩約{walkMinutes(route.result.distanceM)}分・約{Math.round(route.result.distanceM)}m
                </Text>
                {route.reference && (
                  <View style={styles.refBox}>
                    <Ionicons name="alert-circle" size={14} color={colors.warn} />
                    <Text style={styles.refText}>保存済み情報に基づく参考案内です。現地の案内表示もご確認ください。</Text>
                  </View>
                )}
                <View style={styles.steps}>
                  {route.steps.map((s, i) => (
                    <View key={i} style={styles.stepRow}>
                      <Ionicons
                        name={s.kind === 'start' ? 'radio-button-on' : s.kind === 'arrive' ? 'flag' : s.kind === 'floor_change' ? 'swap-vertical' : 'walk'}
                        size={14}
                        color={s.kind === 'arrive' ? colors.danger : colors.primary}
                      />
                      <Text style={styles.stepText}>{s.text}</Text>
                    </View>
                  ))}
                </View>
                {routeFloorIds.length > 1 && (
                  <View style={styles.row}>
                    {routeFloorIds.map((fid) => (
                      <Chip
                        key={fid}
                        label={`${floorName(fid)}の経路`}
                        selected={fid === floorId}
                        onPress={() => {
                          setFloorId(fid);
                          if (routeOk) mapRef.current?.focusLocalPoints(routeOk.path.filter((p) => p.floorId === fid));
                        }}
                      />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.error}>{route.result.message}</Text>
            )}
          </Card>
        ) : selected ? (
          <Card testID="store-card">
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{selected.name}</Text>
              <Pressable onPress={() => setSelectedStoreId(null)} accessibilityLabel="閉じる">
                <Ionicons name="close" size={22} color={colors.textSub} />
              </Pressable>
            </View>
            <View style={styles.row}>
              <Badge text={category(selected.categoryId)?.name ?? ''} color="#fff" bg={category(selected.categoryId)?.color ?? '#999'} />
              <Text style={styles.muted}>{floorName(selected.floorId)}</Text>
              {(() => {
                const open = isOpenNow(selected.openingHours, new Date());
                return open === null ? null : open ? <Badge text="営業中" color={colors.ok} bg={colors.okBg} /> : <Badge text="営業時間外" color={colors.danger} bg={colors.dangerBg} />;
              })()}
            </View>
            <Text style={styles.muted}>営業時間 {selected.openingHours}</Text>
            <Text style={styles.desc}>{selected.description}</Text>
            <Text style={styles.startText} numberOfLines={1}>
              出発地：{start ? `${floorName(start.floorId)} ${start.label}` : '未指定'}（地図の通路をタップで変更）
            </Text>
            <View style={styles.row}>
              <PrimaryButton label="ここへ行く" icon="navigate" onPress={() => void runRoute(selected.entranceNodeId, selected.name, selected.id)} testID="route-button" />
            </View>
          </Card>
        ) : categoryId && highlight ? (
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>
                {category(categoryId)?.name}（{highlight.size}件）
              </Text>
              <Pressable onPress={() => setCategoryId(null)} accessibilityLabel="閉じる">
                <Ionicons name="close" size={22} color={colors.textSub} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 200 }}>
              {bundle.stores
                .filter((s) => highlight.has(s.id))
                .map((s) => (
                  <Pressable key={s.id} style={styles.listItem} onPress={() => selectStore(s.id)}>
                    <Text style={styles.resultName}>{s.name}</Text>
                    <Text style={styles.muted}>
                      {floorName(s.floorId)}・{s.openingHours}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </Card>
        ) : placePin ? (
          <Card>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{placePin.title}</Text>
              <Pressable onPress={() => setPlacePin(null)} accessibilityLabel="閉じる">
                <Ionicons name="close" size={22} color={colors.textSub} />
              </Pressable>
            </View>
            <View style={styles.row}>
              <PrimaryButton label="ここへの経路" icon="car" onPress={() => openDirections(placePin.latitude, placePin.longitude, placePin.title)} />
            </View>
          </Card>
        ) : (
          <Card testID="home-card">
            <Text style={styles.cardTitle}>{fac.name}</Text>
            {venue === 'inside' ? (
              <Text style={styles.muted}>施設内にいます。店舗を検索するか、地図の店舗をタップしてください。</Text>
            ) : (
              <Text style={styles.muted}>
                {distanceToFacilityM !== null ? `現在地から約${formatDistance(distanceToFacilityM)}` : '施設の店舗を探したり、施設までの経路を調べたりできます。'}
              </Text>
            )}
            <Text style={styles.startText} numberOfLines={1}>
              出発地：{start ? `${floorName(start.floorId)} ${start.label}` : '未指定'}（地図の通路をタップで変更）
            </Text>
            <View style={styles.row}>
              <PrimaryButton label="施設を表示" icon="business" kind="secondary" onPress={() => mapRef.current?.focusFacility()} />
              <PrimaryButton
                label="施設への経路"
                icon="car"
                onPress={() => {
                  const p = facilityLatLng();
                  openDirections(p.latitude, p.longitude, fac.name);
                }}
              />
            </View>
          </Card>
        )}
      </View>
    </View>
  );
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EEF0F3' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 8 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadow,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, height: 48 },
  debugBtn: { paddingHorizontal: 10, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, justifyContent: 'center' },
  debugText: { fontSize: 12, color: colors.textSub, fontWeight: '600' },
  chips: { gap: 8, paddingRight: 12 },
  sampleNote: { fontSize: 11, color: colors.warn, marginLeft: 4 },
  locPrompt: { gap: 8 },
  locTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  toast: { alignSelf: 'center', backgroundColor: 'rgba(32,33,36,0.9)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  toastText: { color: '#fff', fontSize: 13 },
  results: { position: 'absolute', left: 12, right: 12, maxHeight: 360, backgroundColor: colors.surface, borderRadius: radius.m, paddingVertical: 4, ...shadow },
  resultItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  resultIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resultName: { fontSize: 15, color: colors.text, flexShrink: 1 },
  side: { position: 'absolute', right: 12, gap: 10, alignItems: 'flex-end' },
  floors: { backgroundColor: colors.surface, borderRadius: radius.m, overflow: 'hidden', ...shadow },
  floorBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  floorBtnOn: { backgroundColor: colors.primary },
  floorText: { fontSize: 14, fontWeight: '700', color: colors.textSub },
  floorTextOn: { color: '#fff' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  cardTitle: { fontSize: 19, fontWeight: '700', color: colors.text, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  muted: { fontSize: 13, color: colors.textSub },
  desc: { fontSize: 14, color: colors.text, marginTop: 6 },
  startText: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  routeSummary: { fontSize: 22, fontWeight: '700', color: colors.ok },
  refBox: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: colors.warnBg, borderRadius: radius.s, padding: 8, marginTop: 8 },
  refText: { fontSize: 12, color: colors.warn, flex: 1 },
  steps: { marginTop: 10, gap: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepText: { fontSize: 14, color: colors.text },
  error: { fontSize: 14, color: colors.danger, marginTop: 4 },
  listItem: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
