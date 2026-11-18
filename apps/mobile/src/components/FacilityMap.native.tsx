import { boundsOf, geometryPoints, localToLngLat, lngLatToLocal, pointInRing, type Vec2 } from '@facility-nav/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type Region } from 'react-native-maps';
import { AMENITY_ICON, FILL_ORDER, fillColor, floorLabels } from '../lib/mapStyle';
import { colors } from '../theme';
import type { FacilityMapHandle, FacilityMapProps, LatLng } from './FacilityMap.types';

/**
 * 屋外・屋内を1枚で扱う地図（iPhone：Apple マップ／Android：Google マップ）。
 * 施設に近づく（拡大する）と、施設の屋内図（店舗区画・通路・壁・設備）を重ねて表示する。
 * 屋内図は端末に保存したデータから描くため、通信がなくても表示される（背景の屋外地図は通信が必要）。
 */

const INDOOR_DELTA = 0.006; // これより拡大すると屋内図を表示
const LABEL_DELTA = 0.0016; // これより拡大すると店舗名を表示

export const FacilityMap = forwardRef<FacilityMapHandle, FacilityMapProps>(function FacilityMap(props, ref) {
  const { bundle, floorId } = props;
  const mapRef = useRef<MapView>(null);
  const lastPolygonPress = useRef(0);
  const fac = bundle.facility;
  const ll = (p: Vec2): LatLng => {
    const [longitude, latitude] = localToLngLat(p, fac);
    return { latitude, longitude };
  };

  const building = useMemo(() => {
    const pts = bundle.features.filter((f) => f.kind === 'building').flatMap((f) => geometryPoints(f.geometry));
    return boundsOf(pts.length ? pts : bundle.nav.nodes);
  }, [bundle]);
  const center = ll({ x: (building.minX + building.maxX) / 2, y: (building.minY + building.maxY) / 2 });
  const facilityRegion: Region = { ...center, latitudeDelta: 0.0022, longitudeDelta: 0.0022 };

  const [region, setRegion] = useState<Region>(facilityRegion);
  const indoorVisible = region.latitudeDelta < INDOOR_DELTA;
  const labelsVisible = region.latitudeDelta < LABEL_DELTA;
  const lastIndoor = useRef(indoorVisible);

  useImperativeHandle(ref, () => ({
    focusFacility: () => mapRef.current?.animateToRegion(facilityRegion, 500),
    focusUser: () => {
      const u = props.userLocation;
      if (u) mapRef.current?.animateToRegion({ latitude: u.latitude, longitude: u.longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 }, 500);
    },
    focusStore: (storeId) => {
      const s = bundle.stores.find((x) => x.id === storeId);
      const f = s && bundle.features.find((x) => x.id === s.featureId);
      if (!f) return;
      const b = boundsOf(geometryPoints(f.geometry));
      mapRef.current?.animateToRegion({ ...ll({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }), latitudeDelta: 0.0012, longitudeDelta: 0.0012 }, 500);
    },
    focusLatLng: (p, zoomedIn = true) =>
      mapRef.current?.animateToRegion({ ...p, latitudeDelta: zoomedIn ? 0.004 : 0.05, longitudeDelta: zoomedIn ? 0.004 : 0.05 }, 500),
    focusLocalPoints: (points) => {
      if (points.length === 0) return;
      mapRef.current?.fitToCoordinates(points.map(ll), { edgePadding: { top: 180, right: 60, bottom: 320, left: 60 }, animated: true });
    },
  }));

  const floorFeatures = useMemo(
    () =>
      bundle.features
        .filter((f) => f.floorId === floorId || f.kind === 'parking')
        .sort((a, b) => FILL_ORDER.indexOf(a.kind) - FILL_ORDER.indexOf(b.kind)),
    [bundle, floorId],
  );
  const labels = useMemo(() => floorLabels(bundle, floorId), [bundle, floorId]);
  const storeById = useMemo(() => new Map(bundle.stores.map((s) => [s.id, s])), [bundle]);
  const catColor = useMemo(() => new Map(bundle.categories.map((c) => [c.id, c.color])), [bundle]);
  const nodes = useMemo(() => new Map(bundle.nav.nodes.map((n) => [n.id, n])), [bundle]);
  const buildingRing = bundle.features.find((f) => f.kind === 'building' && f.floorId === floorId);

  const onMapPress = (coord: LatLng) => {
    if (Date.now() - lastPolygonPress.current < 400) return; // 店舗区画のタップと重複させない
    if (!indoorVisible || !buildingRing || buildingRing.geometry.type !== 'Polygon') return;
    const p = lngLatToLocal([coord.longitude, coord.latitude], fac);
    if (pointInRing(p, buildingRing.geometry.coordinates[0]!)) props.onIndoorPress(p);
  };

  const routeOnFloor = props.route?.path.filter((p) => p.floorId === floorId) ?? [];
  const dest = props.route?.path[props.route.path.length - 1];

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={facilityRegion}
      onRegionChangeComplete={(r) => {
        setRegion(r);
        const v = r.latitudeDelta < INDOOR_DELTA;
        if (v !== lastIndoor.current) {
          lastIndoor.current = v;
          props.onIndoorVisibleChange?.(v);
        }
      }}
      onPress={(e) => onMapPress(e.nativeEvent.coordinate)}
      showsUserLocation={!!props.userLocation}
      showsMyLocationButton={false}
      showsCompass
      showsBuildings={false}
      showsIndoors={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      testID="facility-map"
    >
      {!indoorVisible && (
        <Marker coordinate={center} title={fac.name} onPress={() => mapRef.current?.animateToRegion(facilityRegion, 500)}>
          <View style={styles.facilityPin}>
            <Ionicons name="storefront" size={16} color="#fff" />
            <Text style={styles.facilityPinText} numberOfLines={1}>
              {fac.name}
            </Text>
          </View>
        </Marker>
      )}

      {indoorVisible &&
        floorFeatures.map((f) => {
          if (f.geometry.type !== 'Polygon') return null;
          const coords = f.geometry.coordinates[0]!.map(([x, y]) => ll({ x, y }));
          if (f.kind === 'unit') {
            const s = f.storeId ? storeById.get(f.storeId) : undefined;
            if (!s || !s.isVisible) return null;
            const selected = s.id === props.selectedStoreId;
            const dimmed = props.highlightStoreIds && !props.highlightStoreIds.has(s.id);
            const color = catColor.get(s.categoryId) ?? '#999999';
            return (
              <Polygon
                key={f.id}
                coordinates={coords}
                fillColor={hexA(color, selected ? 0.75 : dimmed ? 0.08 : 0.32)}
                strokeColor={selected ? colors.primary : hexA(color, 0.6)}
                strokeWidth={selected ? 3 : 1}
                tappable
                zIndex={3}
                onPress={() => {
                  lastPolygonPress.current = Date.now();
                  props.onStorePress(s.id);
                }}
              />
            );
          }
          return (
            <Polygon
              key={f.id}
              coordinates={coords}
              fillColor={fillColor(f.kind)}
              strokeColor={f.kind === 'building' ? colors.buildingStroke : f.kind === 'atrium' ? '#8FA7C4' : 'transparent'}
              strokeWidth={f.kind === 'building' || f.kind === 'atrium' ? 1.5 : 0}
              lineDashPattern={f.kind === 'atrium' || f.kind === 'parking' ? [4, 3] : undefined}
              zIndex={f.kind === 'building' || f.kind === 'parking' ? 1 : 2}
            />
          );
        })}

      {indoorVisible &&
        floorFeatures
          .filter((f) => f.kind === 'wall' && f.geometry.type === 'LineString')
          .map((f) =>
            f.geometry.type === 'LineString' ? (
              <Polyline key={f.id} coordinates={f.geometry.coordinates.map(([x, y]) => ll({ x, y }))} strokeColor={colors.wall} strokeWidth={1.5} zIndex={4} />
            ) : null,
          )}

      {indoorVisible &&
        bundle.nav.edges
          .filter((e) => props.blockedEdgeIds.has(e.id))
          .map((e) => {
            const a = nodes.get(e.from);
            const b = nodes.get(e.to);
            if (!a || !b || a.floorId !== floorId || b.floorId !== floorId) return null;
            return <Polyline key={`blk-${e.id}`} coordinates={[ll(a), ll(b)]} strokeColor={colors.danger} strokeWidth={4} lineDashPattern={[6, 4]} zIndex={5} />;
          })}

      {indoorVisible && routeOnFloor.length > 1 && (
        <Polyline coordinates={routeOnFloor.map(ll)} strokeColor={colors.route} strokeWidth={6} lineJoin="round" lineCap="round" zIndex={6} />
      )}

      {indoorVisible &&
        labels.map((l) => {
          if (l.kind === 'unit') {
            if (!labelsVisible && l.storeId !== props.selectedStoreId) return null;
            if (props.highlightStoreIds && l.storeId && !props.highlightStoreIds.has(l.storeId)) return null;
            return (
              <Marker key={l.id} coordinate={ll(l.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} onPress={() => l.storeId && props.onStorePress(l.storeId)}>
                <Text style={styles.storeLabel} numberOfLines={2}>
                  {l.text}
                </Text>
              </Marker>
            );
          }
          const icon = AMENITY_ICON[l.kind];
          if (!icon) {
            if (!labelsVisible) return null;
            return (
              <Marker key={l.id} coordinate={ll(l.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <Text style={styles.areaLabel}>{l.text}</Text>
              </Marker>
            );
          }
          return (
            <Marker key={l.id} coordinate={ll(l.at)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={l.text}>
              <View style={[styles.amenity, l.kind === 'entrance' && styles.entrance]}>
                <Ionicons name={icon as never} size={13} color="#fff" />
              </View>
            </Marker>
          );
        })}

      {indoorVisible && props.start && props.start.floorId === floorId && (
        <Marker coordinate={ll(props.start.point)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={8}>
          <View style={styles.startHalo}>
            <View style={styles.startDot} />
          </View>
        </Marker>
      )}
      {indoorVisible && dest && dest.floorId === floorId && <Marker coordinate={ll(dest)} pinColor={colors.danger} zIndex={9} />}

      {props.placePin && <Marker coordinate={props.placePin} title={props.placePin.title} pinColor={colors.primary} />}
    </MapView>
  );
});

/** #RRGGBB に透明度を付ける */
function hexA(hex: string, a: number): string {
  const v = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${v}`;
}

const styles = StyleSheet.create({
  facilityPin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#fff',
    maxWidth: 220,
  },
  facilityPinText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  storeLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    maxWidth: 90,
    textShadowColor: '#fff',
    textShadowRadius: 3,
  },
  areaLabel: { fontSize: 10, color: colors.textSub, textShadowColor: '#fff', textShadowRadius: 3 },
  amenity: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#5F6B7A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  entrance: { backgroundColor: colors.ok },
  startHalo: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(26,115,232,0.2)', alignItems: 'center', justifyContent: 'center' },
  startDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff' },
});
