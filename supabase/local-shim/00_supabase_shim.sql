-- =====================================================================
-- 【ローカル検証専用】Supabase 互換の最小限の環境
--
-- 本物の Supabase には最初から存在する auth スキーマ・ロール・既定の権限を、
-- 素の PostgreSQL 上で再現するためのファイルです。
-- 自動テスト（scripts/db-test.sh と GitHub Actions）でのみ使用し、
-- 本物の Supabase には適用しません。
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end
$$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Supabase と同様、JWT のクレームは request.jwt.claims（JSON）から読む
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase の既定：public スキーマのテーブル等は anon/authenticated に権限が付与され、RLS で制御する
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
