import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
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
