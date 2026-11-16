#!/usr/bin/env bash
# データベース定義（マイグレーション）と権限の自動テスト。
#
# 一時的な PostgreSQL を起動し、
#   1) Supabase 互換の最小環境（supabase/local-shim）
#   2) supabase/migrations/*.sql（本番と同じDB定義）
#   3) supabase/seed.sql（【サンプル】データ）
# を順に適用してから、supabase/tests/*.test.sql（pgTAP）を実行します。
#
# 必要なもの: PostgreSQL 16 と pgTAP（GitHub Actions では自動で導入されます）
# ※ Windows の開発PCで実行する必要はありません（GitHub 上で自動実行されます）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres

cleanup() {
  "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # root では PostgreSQL を起動できないため、postgres ユーザーで実行する
  chown -R postgres "$WORK"
  RUN_AS=(runuser -u postgres --)
fi

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1)

echo "== Supabase 互換環境を準備"
"${PSQL[@]}" -f "$ROOT/supabase/local-shim/00_supabase_shim.sql"
"${PSQL[@]}" -c "create extension if not exists pgtap;"

echo "== マイグレーションを適用"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "== サンプルデータを投入"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

echo "== テストを実行"
cd "$ROOT"
FAILED=0
for t in supabase/tests/*.test.sql; do
  OUT="$("${PSQL[@]}" -t -A -f "$t" 2>&1)" || { echo "$OUT"; echo "!! $t の実行でエラー"; FAILED=1; continue; }
  echo "$OUT" | grep -E '^(ok|not ok)' | sed 's/^/   /'
  if echo "$OUT" | grep -qE '^not ok|Looks like you'; then
    echo "$OUT" | grep -E '^#' | sed 's/^/   /'
    FAILED=1
  fi
done

if [ "$FAILED" = "1" ]; then
  echo "== DBテスト: 失敗あり"
  exit 1
fi
echo "== DBテスト: すべて成功"
