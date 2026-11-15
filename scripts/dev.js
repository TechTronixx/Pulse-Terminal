// scripts/dev.js -- local dev server: static files + the /api/news function.
// Usage: node scripts/dev.js [port]   (default 4173)
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const newsHandler = require("../api/news.js");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2]) || 4173;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/news") return newsHandler(req, res);
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/Terminal-main.html";
    const file = path.resolve(ROOT, "." + rel);
    if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}.git`)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
      res.end(data);
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Pulse Terminal on http://127.0.0.1:${PORT}`));
