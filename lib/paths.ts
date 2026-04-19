import path from "node:path";

export function getDataFilePath(): string {
  return process.env.DATA_FILE ?? path.join(process.cwd(), "data.json");
}

export function getChildrenDir(): string {
  return (
    process.env.CHILDREN_DIR ?? path.join(process.cwd(), "public", "children")
  );
}

export function getDefaultProgramsProductId(): string {
  return process.env.DEFAULT_PROGRAMS_PRODUCT_ID ?? "local-demo";
}
