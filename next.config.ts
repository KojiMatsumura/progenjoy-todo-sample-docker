import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [
      {
        source: "/programs/:programId",
        destination: "/programs/:programId/",
        permanent: false,
      },
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
