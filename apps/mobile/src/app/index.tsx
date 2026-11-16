import { findRoute, searchStores, type RouteFailure, type RouteResult, type Vec2 } from '@facility-nav/core';
import { Link } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IndoorMap } from '../components/IndoorMap';
import { StatusBanner } from '../components/StatusBanner';
import { useAppData } from '../data/AppDataContext';
import { confirmAsync, notify } from '../lib/dialog';
import { walkMinutes } from '../lib/format';

type Start = { point: Vec2; label: string };

export default function MapScreen() {
  const d = useAppData();
  const { bundle } = d;
  const floorId = bundle?.floors[0]?.id ?? '';
  const [query, setQuery] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const [route, setRoute] = useState<{ storeId: string; result: RouteResult | RouteFailure; reference: boolean } | null>(null);
  const trackedOpen = useRef(false);

  // 出発地の初期値：最初の出入口
  useEffect(() => {
    if (!bundle || start) return;
    const ent = bundle.nav.nodes.find((n) => n.kind === 'entrance');
    if (ent) setStart({ point: { x: ent.x, y: ent.y }, label: ent.name ?? '出入口' });
  }, [bundle, start]);

  useEffect(() => {
    if (!d.ready || trackedOpen.current) return;
    trackedOpen.current = true;
    d.track('app_open');
    d.track('map_view', { floorId });
  }, [d, floorId]);

  // 通れない通路線（地図に赤の破線で表示）
  const blockedEdgeIds = useMemo(
    () =>
      new Set(
        d.activeRules
          .filter((r) => r.kind === 'closed' || r.kind === 'temporary_closure' || r.kind === 'restricted')
          .flatMap((r) => r.edgeIds),
      ),
    [d.activeRules],
  );

  // 規制情報が更新されたら、表示中の経路を計算し直す
  const activeRulesKey = d.activeRules.map((r) => r.id).join(',');
  useEffect(() => {
    if (!bundle || !route || !start) return;
    const store = bundle.stores.find((s) => s.id === route.storeId);
    if (!store) return;
    setRoute((r) =>
      r ? { ...r, result: findRoute(bundle, { floorId, point: start.point }, store.entranceNodeId, d.activeRules) } : r,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRulesKey, bundle]);

  const hits = useMemo(() => (bundle && query.trim() ? searchStores(bundle, query) : []), [bundle, query]);
  const selected = bundle?.stores.find((s) => s.id === selectedStoreId) ?? null;
  const category = selected ? bundle?.categories.find((c) => c.id === selected.categoryId) : undefined;

  if (!d.ready || !bundle) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>施設データを読み込んでいます…</Text>
      </View>
    );
  }

  const selectStore = (id: string) => {
    setSelectedStoreId(id);
    setQuery('');
    d.track('store_click', { floorId, payload: { storeId: id } });
  };

  const startRoute = async () => {
    if (!selected || !start || !d.freshness) return;
    const f = d.freshness;
    if (f.routing === 'block') {
      notify('経路案内を停止しています', f.message);
      d.track('route_search', { floorId, payload: { destinationStoreId: selected.id, result: 'blocked_by_freshness' } });
      return;
    }
    if (f.routing === 'confirm') {
      const ok = await confirmAsync('参考案内になります', f.message, '参考案内を表示');
      if (!ok) return;
    }
    const result = findRoute(bundle, { floorId, point: start.point }, selected.entranceNodeId, d.activeRules);
    setRoute({ storeId: selected.id, result, reference: f.isReferenceOnly });
    d.track('route_search', {
      floorId,
      x: start.point.x,
      y: start.point.y,
      payload: { destinationStoreId: selected.id, result: result.ok ? 'ok' : result.reason },
    });
  };

  const routeOk = route?.result.ok ? route.result : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {bundle.facility.name}
          </Text>
          {bundle.facility.isSample && <Text style={styles.sampleBadge}>サンプルデータ（実在の施設ではありません）</Text>}
        </View>
        <Link href="/debug" asChild>
          <Pressable style={styles.debugBtn} accessibilityLabel="検証画面を開く">
            <Text style={styles.debugText}>検証</Text>
          </Pressable>
        </Link>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="店舗名・カテゴリーで検索"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => query.trim() && d.track('store_search', { payload: { keyword: query.trim(), hits: hits.length } })}
          testID="search-input"
        />
      </View>

      <StatusBanner />

      <View style={{ flex: 1 }}>
        <IndoorMap
          bundle={bundle}
          floorId={floorId}
          selectedStoreId={selectedStoreId}
          route={routeOk}
          blockedEdgeIds={blockedEdgeIds}
          startPoint={start?.point ?? null}
          onStorePress={selectStore}
          onMapPress={(p) => {
            setStart({ point: p, label: '地図で指定した地点' });
            setRoute(null);
          }}
        />

        {query.trim() !== '' && (
          <View style={styles.results} testID="search-results">
            {hits.length === 0 ? (
              <Text style={styles.muted}>該当する店舗がありません</Text>
            ) : (
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={hits}
                keyExtractor={(h) => h.store.id}
                renderItem={({ item }) => (
                  <Pressable style={styles.resultItem} onPress={() => selectStore(item.store.id)}>
                    <Text style={styles.resultName}>{item.store.name}</Text>
                    <Text style={styles.muted}>{item.categoryName}</Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        )}
      </View>

      <View style={styles.sheet}>
        <Text style={styles.startText} numberOfLines={1}>
          出発地：{start?.label ?? '未指定'}（地図の通路部分をタップして変更）
        </Text>
        {selected && (
          <View testID="store-card">
            <View style={styles.cardHead}>
              <Text style={styles.storeName}>{selected.name}</Text>
              <Pressable onPress={() => { setSelectedStoreId(null); setRoute(null); }} accessibilityLabel="閉じる">
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.muted}>
              {category?.name ?? ''}　／　{bundle.floors.find((f) => f.id === selected.floorId)?.name}　／　営業時間 {selected.openingHours}
            </Text>
            <Text style={styles.desc}>{selected.description}</Text>
            {route?.storeId === selected.id ? (
              route.result.ok ? (
                <View style={[styles.routeBox, route.reference && styles.routeBoxRef]}>
                  <Text style={styles.routeText}>
                    約{Math.round(route.result.distanceM)}m・徒歩約{walkMinutes(route.result.distanceM)}分
                  </Text>
                  {route.reference && <Text style={styles.refText}>保存済み情報に基づく参考案内です。現地の案内表示もご確認ください。</Text>}
                </View>
              ) : (
                <Text style={styles.error}>{route.result.message}</Text>
              )
            ) : (
              <Pressable style={styles.primary} onPress={startRoute} testID="route-button">
                <Text style={styles.primaryText}>ここへ行く</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#263238' },
  sampleBadge: { fontSize: 11, color: '#B26A00', marginTop: 2 },
  debugBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#ECEFF1' },
  debugText: { fontSize: 13, color: '#37474F' },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  search: {
    height: 40,
    borderRadius: 10,
    backgroundColor: '#F1F3F4',
    paddingHorizontal: 12,
    fontSize: 15,
  },
  results: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 8,
    maxHeight: 260,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  resultItem: { paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E0E0E0' },
  resultName: { fontSize: 15, color: '#263238' },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#CFD8DC',
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  startText: { fontSize: 12, color: '#546E7A' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storeName: { fontSize: 18, fontWeight: '700', color: '#263238' },
  close: { fontSize: 22, color: '#78909C', paddingHorizontal: 8 },
  desc: { fontSize: 14, color: '#37474F', marginVertical: 4 },
  muted: { fontSize: 12, color: '#78909C' },
  primary: { backgroundColor: '#1A56DB', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  routeBox: { backgroundColor: '#E8F0FE', borderRadius: 10, padding: 10, marginTop: 4 },
  routeBoxRef: { backgroundColor: '#FFF8E1' },
  routeText: { fontSize: 15, fontWeight: '700', color: '#1A3E8C' },
  refText: { fontSize: 12, color: '#8D6E00', marginTop: 4 },
  error: { fontSize: 14, color: '#B71C1C', marginTop: 4 },
});
