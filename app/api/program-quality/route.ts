import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

const PROGRAM_ID_SAFE = /^[a-zA-Z0-9_-]+$/;

const MAX_OUT_CHARS = 48_000;

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…（省略、全長 " + s.length + " 文字）";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 表示中の子プログラムのソースルート（Next アプリ優先、無ければ _sites）。
 * パストラバーサル防止のため programId は英数字・ハイフン・アンダースコアのみ。
 */
async function resolveProgramSourceRoot(
  programId: string,
  cwd: string
): Promise<string | null> {
  if (!PROGRAM_ID_SAFE.test(programId)) return null;
  const programs = path.join(cwd, "app", "programs");
  const nextApp = path.join(programs, programId);
  const siteDir = path.join(programs, "_sites", programId);

  const hasNextPage = await pathExists(path.join(nextApp, "page.tsx"));
  const hasNextLayout = await pathExists(path.join(nextApp, "layout.tsx"));
  if (hasNextPage || hasNextLayout) {
    return nextApp;
  }
  try {
    const st = await fs.stat(siteDir);
    if (st.isDirectory()) return siteDir;
  } catch {
    /* empty */
  }
  return null;
}

type QualityToolName = "eslint" | "prettier";

type QualityToolResult = {
  tool: QualityToolName;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  killed?: boolean;
  signal?: string;
};

async function runQualityTool(
  npx: string,
  args: string[],
  cwd: string,
  tool: QualityToolName,
  timeoutMs: number,
  maxBuffer: number,
  env: NodeJS.ProcessEnv
): Promise<QualityToolResult> {
  try {
    const { stdout, stderr } = await execFileAsync(npx, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer,
      env,
    });
    return {
      tool,
      ok: true,
      exitCode: 0,
      stdout: trunc(String(stdout), MAX_OUT_CHARS),
      stderr: trunc(String(stderr), MAX_OUT_CHARS),
    };
  } catch (e: unknown) {
    const err = e as {
      code?: string | number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      killed?: boolean;
      signal?: string;
    };
    const exitCode =
      typeof err.code === "number"
        ? err.code
        : err.code === "ETIMEDOUT"
          ? 124
          : 1;
    return {
      tool,
      ok: false,
      exitCode,
      stdout: trunc(String(err.stdout ?? ""), MAX_OUT_CHARS),
      stderr: trunc(String(err.stderr ?? ""), MAX_OUT_CHARS),
      killed: err.killed === true,
      signal: err.signal,
    };
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const o = body as { programId?: unknown };
  const programId =
    typeof o.programId === "string" ? o.programId.trim() : "";
  if (!PROGRAM_ID_SAFE.test(programId)) {
    return NextResponse.json({ error: "invalid_program_id" }, { status: 400 });
  }

  const cwd = process.cwd();
  const root = await resolveProgramSourceRoot(programId, cwd);
  if (!root) {
    return NextResponse.json({ error: "program_not_found" }, { status: 404 });
  }
  const rel = path.relative(cwd, root);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const timeoutMs = 120_000;
  const maxBuffer = 20 * 1024 * 1024;
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    CI: "1",
  };

  const eslint = await runQualityTool(
    npx,
    ["eslint", rel, "--ext", ".ts,.tsx,.js,.jsx,.mjs,.cjs"],
    cwd,
    "eslint",
    timeoutMs,
    maxBuffer,
    env
  );

  const prettier = await runQualityTool(
    npx,
    ["prettier", "--check", rel],
    cwd,
    "prettier",
    timeoutMs,
    maxBuffer,
    env
  );

  const ok = eslint.ok && prettier.ok;
  const summaryParts: string[] = [];
  summaryParts.push(
    "ESLint=" + (eslint.ok ? "成功" : "失敗（exit " + String(eslint.exitCode) + "）")
  );
  summaryParts.push(
    "Prettier=" +
      (prettier.ok ? "成功" : "失敗（exit " + String(prettier.exitCode) + "）")
  );

  return NextResponse.json({
    ok,
    programId,
    sourcePath: rel,
    summary: summaryParts.join(" / "),
    eslint,
    prettier,
  });
}
