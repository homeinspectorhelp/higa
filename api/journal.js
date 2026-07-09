// Journal API — GET, POST, PUT (edit), PATCH (add comment), DELETE
// Journals live as markdown files in /journals/ in the The Inspector Playbook repo.
// Three journals: corporate, ken, beth.
//
// Mirrors the HIH journal handler (api/journal/index.js) so the The Inspector Playbook Journal
// tab behaves identically — GitHub-synced, edit/delete/comment — and updates
// made from the Philippines or the USA all read and write the same source of
// truth in homeinspectorhelp/higa. Difference vs HIH: this handler targets the
// The Inspector Playbook repo with GITHUB_TOKEN_HIGA and auto-creates a journal file on first
// write if it does not exist yet.

import { Octokit } from "@octokit/rest";

const REPO_OWNER = "homeinspectorhelp";
const REPO_NAME  = "higa";
const DEFAULT_BRANCH = "main";

const JOURNAL_FILES = {
  corporate: "journals/corporate-journal.md",
  ken:       "journals/ken-journal.md",
  beth:      "journals/beth-journal.md",
};

const JOURNAL_HEADERS = {
  corporate: "# Corporate Journal\n\nShared team journal — synced to GitHub, searchable by Max.\n",
  ken:       "# Ken's Journal\n\nKen's personal journal — synced to GitHub, searchable by Max.\n",
  beth:      "# Beth's Journal\n\nBeth's personal journal — synced to GitHub, searchable by Max.\n",
};

function parseEntries(markdown) {
  const blocks = markdown.split(/(?=\n## \d{4}-\d{2}-\d{2} — )/);
  const entries = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    const headerMatch = trimmed.match(/^## (\d{4}-\d{2}-\d{2}) — (.+)/);
    if (!headerMatch) continue;

    const [, date, title] = headerMatch;
    const rest = trimmed.slice(headerMatch[0].length).trim();
    const lines = rest.split("\n");

    let author = "";
    let category = "general";
    let status = "open";
    const contentLines = [];
    let pastMeta = false;

    for (const line of lines) {
      if (!pastMeta && /^\*\*Written by:\*\*/.test(line)) {
        author = line.replace(/^\*\*Written by:\*\*\s*/, "").trim();
      } else if (!pastMeta && /^\*\*Category:\*\*/.test(line)) {
        category = line.replace(/^\*\*Category:\*\*\s*/, "").trim().toLowerCase();
      } else if (!pastMeta && /^\*\*Status:\*\*/.test(line)) {
        status = line.replace(/^\*\*Status:\*\*\s*/, "").trim().toLowerCase();
      } else if (!pastMeta && line.trim() === "") {
        if (author || category !== "general") pastMeta = true;
      } else {
        contentLines.push(line);
      }
    }

    const fullContent = contentLines.join("\n").replace(/\n---\s*$/, "").trim();

    // Split body into: content, then attachments, then comments (in that order)
    // so content never accidentally swallows the attachments/comments blocks.
    const attachSplit = fullContent.split(/\n### Attachments\n/);
    const beforeAttach = attachSplit[0];
    const afterAttach = attachSplit[1] || "";

    // The Comments section may live in either half depending on whether an
    // Attachments section exists; resolve content + comments accordingly.
    let contentRaw, attachmentsRaw, commentsRaw;
    if (attachSplit.length > 1) {
      // Attachments present: comments (if any) follow attachments.
      contentRaw = beforeAttach;
      const ac = afterAttach.split(/\n### Comments\n/);
      attachmentsRaw = ac[0];
      commentsRaw = ac[1] || "";
    } else {
      // No attachments: split content from comments as before.
      const cc = beforeAttach.split(/\n### Comments\n/);
      contentRaw = cc[0];
      attachmentsRaw = "";
      commentsRaw = cc[1] || "";
    }

    const content = contentRaw.trim();

    const attachments = attachmentsRaw.trim()
      ? attachmentsRaw.trim().split("\n")
          .map(l => {
            const m = l.match(/^- \[(.*?)\]\((.*?)\)\s*$/);
            return m ? { name: m[1], path: m[2] } : null;
          })
          .filter(Boolean)
      : [];

    const comments = commentsRaw.trim()
      ? commentsRaw.trim().split("\n")
          .filter(l => l.startsWith("- **"))
          .map(l => {
            const m = l.match(/^- \*\*(.+?) \| (.+?):\*\*\s*(.*)/);
            return m ? { timestamp: m[1], author: m[2], text: m[3] } : null;
          })
          .filter(Boolean)
      : [];

    entries.push({ date, title, author, category, status, content, attachments, comments });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

function extractHeader(markdown) {
  const firstEntry = markdown.search(/\n## \d{4}-\d{2}-\d{2} — /);
  return firstEntry === -1 ? markdown : markdown.slice(0, firstEntry);
}

function buildBlock(entry) {
  const lines = [
    `## ${entry.date} — ${entry.title}`,
    ``,
    `**Written by:** ${entry.author || ""}`,
    `**Category:** ${entry.category || "general"}`,
    `**Status:** ${entry.status || "open"}`,
    ``,
    entry.content.trim(),
  ];

  if (entry.attachments && entry.attachments.length) {
    lines.push(``, `### Attachments`, ``);
    for (const a of entry.attachments) {
      lines.push(`- [${a.name}](${a.path})`);
    }
  }

  if (entry.comments && entry.comments.length) {
    lines.push(``, `### Comments`, ``);
    for (const c of entry.comments) {
      lines.push(`- **${c.timestamp} | ${c.author}:** ${c.text}`);
    }
  }

  lines.push(``, `---`);
  return lines.join("\n");
}

function reconstructFile(header, entries) {
  if (!entries.length) return header.trimEnd() + "\n";
  return header.trimEnd() + "\n\n" + entries.map(buildBlock).join("\n\n") + "\n";
}

// Read a file; if it does not exist yet, return an empty default (sha:null)
// so the journal works before any entries have been written.
async function readFile(octokit, filePath, journal) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path: filePath, ref: DEFAULT_BRANCH,
    });
    if (Array.isArray(data)) throw new Error("Path is a directory");
    return { markdown: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha };
  } catch (err) {
    if (err.status === 404) {
      return { markdown: JOURNAL_HEADERS[journal] || "# Journal\n", sha: null };
    }
    throw err;
  }
}

// Write a file; omit sha to create it, include sha to update it.
async function writeFile(octokit, filePath, content, sha, message) {
  const params = {
    owner: REPO_OWNER, repo: REPO_NAME, path: filePath, branch: DEFAULT_BRANCH,
    message, content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) params.sha = sha;
  await octokit.repos.createOrUpdateFileContents(params);
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "entry";
}

// Commit each attachment to a per-entry folder under journals/attachments/.
// `attachments` is [{ name, dataBase64 }] — dataBase64 is ALREADY base64, used
// as-is (no re-encoding). Returns [{ name, path }] for files committed OK.
// Best-effort: a single failing file is skipped, never failing the whole entry.
async function commitAttachments(octokit, journal, date, title, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  const valid = attachments.filter(a => a && a.name && a.dataBase64);
  if (!valid.length) return [];
  const rand = Math.random().toString(36).slice(2, 8);
  const folder = `journals/attachments/${date}__${slugify(title)}__${rand}`;

  // Git Data API (blob → tree → commit), NOT the Contents API: the Contents API
  // caps a single file at ~1 MB and was silently dropping larger PDFs. Blobs
  // handle binaries up to 100 MB; every attachment lands in ONE commit.
  const branchRef = `heads/${DEFAULT_BRANCH}`;
  const { data: refData } = await octokit.git.getRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: branchRef });
  const headSha = refData.object.sha;
  const { data: headCommit } = await octokit.git.getCommit({ owner: REPO_OWNER, repo: REPO_NAME, commit_sha: headSha });

  const treeItems = [];
  const committed = [];
  for (const att of valid) {
    const safeName = String(att.name).replace(/[^\w.\-]+/g, "_");
    const path = `${folder}/${safeName}`;
    try {
      const { data: blob } = await octokit.git.createBlob({
        owner: REPO_OWNER, repo: REPO_NAME, content: att.dataBase64, encoding: "base64",
      });
      treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
      committed.push({ name: att.name, path });
    } catch (err) {
      // skip this one file, keep going
    }
  }
  if (!treeItems.length) return [];

  const { data: newTree } = await octokit.git.createTree({
    owner: REPO_OWNER, repo: REPO_NAME, base_tree: headCommit.tree.sha, tree: treeItems,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner: REPO_OWNER, repo: REPO_NAME,
    message: `journal(${journal}): ${committed.length} attachment(s) — ${committed.map(c => c.name).join(", ")}`,
    tree: newTree.sha, parents: [headSha],
  });
  await octokit.git.updateRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: branchRef, sha: newCommit.sha });
  return committed;
}

const ATTACHMENT_CONTENT_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", pdf: "application/pdf", txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8",
  json: "application/json", zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.GITHUB_TOKEN_HIGA) return res.status(500).json({ error: "GITHUB_TOKEN_HIGA not configured" });

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN_HIGA });

  // ── Attachment download (GET ?attachment=<repo path>) ──────────────────────
  if (req.method === "GET" && req.query.attachment) {
    const path = String(req.query.attachment);
    if (!path.startsWith("journals/attachments/")) {
      return res.status(400).json({ error: "Invalid attachment path" });
    }
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path, ref: DEFAULT_BRANCH,
      });
      if (Array.isArray(data) || !data.content) {
        return res.status(404).json({ error: "Attachment not found" });
      }
      const buf = Buffer.from(data.content, "base64");
      const basename = path.split("/").pop();
      const ext = (basename.split(".").pop() || "").toLowerCase();
      const type = ATTACHMENT_CONTENT_TYPES[ext] || "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
      return res.status(200).send(buf);
    } catch (err) {
      const missing = err && (err.status === 404 || /not found/i.test(String(err.message)));
      if (missing) return res.status(404).json({ error: "Attachment not found" });
      return res.status(500).json({ error: err.message });
    }
  }

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { journal } = req.query;
    const filePath = JOURNAL_FILES[journal];
    if (!filePath) return res.status(400).json({ error: `Unknown journal: "${journal}"` });
    try {
      const { markdown } = await readFile(octokit, filePath, journal);
      return res.json({ journal, entries: parseEntries(markdown) });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── POST (create) ─────────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { journal, title, category = "general", status = "open", content, author = "Ken Compton", attachments = [] } = req.body || {};
    const filePath = JOURNAL_FILES[journal];
    if (!filePath) return res.status(400).json({ error: `Unknown journal: "${journal}"` });
    if (!title)    return res.status(400).json({ error: "title is required" });
    if (!content)  return res.status(400).json({ error: "content is required" });

    const date = new Date().toISOString().slice(0, 10);

    try {
      // Commit the uploaded files first, then reference them in the entry block.
      const committed = await commitAttachments(octokit, journal, date, title, attachments);
      const newBlock = "\n" + buildBlock({ date, title, category, status, author, content, attachments: committed, comments: [] });

      const { markdown, sha } = await readFile(octokit, filePath, journal);
      const firstEntry = markdown.search(/\n## \d{4}-\d{2}-\d{2} — /);
      const updated = firstEntry !== -1
        ? markdown.slice(0, firstEntry) + newBlock + "\n" + markdown.slice(firstEntry)
        : markdown.trimEnd() + "\n" + newBlock + "\n";

      await writeFile(octokit, filePath, updated, sha, `journal(${journal}): ${date} — ${title}`);
      return res.json({ ok: true, entry: { date, title, category, status, author, content: content.trim(), attachments: committed, comments: [] } });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── PUT (edit) ────────────────────────────────────────────────────────────
  if (req.method === "PUT") {
    const { journal, originalDate, originalTitle, title, category = "general", status = "open", content, author = "Ken Compton", attachments = [] } = req.body || {};
    const filePath = JOURNAL_FILES[journal];
    if (!filePath)       return res.status(400).json({ error: `Unknown journal: "${journal}"` });
    if (!originalTitle)  return res.status(400).json({ error: "originalTitle is required" });
    if (!title)          return res.status(400).json({ error: "title is required" });
    if (!content)        return res.status(400).json({ error: "content is required" });

    try {
      const { markdown, sha } = await readFile(octokit, filePath, journal);
      const header = extractHeader(markdown);
      const entries = parseEntries(markdown);

      const idx = entries.findIndex(e => e.date === originalDate && e.title === originalTitle);
      if (idx === -1) return res.status(404).json({ error: "Entry not found" });

      const date = entries[idx].date;
      const comments = entries[idx].comments || [];
      // Preserve existing attachments and append any newly uploaded ones.
      const existingAttachments = entries[idx].attachments || [];
      const newAttachments = await commitAttachments(octokit, journal, date, title, attachments);
      const mergedAttachments = existingAttachments.concat(newAttachments);
      entries[idx] = { date, title, category, status, author, content: content.trim(), attachments: mergedAttachments, comments };

      const updated = reconstructFile(header, entries);
      await writeFile(octokit, filePath, updated, sha, `journal(${journal}): edit — ${title}`);
      return res.json({ ok: true, entry: entries[idx] });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── PATCH (add comment) ───────────────────────────────────────────────────
  if (req.method === "PATCH") {
    const { journal, date, title, comment, author = "Ken Compton" } = req.body || {};
    const filePath = JOURNAL_FILES[journal];
    if (!filePath) return res.status(400).json({ error: `Unknown journal: "${journal}"` });
    if (!title)    return res.status(400).json({ error: "title is required" });
    if (!comment)  return res.status(400).json({ error: "comment is required" });

    try {
      const { markdown, sha } = await readFile(octokit, filePath, journal);
      const header = extractHeader(markdown);
      const entries = parseEntries(markdown);

      const idx = entries.findIndex(e => e.date === date && e.title === title);
      if (idx === -1) return res.status(404).json({ error: "Entry not found" });

      const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      entries[idx].comments = entries[idx].comments || [];
      entries[idx].comments.push({ timestamp, author, text: comment.trim() });

      const updated = reconstructFile(header, entries);
      await writeFile(octokit, filePath, updated, sha, `journal(${journal}): comment on — ${title}`);
      return res.json({ ok: true, comment: { timestamp, author, text: comment.trim() } });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    const { journal, date, title } = req.body || {};
    const filePath = JOURNAL_FILES[journal];
    if (!filePath) return res.status(400).json({ error: `Unknown journal: "${journal}"` });
    if (!title)    return res.status(400).json({ error: "title is required" });

    try {
      const { markdown, sha } = await readFile(octokit, filePath, journal);
      const header = extractHeader(markdown);
      const entries = parseEntries(markdown);

      const before = entries.length;
      const filtered = entries.filter(e => !(e.date === date && e.title === title));
      if (filtered.length === before) return res.status(404).json({ error: "Entry not found" });

      const updated = reconstructFile(header, filtered);
      await writeFile(octokit, filePath, updated, sha, `journal(${journal}): delete — ${title}`);
      return res.json({ ok: true, deleted: { date, title } });
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  return res.status(405).json({ error: "GET, POST, PUT, PATCH, or DELETE only" });
}
