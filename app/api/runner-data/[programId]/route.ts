import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getProgramDataFilePath,
  isValidProgramIdForData,
} from "@/lib/paths";

/** `data/` や `data/<programId>/` が無くても `data.json` 用のディレクトリを作成する */
async function ensureProgramDataFileParent(programId: string): Promise<string> {
  const file = getProgramDataFilePath(programId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  return file;
}

async function readStore(programId: string) {
  const file = await ensureProgramDataFileParent(programId);
  try {
    const txt = await fs.readFile(file, "utf8");
    if (txt.trim() === "") {
      return { content: {} };
    }
    const parsed = JSON.parse(txt) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "content" in (parsed as object)
    ) {
      const c = (parsed as { content: unknown }).content;
      if (
        c === null ||
        (typeof c === "object" && !Array.isArray(c))
      ) {
        return parsed as { content: Record<string, unknown> | null };
      }
    }
    /* レガシー: ルートがそのままユーザー JSON のときは content で包む（todo-app は data.content を参照） */
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { content: parsed as Record<string, unknown> };
    }
    return { content: {} };
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return { content: {} };
    }
    throw e;
  }
}

export async function GET(
  _req: Request,
  segment: { params: Promise<{ programId: string }> }
) {
  const { programId } = await segment.params;
  if (!isValidProgramIdForData(programId)) {
    return NextResponse.json({ error: "invalid programId" }, { status: 400 });
  }
  try {
    const data = await readStore(programId);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  segment: { params: Promise<{ programId: string }> }
) {
  const { programId } = await segment.params;
  if (!isValidProgramIdForData(programId)) {
    return NextResponse.json({ error: "invalid programId" }, { status: 400 });
  }
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
    const out = {
      content: (body as { content: Record<string, unknown> }).content,
    };
    const file = await ensureProgramDataFileParent(programId);
    await fs.writeFile(file, JSON.stringify(out, null, 2), "utf8");
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
