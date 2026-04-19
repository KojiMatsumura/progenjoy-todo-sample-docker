import fs from "node:fs/promises";

export type ChildProgramEntry = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

export async function listChildPrograms(
  childrenDir: string,
  defaultProgramsProductId: string
): Promise<ChildProgramEntry[]> {
  const programs: ChildProgramEntry[] = [];
  let entries;
  try {
    entries = await fs.readdir(childrenDir, { withFileTypes: true });
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
    if (dirName === "_default") {
      programs.push({
        id: "default",
        label: "ローカルデモ (_default)",
        path: `/programs/${defaultProgramsProductId}/`,
        iframeTitle: "ローカルデモプログラム",
      });
      continue;
    }
    const enc = encodeURIComponent(dirName);
    programs.push({
      id: dirName,
      label: `${dirName} (/program/${dirName}/)`,
      path: `/program/${enc}/`,
      iframeTitle: dirName,
    });
  }

  programs.sort((a, b) => {
    if (a.id === "default") return -1;
    if (b.id === "default") return 1;
    return a.label.localeCompare(b.label, "ja");
  });
  return programs;
}
