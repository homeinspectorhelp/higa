// api/tasks.js — Self-hosted task tracker for The Inspector Playbook (Max).
//
// Mirror of the HIH (Dean) task tracker, but stored in the `higa` repo using
// GITHUB_TOKEN_HIGA. Fully owned: no Google OAuth — just a DEAN_CALENDAR_SECRET
// header check and a JSON file in journals/tasks.json committed to GitHub.
//
// Endpoints (all require x-dean-secret: <DEAN_CALENDAR_SECRET>):
//   POST   /api/tasks/create       { title, date (YYYY-MM-DD), description?, owner?, priority?, attachments? }
//   GET    /api/tasks/upcoming     ?days=30
//   GET    /api/tasks/all
//   POST   /api/tasks/complete     { id }
//   DELETE /api/tasks/:id
//   GET    /api/tasks/attachment?path=journals/task-attachments/<id>/<file>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_OWNER = "homeinspectorhelp";
const REPO_NAME  = "higa";
const TASKS_PATH = "journals/tasks.json";
const LOCAL_PATH = path.join(__dirname, "..", TASKS_PATH);
const DEFAULT_BRANCH = "main";
const ATTACH_DIR = "journals/task-attachments";

function authed(req) {
  const secret = process.env.DEAN_CALENDAR_SECRET;
  return !!secret && req.headers["x-dean-secret"] === secret;
}

function getOctokit() {
  const token = process.env.GITHUB_TOKEN_HIGA || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN_HIGA not set");
  return new Octokit({ auth: token });
}

function genId() {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readTasks() {
  // Try local file first (fast path for the server process)
  try {
    if (fs.existsSync(LOCAL_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCAL_PATH, "utf-8"));
      return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [], sha: undefined };
    }
  } catch {}

  // Fall back to GitHub (first boot or after a deploy that doesn't keep the file)
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path: TASKS_PATH,
    });
    if (Array.isArray(data)) throw new Error("tasks.json path is a directory");
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    return { tasks: JSON.parse(raw).tasks || [], sha: data.sha };
  } catch (err) {
    if (err.status === 404) return { tasks: [], sha: undefined };
    throw err;
  }
}

async function writeTasks(tasks, sha) {
  const content = JSON.stringify({ tasks }, null, 2) + "\n";

  // Write locally first — instant availability for the running server process
  try {
    fs.mkdirSync(path.dirname(LOCAL_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_PATH, content, "utf-8");
  } catch (err) {
    console.error("tasks: local write failed:", err.message);
  }

  // Commit to GitHub for durability (the GitHub copy is the source of truth on
  // next cold-start)
  try {
    const octokit = getOctokit();
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER, repo: REPO_NAME,
      path: TASKS_PATH,
      message: "tasks: update task list [Playbook auto-commit]",
      content: Buffer.from(content, "utf-8").toString("base64"),
      ...(sha ? { sha } : {}),
    });
  } catch (err) {
    console.error("tasks: GitHub commit failed (local write succeeded):", err.message);
  }
}

function slim(t) {
  return {
    id:          t.id,
    ref:         t.ref        || "",
    title:       t.title,
    date:        t.date,
    description: t.description || "",
    owner:       t.owner    || "",
    priority:    t.priority || "normal",
    status:      t.status   || "TODO",
    blockedBy:   t.blockedBy || "",
    link:        t.link      || "",
    lastUpdate:  t.lastUpdate || t.createdAt || null,
    done:        !!t.done,
    doneAt:      t.doneAt   || null,
    attachments: Array.isArray(t.attachments) ? t.attachments : [],
  };
}

// Commit each uploaded file to journals/task-attachments/<taskId>/<name> via the
// Git Data API (blob → tree → commit) — handles binaries up to 100 MB in one
// commit, unlike the ~1 MB Contents API cap. `attachments` is [{ name, dataBase64 }].
async function commitTaskAttachments(octokit, taskId, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];
  const valid = attachments.filter((a) => a && a.name && a.dataBase64);
  if (!valid.length) return [];
  const folder = `${ATTACH_DIR}/${taskId}`;

  const branchRef = `heads/${DEFAULT_BRANCH}`;
  const { data: refData } = await octokit.git.getRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: branchRef });
  const headSha = refData.object.sha;
  const { data: headCommit } = await octokit.git.getCommit({ owner: REPO_OWNER, repo: REPO_NAME, commit_sha: headSha });

  const treeItems = [];
  const committed = [];
  for (const att of valid) {
    const safeName = String(att.name).replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
    const filePath = `${folder}/${safeName}`;
    try {
      const { data: blob } = await octokit.git.createBlob({
        owner: REPO_OWNER, repo: REPO_NAME, content: att.dataBase64, encoding: "base64",
      });
      treeItems.push({ path: filePath, mode: "100644", type: "blob", sha: blob.sha });
      committed.push({ name: att.name, path: filePath });
    } catch { /* skip this one file, keep going */ }
  }
  if (!treeItems.length) return [];

  const { data: newTree } = await octokit.git.createTree({
    owner: REPO_OWNER, repo: REPO_NAME, base_tree: headCommit.tree.sha, tree: treeItems,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner: REPO_OWNER, repo: REPO_NAME,
    message: `tasks: ${committed.length} attachment(s) for ${taskId} — ${committed.map((c) => c.name).join(", ")}`,
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

// GET /api/tasks/attachment?path=journals/task-attachments/<id>/<file>
export async function taskAttachmentHandler(req, res) {
  const p = String(req.query.path || req.query.attachment || "");
  if (!p.startsWith(ATTACH_DIR + "/") || p.includes("..")) {
    return res.status(400).json({ error: "invalid attachment path" });
  }
  try {
    const octokit = getOctokit();
    const { data } = await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: p, ref: DEFAULT_BRANCH });
    if (Array.isArray(data)) return res.status(404).json({ error: "attachment not found" });
    let b64 = data.content;
    if (!b64 && data.sha) {
      const { data: blob } = await octokit.git.getBlob({ owner: REPO_OWNER, repo: REPO_NAME, file_sha: data.sha });
      b64 = blob.content;
    }
    if (!b64) return res.status(404).json({ error: "attachment not found" });
    const buf = Buffer.from(b64, "base64");
    const basename = p.split("/").pop();
    const ext = (basename.split(".").pop() || "").toLowerCase();
    res.setHeader("Content-Type", ATTACHMENT_CONTENT_TYPES[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
    return res.status(200).send(buf);
  } catch (err) {
    const missing = err && (err.status === 404 || /not found/i.test(String(err.message)));
    return res.status(missing ? 404 : 500).json({ error: missing ? "attachment not found" : err.message });
  }
}

// POST /api/tasks/create
export async function createTaskHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  const {
    title, date, description = "", owner = "", priority = "normal",
    ref = "", status = "TODO", blockedBy = "", link = "", attachments,
  } = req.body || {};
  if (!title || !date) return res.status(400).json({ error: "title and date (YYYY-MM-DD) required" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  try {
    const id = genId();
    let saved = [];
    if (Array.isArray(attachments) && attachments.length) {
      try { saved = await commitTaskAttachments(getOctokit(), id, attachments); }
      catch (err) { console.error("tasks: attachment commit failed:", err.message); }
    }
    const now = new Date().toISOString();
    const { tasks, sha } = await readTasks();
    const isDone = status.toUpperCase() === "DONE";
    const task = {
      id, ref, title, date, description, owner, priority,
      status: status.toUpperCase(), blockedBy, link,
      done: isDone, doneAt: isDone ? now : null,
      attachments: saved, createdAt: now, lastUpdate: now,
    };
    tasks.push(task);
    await writeTasks(tasks, sha);
    res.status(200).json({ created: true, task: slim(task) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/tasks-ui/update  { id, title?, date?, description?, owner?, priority?, ref?, status?, blockedBy?, link? }
export async function updateTaskHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  const { id, ...fields } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date))
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  try {
    const { tasks, sha } = await readTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: "task not found" });
    const now = new Date().toISOString();
    const allowed = ["title","date","description","owner","priority","ref","status","blockedBy","link"];
    for (const key of allowed) {
      if (fields[key] !== undefined) task[key] = key === "status" ? String(fields[key]).toUpperCase() : fields[key];
    }
    if (task.status === "DONE" && !task.done) { task.done = true; task.doneAt = now; }
    task.lastUpdate = now;
    await writeTasks(tasks, sha);
    res.status(200).json({ updated: true, task: slim(task) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// GET /api/tasks/upcoming?days=30
export async function upcomingTasksHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  try {
    const days = Math.min(365, Number(req.query.days) || 30);
    const { tasks } = await readTasks();
    const today  = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const upcoming = tasks
      .filter(t => !t.done && t.date >= today && t.date <= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    res.status(200).json({ count: upcoming.length, events: upcoming.map(slim) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// GET /api/tasks/all
export async function allTasksHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  try {
    const { tasks } = await readTasks();
    const sorted = [...tasks].sort((a, b) => a.date.localeCompare(b.date));
    res.status(200).json({ count: tasks.length, tasks: sorted.map(slim) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// POST /api/tasks/complete  { id }
export async function completeTaskHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: "id required" });
  try {
    const { tasks, sha } = await readTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: "task not found" });
    task.done  = true;
    task.doneAt = new Date().toISOString();
    if (!task.title.startsWith("✅")) task.title = `✅ ${task.title}`;
    await writeTasks(tasks, sha);
    res.status(200).json({ completed: true, task: slim(task) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}

// DELETE /api/tasks/:id
export async function deleteTaskHandler(req, res) {
  if (!authed(req)) return res.status(401).json({ error: "bad secret" });
  const { id } = req.params;
  try {
    const { tasks, sha } = await readTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ error: "task not found" });
    const [removed] = tasks.splice(idx, 1);
    await writeTasks(tasks, sha);
    res.status(200).json({ deleted: true, task: slim(removed) });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
