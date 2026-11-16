# Supabase（無料プラン）の準備とアプリの接続

アプリはサーバーがなくても【サンプル】データで動きます。
この手順では、無料の Supabase プロジェクトを作り、**本物のサーバーからデータを取得してオフライン保存する流れ**を iPhone で確認できるようにします。

- 費用：**無料プラン**を使います。**クレジットカードの登録は不要**です（求められた場合は進めずに Claude に相談してください）
- 所要時間：30分程度

> 注意：無料プランは **1週間アクセスがないと一時停止**します。データは消えず、Supabase の管理画面から「Restore（再開）」で戻せます。

---

## 1. アカウントとプロジェクトを作る

1. https://supabase.com を開き、「Start your project」→ GitHub アカウントでサインイン（GitHub のアカウントをそのまま使えます）
2. 「New project」を押す
3. 次のように入力
   | 項目 | 入力内容 |
   |---|---|
   | Name | `facility-nav-dev`（開発用） |
   | Database Password | 「Generate a password」で自動作成し、**パスワード管理アプリなど安全な場所に保管**（チャットには貼らないでください） |
   | Region | **Northeast Asia (Tokyo)** |
   | Plan | **Free** |
4. 「Create new project」→ 数分待つ

## 2. データベースの定義を入れる

GitHub に保存してある SQL ファイルを、上から順番に貼り付けて実行します。

1. Supabase の左メニュー「**SQL Editor**」を開く
2. 「New query」を押す
3. VS Code で次のファイルを開き、**中身を全部コピー**（Ctrl + A → Ctrl + C）して SQL Editor に貼り付け（Ctrl + V）、右下の「**Run**」
   1. `supabase/migrations/20261116000001_foundation.sql`
   2. `supabase/migrations/20261116000002_publishing_and_events.sql`
   3. `supabase/seed.sql`（【サンプル】データ）
4. それぞれ「Success. No rows returned」と出れば成功です
   - 赤いエラーが出たら、**その時点で止めて**エラーの文言を Claude に送ってください
   - 「destructive operation」の確認が出た場合も、実行せずに Claude に送ってください

> 将来は「Supabase CLI」という道具でこの作業を自動化できますが、PoC 初期は画面操作の方が確実なため、この方法にしています。

## 3. 接続情報を取得する

1. 左メニュー下の「**Project Settings**」（歯車）→「**API Keys**」（または「Data API」）
2. 次の2つを控えます
   | 名前 | 使う場所 |
   |---|---|
   | Project URL（`https://xxxx.supabase.co`） | アプリの設定 |
   | **Publishable key**（`sb_publishable_…`。古い画面では「anon public」キー） | アプリの設定 |
3. **「Secret key」や「service_role」と書かれたキーは絶対にアプリに入れないでください**（データベースを自由に操作できる鍵です）

## 4. アプリに接続情報を設定する

1. VS Code で `apps/mobile/.env.example` を右クリック→「コピー」、同じ場所に「貼り付け」→ 名前を `.env` に変更
2. `.env` を開いて、次のように書き換えて保存

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_xxxxxxxx
EXPO_PUBLIC_FACILITY_ID=
```

3. `.env` は GitHub に保存されない設定になっています（`.gitignore` で除外済み）
4. ターミナルで、アプリを起動し直します（`-c` は設定を読み直すための指定）

```
npm run mobile -- -c
```

## 5. 接続できたかの確認

iPhone の Expo Go でアプリを開き、右上の「検証」→「施設データ（オフライン保存）」で次を確認します。

| 項目 | 期待される表示 |
|---|---|
| サーバー接続設定 | あり（Supabase） |
| 前回の更新確認 | 通信成功／地図：新しい版を保存／規制：取得 |
| 読込元 | 端末に保存したデータ（日時） |

地図画面の上部が緑色の「規制情報：最新」になれば成功です。続けて `docs/setup/03-iphone-check.md` の「B. サーバー接続あり」の確認をお願いします。

## 補足：Supabase の管理画面でデータを見る

- 左メニュー「Table Editor」→ `analytics_events`：アプリから送られた行動データ（分析データ送信に同意した場合のみ）
- `route_rules`：通行規制。行を追加すると、アプリの次回の更新確認で反映されます（管理画面は Phase 2 以降で作ります）
