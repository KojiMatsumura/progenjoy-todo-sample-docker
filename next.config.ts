import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 末尾スラッシュの有無で 308 が挟まると iframe / App Router の遷移が不安定になるため、
   * オプションの静的バンドル配信（route.ts）と同様にリダイレクトを挟まない。
   * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/skipTrailingSlashRedirect
   */
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
