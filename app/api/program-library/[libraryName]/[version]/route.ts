import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const SEGMENT_SAFE = /^[a-zA-Z0-9._-]+$/;

function badRequest(error: string): Response {
  return NextResponse.json({ error }, { status: 400 });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ libraryName: string; version: string }> }
): Promise<Response> {
  const { libraryName, version } = await ctx.params;
  if (!SEGMENT_SAFE.test(libraryName)) return badRequest("invalid_library_name");
  if (!SEGMENT_SAFE.test(version)) return badRequest("invalid_version");

  const cacheDir = path.join(
    process.cwd(),
    "data",
    "program-library-cache",
    libraryName,
    version
  );
  const fileName = libraryName + ".min.js";
  const cacheFile = path.join(cacheDir, fileName);

  try {
    const cached = await fs.readFile(cacheFile);
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "x-library-cache": "hit",
      },
    });
  } catch {
    // miss
  }

  const cdnUrl =
    "https://cdn.jsdelivr.net/npm/" +
    encodeURIComponent(libraryName) +
    "@" +
    encodeURIComponent(version) +
    "/build/global/" +
    encodeURIComponent(libraryName) +
    ".min.js";

  let res: Response;
  try {
    res = await fetch(cdnUrl, { method: "GET", cache: "no-store" });
  } catch {
    return NextResponse.json(
      { error: "cdn_fetch_failed", libraryName, version },
      { status: 502 }
    );
  }
  if (!res.ok) {
    return NextResponse.json(
      { error: "cdn_fetch_not_ok", status: res.status, libraryName, version },
      { status: 502 }
    );
  }

  const body = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, body);

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "x-library-cache": "miss",
    },
  });
}

