import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [
      {
        source: "/programs/:id",
        destination: "/programs/:id/",
        permanent: false,
      },
      {
        source: "/program/:name",
        destination: "/program/:name/",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/programs/:productId/",
        destination: "/children/_default/",
      },
      {
        source: "/programs/:productId/:path*",
        destination: "/children/_default/:path*",
      },
      {
        source: "/program/:repo/",
        destination: "/children/:repo/",
      },
      {
        source: "/program/:repo/:path*",
        destination: "/children/:repo/:path*",
      },
    ];
  },
};

export default nextConfig;
