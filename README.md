# progenjoy-todo-sample-docker

`program-ec-frontend` のプログラムテスト／アップロード後プレビューで使う **プログラム実行用オリジン** を、ローカルで再現するための **Next.js** 構成です。

## 何ができるか

- **`/`（トップ）** … タイトル・説明、16:10 の実行ビュー、通信ログ。内側の iframe は既定で `/programs/local-demo/`（`public/children/_default`）を読み込みます。`?name=商品名` で見出しだけ変えられます。
- **`/programs/<productId>/...`** … EC の iframe と同じ URL 形。ローカルでは **どの `productId` でも** `public/children/_default/` の静的ファイルが返ります（`next.config.ts` の rewrite）。
- **`/program/<リポジトリ名>/...`** … 子プロジェクトの成果物を `public/children/<名前>/` に置き、そのパスで確認できます。
- **`/api/child-programs`** … `public/children` 直下のフォルダを走査し、トップのプルダウン用の一覧を JSON で返します。
- **`/api/runner-data`** … トップページの postMessage ブリッジ用（`GET` / `PUT`）。リポジトリルートの **`data.json`** を読み書きします。

## 開発（Docker なし）

```bash
npm install
npm run dev
```

既定で **http://localhost:8787** で起動します（`package.json` の `next dev -p 8787`）。

## Docker で起動

初回のみ、空の `data.json` を用意してください（未作成だと Docker がディレクトリを作ってしまう場合があります）。

```bash
touch data.json
docker compose up --build -d
```

ホストの **8787** がコンテナの **3000** にマッピングされます。ポートを変える場合は `PROGRAM_RUNNER_PORT` を指定してください。

## program-ec-frontend 側の環境変数

`.env.local` などに次を設定します（末尾にスラッシュは付けない）。

```bash
NEXT_PUBLIC_PROGRAM_RUNNER_DOMAIN=http://localhost:8787
```

## 表示するプログラムの置き場所

| 目的 | パス |
| --- | --- |
| iframe 用（すべての productId で共通） | `public/children/_default/` |
| 名前付き URL で配信 | `public/children/<フォルダ名>/`（例: `public/children/sample-game/`） |

- 名前付きの例: `http://localhost:8787/program/sample-game/`
- iframe 用の例: `http://localhost:8787/programs/任意のUUID/`（中身は `_default`）

フォルダを追加すると、**`/api/child-programs` の結果に自動で反映**され、トップの選択肢が増えます。

## 子サイトの CSP

`/program/*` と `/programs/*` には `middleware.ts` で Content-Security-Policy を付与しています（旧 nginx の `child-site-headers.conf` と同趣旨）。`frame-ancestors` を変えたい場合は環境変数 **`CHILD_SITE_CSP`** で上書きするか、`middleware.ts` を編集してください。

## postMessage と data.json（トップ `/` のみ）

- **api_id:1** → `GET /api/runner-data` → `data.json` の内容を子へ `postMessage`。
- **api_id:2** → `PUT /api/runner-data` → `data.json` に保存。
- **api_id:3** → 親ページ内の Web Worker でユーザコードを実行（従来どおり）。

**注意:** EC から `localhost:8787` の子だけを開いた場合、親は EC 側のためこのストレージ APIは使われません。`data.json` を試すときは **`http://localhost:8787/`** のランナーを使うか、同様のブリッジを EC に実装してください。

## 疎通確認

```bash
curl -s http://localhost:8787/health
```

## 補足

- 本リポジトリの **ストレージは単一ファイル `data.json`** です。本番の ID 別ディレクトリ割り当ては含みません。
- フロントの `ProgramIframeBridge` は `sandbox="allow-scripts"` の iframe 内で動きます。追加権限が必要な場合は sandbox 設定を確認してください。
