import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DATA_FILE = process.env.DATA_FILE ?? "/workspace/data.json";

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
  if (req.url !== "/" && req.url !== "") {
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
  console.log(`runner-api ${PORT} DATA_FILE=${DATA_FILE}`);
});
