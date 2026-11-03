/*
 * 本地学习服务：静态资源 + SQLite 键值存储
 * 使用 Node 内置 node:sqlite（Node 22.5+），无需 npm 安装依赖
 * 启动：node server.js  然后访问 http://127.0.0.1:8765/
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8765;
const DB_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DB_DIR, "study.db");
const INDEX = "计算机地图制图思维导图.html";
const MAX_BODY = 8 * 1024 * 1024; // 单次写入上限 8MB，防止异常请求占满内存

fs.mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let chunks = [];
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* ---------- 存储接口 ---------- */
async function handleStore(req, res, key) {
  if (!key) return sendJSON(res, 400, { error: "缺少存储键" });

  if (req.method === "GET") {
    const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
    // 没有记录时返回 null，前端据此判断是否需要把本地旧数据迁移过来
    return sendJSON(res, 200, row ? JSON.parse(row.value) : null);
  }

  if (req.method === "PUT") {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (e) {
      return sendJSON(res, 400, { error: "请求体不是有效的 JSON" });
    }
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(parsed), now);
    return sendJSON(res, 200, { ok: true, updatedAt: now });
  }

  if (req.method === "DELETE") {
    db.prepare("DELETE FROM kv WHERE key = ?").run(key);
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 405, { error: "不支持的方法" });
}

/* ---------- 静态资源 ---------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/" + INDEX;

  // 规范化路径并限制在 ROOT 内，避免 ../ 越权读取
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep) && full !== path.join(ROOT, INDEX)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = url.pathname;

  try {
    if (pathname === "/api/health") {
      return sendJSON(res, 200, { ok: true, db: DB_FILE });
    }
    if (pathname.startsWith("/api/store/")) {
      return await handleStore(req, res, decodeURIComponent(pathname.slice("/api/store/".length)));
    }
    if (pathname.startsWith("/api/")) {
      return sendJSON(res, 404, { error: "接口不存在" });
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    sendJSON(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`学习平台已启动：http://127.0.0.1:${PORT}/`);
  console.log(`数据库文件：${DB_FILE}`);
});
