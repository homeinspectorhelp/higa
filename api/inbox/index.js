// Owner's Inbox API — serves files from the local owners-inbox/ directory.
//
// Endpoints:
//   GET                         — list all files (recursive, sorted newest-first by name)
//   GET ?file=<rel-path>        — return { name, content } for text/md files
//   GET ?file=<rel-path>&inline=1   — serve inline (PDF/HTML preview in browser)
//   GET ?file=<rel-path>&download=1 — force download

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INBOX_DIR = path.resolve(__dirname, "..", "..", "owners-inbox");

const CONTENT_TYPES = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  htm:  "text/html; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function contentTypeFor(name) {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

function isTextType(name) {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  return ["md", "txt", "csv", "json"].includes(ext);
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Walk a directory recursively, collecting file info.
function walkDir(dir, base = "") {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const e of entries) {
    const relPath = base ? `${base}/${e.name}` : e.name;
    const absPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...walkDir(absPath, relPath));
    } else if (e.isFile()) {
      const stat = fs.statSync(absPath);
      const ext = (e.name.split(".").pop() || "").toLowerCase();
      results.push({
        name: e.name,
        path: relPath,
        size: stat.size,
        sizeStr: fmtSize(stat.size),
        ext,
        dir: base || "/",
        top: base === "",              // filed directly in owners-inbox/ = a real deliverable
        mtimeMs: stat.mtimeMs,          // real recency, independent of filename
      });
    }
  }
  return results;
}

// Validate that the resolved path stays inside INBOX_DIR (prevent traversal).
function resolveSafe(relPath) {
  const abs = path.resolve(INBOX_DIR, relPath);
  if (!abs.startsWith(INBOX_DIR + path.sep) && abs !== INBOX_DIR) return null;
  return abs;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  // ── Serve a single file ──────────────────────────────────────────────────
  if (req.query.file) {
    const relPath = String(req.query.file);
    const absPath = resolveSafe(relPath);
    if (!absPath || !fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      return res.status(404).json({ error: "File not found" });
    }
    const basename = path.basename(absPath);
    const ct = contentTypeFor(basename);

    if (req.query.inline) {
      res.setHeader("Content-Type", ct);
      res.setHeader("Content-Disposition", `inline; filename="${basename}"`);
      return fs.createReadStream(absPath).pipe(res);
    }
    if (req.query.download) {
      res.setHeader("Content-Type", ct);
      res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
      return fs.createReadStream(absPath).pipe(res);
    }
    // JSON text view — for text/md/csv files
    if (isTextType(basename)) {
      const content = fs.readFileSync(absPath, "utf-8");
      return res.json({ name: basename, content });
    }
    // For binary files without inline/download flag — redirect to inline view
    res.setHeader("Content-Type", ct);
    res.setHeader("Content-Disposition", `inline; filename="${basename}"`);
    return fs.createReadStream(absPath).pipe(res);
  }

  // ── List all files, newest-modified first ────────────────────────────────
  const files = walkDir(INBOX_DIR).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return res.json({ files });
}
