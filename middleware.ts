import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** 旧 nginx/child-site-headers.conf と同等（frame-ancestors は環境で差し替え可能） */
const CHILD_SITE_CSP =
  process.env.CHILD_SITE_CSP ??
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'self' http://localhost:8787 http://127.0.0.1:8787 http://localhost:3000 http://127.0.0.1:3000; form-action 'none'; navigate-to 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none';";

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
