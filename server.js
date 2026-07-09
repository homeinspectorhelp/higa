// server.js — standalone Node server for the The Inspector Playbook dashboard + Max Pro.
//
// One always-on process (Rose Hosting, kept running by PM2) that does two
// jobs: it serves the dashboard/ frontend and routes the /api endpoints to
// their handlers. Each api/*.js file exports a single (req, res) handler.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import crypto from "node:crypto";
import express from "express";

import chatHandler from "./api/max-pro/chat.js";
import xlsxToMdHandler from "./api/xlsx-to-md.js";
import bulkUpdateHandler from "./api/bulk-update-clients.js";
import journalHandler from "./api/journal.js";
import ghlAuthHandler, { callbackHandler as ghlCallback, statusHandler as ghlStatus, getValidToken } from "./api/ghl/auth.js";
import { googleAuthHandler, googleCallbackHandler, googleStatusHandler } from "./api/lib/google-oauth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, ".env");
try {
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch {
  /* no .env file — fall back to env vars */
}

const PORT = process.env.PORT || 3002;

const app = express();
app.disable("x-powered-by");

// ── GitHub Webhook — must be registered BEFORE global express.json() ──────────
// express.json() consumes the body stream; express.raw() needs the raw Buffer
// to compute the HMAC signature. Registering the route first wins.
// Set WEBHOOK_SECRET in .env to the same value you enter in GitHub repo settings.
// Works for BOTH the The Inspector Playbook repo and the HIH repo.
// The Inspector Playbook push  → git pull origin main + pm2 reload max  (Max's file changes go live)
// HIH push   → pull HIH repo at /tmp/hih + copy dashboard + server + chat + pm2 reload max
app.post("/api/webhook/github", express.raw({ type: "*/*" }), (req, res) => {
  const secret = process.env.WEBHOOK_SECRET || "";
  if (secret) {
    const sig = req.headers["x-hub-signature-256"] || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.status(401).json({ error: "Bad signature" });
      }
    } catch {
      return res.status(401).json({ error: "Bad signature" });
    }
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return res.status(400).json({ error: "Bad JSON" }); }

  // Only act on pushes to the main branch
  if (payload.ref !== "refs/heads/main") return res.json({ ok: true, skipped: "not main branch" });

  const repoName = (payload.repository && payload.repository.full_name) || "";
  const isHIH = repoName === "homeinspectorhelp/hih";

  res.json({ ok: true, message: "Webhook received — deploying." });

  setTimeout(() => {
    if (isHIH) {
      // HIH push: pull HIH repo then copy all The Inspector Playbook files into place
      const token = process.env.GITHUB_TOKEN_HIGA || "";
      const cloneUrl = token
        ? `https://${token}@github.com/homeinspectorhelp/hih.git`
        : "https://github.com/homeinspectorhelp/hih.git";
      const dst = __dirname;
      const cmd = [
        `(git -C /tmp/hih pull "${cloneUrl}" main 2>/dev/null || git clone "${cloneUrl}" /tmp/hih)`,
        `&& cp /tmp/hih/dashboard-upgraded.html "${dst}/dashboard/index.html"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/server.js "${dst}/server.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/chat.js "${dst}/api/max-pro/chat.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/api/journal.js "${dst}/api/journal.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/api/resources.js "${dst}/api/resources.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/CLAUDE.md "${dst}/CLAUDE.md"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/package.json "${dst}/package.json"`,
        `&& mkdir -p "${dst}/api/max-prime" "${dst}/.claude/agents" "${dst}/journals"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/api/max-prime/chat.js "${dst}/api/max-prime/chat.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/api/max-prime/integrations.js "${dst}/api/max-prime/integrations.js"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/.claude/agents/*.md "${dst}/.claude/agents/"`,
        `&& cp /tmp/hih/owners-inbox/max-pro-fix/journals/team-learnings.md "${dst}/journals/team-learnings.md"`,
        `&& npm install --prefix "${dst}" --silent`,
        `&& mkdir -p "${dst}/dashboard/assets"`,
        `&& (curl -fsSL -H "Authorization: token ${token}" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/homeinspectorhelp/higa/contents/resources/higa-logo.png?ref=main" -o "${dst}/dashboard/assets/higa-logo.png" || true)`,
        `&& pm2 reload max`,
      ].join(" ");
      exec(cmd, { timeout: 90000 }, (err, stdout) => {
        if (err) console.error("[webhook] HIH deploy error:", err.message);
        else console.log("[webhook] HIH deploy:", stdout.trim().split("\n").slice(-2).join(" | "));
      });
    } else {
      // The Inspector Playbook push: pull this repo + reload
      exec(
        `cd "${__dirname}" && git pull origin main && pm2 reload max`,
        { timeout: 60000 },
        (err, stdout) => {
          if (err) console.error("[webhook] The Inspector Playbook deploy error:", err.message);
          else console.log("[webhook] The Inspector Playbook deploy:", stdout.trim().split("\n").slice(-2).join(" | "));
        }
      );
    }
  }, 800);
});

app.use(express.json({ limit: "100mb" }));

// ── Chat ──────────────────────────────────────────────────────────────────────
app.all("/api/max-pro/chat", chatHandler);
// Max Prime (Claude Agent SDK) — loaded lazily so a missing/not-yet-deployed
// file degrades to a clean 500 on THIS route instead of crash-looping the whole
// server at boot.
let _maxPrimeHandler = null;
app.all("/api/max-prime/chat", async (req, res) => {
  try {
    if (!_maxPrimeHandler) _maxPrimeHandler = (await import("./api/max-prime/chat.js")).default;
    return _maxPrimeHandler(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Max Prime engine isn't deployed yet: " + (e && e.message || e) }));
  }
});

// ── Journal ─────────────────────────────────────────────────────────────────
// GitHub-synced journal (corporate / ken / beth) — read/write the same files
// from anywhere (Philippines or USA). GET, POST, PUT (edit), PATCH (comment), DELETE.
app.all("/api/journal", journalHandler);

// ── Task Calendar (self-hosted task tracker, stored in the higa repo) ─────────
// Lazy-loaded so a partial/old deploy that hasn't copied api/tasks.js yet
// degrades to a 503 on these routes instead of crashing the whole server.
let _tasksMod = null;
async function tasksMod(res) {
  try { if (!_tasksMod) _tasksMod = await import("./api/tasks.js"); return _tasksMod; }
  catch (e) { res.status(503).json({ error: "Tasks module not deployed yet: " + (e && e.message || e) }); return null; }
}
function injectDeanSecret(req) { req.headers["x-dean-secret"] = process.env.DEAN_CALENDAR_SECRET || ""; }

// External routes (caller supplies x-dean-secret)
app.post("/api/tasks/create",      async (req, res) => { const m = await tasksMod(res); if (m) m.createTaskHandler(req, res); });
app.get("/api/tasks/upcoming",     async (req, res) => { const m = await tasksMod(res); if (m) m.upcomingTasksHandler(req, res); });
app.get("/api/tasks/all",          async (req, res) => { const m = await tasksMod(res); if (m) m.allTasksHandler(req, res); });
app.post("/api/tasks/complete",    async (req, res) => { const m = await tasksMod(res); if (m) m.completeTaskHandler(req, res); });
app.get("/api/tasks/attachment",   async (req, res) => { const m = await tasksMod(res); if (m) m.taskAttachmentHandler(req, res); });
app.delete("/api/tasks/:id",       async (req, res) => { const m = await tasksMod(res); if (m) m.deleteTaskHandler(req, res); });

// Dashboard UI routes — secret injected server-side so the browser never holds it
app.post("/api/tasks-ui/create",     async (req, res) => { const m = await tasksMod(res); if (m) { injectDeanSecret(req); m.createTaskHandler(req, res); } });
app.get("/api/tasks-ui/upcoming",    async (req, res) => { const m = await tasksMod(res); if (m) { injectDeanSecret(req); m.upcomingTasksHandler(req, res); } });
app.get("/api/tasks-ui/all",         async (req, res) => { const m = await tasksMod(res); if (m) { injectDeanSecret(req); m.allTasksHandler(req, res); } });
app.get("/api/tasks-ui/attachment",  async (req, res) => { const m = await tasksMod(res); if (m) m.taskAttachmentHandler(req, res); });
app.post("/api/tasks-ui/complete",   async (req, res) => { const m = await tasksMod(res); if (m) { injectDeanSecret(req); m.completeTaskHandler(req, res); } });
app.delete("/api/tasks-ui/:id",      async (req, res) => { const m = await tasksMod(res); if (m) { injectDeanSecret(req); m.deleteTaskHandler(req, res); } });

// ── Resources (Shared Library) ────────────────────────────────────────────────
// Filesystem-based shared library under resources/shared/. The The Inspector Playbook deploy
// uses `git pull` (not reset --hard), so untracked uploads survive reloads.
// Lazy-loaded so a partial/old deploy that hasn't copied api/resources.js yet
// degrades to a 503 on this one route instead of crashing the whole server.
let _resourcesHandler = null;
app.all("/api/resources", async (req, res) => {
  try {
    if (!_resourcesHandler) _resourcesHandler = (await import("./api/resources.js")).default;
  } catch (e) {
    return res.status(503).json({ error: "Resources module not deployed yet" });
  }
  return _resourcesHandler(req, res);
});

// ── Owner's Inbox ─────────────────────────────────────────────────────────────
// Read-only view of owners-inbox/ — lists files and serves them for
// preview or download. No GitHub token required (local filesystem).
import inboxHandler from "./api/inbox/index.js";
app.all("/api/inbox", inboxHandler);

// ── Utilities ─────────────────────────────────────────────────────────────────
app.post("/api/xlsx-to-md", xlsxToMdHandler);
app.post("/api/bulk-update-clients", bulkUpdateHandler);

// ── GHL OAuth ─────────────────────────────────────────────────────────────────
app.get("/api/ghl/auth", ghlAuthHandler);
app.get("/api/auth/callback", ghlCallback);
app.get("/api/ghl/status", ghlStatus);

// ── Google OAuth ──────────────────────────────────────────────────────────────
app.get("/api/google/auth", googleAuthHandler);
app.get("/api/google/callback", googleCallbackHandler);
app.get("/api/google/status", googleStatusHandler);

// ── Deploy endpoint ───────────────────────────────────────────────────────────
// Max Pro calls this via the deploy tool after committing dashboard changes.
// The endpoint pulls the latest commit from GitHub and reloads the PM2 process
// so changes go live without anyone touching the terminal.
app.post("/api/deploy", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token || token !== process.env.GITHUB_TOKEN_HIGA) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  // Respond immediately so the SSE stream can close before the reload kills the
  // process. Then pull + reload after a short delay so the response is flushed.
  res.json({ ok: true, message: "Deploy triggered — pulling latest and reloading." });
  setTimeout(() => {
    exec(
      `cd "${__dirname}" && git pull origin main && pm2 reload max`,
      { timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) console.error("Deploy error:", err.message);
        else console.log("Auto-deploy:", stdout.trim());
      }
    );
  }, 800);
});

// ── Static: published pages (websites / wireframes / designs) ─────────────────
// Files under resources/ are served at /resources/... so a built .html is live
// at a shareable link Ken can open in a browser — no download, no GitHub.
app.use('/resources', express.static(path.join(__dirname, "resources"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

// ── Static dashboard ──────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "dashboard"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache"),
}));

app.listen(PORT, () => {
  console.log(`The Inspector Playbook dashboard + Max Pro listening on port ${PORT}`);
});
