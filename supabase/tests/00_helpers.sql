-- テスト用の補助関数（各テストファイルの先頭で読み込む。トランザクション内で作成し、最後に rollback で消える）

-- 匿名利用者（利用者アプリ）として振る舞う
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- ログイン済み管理者として振る舞う（aal: 'aal1' = パスワードのみ, 'aal2' = 多要素認証済み）
create or replace function pg_temp.as_user(p_id uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on all functions in schema pg_temp to anon, authenticated;
