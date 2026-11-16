// 【サンプル】施設データから Supabase 用の seed.sql を生成する。
// 実行: npm run gen:seed（リポジトリのルートで）
// 出力: supabase/seed.sql
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(join(here, '..', 'src', 'sample-facility.json'), 'utf8'));
const f = bundle.facility;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// JSON をドル引用符で埋め込む（中身に区切り文字が含まれないことを確認）
const DELIM = '$json$';
const json = JSON.stringify(bundle);
if (json.includes(DELIM)) throw new Error('unexpected delimiter in JSON');

const floors = bundle.floors
  .map(
    (fl, i) =>
      `insert into public.floors (id, facility_id, level, name, sort_order) values (${q(fl.id)}, ${q(f.id)}, ${fl.level}, ${q(fl.name)}, ${i}) on conflict (id) do nothing;`,
  )
  .join('\n');

const sql = [
  '-- =====================================================================',
  '-- 【サンプル】開発・テスト用データ（自動生成ファイル。直接編集しないでください）',
  '-- 生成元: packages/sample-data/src/sample-facility.json',
  '-- 生成方法: npm run gen:seed',
  '-- 実在の施設ではありません（is_sample = true）。',
  '-- =====================================================================',
  '',
  'insert into public.facilities (',
  '  id, name, slug, status, is_sample, origin_lat, origin_lng, rotation_deg,',
  '  rule_fresh_minutes, rule_restrict_minutes, rule_high_severity_restrict_minutes, rule_restrict_mode, event_mode',
  ') values (',
  `  ${q(f.id)}, ${q(f.name)}, 'sample-test-mall', 'published', true, ${f.origin.lat}, ${f.origin.lng}, ${f.rotationDeg},`,
  `  ${f.freshness.freshMinutes}, ${f.freshness.restrictMinutes}, ${f.freshness.highSeverityRestrictMinutes}, ${q(f.freshness.restrictMode)}, ${f.freshness.eventMode}`,
  ') on conflict (id) do nothing;',
  '',
  floors,
  '',
  'insert into public.map_versions (facility_id, version_no, status, snapshot, note, published_at)',
  `values (${q(f.id)}, ${bundle.version.versionNo}, 'published', ${DELIM}${json}${DELIM}::jsonb, '【サンプル】初期データ', ${q(bundle.version.publishedAt)})`,
  'on conflict (facility_id, version_no) do nothing;',
  '',
].join('\n');

writeFileSync(join(here, '..', '..', '..', 'supabase', 'seed.sql'), sql);
console.log('supabase/seed.sql を出力しました');
