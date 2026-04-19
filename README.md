# progenjoy-todo-sample-docker

`program-ec-frontend` のプログラムテスト／アップロード後プレビューで使う **プログラム実行用オリジン** を、ローカルで再現するための **Next.js** 構成です。

## 何ができるか

- **`/`（トップ）** … タイトル・説明、16:10 の実行ビュー、通信ログ。内側の iframe は既定で **`/programs/default/`**（`app/programs/_sites/default/`）を読み込みます。`?name=商品名` で見出しだけ変えられます。
- **`/programs/<programId>/...`** … iframe 用の子サイト。`app/programs/_sites/<programId>/` にファイルがあるときはそのフォルダを配信し、**無い `programId`（例: EC の商品 UUID）は `default` フォルダにフォールバック**します。
- **旧 URL** … `next.config.ts` の `redirects` で **`/child/...` → `/programs/...`**、**`/program/...` → `/programs/...`** に寄せています。
- **`/api/child-programs`** … `app/programs/_sites` 直下のフォルダ名を走査し、トップのプルダウン用の一覧を JSON で返します。
- **`/api/runner-data`** … トップの postMessage ブリッジ用（`GET` / `PUT`）。リポジトリルートの **`data.json`** を読み書きします。

ユーザー作成プログラムの置き場所は **`app/programs/_sites/<programId>/` のみ**です（`_sites` は Next.js のルート対象外のため、`app/programs/[programId]/` の API ルートと共存します）。

## 開発（Docker なし）

```bash
npm install
npm run dev
```

既定で **http://localhost:8787** で起動します。

## Docker で起動

```bash
touch data.json
docker compose up --build -d
```

ホストの **8787** がコンテナの **3000** にマッピングされます。

## program-ec-frontend 側の環境変数

```bash
NEXT_PUBLIC_PROGRAM_RUNNER_DOMAIN=http://localhost:8787
```

iframe は **`http://localhost:8787/programs/<商品ID>/`** の形で読み込めます（`<商品ID>` がディスク上に無くても `default` のデモが表示されます）。

## 子サイトの置き場所

| programId（フォルダ名） | パス | URL 例 |
| --- | --- | --- |
| `default` | `app/programs/_sites/default/` | `/programs/default/` または任意の未登録 `programId` でフォールバック |
| 任意（例: `sample-game`） | `app/programs/_sites/<programId>/` | `/programs/<programId>/` |

環境変数 **`PROGRAM_SITES_DIR`**（互換: `CHILDREN_DIR`）で別パスに差し替え可能です。

## 子サイトの CSP

`/programs/*` には `middleware.ts` で Content-Security-Policy を付与しています。`frame-ancestors` を変えたい場合は **`CHILD_SITE_CSP`** で上書きするか、`middleware.ts` を編集してください。

## postMessage と data.json（トップ `/` のみ）

- **api_id:1** → `GET /api/runner-data`
- **api_id:2** → `PUT /api/runner-data`
- **api_id:3** → 親ページ内の Web Worker でユーザコードを実行

## 疎通確認

```bash
curl -s http://localhost:8787/health
```

## 補足

- ストレージは単一ファイル **`data.json`** です。
- `sandbox="allow-scripts"` の iframe 内で動作します。追加権限が必要な場合は sandbox を確認してください。
