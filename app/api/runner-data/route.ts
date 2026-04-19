import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getDataFilePath } from "@/lib/paths";

async function readStore() {
  const file = getDataFilePath();
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt) as unknown;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return { content: {} };
    }
    throw e;
  }
}

export async function GET() {
  try {
    const data = await readStore();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (
      typeof body !== "object" ||
      body === null ||
      !("content" in body) ||
      typeof (body as { content: unknown }).content !== "object" ||
      (body as { content: unknown }).content === null ||
      Array.isArray((body as { content: unknown }).content)
    ) {
      return NextResponse.json(
        { error: "content is required and must be an object" },
        { status: 400 }
      );
    }
    const out = { content: (body as { content: Record<string, unknown> }).content };
    const file = getDataFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(out, null, 2), "utf8");
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
