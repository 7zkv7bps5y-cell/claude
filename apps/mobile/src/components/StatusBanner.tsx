import { StyleSheet, Text, View } from 'react-native';
import { hasServer } from '../config';
import { useAppData } from '../data/AppDataContext';
import { formatDateTime } from '../lib/format';

/** 地図データの時点・通行規制情報の鮮度・オフライン状態を表示する */
export function StatusBanner() {
  const d = useAppData();
  if (!d.bundle || !d.freshness) return null;
  const f = d.freshness;
  const colors = {
    fresh: { bg: '#E8F5E9', fg: '#1B5E20', label: '規制情報：最新' },
    stale: { bg: '#FFF8E1', fg: '#8D6E00', label: '規制情報：注意' },
    restricted: { bg: '#FFEBEE', fg: '#B71C1C', label: '規制情報：制限' },
  }[f.level];
  const connection = !hasServer
    ? '　・　サーバー未設定（内蔵データで動作）'
    : d.simulateOffline || (d.lastRefresh !== null && !d.lastRefresh.online)
      ? '　・　オフライン'
      : '';
  const dataAt =
    d.bundleSource === 'embedded'
      ? 'アプリ内蔵の【サンプル】データ'
      : `地図データ：${formatDateTime(d.bundle.version.publishedAt)} 公開版（第${d.bundle.version.versionNo}版）`;

  return (
    <View style={[styles.box, { backgroundColor: colors.bg }]} testID="status-banner">
      <Text style={[styles.title, { color: colors.fg }]}>
        {colors.label}
        {connection}
      </Text>
      {f.level !== 'fresh' && <Text style={[styles.msg, { color: colors.fg }]}>{f.message}</Text>}
      <Text style={styles.sub}>
        {dataAt}
        {d.rules ? `　／　規制情報の最終取得：${formatDateTime(d.rules.fetchedAt)}` : '　／　規制情報：未取得'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingHorizontal: 12, paddingVertical: 6 },
  title: { fontSize: 13, fontWeight: '700' },
  msg: { fontSize: 12, marginTop: 2 },
  sub: { fontSize: 11, color: '#546E7A', marginTop: 2 },
});
