import fs from "node:fs/promises";

export type ChildProgramEntry = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

/**
 * `app/programs/_sites/<programId>/` 直下のディレクトリ名を programId とし、URL は `/programs/<programId>/`。
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
    programs.push({
      id: dirName,
      label: `${dirName}（/programs/${dirName}/）`,
      path: `/programs/${enc}/`,
      iframeTitle: dirName,
    });
  }

  programs.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return programs;
}
