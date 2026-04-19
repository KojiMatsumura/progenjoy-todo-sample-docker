# progenjoy-todo-sample-docker

`program-ec-frontend` のプログラムテスト／アップロード後プレビューで使う **プログラム実行用オリジン** を、ローカルで再現するための **Next.js** 構成です。

## 何ができるか

- **`/`（トップ）** … タイトル・説明、16:10 の実行ビュー、通信ログ。内側の iframe は一覧の先頭（フォールバック時は **`/programs/todo-app/`**）を読み込みます。`?name=商品名` で見出しだけ変えられます。
- **`/programs/<programId>/...`** … `_sites` 配下の静的子サイト用。`app/programs/_sites/<programId>/` にフォルダがあるときだけ配信し、**無い `programId` は 404** です（Next アプリとして実装している `app/programs/<programId>/` は別ルート）。
- **旧 URL** … `next.config.ts` の `redirects` で **`/child/...` → `/programs/...`**、**`/program/...` → `/programs/...`** に寄せています。
- **`/api/child-programs`** … `app/programs/_sites` 直下のフォルダ名を走査し、トップのプルダウン用の一覧を JSON で返します。
- **`/api/runner-data/<programId>`** … トップの postMessage ブリッジ用（`GET` / `PUT`）。**`data/<programId>/data.json`** を読み書きします。

ユーザー作成プログラムの置き場所は **`app/programs/_sites/<programId>/` のみ**です（`_sites` は Next.js のルート対象外のため、`app/programs/[programId]/` の API ルートと共存します）。

## 開発（Docker なし）

```bash
npm install
npm run dev
```

既定で **http://localhost:8787** で起動します。

## Docker で起動

```bash
mkdir -p data && docker compose up --build -d
```

ホストの **8787** がコンテナの **3000** にマッピングされます。

## program-ec-frontend 側の環境変数

```bash
NEXT_PUBLIC_PROGRAM_RUNNER_DOMAIN=http://localhost:8787
```

iframe は **`http://localhost:8787/programs/<商品ID>/`** の形で読み込めます（`_sites` に対応フォルダが無い場合は静的配信は 404 になります）。

## 子サイトの置き場所

| programId（フォルダ名） | パス | URL 例 |
| --- | --- | --- |
| 任意（例: `todo-app` のプレースホルダ） | `app/programs/_sites/<programId>/` | `/programs/<programId>/`（`_sites` にフォルダがある場合のみ） |

環境変数 **`PROGRAM_SITES_DIR`**（互換: `CHILDREN_DIR`）で別パスに差し替え可能です。

## 子サイトの CSP

`/programs/*` には `middleware.ts` で Content-Security-Policy を付与しています。`frame-ancestors` を変えたい場合は **`CHILD_SITE_CSP`** で上書きするか、`middleware.ts` を編集してください。

## postMessage と data.json（トップ `/` のみ）

- **api_id:1** → `GET /api/runner-data/<選択中の programId>`
- **api_id:2** → `PUT /api/runner-data/<選択中の programId>`
- **api_id:3** → 親ページ内の Web Worker でユーザコードを実行

## 疎通確認

```bash
curl -s http://localhost:8787/health
```

## 補足

- 永続化は **`data/<programId>/data.json`**（`DATA_DIR` 環境変数でルートを変更可）です。
- `sandbox="allow-scripts"` の iframe 内で動作します。追加権限が必要な場合は sandbox を確認してください。
