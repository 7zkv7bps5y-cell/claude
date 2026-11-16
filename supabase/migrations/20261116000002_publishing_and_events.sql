-- =====================================================================
-- 公開データ配信（オフライン保存用）・経路規制・行動データ受付
-- 設計書 4章（オフライン）・11-5（利用者アプリ向けAPI）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 公開版（端末に配布する施設データ一式のスナップショット）
-- ---------------------------------------------------------------------
create table public.map_versions (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null check (status in ('published', 'archived')),
  snapshot jsonb not null,
  note text not null default '',
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz not null default now(),
  unique (facility_id, version_no)
);
-- 1施設につき「公開中」は1つだけ
create unique index map_versions_one_published on public.map_versions (facility_id) where status = 'published';

alter table public.map_versions enable row level security;
create policy map_versions_select on public.map_versions for select to authenticated
  using (private.has_permission(facility_id, 'map.view'));
revoke insert, update, delete on public.map_versions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 経路規制（公開操作なしで即時反映・期間指定可能）
-- ---------------------------------------------------------------------
create table public.route_rules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  kind text not null check (kind in ('closed', 'temporary_closure', 'restricted', 'one_way', 'preferred')),
  severity text not null default 'normal' check (severity in ('normal', 'high')),
  edge_ids text[] not null check (cardinality(edge_ids) > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  note text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_rules_period check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create index route_rules_facility_idx on public.route_rules (facility_id) where is_active;
create trigger route_rules_touch before update on public.route_rules
  for each row execute function private.touch_updated_at();

alter table public.route_rules enable row level security;
create policy route_rules_select on public.route_rules for select to authenticated
  using (private.has_permission(facility_id, 'route.manage') or private.has_permission(facility_id, 'map.view'));
create policy route_rules_write on public.route_rules for all to authenticated
  using (private.has_permission(facility_id, 'route.manage'))
  with check (private.has_permission(facility_id, 'route.manage'));
revoke all on public.route_rules from anon;

-- ---------------------------------------------------------------------
-- 行動データ（生データ。90日で削除予定：Phase 6 で定期処理を実装）
-- ---------------------------------------------------------------------
create table public.analytics_events (
  event_id uuid primary key,                -- 端末で発行する一意ID。再送時の重複を防ぐ
  facility_id uuid not null references public.facilities (id) on delete cascade,
  anon_session_id text not null check (char_length(anon_session_id) between 1 and 64),
  event_type text not null check (event_type in (
    'app_open', 'map_view', 'store_click', 'store_search', 'route_search', 'position_correction', 'beacon_seen'
  )),
  floor_id uuid,
  x double precision,
  y double precision,
  payload jsonb not null default '{}'::jsonb,
  platform text check (char_length(platform) <= 20),
  app_version text check (char_length(app_version) <= 40),
  occurred_at timestamptz not null,         -- 端末時計の発生時刻
  received_at timestamptz not null default now()  -- サーバーの受信時刻
);
create index analytics_events_facility_time_idx on public.analytics_events (facility_id, occurred_at);

alter table public.analytics_events enable row level security;
create policy analytics_events_select on public.analytics_events for select to authenticated
  using (private.has_permission(facility_id, 'userdata.view'));
-- 直接の書き込みは禁止。受付は ingest_events() 経由のみ
revoke insert, update, delete on public.analytics_events from anon, authenticated;

-- =====================================================================
-- 利用者アプリ向け関数（ログイン不要）
-- =====================================================================

-- 公開版番号の確認（軽量。端末はこれで更新の有無を判断する）
create or replace function public.get_facility_version(p_facility_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('versionNo', v.version_no, 'publishedAt', v.published_at)
  from public.map_versions v
  join public.facilities f on f.id = v.facility_id
  where v.facility_id = p_facility_id and v.status = 'published' and f.status = 'published';
$$;

-- 施設データ一式（オフライン保存用）
create or replace function public.get_published_facility(p_facility_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select v.snapshot
  from public.map_versions v
  join public.facilities f on f.id = v.facility_id
  where v.facility_id = p_facility_id and v.status = 'published' and f.status = 'published';
$$;

-- 経路規制情報（期限切れでないもの。開始前のものも含め、端末がオフラインでも開始時刻に自動適用できるようにする）
-- 鮮度しきい値も同梱する（地図の再公開なしで変更を反映するため）
create or replace function public.get_active_route_rules(p_facility_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'serverTime', now(),
    'freshness', jsonb_build_object(
      'freshMinutes', f.rule_fresh_minutes,
      'restrictMinutes', f.rule_restrict_minutes,
      'highSeverityRestrictMinutes', f.rule_high_severity_restrict_minutes,
      'restrictMode', f.rule_restrict_mode,
      'eventMode', f.event_mode
    ),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'severity', r.severity, 'edgeIds', to_jsonb(r.edge_ids),
        'startsAt', r.starts_at, 'endsAt', r.ends_at, 'note', r.note
      ) order by r.created_at)
      from public.route_rules r
      where r.facility_id = f.id and r.is_active and (r.ends_at is null or r.ends_at > now())
    ), '[]'::jsonb)
  )
  from public.facilities f
  where f.id = p_facility_id and f.status = 'published';
$$;

-- 行動データの受付（まとめて送信。event_id で重複を排除）
-- 戻り値: { accepted: [event_id...], rejected: [{eventId, reason}...] }
--   accepted には「今回保存したもの」と「既に保存済みだったもの（再送）」の両方を含める
--   → 端末は accepted / rejected のIDをキューから削除する
-- ※ 回数制限（不正な大量送信への対策）は Phase 6 で Edge Function を前段に置いて実装する（残課題）
create or replace function public.ingest_events(p_events jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e jsonb;
  v_id uuid;
  v_facility uuid;
  v_type text;
  v_occurred timestamptz;
  v_floor uuid;
  v_payload jsonb;
  v_reason text;
  accepted jsonb := '[]'::jsonb;
  rejected jsonb := '[]'::jsonb;
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'p_events は配列である必要があります' using errcode = '22023';
  end if;
  if jsonb_array_length(p_events) > 200 then
    raise exception '一度に送信できるのは200件までです' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_events) loop
    v_reason := null;
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'eventId', '') !~ uuid_re then
      -- IDがない・不正なものは返すIDもないので、件数に含めず無視する
      continue;
    end if;
    v_id := (e ->> 'eventId')::uuid;

    if coalesce(e ->> 'facilityId', '') !~ uuid_re then
      v_reason := 'invalid_facility';
    else
      v_facility := (e ->> 'facilityId')::uuid;
      if not exists (select 1 from public.facilities f where f.id = v_facility and f.status = 'published') then
        v_reason := 'unknown_facility';
      end if;
    end if;

    v_type := e ->> 'type';
    if v_reason is null and v_type not in (
      'app_open', 'map_view', 'store_click', 'store_search', 'route_search', 'position_correction', 'beacon_seen'
    ) then
      v_reason := 'invalid_type';
    end if;

    if v_reason is null and coalesce(char_length(e ->> 'anonSessionId'), 0) not between 1 and 64 then
      v_reason := 'invalid_session';
    end if;

    if v_reason is null then
      begin
        v_occurred := (e ->> 'occurredAt')::timestamptz;
      exception when others then
        v_occurred := null;
      end;
      -- 端末の保存期間（7日）＋余裕を超える古いもの、未来すぎるものは受け付けない
      if v_occurred is null or v_occurred < now() - interval '8 days' or v_occurred > now() + interval '1 day' then
        v_reason := 'invalid_time';
      end if;
    end if;

    v_payload := coalesce(e -> 'payload', '{}'::jsonb);
    if v_reason is null and (jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 4000) then
      v_reason := 'invalid_payload';
    end if;

    if v_reason is not null then
      rejected := rejected || jsonb_build_object('eventId', v_id, 'reason', v_reason);
      continue;
    end if;

    v_floor := case when coalesce(e ->> 'floorId', '') ~ uuid_re then (e ->> 'floorId')::uuid end;

    insert into public.analytics_events (
      event_id, facility_id, anon_session_id, event_type, floor_id, x, y, payload, platform, app_version, occurred_at
    ) values (
      v_id, v_facility, e ->> 'anonSessionId', v_type, v_floor,
      case when jsonb_typeof(e -> 'x') = 'number' then (e ->> 'x')::double precision end,
      case when jsonb_typeof(e -> 'y') = 'number' then (e ->> 'y')::double precision end,
      v_payload, left(e ->> 'platform', 20), left(e ->> 'appVersion', 40), v_occurred
    )
    on conflict (event_id) do nothing;

    accepted := accepted || to_jsonb(v_id);
  end loop;

  return jsonb_build_object('accepted', accepted, 'rejected', rejected);
end;
$$;

revoke all on function public.get_facility_version(uuid) from public;
revoke all on function public.get_published_facility(uuid) from public;
revoke all on function public.get_active_route_rules(uuid) from public;
revoke all on function public.ingest_events(jsonb) from public;
grant execute on function public.get_facility_version(uuid) to anon, authenticated;
grant execute on function public.get_published_facility(uuid) to anon, authenticated;
grant execute on function public.get_active_route_rules(uuid) to anon, authenticated;
grant execute on function public.ingest_events(jsonb) to anon, authenticated;
