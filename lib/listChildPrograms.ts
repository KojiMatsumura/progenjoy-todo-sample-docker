import fs from "node:fs/promises";

const PROGRAM_ID_FOLDER = /^[a-zA-Z0-9_-]+$/;

export type ChildProgramEntry = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

/**
 * `app/programs/<programId>/` 直下のディレクトリ名を programId とする（`_` 始まり・`.` 始まりは除外）。
 * URL は `/programs/<programId>`（末尾スラッシュなし）。
 */
export async function listChildPrograms(
  programsDir: string
): Promise<ChildProgramEntry[]> {
  const programs: ChildProgramEntry[] = [];
  let entries;
  try {
    entries = await fs.readdir(programsDir, { withFileTypes: true });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return programs;
    }
    throw e;
  }
  const dirNames = entries
    .filter(
      (d) =>
        d.isDirectory() &&
        !d.name.startsWith(".") &&
        !d.name.startsWith("_") &&
        PROGRAM_ID_FOLDER.test(d.name)
    )
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));

  for (const dirName of dirNames) {
    const enc = encodeURIComponent(dirName);
    programs.push({
      id: dirName,
      label: `${dirName}（/programs/${dirName}）`,
      path: `/programs/${enc}`,
      iframeTitle: dirName,
    });
  }

  programs.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  return programs;
}
