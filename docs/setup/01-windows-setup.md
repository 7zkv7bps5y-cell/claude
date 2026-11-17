# 開発環境の準備（Windows）とiPhoneでの表示確認

この手順は、プログラミング経験がなくても進められるように書いています。
所要時間の目安：初回 60〜90分（ダウンロード時間を含む）。**費用はかかりません。**

> 画面の文言はソフトのバージョンによって少し違うことがあります。迷ったら、その画面のスクリーンショットを Claude に送ってください。

---

## 全体の流れ

1. 必要なソフトを3つ入れる（Node.js、Git、VS Code）
2. このプロジェクトをPCにダウンロードする
3. 自動テストを動かして、正しく準備できたか確認する
4. iPhone に「Expo Go」を入れて、アプリの画面を表示する

---

## 1. 必要なソフトを入れる

### 1-1. Node.js（アプリを動かすための土台）

1. ブラウザで https://nodejs.org/ja を開く
2. **「LTS」と書かれた版**（推奨版）の Windows インストーラー（`.msi`）をダウンロード
3. ダウンロードしたファイルをダブルクリックし、基本的に「Next（次へ）」を押して進める
   - 「Automatically install the necessary tools…」というチェック欄は**チェックしなくて大丈夫**です
4. 完了したら次へ

> このプロジェクトは Node.js 22 以上が必要です。LTS 版が 22 以上であることを確認してください。

### 1-2. Git（変更履歴を管理するソフト）

1. https://git-scm.com/download/win を開き、「64-bit Git for Windows Setup」をダウンロード
2. ダブルクリックで実行し、**すべて初期設定のまま「Next」**で進めて「Install」

### 1-3. VS Code（作業用の画面）

1. https://code.visualstudio.com/ を開き、「Download for Windows」
2. インストール時の「追加タスクの選択」で、次の2つにチェックを入れると便利です
   - 「エクスプローラーのファイル コンテキスト メニューに [Code で開く] アクションを追加する」
   - 「PATH への追加」（初期状態でチェック済み）
3. VS Code を起動し、左の四角いアイコン（拡張機能）から「Japanese Language Pack」を検索して入れると日本語表示になります

### 1-4. 正しく入ったか確認

1. VS Code を開き、上のメニュー「ターミナル」→「新しいターミナル」
2. 画面下に出た黒い（または白い）欄に、次の3行を1行ずつ入力して Enter

```
node -v
npm -v
git --version
```

3. それぞれ `v22.…`、`10.…`、`git version 2.…` のような番号が出れば成功です
   - 「認識されません」と出たら、VS Code を一度閉じて開き直し、もう一度試してください

---

## 2. プロジェクトをダウンロードする

1. VS Code のターミナルで、保存したい場所に移動します（例：ドキュメントフォルダ）

```
cd $HOME\Documents
```

2. 次のコマンドでダウンロードします（GitHub のログイン画面が出たら、ご自身のアカウントでログイン）

```
git clone https://github.com/7zkv7bps5y-cell/claude.git facility-nav
cd facility-nav
git checkout claude/facility-navigation-poc-opq8ec
```

3. VS Code のメニュー「ファイル」→「フォルダーを開く」で `ドキュメント\facility-nav` を開く
   - 「このフォルダー内のファイルの作成者を信頼しますか？」と聞かれたら「はい、作成者を信頼します」

---

## 3. 準備と自動テスト

VS Code のターミナル（「ターミナル」→「新しいターミナル」）で、1行ずつ実行します。

```
npm install
```

- 数分かかります。最後に `added … packages` のように出れば成功です
- 黄色い `warn` や `npm audit` の案内は、今は気にしなくて大丈夫です

```
npm test
```

- `Tests  54 passed` と `Tests  6 passed` のように **failed が 0** なら成功です（件数は今後増えることがあります）

> データベースのテスト（`scripts/db-test.sh`）は Windows では動かしません。GitHub に保存するたびに自動で実行されます（GitHub のリポジトリ画面の「Actions」タブで結果を見られます）。

---

## 4. iPhone でアプリの画面を表示する（Expo Go）

### 4-1. iPhone の準備

1. App Store で「**Expo Go**」を検索してインストール（無料）
2. **PC と iPhone を同じ Wi-Fi に接続**してください

### 4-2. PC でアプリを起動

VS Code のターミナルで：

```
npm run mobile
```

- しばらくすると、ターミナルに大きな **QRコード** が表示されます
- 「Windows セキュリティの重要な警告（ファイアウォール）」が出たら、「**プライベート ネットワーク**」にチェックして「アクセスを許可する」

### 4-2b. Expo アカウントでログインする（初回のみ・無料）

Expo Go は、PC と iPhone の両方で**同じ Expo アカウントにログインしていないと開けません**（Expo Go 57 以降の仕様）。

1. https://expo.dev/signup で無料アカウントを作成（メールアドレスまたは GitHub アカウント。クレジットカード不要）
2. PC の VS Code のターミナルで（アプリを起動中なら Ctrl + C で止めてから）：
   ```
   npx expo login
   ```
   ユーザー名（またはメールアドレス）とパスワードを入力。`npx expo whoami` でユーザー名が表示されれば成功
3. iPhone の Expo Go を開き、右上の人型アイコン（アカウント）から**同じアカウント**でログイン
4. もう一度 `npm run mobile` で起動し、QR コードを読み取る

### 4-3. iPhone で読み取る

1. iPhone の**標準カメラ**で、PC画面の QR コードを写す
2. 「Expo Go で開く」と表示されたらタップ
3. 初回は1〜2分ほど読み込み、【サンプル】テストモールの地図が表示されれば成功です

### うまくいかないとき

| 症状 | 対処 |
|---|---|
| QRコードを読んでも「接続できません」 | PC と iPhone が同じ Wi-Fi か確認。会社や施設の Wi-Fi は端末間の通信が禁止されていることがあります。その場合は Ctrl + C で止めて、`npm run mobile -- --tunnel` で起動し直す（初回は追加の部品の導入を聞かれるので `y`） |
| 「Project is incompatible with this version of Expo Go」 | App Store で Expo Go を最新版に更新する。それでも出る場合は Claude に画面の文言を伝えてください |
| 「You need to be signed in to Expo Go and Expo CLI…」 | 上の 4-2b のとおり、PC と iPhone で同じ Expo アカウントにログイン。iPhone の画面で「Try Again」 |
| 「An update for expo is available」 | お知らせです。動作には影響しないので、そのまま進めて大丈夫です |
| 画面が真っ白／赤いエラー画面 | 赤い画面の文言をスクリーンショットで Claude に送ってください |
| 止めたいとき | ターミナルで Ctrl + C |

### 4-4. 確認していただきたいこと

`docs/setup/03-iphone-check.md` のチェック表に沿って確認し、結果（○×とスクリーンショット）を送ってください。

---

## 用語メモ

| 用語 | 意味 |
|---|---|
| ターミナル | 文字でコンピューターに命令する画面 |
| `npm install` | プロジェクトが使う部品をまとめてダウンロードする命令 |
| `npm test` | 自動テストを実行する命令 |
| Expo Go | 開発中のアプリを、ストアに出さずに iPhone で試せる無料アプリ |
| QRコード | PC で動いているアプリの場所を iPhone に伝えるための画像 |
