import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { hasServer } from '../config';
import { useAppData } from '../data/AppDataContext';
import { formatDateTime } from '../lib/format';
import { colors, radius, shadow } from '../theme';

/**
 * 通行規制情報の鮮度・通信状態の表示（小さな表示。タップで詳細）。
 * 「注意」「制限」のときは説明文を常に表示する。
 */
export function StatusBanner() {
  const d = useAppData();
  const [open, setOpen] = useState(false);
  if (!d.bundle || !d.freshness) return null;
  const f = d.freshness;
  const tone = {
    fresh: { bg: colors.okBg, fg: colors.ok, icon: 'checkmark-circle' as const, label: '規制情報：最新' },
    stale: { bg: colors.warnBg, fg: colors.warn, icon: 'time' as const, label: '規制情報：注意' },
    restricted: { bg: colors.dangerBg, fg: colors.danger, icon: 'warning' as const, label: '規制情報：制限' },
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
    <Pressable onPress={() => setOpen((v) => !v)} style={[styles.box, { backgroundColor: tone.bg }]} testID="status-banner">
      <View style={styles.row}>
        <Ionicons name={tone.icon} size={14} color={tone.fg} />
        <Text style={[styles.title, { color: tone.fg }]} numberOfLines={1}>
          {tone.label}
          {connection}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={tone.fg} />
      </View>
      {f.level !== 'fresh' && <Text style={[styles.msg, { color: tone.fg }]}>{f.message}</Text>}
      {open && (
        <Text style={styles.sub}>
          {dataAt}
          {d.rules ? `\n規制情報の最終取得：${formatDateTime(d.rules.fetchedAt)}` : '\n規制情報：未取得'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.m, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', maxWidth: '100%', ...shadow, shadowOpacity: 0.08 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 12, fontWeight: '700', flexShrink: 1 },
  msg: { fontSize: 12, marginTop: 4 },
  sub: { fontSize: 11, color: colors.textSub, marginTop: 4 },
});
