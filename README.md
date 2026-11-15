# 施設型マップ・屋内ナビゲーションアプリ

施設内外の地図表示・店舗検索・現在地測位（GPS / BLEビーコン）・経路案内・利用データ分析を統合した、複数施設展開を前提とする施設型ナビゲーションプラットフォームです。

## 現在の状況

**設計提案段階（承認待ち）** — まだ実装コードはありません。

- 設計提案書：[docs/design/00-design-proposal.md](docs/design/00-design-proposal.md)

設計が承認されたら Phase 1（環境構築・技術検証）に進みます。

## 構成（予定）

| 構成要素 | 技術（提案） |
|---|---|
| 利用者アプリ（iOS / Android） | React Native + Expo（TypeScript） |
| 管理画面（Web） | React + Vite |
| バックエンド | Supabase（PostgreSQL + PostGIS） |
| 地図描画 | MapLibre |
