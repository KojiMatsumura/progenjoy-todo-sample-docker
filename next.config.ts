import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  /**
   * Next の自動トレーリングスラッシュ 308 リダイレクトを切る。
   * 過去に逆方向の 308 がブラウザキャッシュに残っているとループになるため、
   * 親 (`/`) も子 (`/programs/<id>/…`) も「リダイレクトしない」で統一する。
   * 相対パス問題は各 HTML 側で `<base href>` を入れて解決する。
   */
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      /**
       * 末尾スラッシュ用の /programs/:id → /programs/:id/ は置かない。
       * Next のマッチが末尾付き URL にも当たり 302 が連鎖する事例があるため。
       * `/programs/foo` と `/programs/foo/` はどちらも Route Handler で処理される。
       */
      /** 旧 `/child/…` `/program/…` → `/programs/…` */
      {
        source: "/child/:id",
        destination: "/programs/:id/",
        permanent: false,
      },
      {
        source: "/child/:id/:path+",
        destination: "/programs/:id/:path+",
        permanent: false,
      },
      {
        source: "/program/:repo",
        destination: "/programs/:repo/",
        permanent: false,
      },
      {
        source: "/program/:repo/:path+",
        destination: "/programs/:repo/:path+",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
