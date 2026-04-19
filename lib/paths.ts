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

/**
 * ユーザー作成プログラム（iframe 子）の置き場。
 * `app/programs/_sites/<programId>/`（`_` 始まりは Next のルート対象外）
 */
export function getProgramSitesDir(): string {
  return (
    process.env.PROGRAM_SITES_DIR ??
    process.env.CHILDREN_DIR ??
    path.join(process.cwd(), "app", "programs", "_sites")
  );
}

/** @deprecated 互換のため。getProgramSitesDir と同じ */
export function getChildrenDir(): string {
  return getProgramSitesDir();
}
