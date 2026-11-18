import { randomUUID } from 'expo-crypto';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { hasServer } from '../config';
import { useAppData } from '../data/AppDataContext';
import { currentPositionOnce } from '../data/useLocation';
import { notify } from '../lib/dialog';
import { formatDateTime } from '../lib/format';

/**
 * Phase 1A の検証画面。依頼者が iPhone で動作確認するための画面です。
 * 本番の同意画面・設定画面は Phase 6 で作成します（ここにあるのは検証用の仮スイッチです）。
 */
export default function DebugScreen() {
  const d = useAppData();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const f = d.freshness;
  return (
    <ScrollView contentContainerStyle={styles.page} testID="debug-screen">
      <Section title="施設データ（オフライン保存）">
        <Row k="施設" v={d.bundle?.facility.name ?? '—'} />
        <Row k="版" v={d.bundle ? `第${d.bundle.version.versionNo}版（${formatDateTime(d.bundle.version.publishedAt)} 公開）` : '—'} />
        <Row
          k="読込元"
          v={d.bundleSource === 'cache' ? `端末に保存したデータ（${formatDateTime(d.bundleSavedAt)} 保存）` : 'アプリ内蔵の【サンプル】データ'}
        />
        <Row k="サーバー接続設定" v={hasServer ? 'あり（Supabase）' : 'なし（内蔵データのみで動作）'} />
        <Row
          k="前回の更新確認"
          v={
            d.lastRefresh
              ? `${d.lastRefresh.online ? '通信成功' : '通信なし'}／地図：${bundleLabel(d.lastRefresh.bundle)}／規制：${rulesLabel(d.lastRefresh.rules)}`
              : '—'
          }
        />
        {d.lastRefresh?.errors.map((e) => (
          <Text key={e} style={styles.err}>
            {e}
          </Text>
        ))}
        <Button label={d.refreshing ? '確認中…' : '今すぐ更新を確認'} onPress={() => run(d.refresh)} disabled={busy} />
        <Button
          label="直前の版に戻す"
          onPress={() => run(async () => notify('直前の版に戻す', (await d.rollbackBundle()) ? '戻しました' : '戻せる版がありません'))}
          disabled={busy}
        />
      </Section>

      <Section title="【サンプル】施設の配置場所">
        <Text style={styles.note}>
          施設外→施設内の切り替えを試すため、架空の施設を現在地の近くに移動できます（サンプルデータのみ。あなたの現在地が施設の南側の駐車場にくる位置に置きます）。
        </Text>
        <Row k="配置" v={d.sampleOrigin ? `現在地付近（${d.sampleOrigin.lat.toFixed(4)}, ${d.sampleOrigin.lng.toFixed(4)}）` : '初期位置'} />
        <Button
          label="サンプル施設を現在地へ移動"
          disabled={busy}
          onPress={() =>
            run(async () => {
              const p = await currentPositionOnce();
              if (!p) return notify('現在地を取得できません', '地図画面で「現在地を使いますか？」の「許可する」を押してから、もう一度お試しください。（ブラウザ版では使えません）');
              // 現在地がローカル座標 (80, -30)＝南口の前の駐車場 になるよう原点を決める
              const R = 6378137;
              const DEG = Math.PI / 180;
              const lat = p.latitude - -30 / R / DEG;
              const lng = p.longitude - 80 / (R * Math.cos(lat * DEG)) / DEG;
              await d.setSampleOrigin({ lat, lng });
              notify('移動しました', '地図画面に戻ると、施設が現在地のすぐ北側に表示されます。');
            })
          }
        />
        <Button label="初期位置に戻す" disabled={busy || !d.sampleOrigin} onPress={() => run(() => d.setSampleOrigin(null))} />
      </Section>

      <Section title="通行規制情報と鮮度">
        <Row k="最終取得" v={d.rules ? formatDateTime(d.rules.fetchedAt) : '未取得'} />
        <Row k="保存件数／現在有効" v={`${d.rules?.rules.length ?? 0}件／${d.activeRules.length}件`} />
        <Row k="判定" v={f ? `${levelLabel(f.level)}（経路案内：${routingLabel(f.routing)}）` : '—'} />
        {f && <Text style={styles.note}>{f.message}</Text>}
        <Text style={styles.label}>検証用：時刻を進める（鮮度判定のみに影響）</Text>
        <View style={styles.btnRow}>
          {[0, 30, 120, 420].map((m) => (
            <Pressable
              key={m}
              style={[styles.chip, d.clockOffsetMinutes === m && styles.chipOn]}
              onPress={() => d.setClockOffsetMinutes(m)}
            >
              <Text style={[styles.chipText, d.clockOffsetMinutes === m && styles.chipTextOn]}>
                {m === 0 ? '現在' : `+${m >= 60 ? `${m / 60}時間` : `${m}分`}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="通信">
        <ToggleRow
          label="オフラインを模擬する（通信しない）"
          value={d.simulateOffline}
          onChange={(v) => d.setSimulateOffline(v)}
        />
        <Text style={styles.note}>
          iPhone では、機内モードにしても確認できます（その場合はこのスイッチは不要です）。
        </Text>
      </Section>

      <Section title="行動データ（送信待ちキュー）">
        <ToggleRow
          label="分析データの送信に同意する（検証用の仮スイッチ）"
          value={d.analyticsConsent}
          onChange={(v) => d.setAnalyticsConsent(v)}
        />
        <Text style={styles.note}>
          初期値は「同意しない」です。同意しなくても地図・検索・経路案内はすべて使えます。同意を取り消すと、未送信のデータは端末から削除されます。
        </Text>
        <Row k="送信待ち" v={`${d.outboxCount}件`} />
        <Row k="匿名ID（日替わり）" v={d.anonSessionId ? `${d.anonSessionId.slice(0, 8)}…` : '—'} />
        <Row
          k="前回の送信"
          v={
            d.lastFlush
              ? `${flushLabel(d.lastFlush.status)}（送信${d.lastFlush.sent}件・拒否${d.lastFlush.rejected}件・残り${d.lastFlush.remaining}件）`
              : hasServer
                ? '—'
                : 'サーバー未設定のため送信しません'
          }
        />
        {d.lastFlush?.error && <Text style={styles.err}>{d.lastFlush.error}</Text>}
        <Button
          label="テスト用イベントを10件追加"
          disabled={busy || !d.analyticsConsent}
          onPress={() =>
            run(async () => {
              for (let i = 0; i < 10; i++) d.track('map_view', { payload: { test: true, n: i, batch: randomUUID().slice(0, 8) } });
            })
          }
        />
        <Button
          label="今すぐ送信"
          disabled={busy}
          onPress={() =>
            run(async () => {
              const r = await d.flushOutbox();
              if (!r) notify('送信しませんでした', d.simulateOffline ? 'オフラインを模擬中です' : 'サーバーが設定されていません');
            })
          }
        />
      </Section>
    </ScrollView>
  );
}

const bundleLabel = (s: string) =>
  ({ updated: '新しい版を保存', up_to_date: '最新', not_published: '未公開', invalid: '形式不正（保存せず）', error: '取得失敗', skipped: '確認せず' })[s] ?? s;
const rulesLabel = (s: string) => ({ updated: '取得', error: '取得失敗', skipped: '確認せず' })[s] ?? s;
const levelLabel = (s: string) => ({ fresh: '正常', stale: '注意', restricted: '制限' })[s] ?? s;
const routingLabel = (s: string) => ({ allow: '通常', confirm: '確認後に参考案内', block: '停止' })[s] ?? s;
const flushLabel = (s: string) =>
  ({ sent: '送信成功', nothing_to_send: '送信データなし', no_consent: '同意なし', waiting_backoff: '再送待ち', failed: '送信失敗' })[s] ?? s;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable style={[styles.btn, disabled && styles.btnOff]} onPress={onPress} disabled={disabled}>
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16, backgroundColor: '#F5F7F9' },
  section: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#263238' },
  row: { flexDirection: 'row', gap: 8 },
  k: { width: 120, fontSize: 13, color: '#78909C' },
  v: { flex: 1, fontSize: 13, color: '#263238' },
  note: { fontSize: 12, color: '#546E7A' },
  err: { fontSize: 12, color: '#B71C1C' },
  label: { fontSize: 12, color: '#37474F', marginTop: 4 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#ECEFF1' },
  chipOn: { backgroundColor: '#1A56DB' },
  chipText: { fontSize: 13, color: '#37474F' },
  chipTextOn: { color: '#FFFFFF' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  toggleLabel: { flex: 1, fontSize: 14, color: '#263238' },
  btn: { backgroundColor: '#1A56DB', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnOff: { backgroundColor: '#B0BEC5' },
  btnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
