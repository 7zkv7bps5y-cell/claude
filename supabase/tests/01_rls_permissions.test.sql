-- 権限・施設分離のテスト（設計書 11-4, 11-6）
-- 「画面で隠すだけ」ではなく、DB に直接アクセスしても拒否されることを確認する
begin;
\i supabase/tests/00_helpers.sql
select plan(22);

-- ---------- 準備（管理者権限で作成） ----------
-- 施設A = seed の【サンプル】テストモール（公開中）
-- 施設B = 非公開（下書き）、施設C = 別の公開施設
insert into public.facilities (id, name, slug, status, is_sample) values
  ('00000000-0000-4000-8000-00000000000b', '【テスト】非公開施設', 'test-draft', 'draft', true),
  ('00000000-0000-4000-8000-00000000000c', '【テスト】別施設', 'test-other', 'published', true);

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'super@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'alice@example.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'bob@example.invalid'),
  ('10000000-0000-4000-8000-000000000004', 'carol@example.invalid');
insert into public.profiles (id, display_name, is_super_admin, is_active) values
  ('10000000-0000-4000-8000-000000000001', '最上位管理者', true, true),
  ('10000000-0000-4000-8000-000000000002', 'アリス（施設A）', false, true),
  ('10000000-0000-4000-8000-000000000003', 'ボブ（施設C）', false, true),
  ('10000000-0000-4000-8000-000000000004', 'キャロル（停止中）', false, false);
insert into public.facility_members (user_id, facility_id) values
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000c'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001');
insert into public.user_permissions (user_id, facility_id, permission_key) values
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'userdata.view'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'map.view'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000c', 'userdata.view'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'userdata.view');

insert into public.analytics_events (event_id, facility_id, anon_session_id, event_type, occurred_at)
select gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 's', 'map_view', now() from generate_series(1, 3);
insert into public.analytics_events (event_id, facility_id, anon_session_id, event_type, occurred_at)
select gen_random_uuid(), '00000000-0000-4000-8000-00000000000c', 's', 'map_view', now() from generate_series(1, 2);

-- ---------- 匿名利用者 ----------
select pg_temp.as_anon();
select results_eq(
  $$ select slug from public.facilities order by slug $$,
  $$ values ('sample-test-mall'::text), ('test-other'::text) $$,
  '匿名：公開中の施設だけが見える（非公開施設は見えない）');
select is((select count(*)::int from public.analytics_events), 0, '匿名：行動データは閲覧できない');
select throws_ok(
  $$ insert into public.analytics_events (event_id, facility_id, anon_session_id, event_type, occurred_at)
     values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 's', 'map_view', now()) $$,
  '42501', null, '匿名：行動データへ直接書き込めない（受付関数経由のみ）');
select is((select count(*)::int from public.map_versions), 0, '匿名：公開版テーブルを直接は読めない（関数経由のみ）');
select throws_ok($$ select * from public.route_rules $$, '42501', null, '匿名：経路規制テーブルを直接は読めない');
-- ※ private スキーマは Supabase の API に公開しない設定にする（RLS の判定に使うため実行権限は必要）
select is(private.has_permission('00000000-0000-4000-8000-000000000001', 'map.view'), false,
  '匿名：権限判定は常に false（ログインしていない）');

-- ---------- アリス（施設Aの担当者、パスワードのみ） ----------
select pg_temp.as_user('10000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.analytics_events), 3, 'アリス：施設Aの行動データ（3件）だけが見える');
select is((select count(*)::int from public.analytics_events where facility_id = '00000000-0000-4000-8000-00000000000c'), 0,
  'アリス：施設Cの行動データは見えない（施設分離）');
select is((select count(*)::int from public.facilities where status = 'draft'), 0, 'アリス：所属していない非公開施設は見えない');
update public.facilities set name = '改ざん' where id = '00000000-0000-4000-8000-000000000001';
select pg_temp.as_admin();
select is((select name from public.facilities where id = '00000000-0000-4000-8000-000000000001'), '【サンプル】テストモール',
  'アリス：施設情報編集の権限がないので施設を変更できない');
select pg_temp.as_user('10000000-0000-4000-8000-000000000002');
select throws_ok(
  $$ insert into public.user_permissions (user_id, facility_id, permission_key)
     values ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'account.manage') $$,
  '42501', null, 'アリス：自分に権限を付与できない');
select throws_ok(
  $$ update public.profiles set is_super_admin = true where id = '10000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'アリス：自分を最上位管理者にできない');
select is((select count(*)::int from public.profiles), 1, 'アリス：他人のアカウント情報は見えない');

-- ---------- ボブ（施設Cの担当者） ----------
select pg_temp.as_user('10000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.analytics_events), 2, 'ボブ：施設Cの行動データ（2件）だけが見える');

-- ---------- キャロル（停止中のアカウント） ----------
select pg_temp.as_user('10000000-0000-4000-8000-000000000004');
select is((select count(*)::int from public.analytics_events), 0, 'キャロル：停止中のアカウントは権限があっても閲覧できない');

-- ---------- 最上位管理者 ----------
select pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'aal1');
select is((select count(*)::int from public.analytics_events), 0, '最上位管理者：多要素認証なし（aal1）では特権が使えない');
select is((select count(*)::int from public.facilities where status = 'draft'), 0, '最上位管理者：多要素認証なしでは非公開施設も見えない');
select pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'aal2');
select is((select count(*)::int from public.analytics_events), 5, '最上位管理者：多要素認証済み（aal2）なら全施設のデータが見える');
select is((select count(*)::int from public.facilities where status = 'draft'), 1, '最上位管理者：多要素認証済みなら非公開施設も見える');
select throws_ok(
  $$ update public.profiles set is_super_admin = true where id = '10000000-0000-4000-8000-000000000002' $$,
  '42501', null, '最上位管理者でも API から直接 profiles は変更できない（Phase 5 の検証つき関数を使う）');

-- ---------- 権限変更履歴 ----------
select pg_temp.as_admin();
select is((select count(*)::int from public.permission_audit_log where action = 'grant'), 4, '権限付与が履歴に自動記録される');
select throws_ok($$ delete from public.permission_audit_log $$, '42501', null, '権限変更履歴は削除できない（管理者権限でも不可）');

select * from finish();
rollback;
