# 検証用ツール（tools/verify）

Phase 1A の動作を、ブラウザ版のアプリを自動操作して確認するためのツールです。**アプリ本体には含まれません。**

| ファイル | 内容 |
|---|---|
| `run-all.sh` | 下記をまとめて実行（ビルド → 検証用DB起動 → 自動操作） |
| `local-api.mjs` | Supabase の公開API（`/rest/v1/rpc/*`）を模した検証用サーバー。本番と同じDB定義・匿名ロールで関数を実行する。通信断・応答切断も再現できる |
| `e2e-standalone.cjs` | サーバーなし（内蔵サンプルのみ）での画面操作の確認 |
| `e2e-online.cjs` | サーバーありでの確認（オフライン保存・規制・鮮度・送信キュー・重複防止・版更新） |
| `serve-static.mjs` | ビルドしたWeb版アプリを配信する簡易サーバー |

実行には Linux 環境（PostgreSQL 16、Node.js 22、Playwright + Chromium）が必要です。
依頼者の Windows PC で実行する必要はありません（Claude Code の作業環境で実行し、結果を報告書に記載しています）。

```bash
bash tools/verify/run-all.sh
```

注意：これは本物の Supabase ではありません。本物の Supabase に接続した確認は、依頼者が Supabase の無料プロジェクトを作成した後に行います（docs/setup/02-supabase-setup.md）。
