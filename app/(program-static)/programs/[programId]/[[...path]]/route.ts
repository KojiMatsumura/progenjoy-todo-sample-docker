import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getProgramSitesDir } from "@/lib/paths";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

function isSafeProgramId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

function isUnderDir(root: string, target: string): boolean {
  const r = path.resolve(root) + path.sep;
  const t = path.resolve(target);
  return t === path.resolve(root) || t.startsWith(r);
}

/** `sites/<programId>` が存在するディレクトリのみ配信（未登録 ID は 404） */
async function resolveBaseDir(
  programId: string,
  sitesRoot: string
): Promise<string | null> {
  const candidate = path.resolve(sitesRoot, programId);
  if (!isUnderDir(sitesRoot, candidate)) {
    return null;
  }
  try {
    const st = await fs.stat(candidate);
    if (st.isDirectory()) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  segment: { params: Promise<{ programId: string; path?: string[] }> }
) {
  const { programId, path: pathSegs } = await segment.params;

  if (!isSafeProgramId(programId)) {
    return NextResponse.json({ error: "invalid programId" }, { status: 400 });
  }

  const sitesRoot = path.resolve(getProgramSitesDir());
  const base = await resolveBaseDir(programId, sitesRoot);

  if (!base) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const parts = (pathSegs ?? []).filter((p) => p.length > 0);
  if (parts.some((p) => p.includes(".."))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let target = path.join(base, ...parts);

  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) {
      target = path.join(target, "index.html");
    }
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (!isUnderDir(base, target)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const buf = await fs.readFile(target);

    /**
     * HTML のときだけ `<base href="/programs/<id>/">` を注入する。
     * `skipTrailingSlashRedirect: true` にしてリダイレクトを排除した結果、
     * URL が `/programs/<id>` でも `/programs/<id>/` でも配信されるため、
     * どちらでも相対パス (`todo.css` `todo.js` 等) が正しく解決できるようにする。
     */
    const contentType = mimeFor(target);
    if (contentType.startsWith("text/html")) {
      const html = buf.toString("utf8");
      const baseTag = `<base href="/programs/${programId}/">`;
      const injected = html.includes("<base ")
        ? html
        : html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n    ${baseTag}`);
      return new NextResponse(injected, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "no-store",
        },
      });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return new NextResponse("Not Found", { status: 404 });
    }
    throw e;
  }
}
