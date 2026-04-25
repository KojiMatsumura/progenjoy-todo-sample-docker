import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const PACKAGE_NAME_SAFE = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const VERSION_SAFE = /^[a-zA-Z0-9._+-]+$/;

type ProgramLibraryPolicy = {
  updatedAt?: string;
  allowedPackages?: string[];
  rejectedPackages?: string[];
};

function resolveBundlePath(libraryName: string): string {
  if (libraryName === "zod") return "lib/index.umd.js";
  return "build/global/" + libraryName + ".min.js";
}

async function readPolicy(): Promise<ProgramLibraryPolicy> {
  const policyPath = path.join(process.cwd(), "config", "program-library-policy.json");
  const raw = await fs.readFile(policyPath, "utf8");
  return JSON.parse(raw) as ProgramLibraryPolicy;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const libraryName = (url.searchParams.get("name") ?? "").trim();
  const version = (url.searchParams.get("version") ?? "").trim();
  if (!PACKAGE_NAME_SAFE.test(libraryName)) {
    return NextResponse.json({ error: "invalid_library_name" }, { status: 400 });
  }
  if (!VERSION_SAFE.test(version)) {
    return NextResponse.json({ error: "invalid_version" }, { status: 400 });
  }

  let policy: ProgramLibraryPolicy;
  try {
    policy = await readPolicy();
  } catch {
    return NextResponse.json({ error: "policy_load_failed" }, { status: 500 });
  }
  const allowed = new Set(policy.allowedPackages ?? []);
  const rejected = new Set(policy.rejectedPackages ?? []);
  if (rejected.has(libraryName)) {
    return NextResponse.json(
      { error: "package_rejected", libraryName },
      { status: 403 }
    );
  }
  if (!allowed.has(libraryName)) {
    return NextResponse.json(
      { error: "package_not_allowed", libraryName },
      { status: 403 }
    );
  }

  const cacheDir = path.join(
    process.cwd(),
    "data",
    "program-library-cache",
    libraryName,
    version
  );
  const cacheFile = path.join(cacheDir, libraryName.replace("/", "__") + ".bundle.js");
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
    // cache miss
  }

  const cdnUrl =
    "https://cdn.jsdelivr.net/npm/" +
    encodeURIComponent(libraryName) +
    "@" +
    encodeURIComponent(version) +
    "/" +
    resolveBundlePath(libraryName);
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

