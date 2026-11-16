import {
  boundsOf,
  geometryPoints,
  pointInRing,
  ringCentroid,
  type FacilityBundle,
  type MapFeature,
  type RouteResult,
  type Vec2,
} from '@facility-nav/core';
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

/**
 * 屋内マップの描画（SVG 方式）。
 *
 * Expo Go でも動作する描画方式。Phase 1B で MapLibre（ネイティブ地図）と比較し、
 * 採用方式を決める（設計書 G2）。画面側はこの部品の入出力だけを使うので、差し替えが可能。
 *
 * 座標：データはローカル座標（x=東, y=北, m）。SVG は y が下向きなので、表示時に上下を反転する。
 */

export interface IndoorMapProps {
  bundle: FacilityBundle;
  floorId: string;
  selectedStoreId: string | null;
  route: RouteResult | null;
  /** 経路の区間のうち、規制で通れない通路線（赤の破線で表示） */
  blockedEdgeIds: Set<string>;
  startPoint: Vec2 | null;
  onStorePress: (storeId: string) => void;
  onMapPress: (p: Vec2) => void;
}

const MARGIN_M = 3;
const TAP_SLOP_PX = 8;

export function IndoorMap(props: IndoorMapProps) {
  const { bundle, floorId } = props;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const features = useMemo(() => bundle.features.filter((f) => f.floorId === floorId), [bundle, floorId]);
  const bounds = useMemo(() => boundsOf(features.flatMap((f) => geometryPoints(f.geometry))), [features]);
  const H = bounds.maxY; // 上下反転用
  const sv = (p: Vec2) => ({ x: p.x, y: H - p.y });
  const toWorld = (svgX: number, svgY: number): Vec2 => ({ x: svgX, y: H - svgY });

  const fitView = (w: number, h: number) => {
    const bw = bounds.maxX - bounds.minX + MARGIN_M * 2;
    const bh = bounds.maxY - bounds.minY + MARGIN_M * 2;
    const scale = Math.min(w / bw, h / bh);
    const c = sv({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
    return { cx: c.x, cy: c.y, scale };
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    if (!viewRef.current && width > 0 && height > 0) setView(fitView(width, height));
  };

  // 画面上の位置（px）→ ローカル座標（m）
  const screenToWorld = (px: number, py: number): Vec2 | null => {
    const v = viewRef.current;
    const s = sizeRef.current;
    if (!v) return null;
    return toWorld(v.cx + (px - s.w / 2) / v.scale, v.cy + (py - s.h / 2) / v.scale);
  };

  const handleTap = (px: number, py: number) => {
    const p = screenToWorld(px, py);
    if (!p) return;
    const unit = features.find(
      (f) => f.kind === 'unit' && f.storeId && f.geometry.type === 'Polygon' && pointInRing(p, f.geometry.coordinates[0]!),
    );
    const store = unit && bundle.stores.find((s) => s.id === unit.storeId && s.isVisible);
    if (store) props.onStorePress(store.id);
    else props.onMapPress(p);
  };

  // ドラッグで移動、2本指でズーム、軽いタップで選択
  const gesture = useRef({ startView: view, startDist: 0, moved: false, x0: 0, y0: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          gesture.current = {
            startView: viewRef.current,
            startDist: 0,
            moved: false,
            x0: e.nativeEvent.locationX,
            y0: e.nativeEvent.locationY,
          };
        },
        onPanResponderMove: (e, g) => {
          const st = gesture.current;
          const sv0 = st.startView;
          if (!sv0) return;
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const [a, b] = [touches[0]!, touches[1]!];
            const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            if (st.startDist === 0) {
              st.startDist = d;
              st.startView = viewRef.current;
              return;
            }
            st.moved = true;
            const scale = clampScale((st.startView?.scale ?? sv0.scale) * (d / st.startDist));
            setView((v) => (v ? { ...v, scale } : v));
            return;
          }
          if (Math.abs(g.dx) + Math.abs(g.dy) > TAP_SLOP_PX) st.moved = true;
          if (st.moved && st.startDist === 0) {
            setView({ cx: sv0.cx - g.dx / sv0.scale, cy: sv0.cy - g.dy / sv0.scale, scale: sv0.scale });
          }
        },
        onPanResponderRelease: () => {
          const st = gesture.current;
          if (!st.moved) handleTap(st.x0, st.y0);
        },
      }),
    // handleTap は最新の features/bundle を参照するため依存に含める
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, bundle, props.onStorePress, props.onMapPress],
  );

  const zoom = (f: number) => setView((v) => (v ? { ...v, scale: clampScale(v.scale * f) } : v));

  const vb = view && size.w > 0 ? viewBox(view, size) : '0 0 1 1';
  const s = view?.scale ?? 10;
  const px = (n: number) => n / s; // 画面上の px をメートルに換算（線の太さ・文字サイズを一定に保つ）

  const catColor = new Map(bundle.categories.map((c) => [c.id, c.color]));
  const storeById = new Map(bundle.stores.map((st) => [st.id, st]));
  const nodes = new Map(bundle.nav.nodes.map((n) => [n.id, n]));

  const poly = (f: MapFeature) =>
    f.geometry.type === 'Polygon'
      ? f.geometry.coordinates[0]!.map(([x, y]) => `${x},${H - y}`).join(' ')
      : '';

  return (
    <View style={styles.container} onLayout={onLayout} testID="indoor-map">
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        {view && size.w > 0 && (
          <Svg width={size.w} height={size.h} viewBox={vb}>
            {/* 通路 */}
            {features
              .filter((f) => f.kind === 'corridor')
              .map((f) => (
                <Polygon key={f.id} points={poly(f)} fill="#EEF1F5" />
              ))}
            {/* 店舗区画 */}
            {features
              .filter((f) => f.kind === 'unit')
              .map((f) => {
                const st = f.storeId ? storeById.get(f.storeId) : undefined;
                const selected = st && st.id === props.selectedStoreId;
                const color = (st && catColor.get(st.categoryId)) ?? '#CCCCCC';
                return (
                  <Polygon
                    key={f.id}
                    points={poly(f)}
                    fill={color}
                    fillOpacity={selected ? 0.75 : 0.35}
                    stroke={selected ? '#1A56DB' : 'none'}
                    strokeWidth={px(3)}
                  />
                );
              })}
            {/* 設備（トイレ・階段・エレベーター） */}
            {features
              .filter((f) => f.kind === 'toilet' || f.kind === 'stairs' || f.kind === 'elevator' || f.kind === 'escalator')
              .map((f) => (
                <Polygon key={f.id} points={poly(f)} fill="#D9D9D9" stroke="#9E9E9E" strokeWidth={px(1)} />
              ))}
            {/* 壁 */}
            {features
              .filter((f) => f.kind === 'wall' && f.geometry.type === 'LineString')
              .map((f) =>
                f.geometry.type === 'LineString' ? (
                  <Polyline
                    key={f.id}
                    points={f.geometry.coordinates.map(([x, y]) => `${x},${H - y}`).join(' ')}
                    stroke="#37474F"
                    strokeWidth={px(3)}
                    fill="none"
                    strokeLinecap="round"
                  />
                ) : null,
              )}
            {/* 規制で通れない通路線 */}
            {bundle.nav.edges
              .filter((e) => props.blockedEdgeIds.has(e.id))
              .map((e) => {
                const a = nodes.get(e.from);
                const b = nodes.get(e.to);
                if (!a || !b || a.floorId !== floorId) return null;
                return (
                  <Line
                    key={`blk-${e.id}`}
                    x1={a.x}
                    y1={H - a.y}
                    x2={b.x}
                    y2={H - b.y}
                    stroke="#D32F2F"
                    strokeWidth={px(4)}
                    strokeDasharray={`${px(6)},${px(4)}`}
                  />
                );
              })}
            {/* 経路 */}
            {props.route && (
              <Polyline
                points={props.route.path
                  .filter((p) => p.floorId === floorId)
                  .map((p) => `${p.x},${H - p.y}`)
                  .join(' ')}
                stroke="#1A56DB"
                strokeWidth={px(6)}
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* 店舗名・設備名 */}
            {features
              .filter((f) => f.name && f.geometry.type === 'Polygon')
              .map((f) => {
                const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0]! : [];
                const c = sv(ringCentroid(ring));
                const label = SHORT_LABEL[f.kind] ?? f.name!;
                const w = boundsOf(ring.map(([x, y]) => ({ x, y })));
                // 区画の幅に収まる文字サイズ（最大は画面上 12px 相当）
                const size = Math.min(px(f.kind === 'unit' ? 12 : 10), ((w.maxX - w.minX) * 0.9) / label.length);
                return (
                  <SvgText key={`t-${f.id}`} x={c.x} y={c.y + size / 3} fontSize={size} fill="#263238" textAnchor="middle">
                    {label}
                  </SvgText>
                );
              })}
            {/* 出入口 */}
            {features
              .filter((f) => f.kind === 'entrance' && f.geometry.type === 'Point')
              .map((f) => {
                const p = f.geometry.type === 'Point' ? sv({ x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] }) : { x: 0, y: 0 };
                return (
                  <G key={`e-${f.id}`}>
                    <Circle cx={p.x} cy={p.y} r={px(7)} fill="#2E7D32" />
                    <SvgText x={p.x} y={p.y - px(10)} fontSize={px(11)} fill="#2E7D32" textAnchor="middle">
                      {f.name}
                    </SvgText>
                  </G>
                );
              })}
            {/* 出発地 */}
            {props.startPoint && (
              <G>
                <Circle cx={props.startPoint.x} cy={H - props.startPoint.y} r={px(10)} fill="#1A56DB" fillOpacity={0.2} />
                <Circle
                  cx={props.startPoint.x}
                  cy={H - props.startPoint.y}
                  r={px(5)}
                  fill="#1A56DB"
                  stroke="#FFFFFF"
                  strokeWidth={px(2)}
                />
              </G>
            )}
          </Svg>
        )}
      </View>
      <View style={styles.zoomBox} pointerEvents="box-none">
        <Pressable accessibilityLabel="拡大" style={styles.zoomBtn} onPress={() => zoom(1.4)}>
          <Text style={styles.zoomText}>＋</Text>
        </Pressable>
        <Pressable accessibilityLabel="縮小" style={styles.zoomBtn} onPress={() => zoom(1 / 1.4)}>
          <Text style={styles.zoomText}>－</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="全体表示"
          style={styles.zoomBtn}
          onPress={() => size.w > 0 && setView(fitView(size.w, size.h))}
        >
          <Text style={styles.zoomTextSmall}>全体</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** 狭い設備区画に表示する短い名前 */
const SHORT_LABEL: Partial<Record<MapFeature['kind'], string>> = {
  toilet: 'WC',
  elevator: 'EV',
  stairs: '階段',
  escalator: 'ES',
};

function clampScale(s: number) {
  return Math.max(2, Math.min(200, s));
}

function viewBox(v: { cx: number; cy: number; scale: number }, size: { w: number; h: number }) {
  const w = size.w / v.scale;
  const h = size.h / v.scale;
  return `${v.cx - w / 2} ${v.cy - h / 2} ${w} ${h}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA', overflow: 'hidden' },
  zoomBox: { position: 'absolute', right: 12, top: 12, gap: 8 },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  zoomText: { fontSize: 22, color: '#263238' },
  zoomTextSmall: { fontSize: 12, color: '#263238' },
});
