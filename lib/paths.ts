import path from "node:path";

const PROGRAM_ID_SAFE = /^[a-zA-Z0-9_-]+$/;

export function isValidProgramIdForData(id: string): boolean {
  return PROGRAM_ID_SAFE.test(id);
}

/**
 * 子プログラムごとの永続化先: `data/<programId>/data.json`（または DATA_DIR 配下）
 */
export function getProgramDataFilePath(programId: string): string {
  if (!isValidProgramIdForData(programId)) {
    throw new Error("invalid programId");
  }
  const root = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(root, programId, "data.json");
}

/** @deprecated 旧単一ファイル。互換が必要な場合のみ */
export function getDataFilePath(): string {
  return process.env.DATA_FILE ?? path.join(process.cwd(), "data.json");
}

/** Next の子プログラムルート: `app/programs/<programId>/` */
export function getProgramsAppDir(): string {
  return path.join(process.cwd(), "app", "programs");
}

/**
 * オプションの静的ファイル束ね置き場（例: 純 HTML バンドル）。
 * 既定はリポジトリ直下の `program-sites/`（無ければ静的 route は 404）。
 * `PROGRAM_SITES_DIR` / `CHILDREN_DIR` で上書き可。
 */
export function getProgramSitesDir(): string {
  return (
    process.env.PROGRAM_SITES_DIR ??
    process.env.CHILDREN_DIR ??
    path.join(process.cwd(), "program-sites")
  );
}

/** @deprecated 互換のため。getProgramSitesDir と同じ */
export function getChildrenDir(): string {
  return getProgramSitesDir();
}
