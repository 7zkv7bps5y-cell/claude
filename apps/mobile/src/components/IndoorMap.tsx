import { boundsOf, geometryPoints, pointInRing, type MapFeature, type Vec2 } from '@facility-nav/core';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';
import { FILL_ORDER, fillColor, floorLabels } from '../lib/mapStyle';
import { colors } from '../theme';
import type { FacilityMapHandle, FacilityMapProps } from './FacilityMap.types';

/**
 * 屋内図の SVG 描画（ブラウザ版での確認用）。
 * iPhone / Android では FacilityMap.native.tsx（Apple マップ／Google マップ上に重ねる方式）を使う。
 * 座標はローカル座標（x=東, y=北, m）。SVG は y が下向きなので上下を反転して描く。
 */

const MARGIN_M = 6;
const TAP_SLOP_PX = 8;

export const IndoorMap = forwardRef<FacilityMapHandle, FacilityMapProps>(function IndoorMap(props, ref) {
  const { bundle, floorId } = props;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ cx: number; cy: number; scale: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const features = useMemo(
    () =>
      bundle.features
        .filter((f) => f.floorId === floorId && f.kind !== 'parking')
        .sort((a, b) => FILL_ORDER.indexOf(a.kind) - FILL_ORDER.indexOf(b.kind)),
    [bundle, floorId],
  );
  const bounds = useMemo(
    () => boundsOf(bundle.features.filter((f) => f.kind === 'building').flatMap((f) => geometryPoints(f.geometry))),
    [bundle],
  );
  const labels = useMemo(() => floorLabels(bundle, floorId), [bundle, floorId]);
  const H = bounds.maxY;
  const toWorld = (sx: number, sy: number): Vec2 => ({ x: sx, y: H - sy });

  const fit = (w: number, h: number, b = bounds) => {
    const bw = b.maxX - b.minX + MARGIN_M * 2;
    const bh = b.maxY - b.minY + MARGIN_M * 2;
    return { cx: (b.minX + b.maxX) / 2, cy: H - (b.minY + b.maxY) / 2, scale: Math.min(w / bw, h / bh) };
  };

  useImperativeHandle(ref, () => ({
    focusFacility: () => sizeRef.current.w > 0 && setView(fit(sizeRef.current.w, sizeRef.current.h)),
    focusUser: () => {},
    focusStore: () => {},
    focusLatLng: () => {},
    focusLocalPoints: (pts) => {
      if (pts.length === 0 || sizeRef.current.w === 0) return;
      const b = boundsOf(pts);
      const pad = { minX: b.minX - 10, minY: b.minY - 10, maxX: b.maxX + 10, maxY: b.maxY + 10 };
      setView(fit(sizeRef.current.w, sizeRef.current.h, pad));
    },
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
    if (!viewRef.current && width > 0) setView(fit(width, height));
  };

  const screenToWorld = (px: number, py: number): Vec2 | null => {
    const v = viewRef.current;
    const s = sizeRef.current;
    if (!v) return null;
    return toWorld(v.cx + (px - s.w / 2) / v.scale, v.cy + (py - s.h / 2) / v.scale);
  };

  const handleTap = (px: number, py: number) => {
    const p = screenToWorld(px, py);
    if (!p) return;
    const unit = features.find((f) => f.kind === 'unit' && f.storeId && f.geometry.type === 'Polygon' && pointInRing(p, f.geometry.coordinates[0]!));
    const store = unit && bundle.stores.find((s) => s.id === unit.storeId && s.isVisible);
    if (store) return props.onStorePress(store.id);
    const b = features.find((f) => f.kind === 'building');
    if (b && b.geometry.type === 'Polygon' && pointInRing(p, b.geometry.coordinates[0]!)) props.onIndoorPress(p);
  };

  const gesture = useRef({ startView: view, startDist: 0, moved: false, x0: 0, y0: 0 });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          gesture.current = { startView: viewRef.current, startDist: 0, moved: false, x0: e.nativeEvent.locationX, y0: e.nativeEvent.locationY };
        },
        onPanResponderMove: (e, g) => {
          const st = gesture.current;
          const v0 = st.startView;
          if (!v0) return;
          const t = e.nativeEvent.touches;
          if (t.length >= 2) {
            const d = Math.hypot(t[0]!.pageX - t[1]!.pageX, t[0]!.pageY - t[1]!.pageY);
            if (st.startDist === 0) {
              st.startDist = d;
              st.startView = viewRef.current;
              return;
            }
            st.moved = true;
            const scale = Math.max(1, Math.min(60, (st.startView?.scale ?? v0.scale) * (d / st.startDist)));
            setView((v) => (v ? { ...v, scale } : v));
            return;
          }
          if (Math.abs(g.dx) + Math.abs(g.dy) > TAP_SLOP_PX) st.moved = true;
          if (st.moved && st.startDist === 0) setView({ cx: v0.cx - g.dx / v0.scale, cy: v0.cy - g.dy / v0.scale, scale: v0.scale });
        },
        onPanResponderRelease: () => {
          if (!gesture.current.moved) handleTap(gesture.current.x0, gesture.current.y0);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [features, bundle, props.onStorePress, props.onIndoorPress],
  );

  const s = view?.scale ?? 4;
  const px = (n: number) => n / s;
  const vb = view && size.w > 0 ? `${view.cx - size.w / s / 2} ${view.cy - size.h / s / 2} ${size.w / s} ${size.h / s}` : '0 0 1 1';
  const catColor = new Map(bundle.categories.map((c) => [c.id, c.color]));
  const storeById = new Map(bundle.stores.map((st) => [st.id, st]));
  const nodes = new Map(bundle.nav.nodes.map((n) => [n.id, n]));
  const pts = (f: MapFeature) => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0]!.map(([x, y]) => `${x},${H - y}`).join(' ') : '');
  const routePts = props.route?.path.filter((p) => p.floorId === floorId) ?? [];
  const dest = props.route?.path[props.route.path.length - 1];

  return (
    <View style={styles.container} onLayout={onLayout} testID="indoor-map">
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        {view && size.w > 0 && (
          <Svg width={size.w} height={size.h} viewBox={vb}>
            {features.map((f) => {
              if (f.geometry.type !== 'Polygon') return null;
              if (f.kind === 'unit') {
                const st = f.storeId ? storeById.get(f.storeId) : undefined;
                if (!st || !st.isVisible) return null;
                const sel = st.id === props.selectedStoreId;
                const dim = props.highlightStoreIds && !props.highlightStoreIds.has(st.id);
                return (
                  <Polygon
                    key={f.id}
                    points={pts(f)}
                    fill={catColor.get(st.categoryId) ?? '#999'}
                    fillOpacity={sel ? 0.75 : dim ? 0.08 : 0.32}
                    stroke={sel ? colors.primary : 'none'}
                    strokeWidth={px(3)}
                  />
                );
              }
              return (
                <Polygon
                  key={f.id}
                  points={pts(f)}
                  fill={fillColor(f.kind)}
                  stroke={f.kind === 'building' ? colors.buildingStroke : f.kind === 'atrium' ? '#8FA7C4' : 'none'}
                  strokeWidth={px(1.5)}
                  strokeDasharray={f.kind === 'atrium' ? `${px(4)},${px(3)}` : undefined}
                />
              );
            })}
            {features
              .filter((f) => f.kind === 'wall')
              .map((f) =>
                f.geometry.type === 'LineString' ? (
                  <Polyline key={f.id} points={f.geometry.coordinates.map(([x, y]) => `${x},${H - y}`).join(' ')} stroke={colors.wall} strokeWidth={px(1.5)} fill="none" />
                ) : null,
              )}
            {bundle.nav.edges
              .filter((e) => props.blockedEdgeIds.has(e.id))
              .map((e) => {
                const a = nodes.get(e.from);
                const b = nodes.get(e.to);
                if (!a || !b || a.floorId !== floorId || b.floorId !== floorId) return null;
                return (
                  <Line key={`blk-${e.id}`} x1={a.x} y1={H - a.y} x2={b.x} y2={H - b.y} stroke={colors.danger} strokeWidth={px(4)} strokeDasharray={`${px(6)},${px(4)}`} />
                );
              })}
            {routePts.length > 1 && (
              <Polyline points={routePts.map((p) => `${p.x},${H - p.y}`).join(' ')} stroke={colors.route} strokeWidth={px(6)} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            )}
            {labels.map((l) => {
              if (l.kind === 'unit' && props.highlightStoreIds && l.storeId && !props.highlightStoreIds.has(l.storeId)) return null;
              const fs = px(l.kind === 'unit' ? 10 : 9);
              return (
                <SvgText key={l.id} x={l.at.x} y={H - l.at.y + fs / 3} fontSize={fs} fill={l.kind === 'entrance' ? colors.ok : colors.text} textAnchor="middle">
                  {l.text}
                </SvgText>
              );
            })}
            {props.start && props.start.floorId === floorId && (
              <G>
                <Circle cx={props.start.point.x} cy={H - props.start.point.y} r={px(11)} fill={colors.primary} fillOpacity={0.2} />
                <Circle cx={props.start.point.x} cy={H - props.start.point.y} r={px(6)} fill={colors.primary} stroke="#fff" strokeWidth={px(2)} />
              </G>
            )}
            {dest && dest.floorId === floorId && <Circle cx={dest.x} cy={H - dest.y} r={px(7)} fill={colors.danger} stroke="#fff" strokeWidth={px(2)} />}
          </Svg>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#EEF0F3', overflow: 'hidden' },
});
