# 施設型マップ・屋内ナビゲーション PoC

施設内外の地図表示・店舗検索・現在地測位（GPS / BLEビーコン）・経路案内・利用データ分析を統合した、複数施設展開を前提とする施設型ナビゲーションプラットフォームの PoC です。

## 現在の状況

**Phase 1A（無料の範囲での実装・検証）完了 — 依頼者の iPhone 確認と判断ポイント G1 待ち**

| 文書 | 内容 |
|---|---|
| [設計提案書 v1.0](docs/design/00-design-proposal.md) | 全体設計（承認済み） |
| [Phase 1A 報告書](docs/reports/phase-1a-report.md) | 実装・検証結果・残課題・次の費用 |
| [デザイン・機能の刷新（11/18）](docs/reports/redesign-2026-11-18.md) | Apple/Google マップ上の屋内図、施設外の機能、2フロアのサンプル施設 |
| [G1 判断材料](docs/decisions/G1-apple-developer-and-beacons.md) | Apple Developer 登録・BLE発信機 |
| [Windows 開発環境の準備](docs/setup/01-windows-setup.md) | Node.js / Git / VS Code、iPhone（Expo Go）での表示 |
| [Supabase の準備](docs/setup/02-supabase-setup.md) | 無料プロジェクト作成とアプリの接続 |
| [iPhone 確認チェック表](docs/setup/03-iphone-check.md) | 依頼者に確認していただく項目 |

## フォルダ構成

| フォルダ | 内容 |
|---|---|
| `apps/mobile` | 利用者アプリ（React Native + Expo） |
| `packages/core` | 共通ロジック（経路探索 A*、規制情報の鮮度判定、検索、送信キュー、オフライン同期、座標変換） |
| `packages/sample-data` | 【サンプル】架空の施設データ（実在の施設ではありません） |
| `supabase` | DB定義（migrations）・サンプルデータ（seed.sql）・権限テスト（tests） |
| `tools/verify` | 画面の通し検証ツール（アプリ本体には含まれません） |
| `docs` | 設計書・手順書・報告書 |

## よく使うコマンド（リポジトリの一番上のフォルダで実行）

| コマンド | 内容 |
|---|---|
| `npm install` | 必要な部品をダウンロード（最初に1回） |
| `npm test` | 自動テスト |
| `npm run typecheck` | 型チェック |
| `npm run mobile` | アプリを起動（iPhone の Expo Go で QR コードを読み取る） |
| `bash scripts/db-test.sh` | DB権限テスト（Linux 用。GitHub 上で自動実行されます） |

## 技術構成

React Native + Expo（TypeScript）／ Supabase（PostgreSQL）／ 地図：iPhone は Apple マップ、Android は Google マップ（react-native-maps）に屋内図を重ねる（ブラウザ版は確認用の簡易表示）
