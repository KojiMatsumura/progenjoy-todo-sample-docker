import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_FILE = process.env.DATA_FILE ?? "/workspace/data.json";
const CHILDREN_DIR = process.env.CHILDREN_DIR ?? "/workspace/children";
const DEFAULT_PROGRAMS_PRODUCT_ID =
  process.env.DEFAULT_PROGRAMS_PRODUCT_ID ?? "local-demo";

function requestPathname(reqUrl) {
  try {
    return new URL(reqUrl, "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

/**
 * children 直下のディレクトリを走査し、ランナー用の iframe URL 一覧を返す。
 * _default は /programs/<DEFAULT_PROGRAMS_PRODUCT_ID>/ 、それ以外は /program/<名>/ 。
 */
async function listChildPrograms() {
  const programs = [];
  let entries;
  try {
    entries = await fs.readdir(CHILDREN_DIR, { withFileTypes: true });
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
        path: `/programs/${DEFAULT_PROGRAMS_PRODUCT_ID}/`,
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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    );
    req.on("error", reject);
  });
}

async function readStore() {
  try {
    const txt = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(txt);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return { content: {} };
    }
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = requestPathname(req.url ?? "/");

  if (pathname === "/child-programs") {
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" });
      res.end();
      return;
    }
    try {
      const programs = await listChildPrograms();
      sendJson(res, 200, { programs });
    } catch (e) {
      console.error(e);
      sendJson(res, 500, { error: "server_error" });
    }
    return;
  }

  if (pathname !== "/" && pathname !== "") {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    if (req.method === "GET") {
      const data = await readStore();
      sendJson(res, 200, data);
      return;
    }

    if (req.method === "PUT") {
      let raw;
      try {
        raw = await readBody(req);
      } catch {
        sendJson(res, 400, { error: "read body failed" });
        return;
      }
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        sendJson(res, 400, { error: "Invalid JSON" });
        return;
      }
      if (
        typeof body.content !== "object" ||
        body.content === null ||
        Array.isArray(body.content)
      ) {
        sendJson(res, 400, {
          error: "content is required and must be an object",
        });
        return;
      }
      const out = { content: body.content };
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(out, null, 2), "utf8");
      sendJson(res, 200, out);
      return;
    }

    res.writeHead(405, { Allow: "GET, PUT" });
    res.end();
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: "server_error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `runner-api ${PORT} DATA_FILE=${DATA_FILE} CHILDREN_DIR=${CHILDREN_DIR}`
  );
});
