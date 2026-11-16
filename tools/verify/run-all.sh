#!/usr/bin/env bash
# =====================================================================
# Phase 1A 画面の通し検証（ブラウザ版アプリで自動操作）
#
#  A. サーバーなし（アプリ内蔵の【サンプル】データのみ）  → e2e-standalone.cjs
#  B. サーバーあり（本番と同じDB定義＋匿名ロールで動く検証用API） → e2e-online.cjs
#
# 実行環境: Linux（PostgreSQL 16 + pgTAP, Node.js 22, Playwright + Chromium）
# ※ 依頼者の Windows PC で実行する必要はありません。Claude Code の作業環境で実行し、結果を報告書に記載しています。
# 使い方: bash tools/verify/run-all.sh [スクリーンショットの出力先]
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$HERE/out}"
mkdir -p "$OUT"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
export VERIFY_PGPORT=55433
WORK="$(mktemp -d)"
PIDS=()

cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  runuser -u postgres -- "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

[ -d "$HERE/node_modules/pg" ] || (cd "$HERE" && npm install --no-audit --no-fund >/dev/null)

echo "== アプリをビルド（Web版：サーバーなし／サーバーあり）"
(cd "$ROOT/apps/mobile" && EXPO_OFFLINE=1 npx expo export --platform web --output-dir "$WORK/web-standalone" >/dev/null)
(cd "$ROOT/apps/mobile" && EXPO_OFFLINE=1 EXPO_PUBLIC_SUPABASE_URL=http://localhost:8098 EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_test \
  npx expo export --platform web --output-dir "$WORK/web-online" >/dev/null)

echo "== 検証用DBを起動（shim + migrations + seed）"
chown postgres "$WORK"
runuser -u postgres -- "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
runuser -u postgres -- "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $VERIFY_PGPORT -c listen_addresses=127.0.0.1" -l "$WORK/pg.log" -w start >/dev/null
export PGHOST=127.0.0.1 PGPORT=$VERIFY_PGPORT PGUSER=postgres PGDATABASE=postgres
psql -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/local-shim/00_supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do psql -X -q -v ON_ERROR_STOP=1 -f "$f"; done
psql -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql"

echo "== サーバーを起動"
node "$HERE/serve-static.mjs" "$WORK/web-standalone" 8099 >/dev/null 2>&1 & PIDS+=($!)
node "$HERE/serve-static.mjs" "$WORK/web-online" 8097 >/dev/null 2>&1 & PIDS+=($!)
node "$HERE/local-api.mjs" >/dev/null 2>&1 & PIDS+=($!)
sleep 1

echo "== A. サーバーなし"
(cd "$HERE" && node e2e-standalone.cjs "$OUT")
echo "== B. サーバーあり"
(cd "$HERE" && node e2e-online.cjs "$OUT")
