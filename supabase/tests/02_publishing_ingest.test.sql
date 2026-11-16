-- 公開データ配信・経路規制・行動データ受付（重複排除）のテスト（設計書 4章, 11-5）
begin;
\i supabase/tests/00_helpers.sql
select plan(18);

insert into public.facilities (id, name, slug, status, is_sample) values
  ('00000000-0000-4000-8000-00000000000b', '【テスト】非公開施設', 'test-draft', 'draft', true),
  ('00000000-0000-4000-8000-00000000000c', '【テスト】別施設', 'test-other', 'published', true);

-- 経路規制（施設A）：有効・期限切れ・開始前・無効化済み
insert into public.route_rules (id, facility_id, kind, severity, edge_ids, starts_at, ends_at, is_active) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'closed', 'high', '{e001}', null, null, true),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'temporary_closure', 'normal', '{e002}', now() - interval '2 hours', now() - interval '1 hour', true),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'temporary_closure', 'normal', '{e003}', now() + interval '1 hour', now() + interval '2 hours', true),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'closed', 'normal', '{e004}', null, null, false);

-- ---------- 公開データの取得（匿名） ----------
select pg_temp.as_anon();
select is(public.get_facility_version('00000000-0000-4000-8000-000000000001') ->> 'versionNo', '1', '公開版番号を取得できる');
select is(public.get_published_facility('00000000-0000-4000-8000-000000000001') -> 'facility' ->> 'isSample', 'true',
  '施設データ一式（サンプル）を取得できる');
select is(public.get_published_facility('00000000-0000-4000-8000-00000000000b'), null, '非公開施設のデータは取得できない');

select results_eq(
  $$ select r ->> 'id' from jsonb_array_elements(public.get_active_route_rules('00000000-0000-4000-8000-000000000001') -> 'rules') r order by 1 $$,
  $$ values ('20000000-0000-4000-8000-000000000001'::text), ('20000000-0000-4000-8000-000000000003'::text) $$,
  '経路規制：有効なものと開始前のもの（オフライン時に自動適用するため）を返し、期限切れ・無効化済みは返さない');
select ok(public.get_active_route_rules('00000000-0000-4000-8000-000000000001') ? 'serverTime', '経路規制：サーバー時刻を返す');
select is(public.get_active_route_rules('00000000-0000-4000-8000-000000000001') -> 'freshness' ->> 'restrictMinutes', '360',
  '経路規制：施設の鮮度しきい値を同梱する');

-- ---------- 行動データの受付と重複排除 ----------
create temp table ev as select
  jsonb_build_object('eventId', '30000000-0000-4000-8000-000000000001', 'facilityId', '00000000-0000-4000-8000-000000000001',
    'anonSessionId', 'a1', 'type', 'map_view', 'occurredAt', now()) as e1,
  jsonb_build_object('eventId', '30000000-0000-4000-8000-000000000002', 'facilityId', '00000000-0000-4000-8000-000000000001',
    'anonSessionId', 'a1', 'type', 'store_click', 'occurredAt', now(), 'payload', jsonb_build_object('storeId', 'store-A'),
    'x', 1.5, 'y', 2) as e2;
grant select on ev to anon;
select is(
  jsonb_array_length(public.ingest_events((select jsonb_build_array(e1, e2) from ev)) -> 'accepted'), 2, '2件を受け付ける');

-- 応答が届かず端末が再送したケース（2件目は内容を変えて再送しても、最初の内容が保持される）
select is(
  public.ingest_events((select jsonb_build_array(e1, e2 || '{"payload":{"storeId":"changed"}}'::jsonb) from ev)) -> 'accepted',
  '["30000000-0000-4000-8000-000000000001","30000000-0000-4000-8000-000000000002"]'::jsonb,
  '再送されたデータも「受付済み」として返す（端末がキューから削除できるように）');

select pg_temp.as_admin();
select is((select count(*)::int from public.analytics_events), 2, '再送しても重複保存されない');
select is((select payload ->> 'storeId' from public.analytics_events where event_id = '30000000-0000-4000-8000-000000000002'), 'store-A',
  '最初に届いた内容が保存される');
select pg_temp.as_anon();

-- 不正データ
create temp table r as select public.ingest_events(jsonb_build_array(
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a1', 'facilityId', '00000000-0000-4000-8000-000000000001', 'anonSessionId', 'a', 'type', 'hack', 'occurredAt', now()),
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a2', 'facilityId', '99999999-0000-4000-8000-000000000001', 'anonSessionId', 'a', 'type', 'map_view', 'occurredAt', now()),
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a3', 'facilityId', '00000000-0000-4000-8000-00000000000b', 'anonSessionId', 'a', 'type', 'map_view', 'occurredAt', now()),
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a4', 'facilityId', '00000000-0000-4000-8000-000000000001', 'anonSessionId', 'a', 'type', 'map_view', 'occurredAt', now() - interval '30 days'),
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a5', 'facilityId', '00000000-0000-4000-8000-000000000001', 'anonSessionId', 'a', 'type', 'map_view', 'occurredAt', now(), 'payload', jsonb_build_array(1)),
  jsonb_build_object('eventId', '30000000-0000-4000-8000-0000000000a6', 'facilityId', '00000000-0000-4000-8000-000000000001', 'anonSessionId', '', 'type', 'map_view', 'occurredAt', now()),
  jsonb_build_object('facilityId', '00000000-0000-4000-8000-000000000001', 'type', 'map_view')
)) as res;
grant select on r to anon;
select results_eq(
  $$ select x ->> 'reason' from r, jsonb_array_elements(res -> 'rejected') x order by x ->> 'eventId' $$,
  $$ values ('invalid_type'), ('unknown_facility'), ('unknown_facility'), ('invalid_time'), ('invalid_payload'), ('invalid_session') $$,
  '不正なデータは理由つきで拒否する（種類不正・存在しない施設・非公開施設・古すぎる時刻・不正な付加情報・匿名IDなし）');
select is((select jsonb_array_length(res -> 'accepted') from r), 0, '不正なデータは受け付けない');
select pg_temp.as_admin();
select is((select count(*)::int from public.analytics_events), 2, '不正なデータは保存されない');
select pg_temp.as_anon();

select throws_ok(
  $$ select public.ingest_events((select jsonb_agg(jsonb_build_object('eventId', gen_random_uuid())) from generate_series(1, 201))) $$,
  '22023', null, '201件以上の一括送信は拒否する');
select throws_ok($$ select public.ingest_events('{}'::jsonb) $$, '22023', null, '配列以外は拒否する');

-- ---------- 経路規制の編集権限 ----------
select pg_temp.as_admin();
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000005'), ('10000000-0000-4000-8000-000000000006');
insert into public.profiles (id, display_name) values
  ('10000000-0000-4000-8000-000000000005', 'デイブ（施設A・経路規制管理）'),
  ('10000000-0000-4000-8000-000000000006', 'エレン（施設A・マップ閲覧のみ）');
insert into public.facility_members (user_id, facility_id) values
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001');
insert into public.user_permissions (user_id, facility_id, permission_key) values
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'route.manage'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'map.view');

select pg_temp.as_user('10000000-0000-4000-8000-000000000005');
select lives_ok(
  $$ insert into public.route_rules (facility_id, kind, edge_ids) values ('00000000-0000-4000-8000-000000000001', 'closed', '{e010}') $$,
  'route.manage を持つ担当者は自施設の経路規制を追加できる');
select throws_ok(
  $$ insert into public.route_rules (facility_id, kind, edge_ids) values ('00000000-0000-4000-8000-00000000000c', 'closed', '{e010}') $$,
  '42501', null, '他施設の経路規制は追加できない');

select pg_temp.as_user('10000000-0000-4000-8000-000000000006');
select throws_ok(
  $$ insert into public.route_rules (facility_id, kind, edge_ids) values ('00000000-0000-4000-8000-000000000001', 'closed', '{e011}') $$,
  '42501', null, 'マップ閲覧権限だけでは経路規制を追加できない');

select * from finish();
rollback;
