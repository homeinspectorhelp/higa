// Resources API — Shared Library for the The Inspector Playbook team.
// Lets Ken upload .md (and other) files that the whole team can read/download
// from the dashboard, with NO GitHub login for anyone.
//
// FILESYSTEM-BASED (no Octokit/GitHub). The The Inspector Playbook dashboard deploys with
// `git pull` (NOT `git reset --hard`), so untracked files under
// resources/shared/ SURVIVE reloads. This handler reads/writes the LOCAL
// filesystem only — durable enough for Max, with no redeploy-on-upload. Files
// live at REPO_ROOT/resources/shared/, which makes them readable by the
// on-server agent too.
//
// Endpoints:
//   GET                          — list files in resources/shared
//   GET ?file=<path>             — inline view (returns { name, content })
//   GET ?file=<path>&download=1  — download (Content-Disposition: attachment)
//   POST  { files:[{name,dataBase64}] } — upload
//   DELETE { path }              — delete a file

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");   // api/resources.js is one level under root
const SHARED_DIR = "resources/shared";
const ABS_DIR = path.join(REPO_ROOT, SHARED_DIR);

const CONTENT_TYPES = {
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8", json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", zip: "application/zip",
};

function contentTypeFor(name) {
  const ext = (String(name).split(".").pop() || "").toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

// Resolve a repo-relative path to an absolute path that is GUARANTEED to stay
// inside ABS_DIR (guards against `..` traversal). Returns null if it escapes.
function safeResolve(repoPath) {
  const abs = path.resolve(REPO_ROOT, repoPath);
  if (!abs.startsWith(path.resolve(ABS_DIR))) return null;
  return abs;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET ?file=<repo path> — view or download a single file ─────────────────
  if (req.method === "GET" && req.query.file) {
    const filePath = String(req.query.file);
    if (!filePath.startsWith(SHARED_DIR + "/")) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    const abs = safeResolve(filePath);
    if (!abs) return res.status(400).json({ error: "Invalid file path" });
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ error: "File not found" });
      }
      const buf = fs.readFileSync(abs);
      const basename = filePath.split("/").pop();

      if (req.query.download) {
        res.setHeader("Content-Type", contentTypeFor(basename));
        res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
        return res.status(200).send(buf);
      }
      // Inline view — these are text/markdown files; return UTF-8 text.
      return res.json({ name: basename, content: buf.toString("utf-8") });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET — list files in resources/shared ───────────────────────────────────
  if (req.method === "GET") {
    try {
      fs.mkdirSync(ABS_DIR, { recursive: true });
      const files = fs.readdirSync(ABS_DIR)
        .map(name => {
          try {
            const st = fs.statSync(path.join(ABS_DIR, name));
            if (!st.isFile()) return null;
            return { name, path: `${SHARED_DIR}/${name}`, size: st.size };
          } catch (e) { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      return res.json({ files });
    } catch (err) {
      return res.json({ files: [] }); // never throw on empty
    }
  }

  // ── POST — upload one or more files ────────────────────────────────────────
  if (req.method === "POST") {
    const { files } = req.body || {};
    if (!Array.isArray(files) || !files.length) {
      return res.status(400).json({ error: "files is required" });
    }
    try { fs.mkdirSync(ABS_DIR, { recursive: true }); } catch (e) { /* best-effort */ }
    const committed = [];
    for (const f of files) {
      if (!f || !f.name || !f.dataBase64) continue;
      const safeName = String(f.name).replace(/[^\w.\-]+/g, "_");
      try {
        fs.writeFileSync(path.join(ABS_DIR, safeName), Buffer.from(f.dataBase64, "base64"));
        committed.push({ name: safeName, path: `${SHARED_DIR}/${safeName}` });
      } catch (err) {
        // best-effort per file — skip this one, keep going
      }
    }
    return res.json({ ok: true, committed });
  }

  // ── DELETE — remove a file ─────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { path: filePath } = req.body || {};
    if (!filePath || !String(filePath).startsWith(SHARED_DIR + "/")) {
      return res.status(400).json({ error: "Invalid file path" });
    }
    const abs = safeResolve(String(filePath));
    if (!abs) return res.status(400).json({ error: "Invalid file path" });
    try {
      fs.rmSync(abs, { force: true });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "GET, POST, or DELETE only" });
}
