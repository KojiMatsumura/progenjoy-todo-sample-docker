# progenjoy-todo-sample-docker

`program-ec-frontend` のプログラムテスト／アップロード後プレビューで使う **プログラム実行用オリジン** を、ローカルの Docker で再現するための最小構成です。

## 何ができるか

- **`/`（トップ）** … タイトル・説明、16:10 の実行ビュー、通信ログの静的プレビュー。内側の iframe は `/programs/local-demo/`（`children/_default`）を読み込みます。商品名だけ変えたい場合は `?name=商品名` を付けられます。
- **`/programs/<productId>/...`** … フロントの iframe と同じ URL 形。`NEXT_PUBLIC_PROGRAM_RUNNER_DOMAIN` が指すオリジンとして利用します。ローカル検証では **どの `productId` でも** `children/_default/` の静的ファイルを返します。
- **`/program/<リポジトリ名>/...`** … 子プロジェクト（別リポジトリ）のビルド成果物を `children/<リポジトリ名>/` に置き、そのパスで直接確認・共有できます。

## 使い方

### 1. ランナーを起動

```bash
docker compose up -d
```

デフォルトでは **ホストの 8787** がコンテナの 80 にマッピングされます。ポートを変える場合は環境変数 `PROGRAM_RUNNER_PORT` を指定してください。

### 2. program-ec-frontend 側の環境変数

`.env.local` などに次を設定します（末尾にスラッシュは付けないでください）。

```bash
NEXT_PUBLIC_PROGRAM_RUNNER_DOMAIN=http://localhost:8787
```

Next を再起動すると、プログラムテスト画面やアップロードプレビューの iframe が `http://localhost:8787/programs/<商品ID>/` を読み込みます。

子サイトの CSP では `frame-ancestors` に **`'self'`（ランナー自身）** と **`http://localhost:3000` / `http://127.0.0.1:3000`（ローカル EC）**、および **`localhost:8787` / `127.0.0.1:8787`** を含めています。リポジトリのトッププレビュー（`/`）からの iframe と EC からの iframe の両方で表示できます。EC やランナーを別ポートで動かす場合は `nginx/child-site-headers.conf` の `frame-ancestors` を編集してください。

### 3. トップページの見た目を編集する

`top-page/index.html` を編集します（HTML / CSS / 埋め込み iframe の `src` など）。

### 4. 表示するプログラムの置き場所

| 目的 | パス |
| --- | --- |
| iframe 用（すべての ID で共通のデモ） | `children/_default/` |
| 子サイトとして名前付きで配信 | `children/<リポジトリ名>/`（例: `children/sample-game/`） |

- 名前付き URL の例: `http://localhost:8787/program/sample-game/`
- iframe 用の例: `http://localhost:8787/programs/任意のUUID/`（中身は `_default`）

### 5. 疎通確認

```bash
curl -s http://localhost:8787/health
```

## postMessage と data.json（トップページ `/` のみ）

`docker compose` 起動時に **`runner-api`** コンテナが同時に立ち上がり、リポジトリルートの **`data.json`** を読み書きします（`.gitignore` 済み）。

- **`/`（`top-page/index.html`）** が iframe 子からの postMessage を処理します（`program-ec-frontend` の `ProgramIframeBridge` と同様の api_id 1 / 2）。
  - **api_id:1**（`content: null`）→ `GET /api/runner-data` → `data.json` の内容を JSON で子へ `postMessage` で返す。ファイルが無いときは `{ "content": {} }`。
  - **api_id:2**（`content` がオブジェクト）→ `PUT /api/runner-data`（本文 `{ "content": … }`）→ `data.json` に保存し、保存後の JSON を子へ返す。

**注意:** `program-ec-frontend` から `localhost:8787` の子だけを開いた場合、親は EC 側のためこのストレージ API は使われません。ローカルで `data.json` を試すときは **`http://localhost:8787/`** のプレビューを使うか、同様のブリッジを EC に実装してください。

## 補足

- **`/program/` と `/programs/` のレスポンス**には、子サイト向けに次の CSP が常に付きます（`nginx/child-site-headers.conf`）。`script-src 'self'` / `style-src 'self'` のため、インラインの `<script>` / `<style>` は使えず、同一オリジンの `.js` / `.css` ファイルに分ける必要があります。
- 本リポジトリは **静的ファイル配信のみ** です。本番のストレージ連携や ID ごとの別ディレクトリ割り当ては含みません。ID 別に分けたい場合は、`nginx/default.conf` に `location` を追加するか、`children/_default` をシンボリックリンクで差し替えてください。
- フロントの `ProgramIframeBridge` は `sandbox="allow-scripts"` の iframe 内で動きます。ゲームが追加権限（同一オリジンやフォーム送信など）を必要とする場合は、フロント側の sandbox 設定も合わせて確認してください。
