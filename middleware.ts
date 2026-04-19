import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 子サイト用 CSP（frame-ancestors は環境で差し替え可能）。
 * `/programs/todo-app` など Next 製子ページはハイドレーション用のインライン script や
 * 開発時の eval を使うため script-src に 'unsafe-inline' 'unsafe-eval' を含める。
 */
const CHILD_SITE_CSP =
  process.env.CHILD_SITE_CSP ??
  "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self' http://localhost:8787 http://127.0.0.1:8787 http://localhost:3000 http://127.0.0.1:3000; form-action 'none'; navigate-to 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none';";

export function middleware(request: NextRequest) {
  const res = NextResponse.next();
  res.headers.delete("X-Frame-Options");
  res.headers.set("Content-Security-Policy", CHILD_SITE_CSP);
  return res;
}

export const config = {
  matcher: [
    "/programs/:programId",
    "/programs/:programId/:path*",
  ],
};
