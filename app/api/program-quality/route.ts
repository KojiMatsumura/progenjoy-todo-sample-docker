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

type AssetsValidationResult = {
  ok: boolean;
  checkedFiles: number;
  invalidFiles: string[];
  allowedSuffixes: string[];
  errorMessage: string | null;
};

type NonAssetsValidationResult = {
  ok: boolean;
  checkedFiles: number;
  invalidFiles: string[];
  allowedSuffixes: string[];
  dockerfileAllowed: boolean;
  errorMessage: string | null;
};

type MagicBytesValidationResult = {
  ok: boolean;
  checkedFiles: number;
  skippedFiles: number;
  invalidFiles: Array<{
    path: string;
    expected: string;
    actual: string;
  }>;
  errorMessage: string | null;
};

type SizeValidationResult = {
  ok: boolean;
  totalBytes: number;
  limitBytes: number;
  errorMessage: string | null;
};

const ASSET_ALLOWED_SUFFIXES = [
  ".jpeg",
  ".jpg",
  ".png",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
  ".json",
  ".css",
  ".scss",
] as const;

const ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST = [...ASSET_ALLOWED_SUFFIXES].sort(
  (a, b) => b.length - a.length
);

const NON_ASSETS_ALLOWED_SUFFIXES = [
  ".eslintignore",
  ".dockerignore",
  ".webmanifest",
  ".env.local",
  ".prettierrc",
  ".gitignore",
  ".eslintrc",
  ".d.ts",
  ".html",
  ".scss",
  ".yaml",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".map",
  ".css",
  ".yml",
  ".ts",
  ".js",
  ".md",
  ".env",
  ".vite",
  ".next",
  ".json",
] as const;

const NON_ASSETS_ALLOWED_SUFFIXES_LONGEST_FIRST = [
  ...NON_ASSETS_ALLOWED_SUFFIXES,
].sort((a, b) => b.length - a.length);

const PROGRAM_TOTAL_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const ASSETS_TOTAL_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

const MAGIC_TARGET_SUFFIXES = [
  ".woff2",
  ".woff",
  ".jpeg",
  ".webp",
  ".webm",
  ".json",
  ".next",
  ".vite",
  ".html",
  ".scss",
  ".yaml",
  ".tsx",
  ".jsx",
  ".mjs",
  ".cjs",
  ".map",
  ".css",
  ".yml",
  ".jpg",
  ".png",
  ".gif",
  ".ico",
  ".mp4",
  ".mp3",
  ".wav",
  ".d.ts",
  ".ts",
  ".js",
  ".md",
  ".env",
] as const;

function isAllowedAssetPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const suffix of ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST) {
    if (lower.endsWith(suffix)) return true;
  }
  return false;
}

function isAllowedNonAssetsPath(filePath: string): boolean {
  const base = path.basename(filePath);
  if (base.toLowerCase() === "dockerfile") return true;
  const lower = filePath.toLowerCase();
  for (const suffix of NON_ASSETS_ALLOWED_SUFFIXES_LONGEST_FIRST) {
    if (lower.endsWith(suffix)) return true;
  }
  return false;
}

function hexPrefix(buf: Buffer, len = 16): string {
  return buf.subarray(0, len).toString("hex");
}

function startsWithBytes(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[i] !== bytes[i]) return false;
  }
  return true;
}

function hasAsciiAt(buf: Buffer, offset: number, ascii: string): boolean {
  const end = offset + ascii.length;
  if (buf.length < end) return false;
  return buf.subarray(offset, end).toString("ascii") === ascii;
}

function detectMatchingMagicSuffix(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  const sorted = [...MAGIC_TARGET_SUFFIXES].sort((a, b) => b.length - a.length);
  for (const suffix of sorted) {
    if (lower.endsWith(suffix)) return suffix;
  }
  return null;
}

function checkMagicBySuffix(buf: Buffer, suffix: string): boolean | null {
  switch (suffix) {
    case ".jpg":
    case ".jpeg":
      return startsWithBytes(buf, [0xff, 0xd8, 0xff]);
    case ".png":
      return startsWithBytes(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".gif":
      return hasAsciiAt(buf, 0, "GIF87a") || hasAsciiAt(buf, 0, "GIF89a");
    case ".webp":
      return hasAsciiAt(buf, 0, "RIFF") && hasAsciiAt(buf, 8, "WEBP");
    case ".ico":
      return startsWithBytes(buf, [0x00, 0x00, 0x01, 0x00]);
    case ".wav":
      return hasAsciiAt(buf, 0, "RIFF") && hasAsciiAt(buf, 8, "WAVE");
    case ".webm":
      return startsWithBytes(buf, [0x1a, 0x45, 0xdf, 0xa3]);
    case ".mp4":
      return hasAsciiAt(buf, 4, "ftyp");
    case ".mp3":
      return (
        hasAsciiAt(buf, 0, "ID3") ||
        (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
      );
    case ".woff":
      return hasAsciiAt(buf, 0, "wOFF");
    case ".woff2":
      return hasAsciiAt(buf, 0, "wOF2");
    default:
      return null;
  }
}

async function listAllFilesRecursively(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listAllFilesRecursively(full)));
      continue;
    }
    if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function validateAssetsSuffixes(
  root: string,
  cwd: string
): Promise<AssetsValidationResult> {
  const assetsDir = path.join(root, "assets");
  if (!(await pathExists(assetsDir))) {
    return {
      ok: true,
      checkedFiles: 0,
      invalidFiles: [],
      allowedSuffixes: [...ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST],
      errorMessage: null,
    };
  }
  const st = await fs.stat(assetsDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    return {
      ok: true,
      checkedFiles: 0,
      invalidFiles: [],
      allowedSuffixes: [...ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST],
      errorMessage: null,
    };
  }

  const files = await listAllFilesRecursively(assetsDir);
  const invalidFiles = files
    .filter((f) => !isAllowedAssetPath(f))
    .map((f) => path.relative(cwd, f));

  const allowedText = ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST.join(" ");
  return {
    ok: invalidFiles.length === 0,
    checkedFiles: files.length,
    invalidFiles,
    allowedSuffixes: [...ASSET_ALLOWED_SUFFIXES_LONGEST_FIRST],
    errorMessage:
      invalidFiles.length === 0
        ? null
        : "assetsに許可されているファイルの拡張子の一覧: " + allowedText,
  };
}

async function validateNonAssetsSuffixes(
  root: string,
  cwd: string
): Promise<NonAssetsValidationResult> {
  const allFiles = await listAllFilesRecursively(root);
  const files = allFiles.filter((abs) => {
    const rel = path.relative(root, abs);
    return !rel.startsWith("assets" + path.sep);
  });
  const invalidFiles = files
    .filter((f) => !isAllowedNonAssetsPath(f))
    .map((f) => path.relative(cwd, f));
  const allowedText = NON_ASSETS_ALLOWED_SUFFIXES_LONGEST_FIRST.join(" ");

  return {
    ok: invalidFiles.length === 0,
    checkedFiles: files.length,
    invalidFiles,
    allowedSuffixes: [...NON_ASSETS_ALLOWED_SUFFIXES_LONGEST_FIRST],
    dockerfileAllowed: true,
    errorMessage:
      invalidFiles.length === 0
        ? null
        : "assets/ 配下以外で許可されるのは Dockerfile（大文字小文字無視）または次の拡張子のみ: " +
          allowedText,
  };
}

async function validateMagicBytes(
  root: string,
  cwd: string
): Promise<MagicBytesValidationResult> {
  const files = await listAllFilesRecursively(root);
  const invalidFiles: Array<{ path: string; expected: string; actual: string }> =
    [];
  let checkedFiles = 0;
  let skippedFiles = 0;

  for (const abs of files) {
    const suffix = detectMatchingMagicSuffix(abs);
    if (!suffix) {
      skippedFiles++;
      continue;
    }
    const fh = await fs.open(abs, "r");
    try {
      const buf = Buffer.alloc(64);
      const read = await fh.read(buf, 0, buf.length, 0);
      const body = buf.subarray(0, read.bytesRead);
      const result = checkMagicBySuffix(body, suffix);
      if (result === null) {
        skippedFiles++;
        continue;
      }
      checkedFiles++;
      if (!result) {
        invalidFiles.push({
          path: path.relative(cwd, abs),
          expected: suffix,
          actual: hexPrefix(body, 16),
        });
      }
    } finally {
      await fh.close();
    }
  }

  return {
    ok: invalidFiles.length === 0,
    checkedFiles,
    skippedFiles,
    invalidFiles,
    errorMessage:
      invalidFiles.length === 0
        ? null
        : "拡張子とマジックバイトが一致しないファイルがあります",
  };
}

async function validateTotalProgramSize(root: string): Promise<SizeValidationResult> {
  const files = await listAllFilesRecursively(root);
  let totalBytes = 0;
  for (const abs of files) {
    const st = await fs.stat(abs);
    totalBytes += st.size;
  }
  return {
    ok: totalBytes <= PROGRAM_TOTAL_SIZE_LIMIT_BYTES,
    totalBytes,
    limitBytes: PROGRAM_TOTAL_SIZE_LIMIT_BYTES,
    errorMessage:
      totalBytes <= PROGRAM_TOTAL_SIZE_LIMIT_BYTES
        ? null
        : "プログラム全体の合計容量が上限（100MB）を超えています",
  };
}

async function validateAssetsTotalSize(root: string): Promise<SizeValidationResult> {
  const assetsDir = path.join(root, "assets");
  if (!(await pathExists(assetsDir))) {
    return {
      ok: true,
      totalBytes: 0,
      limitBytes: ASSETS_TOTAL_SIZE_LIMIT_BYTES,
      errorMessage: null,
    };
  }
  const st = await fs.stat(assetsDir).catch(() => null);
  if (!st || !st.isDirectory()) {
    return {
      ok: true,
      totalBytes: 0,
      limitBytes: ASSETS_TOTAL_SIZE_LIMIT_BYTES,
      errorMessage: null,
    };
  }
  const files = await listAllFilesRecursively(assetsDir);
  let totalBytes = 0;
  for (const abs of files) {
    const fst = await fs.stat(abs);
    totalBytes += fst.size;
  }
  return {
    ok: totalBytes <= ASSETS_TOTAL_SIZE_LIMIT_BYTES,
    totalBytes,
    limitBytes: ASSETS_TOTAL_SIZE_LIMIT_BYTES,
    errorMessage:
      totalBytes <= ASSETS_TOTAL_SIZE_LIMIT_BYTES
        ? null
        : "assets/ 配下ファイルの合計容量が上限（10MB）を超えています",
  };
}

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

  const assetsValidation = await validateAssetsSuffixes(root, cwd);
  const nonAssetsValidation = await validateNonAssetsSuffixes(root, cwd);
  const magicBytesValidation = await validateMagicBytes(root, cwd);
  const totalProgramSizeValidation = await validateTotalProgramSize(root);
  const assetsTotalSizeValidation = await validateAssetsTotalSize(root);

  const ok =
    eslint.ok &&
    prettier.ok &&
    assetsValidation.ok &&
    nonAssetsValidation.ok &&
    magicBytesValidation.ok &&
    totalProgramSizeValidation.ok &&
    assetsTotalSizeValidation.ok;
  const summaryParts: string[] = [];
  summaryParts.push(
    "ESLint=" + (eslint.ok ? "成功" : "失敗（exit " + String(eslint.exitCode) + "）")
  );
  summaryParts.push(
    "Prettier=" +
      (prettier.ok ? "成功" : "失敗（exit " + String(prettier.exitCode) + "）")
  );
  summaryParts.push(
    assetsValidation.ok
      ? "assets拡張子=成功"
      : "assets拡張子=失敗（" +
          String(assetsValidation.invalidFiles.length) +
          "件） " +
          (assetsValidation.errorMessage ?? "")
  );
  summaryParts.push(
    nonAssetsValidation.ok
      ? "assets外拡張子=成功"
      : "assets外拡張子=失敗（" +
          String(nonAssetsValidation.invalidFiles.length) +
          "件） " +
          (nonAssetsValidation.errorMessage ?? "")
  );
  summaryParts.push(
    magicBytesValidation.ok
      ? "マジックバイト=成功"
      : "マジックバイト=失敗（" +
          String(magicBytesValidation.invalidFiles.length) +
          "件） " +
          (magicBytesValidation.errorMessage ?? "")
  );
  summaryParts.push(
    totalProgramSizeValidation.ok
      ? "全体容量=成功"
      : "全体容量=失敗（" +
          String(totalProgramSizeValidation.totalBytes) +
          " bytes / 104857600 bytes） " +
          (totalProgramSizeValidation.errorMessage ?? "")
  );
  summaryParts.push(
    assetsTotalSizeValidation.ok
      ? "assets容量=成功"
      : "assets容量=失敗（" +
          String(assetsTotalSizeValidation.totalBytes) +
          " bytes / 10485760 bytes） " +
          (assetsTotalSizeValidation.errorMessage ?? "")
  );

  return NextResponse.json({
    ok,
    programId,
    sourcePath: rel,
    summary: summaryParts.join(" / "),
    eslint,
    prettier,
    assetsValidation,
    nonAssetsValidation,
    magicBytesValidation,
    totalProgramSizeValidation,
    assetsTotalSizeValidation,
  });
}
