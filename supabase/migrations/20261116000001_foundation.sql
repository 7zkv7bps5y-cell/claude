-- =====================================================================
-- 基盤：施設・フロア・管理アカウント・権限（設計書 11章）
--
-- 方針
-- - すべてのデータに facility_id を持たせ、RLS（行単位セキュリティ）で施設をまたいだアクセスを遮断する
-- - 権限チェックはDBで強制する（画面のボタン非表示は補助に過ぎない）
-- - 権限の判定関数は private スキーマに置き、API（PostgREST）からは直接呼べないようにする
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

-- 更新日時の自動更新
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 施設
-- ---------------------------------------------------------------------
create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,64}$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'suspended')),
  -- サンプルデータの印（実データと混同しないため）
  is_sample boolean not null default false,
  -- ローカル座標（m）の原点と回転
  origin_lat double precision not null default 0 check (origin_lat between -90 and 90),
  origin_lng double precision not null default 0 check (origin_lng between -180 and 180),
  rotation_deg double precision not null default 0,
  -- 経路規制情報の鮮度しきい値（施設ごとに変更可能。設計書 4-5）
  rule_fresh_minutes integer not null default 15 check (rule_fresh_minutes > 0),
  rule_restrict_minutes integer not null default 360,
  rule_high_severity_restrict_minutes integer not null default 60 check (rule_high_severity_restrict_minutes > 0),
  rule_restrict_mode text not null default 'confirm' check (rule_restrict_mode in ('confirm', 'block')),
  event_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facilities_fresh_lt_restrict check (rule_fresh_minutes < rule_restrict_minutes)
);
comment on table public.facilities is '施設。is_sample=true はサンプルデータ';
create trigger facilities_touch before update on public.facilities
  for each row execute function private.touch_updated_at();

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities (id) on delete cascade,
  level integer not null,
  name text not null check (char_length(name) between 1 and 50),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (facility_id, level)
);
create index floors_facility_idx on public.floors (facility_id);

-- ---------------------------------------------------------------------
-- 管理画面アカウントと権限
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  is_super_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on column public.profiles.is_super_admin is '最上位管理者。最上位管理者しか変更できない（Phase 5 で専用関数を実装）';

create table public.permissions (
  key text primary key,
  label text not null,
  description text not null default '',
  category text not null,
  sort_order integer not null default 0
);

insert into public.permissions (key, label, description, category, sort_order) values
  ('map.view',       'マップ閲覧',     '下書き・履歴の閲覧',                         'map',       10),
  ('map.edit',       'マップ編集',     '図形編集・公開・復元・図面取込',             'map',       20),
  ('route.manage',   '経路規制管理',   '通行禁止・一時封鎖・立入制限・推奨ルート・鮮度しきい値', 'map', 30),
  ('store.view',     '店舗情報閲覧',   '',                                           'store',     40),
  ('store.edit',     '店舗情報編集',   '登録・編集・非表示・削除',                   'store',     50),
  ('beacon.manage',  'ビーコン管理',   '台帳・稼働状況・点検記録',                   'beacon',    60),
  ('userdata.view',  '利用者データ閲覧', '生データ（補正記録・イベント明細）',       'data',      70),
  ('analytics.view', '分析データ閲覧', '集計・ヒートマップ',                         'data',      80),
  ('account.manage', 'アカウント管理', '自施設アカウントの作成・停止',               'account',   90),
  ('permission.grant', '権限付与',     '自施設アカウントの権限ON/OFF',               'account',  100),
  ('facility.edit',  '施設情報編集',   '施設名・フロア・位置合わせ',                 'facility', 110);

create table public.facility_members (
  user_id uuid not null references public.profiles (id) on delete cascade,
  facility_id uuid not null references public.facilities (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, facility_id)
);
create index facility_members_facility_idx on public.facility_members (facility_id);

-- 行がある = ON、行がない = OFF（施設ごと）
create table public.user_permissions (
  user_id uuid not null,
  facility_id uuid not null,
  permission_key text not null references public.permissions (key),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, facility_id, permission_key),
  foreign key (user_id, facility_id) references public.facility_members (user_id, facility_id) on delete cascade
);
create index user_permissions_facility_idx on public.user_permissions (facility_id);

-- 権限変更履歴（追記のみ。更新・削除は不可）
create table public.permission_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  target_user_id uuid not null,
  facility_id uuid not null,
  permission_key text not null,
  action text not null check (action in ('grant', 'revoke')),
  created_at timestamptz not null default now()
);
create index permission_audit_log_facility_idx on public.permission_audit_log (facility_id, created_at desc);

create or replace function private.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% は変更・削除できません（履歴保護）', tg_table_name using errcode = '42501';
end;
$$;
create trigger permission_audit_log_immutable before update or delete on public.permission_audit_log
  for each row execute function private.forbid_change();

create or replace function private.log_permission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.permission_audit_log (actor_id, target_user_id, facility_id, permission_key, action)
    values (auth.uid(), new.user_id, new.facility_id, new.permission_key, 'grant');
    return new;
  else
    insert into public.permission_audit_log (actor_id, target_user_id, facility_id, permission_key, action)
    values (auth.uid(), old.user_id, old.facility_id, old.permission_key, 'revoke');
    return old;
  end if;
end;
$$;
create trigger user_permissions_audit after insert or delete on public.user_permissions
  for each row execute function private.log_permission_change();

-- ---------------------------------------------------------------------
-- 権限判定関数
-- ---------------------------------------------------------------------

-- 最上位管理者か（多要素認証 aal2 でログインしている場合のみ true。設計書 11-4 ⑦）
create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.is_super_admin and p.is_active
     );
$$;

-- 施設の所属メンバーか（停止中のアカウントは false）
create or replace function private.is_member(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.facility_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid() and m.facility_id = p_facility_id and p.is_active
  );
$$;

-- 指定施設で指定の権限を持つか（最上位管理者は常に true）
create or replace function private.has_permission(p_facility_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
      or exists (
        select 1
        from public.user_permissions up
        join public.profiles p on p.id = up.user_id
        where up.user_id = auth.uid()
          and up.facility_id = p_facility_id
          and up.permission_key = p_key
          and p.is_active
      );
$$;

revoke all on all functions in schema private from public;
grant execute on function private.is_super_admin() to anon, authenticated, service_role;
grant execute on function private.is_member(uuid) to anon, authenticated, service_role;
grant execute on function private.has_permission(uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS（行単位セキュリティ）
-- ---------------------------------------------------------------------
alter table public.facilities enable row level security;
alter table public.floors enable row level security;
alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.facility_members enable row level security;
alter table public.user_permissions enable row level security;
alter table public.permission_audit_log enable row level security;

-- 施設：公開中は誰でも閲覧可。非公開は所属メンバーと最上位管理者のみ
create policy facilities_select on public.facilities for select to anon, authenticated
  using (status = 'published' or private.is_member(id) or private.is_super_admin());
create policy facilities_insert on public.facilities for insert to authenticated
  with check (private.is_super_admin());
create policy facilities_update on public.facilities for update to authenticated
  using (private.has_permission(id, 'facility.edit'))
  with check (private.has_permission(id, 'facility.edit'));
create policy facilities_delete on public.facilities for delete to authenticated
  using (private.is_super_admin());

create policy floors_select on public.floors for select to anon, authenticated
  using (
    exists (select 1 from public.facilities f where f.id = facility_id and f.status = 'published')
    or private.is_member(facility_id) or private.is_super_admin()
  );
create policy floors_write on public.floors for all to authenticated
  using (private.has_permission(facility_id, 'facility.edit'))
  with check (private.has_permission(facility_id, 'facility.edit'));

-- アカウント：自分自身と最上位管理者のみ閲覧。変更は Phase 5 の専用関数で行う
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_super_admin());

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy facility_members_select on public.facility_members for select to authenticated
  using (user_id = auth.uid() or private.has_permission(facility_id, 'account.manage'));

create policy user_permissions_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or private.has_permission(facility_id, 'permission.grant'));

create policy permission_audit_log_select on public.permission_audit_log for select to authenticated
  using (private.has_permission(facility_id, 'permission.grant'));

-- 権限・アカウント関連テーブルへの直接書き込みは禁止（Phase 5 で検証つきの専用関数を用意する）
revoke insert, update, delete on public.profiles, public.permissions, public.facility_members,
  public.user_permissions, public.permission_audit_log from anon, authenticated;
