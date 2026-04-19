import path from "node:path";

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
