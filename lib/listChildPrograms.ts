import fs from "node:fs/promises";

export type ChildProgramEntry = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

/**
 * `app/programs/_sites/<programId>/` 直下のディレクトリ名を programId とし、URL は `/programs/<programId>/`。
 * （存在しない programId はルート側で `default` にフォールバック）
 */
export async function listChildPrograms(
  sitesDir: string
): Promise<ChildProgramEntry[]> {
  const programs: ChildProgramEntry[] = [];
  let entries;
  try {
    entries = await fs.readdir(sitesDir, { withFileTypes: true });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return programs;
    }
    throw e;
  }
  const dirNames = entries
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  for (const dirName of dirNames) {
    const enc = encodeURIComponent(dirName);
    const isDefault = dirName === "default";
    programs.push({
      id: dirName,
      label: isDefault
        ? "ローカルデモ（app/programs/_sites/default）"
        : `${dirName}（/programs/${dirName}/）`,
      path: `/programs/${enc}/`,
      iframeTitle: isDefault ? "ローカルデモプログラム" : dirName,
    });
  }

  programs.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    return a.label.localeCompare(b.label, "ja");
  });
  return programs;
}
