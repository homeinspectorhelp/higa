// Nikki Prime — chat endpoint (streaming, SSE)
//
// This is the "real Claude Code engine" version of Nikki. Where the original
// Nikki Pro (api/nikki-pro/chat.js) is a hand-rolled Anthropic Messages-API
// loop with a large system prompt and a fixed set of GitHub-API tools, Nikki
// Prime runs the **Claude Agent SDK** — the same engine behind Claude Code —
// directly against a local clone of this repo. That gives Nikki native file
// tools (read/write/edit/glob/grep/bash), automatic context management (no
// more "file too big"), and tool calls the harness enforces structurally
// (no more fabricated "Posted ✅" cards).
//
// Requirements on the server:
//   1.  npm install @anthropic-ai/claude-agent-sdk
//   2.  ANTHROPIC_API_KEY set in .env  (already documented in .env.example)
//   3.  This process runs from a working copy of the homeinspectorhelp/hih repo
//       (Rose Hosting VPS) so the engine can read/write the business files and
//       pick up CLAUDE.md as Nikki's memory.
//
// The frontend (dashboard/index.html → Nikki Prime tab) sends:
//   POST { messages: [ { role:'user'|'assistant', content:'...' }, ... ] }
// and consumes Server-Sent Events:
//   event: text   data: { delta }     incremental assistant text
//   event: tool   data: { tool, label }  a tool the engine is running
//   event: error  data: { error }
//   event: done   data: { }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Octokit } from "@octokit/rest";
import { buildHihMcpServer } from "./integrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root is two levels up from api/nikki-prime/.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Durable memory targets. Max runs against the higa repo clone; conversation
// logs + her file saves commit there via GITHUB_TOKEN_HIGA so they survive a
// rebuild and are backed up. CONTENT_DIRS is an ALLOWLIST (business content
// only, never code/secrets). journals/ is excluded — team-learnings is shared
// from the HIH source on deploy, so Max must not fork it here.
const REPO_OWNER = "homeinspectorhelp";
const REPO_NAME = "higa";
const DEFAULT_BRANCH = "main";
const CONTENT_DIRS = new Set([
  "owner-logs", "owners-inbox", "courses", "students", "contacts", "prospects",
  "meetings", "reports", "team-inbox", "resources", "blog-drafts", "blog-posts",
]);

// Sonnet 4.6 — standardized across the agent fleet to cut runtime cost ~40%.
// Drives the Max Prime orchestrator AND its .claude/agents specialists (which
// inherit the session model). Opus is reserved for Ken's own Claude chat.
const MODEL = "claude-sonnet-4-6";

// Max's persona/role is appended to the Claude Code preset. The bulk of who
// she is — the team roster, folder rules, the business — lives in CLAUDE.md,
// which the engine reads automatically from REPO_ROOT.
const MAX_APPEND = "You are Max, the AI Orchestrator for The Inspector Playbook — an online education company for home inspectors (tagline \"Rebuild Smarter. Grow Faster.\", theinspectorplaybook.com), owned by Ken. You are running on the Claude Code engine with full access to The Inspector Playbook repository. CLAUDE.md is your memory — follow it. Be friendly, plain-English, and concrete.\n\nIRON RULE — KEN HAS NO ACCESS TO THE REPO, THE SERVER, OR THE FILESYSTEM. He cannot open a path. NEVER show him an absolute or server path (e.g. /var/www/..., a repo path) as if he can open it. The dashboard turns a file you Read or Write into a Copy/Download chip above your reply — that chip, and the content you paste in chat, are the ONLY ways he receives a file.\n- Every time you hand over a file, Read it in the same turn so the Download button appears, and present the content in chat. Never quote a server path; if you must say where it lives, say \"filed in the Owner's Inbox.\"\n- WHEN A SUB-AGENT PRODUCES A FILE: the sub-agent wrote it in its own session, so no Download button appeared. YOU must Read that file in your turn so the button shows for Ken — don't relay a \"download from the button / file path\" line, and strip any raw server path.\n- PUBLISH A VIEWABLE PAGE AS A LIVE LINK: When you or a specialist produce something Ken should VIEW in a browser — a website page, wireframe, or design mockup (an .html file) — Write it into the publicly-served folder resources/sites/ (create the folder if needed), NOT only owners-inbox. It is then live at a shareable link that renders in the browser: https://dashboard.theinspectorplaybook.com/resources/sites/<filename>. Give Ken that clickable LIVE LINK as the primary deliverable, exactly like a report link — he can open and share it without downloading anything or touching GitHub.\n\nFORMATTING — Ken reads your replies in a chat panel that renders Markdown. Lead with a one-line answer, then short paragraphs, **bold** for key terms, and bulleted/numbered lists. Never a wall of text.\n\nBUSINESS INTEGRATIONS — besides your file/shell/web tools, you have Inspector Playbook integration tools (named mcp__hih__*): monday_com (read boards + post updates/items/statuses), ghl (GoHighLevel — the course/membership platform: locations, contacts/students, pipelines, conversations, calendars, workflows, funnels), and wordpress (the homeinspectorgrowthacademy.com community site — WordPress + MemberPress + BuddyBoss: read members/users, membership status, posts, pages; this is Wes's domain — route website/WordPress work to him and run the tool to pull the data). Use them when Ken asks about Monday tasks, anything in GHL, or anything on the WordPress/community site — pull the data, don't guess.\n- HONESTY ON EXTERNAL ACTIONS: never say you posted to Monday.com (or updated a status / created an item) unless the monday_com tool returned posted:true WITH an id THIS turn. If you didn't call the tool or it errored, say so plainly — never render a fake \"Posted\". Many Monday notifications are on SUBITEMS — post to the subitem's own id, not the parent's.\n\nORCHESTRATION — THE IRON RULE (this is your identity): You are the orchestrator. You ROUTE specialist work to the specialist who owns it and SUPERVISE — you do NOT do the specialist's work yourself (\"wearing a hat\"). You have real specialist sub-agents through your Task tool. Delegate by calling Task with subagent_type set to the agent who owns the work. Your full team: pax (research/competitor/pricing), nolan (HR/roster), cora (course curriculum), vince (course video scripts), ellie (course editing/QA), gus (course graphics), wren (GHL course sales/landing pages), glen (GHL membership-site builds), finn (finances/numbers), wes (public website + the homeinspectorgrowthacademy.com WordPress/member site), skye (GHL marketing tools — funnels/automations/CRM), emma (email marketing), cole (sales copywriting), vera (marketing video), june (YouTube), ivy (Instagram), felix (Facebook Groups), leo (LinkedIn), dawn (marketing planning/calendars), ace (paid ads). Give the sub-agent a COMPLETE, self-contained brief — it has no chat history. When it returns, relay its full output AND its BADGE to Ken; never rewrite its work as your own.\n\nWHAT YOU DO DIRECTLY (no sub-agent needed): answer questions about the team/business/repo; read files and hand Ken downloads; pull Monday.com and GHL; file quick notes and journal entries; run standups and status checks; and route + supervise. WHAT YOU ALWAYS ROUTE: research/pricing → pax; HR/roster → nolan; course curriculum/video/editing/graphics → cora/vince/ellie/gus; GHL course pages & membership sites → wren/glen; website & WordPress/member site → wes; GHL marketing tools → skye; email → emma; copy → cole; video → vera; YouTube/Instagram/Facebook/LinkedIn → june/ivy/felix/leo; planning → dawn; paid ads → ace; finances → finn. When unsure whether something is specialist work, treat it as specialist work and route it to the owner. As the team grows, new specialists are added as sub-agents — route to them as they appear.\n\nENDING EVERY TASK — THE ORCHESTRATOR BADGE (required): End every reply with a badge. As the orchestrator your DID list is ROUTE / SUPERVISE / CHECK / RELAY — never the specialist's actual deliverable. If you ever find specialist work in your own DID list, you wore a hat — stop and route it.\n\n```\n─── ORCHESTRATOR BADGE ───\nDID (verified):  what YOU did — e.g. routed to <agent> (N Task calls), checked the returned badge, pulled <tool> data, filed <file>\nHANDED OFF:      each open item → its named owner (a sub-agent or Ken)\nSTILL OPEN:      anything blocked or awaiting Ken's decision; write \"None.\" if nothing\nPROOF:           the real Task delegations / tool calls / file paths backing each DID item\n```\n\nNo badge = not done. Relay the specialist's badge, then add your orchestrator badge below it. Report in past tense only after the action actually succeeded.\n\nMEMORY & LEARNING — KEEP GETTING SMARTER:\n- ON SESSION START (your first reply in a new conversation — no prior \"Max:\" turns yet): read journals/team-learnings.md so you begin current with what the team has learned.\n- RECALLING PAST CONVERSATIONS: every turn is logged to owner-logs/max-prime-log-<YYYY-MM>.md (timestamp, topic, specialists, your reply). The browser only holds the CURRENT chat; these logs are how you recall EARLIER chats. When Ken asks about a prior conversation you don't see in the current history, read the relevant owner-logs/max-prime-log file (newest first) and answer from it, quoting the date — don't say you don't remember until you've checked.\n- END-OF-TASK CAPTURE: when a task surfaces something durable — a decision Ken made, a new fact or preference, a fix, or a \"what works / what doesn't\" — append ONE dated line to journals/team-learnings.md with your Edit tool (format: \"- YYYY-MM-DD — [category] lesson\"), and cite that append in your badge PROOF. Reusable lessons only — never routine task steps. This is how the team's knowledge compounds.";

// Turn the conversation history into a single prompt. The engine is stateless
// per request here (the frontend keeps history in localStorage and resends it,
// matching how Nikki Pro works), so we render prior turns as context and let
// the latest user message drive the turn.
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && b.type === "text" ? b.text : "")).join("");
  }
  return "";
}

function buildPrompt(messages) {
  const turns = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => {
      const who = m.role === "user" ? "Ken" : "Max";
      const t = textOf(m.content).trim();
      return t ? `${who}: ${t}` : "";
    })
    .filter(Boolean);
  return turns.join("\n\n");
}

// Friendly label for a tool call, so the dashboard can show "📖 Reading X"
// instead of a raw tool name.
function toolLabel(name, input) {
  let p = (input && (input.file_path || input.path || input.pattern || input.command)) || "";
  // Bosses have no filesystem access — show the repo-relative path in the activity
  // feed, never the absolute /var/www server path.
  if (p && (name === "Read" || name === "Write" || name === "Edit" || name === "Glob" || name === "Grep")) p = relToRepo(p);
  switch (name) {
    case "Read":  return `📖 Reading ${p}`;
    case "Write": return `✏️ Writing ${p}`;
    case "Edit":  return `✏️ Editing ${p}`;
    case "Glob":  return `📂 Finding ${p}`;
    case "Grep":  return `🔍 Searching ${p}`;
    case "Bash":  return `⚙️ Running ${p}`;
  }
  // HIH integration tools arrive namespaced as mcp__hih__<tool>.
  const act = input && input.action ? ` · ${input.action}` : "";
  if (name === "mcp__hih__monday_com")        return `📋 Monday.com${act}`;
  if (name === "mcp__hih__pull_call_report")  return `📞 Pulling call data${input && input.month ? ` · ${input.month}` : ""}`;
  if (name === "mcp__hih__build_call_summary")return `📞 Building call summary`;
  if (name === "mcp__hih__ghl")               return `🔗 GoHighLevel${act}`;
  if (name === "mcp__hih__google_analytics")  return `📊 Google Analytics${act}`;
  if (name === "mcp__hih__search_console")    return `🔎 Search Console${act}`;
  if (name === "mcp__hih__wordpress")         return `🌐 WordPress${act}`;
  return `🔧 ${name}`;
}

// --- Download chips -----------------------------------------------------------
// Nikki Pro hands Beth a file by streaming its content to the dashboard, which
// renders a Copy/Download chip. Nikki Prime runs the Agent SDK, so we reproduce
// that here: whenever the engine WRITES a deliverable (or READS an existing
// business file to hand over), emit a `file` SSE event carrying the content so
// the frontend can show the same Download button — instead of Nikki only saying
// "it's in the owner's inbox", which Beth can't click.
const FILE_TEXT_EXT = /\.(md|markdown|txt|csv|json|html?|xml|ya?ml|svg)$/i;
const FILE_MAX = 300000; // ~300KB cap so a huge file can't blow up the stream

// Engine-internal files Beth never asked for — skip so reads of CLAUDE.md,
// settings, server code, etc. don't spam the chat with download chips.
function isInternalPath(rel) {
  return (
    /(^|\/)CLAUDE\.md$/i.test(rel) ||
    /(^|\/)\.(claude|git|env)/.test(rel) ||
    /(^|\/)(package(-lock)?\.json|server\.js)$/.test(rel) ||
    rel.startsWith("api/") ||
    rel.startsWith("scripts/") ||
    rel.startsWith("node_modules/")
  );
}

function relToRepo(p) {
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
    return path.relative(REPO_ROOT, abs) || p;
  } catch { return p; }
}

// Inspect a tool_use block; if it's a deliverable, emit a `file` event once.
function maybeEmitFile(block, send, emitted) {
  try {
    const name = block && block.name;
    const input = (block && block.input) || {};
    // Resolve the path the SAME way toolLabel does — the engine may hand it as
    // file_path OR path. (maybeEmitFile only checking file_path was why the
    // label showed "Reading X" but no Download chip ever appeared.)
    const fp = input.file_path || input.path;
    if (!fp || (name !== "Write" && name !== "Read")) return;

    const rel = relToRepo(fp);

    if (name === "Write") {
      // Content is right here in the tool input — no disk read needed.
      let content = typeof input.content === "string" ? input.content : "";
      if (!content) return;
      if (content.length > FILE_MAX) content = content.slice(0, FILE_MAX);
      send("file", { name: rel.split("/").pop(), path: rel, content });
      emitted.add(rel);
      return;
    }

    // name === "Read" — only chip business files Beth would actually want, and
    // only once per file per turn (Nikki re-reads files while working).
    if (emitted.has(rel) || isInternalPath(rel) || !FILE_TEXT_EXT.test(rel)) return;
    const abs = path.isAbsolute(fp) ? fp : path.resolve(REPO_ROOT, fp);
    let content = "";
    try { content = fs.readFileSync(abs, "utf-8"); } catch { return; }
    if (!content) return;
    if (content.length > FILE_MAX) content = content.slice(0, FILE_MAX);
    send("file", { name: rel.split("/").pop(), path: rel, content });
    emitted.add(rel);
  } catch { /* never let a chip break the stream */ }
}

// Fallback chip for sub-agent deliverables. When Max delegates to a specialist
// (the Task tool), the specialist writes its file INSIDE its own session, so that
// Write block never reaches this parent stream and maybeEmitFile never fires —
// Ken gets no Download button. After the turn, scan the deliverable folders for
// files created/modified during THIS turn and emit a chip for any not already
// surfaced. This makes the Download button reliable regardless of whether Max or
// a specialist produced the file.
const DELIVERABLE_DIRS = ["owners-inbox", "team-inbox"];
function emitTurnDeliverables(turnStart, send, emitted) {
  for (const dir of DELIVERABLE_DIRS) {
    const stack = [path.resolve(REPO_ROOT, dir)];
    let scanned = 0;
    while (stack.length && scanned < 3000) {
      const cur = stack.pop();
      let entries;
      try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        const abs = path.join(cur, ent.name);
        if (ent.isDirectory()) { stack.push(abs); continue; }
        scanned++;
        const rel = relToRepo(abs);
        if (emitted.has(rel) || isInternalPath(rel) || !FILE_TEXT_EXT.test(rel)) continue;
        let st;
        try { st = fs.statSync(abs); } catch { continue; }
        if (st.mtimeMs < turnStart) continue; // not produced this turn
        let content = "";
        try { content = fs.readFileSync(abs, "utf-8"); } catch { continue; }
        if (!content) continue;
        if (content.length > FILE_MAX) content = content.slice(0, FILE_MAX);
        send("file", { name: rel.split("/").pop(), path: rel, content });
        emitted.add(rel);
      }
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const { messages, attachments } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "messages array is required" }));
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };
  res.write(`: stream-open ${Date.now()}\n\n`);

  // Heartbeat so proxies don't drop a quiet long-running turn.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch {}
  }, 15000);

  // Temp files written for this turn's attachments (cleaned up in finally).
  const tmpPaths = [];
  // Paths already surfaced as a Download chip this turn (dedup re-reads).
  const emittedFiles = new Set();
  // Accumulated for the durable conversation log (see logConversation).
  let fullReply = "";
  const specialistsCalled = [];
  // Repo files Max wrote/edited this turn → auto-committed to GitHub (see commitWrittenFiles).
  const writtenPaths = new Set();

  try {
    // Imported lazily so a missing dependency surfaces as a clean stream error
    // (with install instructions) rather than crashing the whole server at boot.
    let sdk, query;
    try {
      sdk = await import("@anthropic-ai/claude-agent-sdk");
      query = sdk.query;
    } catch (impErr) {
      send("error", {
        error:
          "The Claude Agent SDK isn't installed on the server yet. Run `npm install @anthropic-ai/claude-agent-sdk` in the dashboard folder, then restart. (" +
          (impErr && impErr.message ? impErr.message : impErr) + ")",
      });
      clearInterval(heartbeat);
      return res.end();
    }

    // Wire HIH's business integrations (Monday.com, Telnyx, GHL, Google) as an
    // in-process MCP server. If zod or the SDK helpers are missing, Nikki Prime
    // still runs with her native file/shell/web tools — just without these.
    let mcpServers;
    try {
      const { z } = await import("zod");
      const hih = buildHihMcpServer(sdk, z);
      if (hih) mcpServers = { hih };
    } catch { /* integrations unavailable — degrade gracefully */ }

    let prompt = buildPrompt(messages);

    // Write any attached files/photos to a temp dir and point Nikki at the
    // absolute paths — the Claude Code engine's Read tool natively handles
    // images, PDFs, and text, so it pulls in whatever it needs.
    if (Array.isArray(attachments) && attachments.length) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "max-prime-"));
      const lines = [];
      for (const a of attachments) {
        if (!a || !a.base64 || !a.name) continue;
        const safe = String(a.name).replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
        const dest = path.join(dir, safe);
        try {
          fs.writeFileSync(dest, Buffer.from(a.base64, "base64"));
          tmpPaths.push(dest);
          lines.push(`- ${dest}${a.type ? ` (${a.type})` : ""}`);
        } catch {}
      }
      if (lines.length) {
        prompt += `\n\n[Ken attached ${lines.length} file(s) for this message. Use your Read tool on the path(s) below as needed:\n${lines.join("\n")}\n]`;
      }
    }

    // Capture the engine's stderr so a startup failure surfaces a real reason
    // instead of a bare "process exited with code 1".
    let stderrBuf = "";
    const errSuffix = () => (stderrBuf.trim() ? " — " + stderrBuf.trim().slice(-600) : "");

    const run = query({
      prompt,
      options: {
        cwd: REPO_ROOT,
        model: MODEL,
        maxTurns: 40, // cap the agent loop to prevent runaway context re-sending (cost control)
        // Append Nikki's role on top of the standard Claude Code system prompt.
        systemPrompt: { type: "preset", preset: "claude_code", append: MAX_APPEND },
        // Load CLAUDE.md + project settings as Nikki's memory (the SDK does NOT
        // read filesystem settings unless asked).
        settingSources: ["project"],
        // Server-side, fully trusted context — approve every tool via a callback
        // rather than permissionMode:"bypassPermissions". The bypass flag maps to
        // --dangerously-skip-permissions, which the CLI REFUSES to run as root
        // (the deploy/pm2 process runs as root) and exits 1. canUseTool approves
        // tools programmatically without tripping that guard.
        canUseTool: async (_toolName, input) => ({ behavior: "allow", updatedInput: input }),
        // Stream token-level text so the dashboard types the reply live.
        includePartialMessages: true,
        // Surface subprocess stderr for diagnostics.
        stderr: (data) => { stderrBuf += String(data || ""); },
        // HIH business integrations (Monday.com, Telnyx, GHL, Google), when available.
        ...(mcpServers ? { mcpServers } : {}),
      },
    });

    // Mark the start of the turn so we can detect deliverables written during it
    // (including ones a sub-agent wrote, which never stream to this parent loop).
    const turnStart = Date.now();

    for await (const message of run) {
      // Token-level text deltas (from includePartialMessages).
      if (message.type === "stream_event") {
        const ev = message.event;
        if (
          ev &&
          ev.type === "content_block_delta" &&
          ev.delta &&
          ev.delta.type === "text_delta" &&
          ev.delta.text
        ) {
          fullReply += ev.delta.text;
          send("text", { delta: ev.delta.text });
        }
        continue;
      }

      // Surface tool calls as activity notes. The full assistant message
      // arrives as type 'assistant'; its text was already streamed above, so
      // here we only pull out tool_use blocks for the activity feed.
      if (message.type === "assistant" && message.message && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block && block.type === "tool_use") {
            send("tool", { tool: block.name, label: toolLabel(block.name, block.input) });
            if (block.name === "Task" && block.input && block.input.subagent_type) {
              specialistsCalled.push(block.input.subagent_type);
            }
            if (block.name === "Write" || block.name === "Edit" || block.name === "NotebookEdit") {
              const fp = block.input && (block.input.file_path || block.input.path || block.input.notebook_path);
              if (fp) writtenPaths.add(relToRepo(fp));
            }
            // Hand Ken a Download button for any deliverable Max writes/reads.
            maybeEmitFile(block, send, emittedFiles);
          }
        }
        continue;
      }

      // Terminal result for the turn.
      if (message.type === "result") {
        if (message.is_error || message.subtype === "error_during_execution") {
          send("error", { error: (message.error || "The engine hit an error during this turn.") + errSuffix() });
        }
        break;
      }
    }

    // Safety net: chip any deliverable produced this turn that didn't already get
    // a button (covers files a specialist sub-agent wrote in its own session).
    try { emitTurnDeliverables(turnStart, send, emittedFiles); } catch {}

    send("done", {});

    // Persist Max's saves to GitHub so a rebuild can't lose them, then record
    // this turn for recall. Both best-effort/non-fatal.
    try { await commitWrittenFiles(writtenPaths); } catch {}
    try { await logConversation(fullReply, messages, specialistsCalled); } catch {}
  } catch (err) {
    send("error", { error: String((err && err.message) || err) + errSuffix() });
  } finally {
    clearInterval(heartbeat);
    // Clean up any temp attachment files written for this turn.
    for (const p of tmpPaths) { try { fs.rmSync(p, { force: true }); } catch {} }
    try { res.end(); } catch {}
  }
}

// --- Durable saves + conversation log (commit to the higa repo) ----------------
async function commitWrittenFiles(paths) {
  if (!paths || !paths.size || !process.env.GITHUB_TOKEN_HIGA) return;
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN_HIGA });
  for (const rel of paths) {
    try {
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      const top = rel.split("/")[0];
      if (!CONTENT_DIRS.has(top)) continue;
      const abs = path.resolve(REPO_ROOT, rel);
      let buf;
      try { buf = fs.readFileSync(abs); } catch { continue; }
      let sha;
      try {
        const { data } = await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: rel, ref: DEFAULT_BRANCH });
        if (!Array.isArray(data)) {
          if (data.content && Buffer.from(data.content, "base64").equals(buf)) continue;
          sha = data.sha;
        }
      } catch { /* new file */ }
      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER, repo: REPO_NAME, path: rel, branch: DEFAULT_BRANCH,
        message: `max: save ${rel}`, content: buf.toString("base64"), sha,
      });
    } catch (err) {
      console.error("Max Prime auto-commit failed for", rel, err && err.message);
    }
  }
}

function lastUserText(messages) {
  const lastUser = [...(messages || [])].reverse().find((m) => m && m.role === "user");
  if (!lastUser) return "(no message)";
  if (typeof lastUser.content === "string") return lastUser.content.trim() || "(no message)";
  if (Array.isArray(lastUser.content)) {
    const tb = lastUser.content.find((b) => b && b.type === "text");
    if (tb && tb.text) return tb.text.trim();
  }
  return "(no message)";
}

async function logConversation(reply, messages, specialists) {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const timestamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const logPath = `owner-logs/max-prime-log-${monthKey}.md`;
  const absLog = path.resolve(REPO_ROOT, logPath);
  const specLine = specialists && specialists.length ? [...new Set(specialists)].join(", ") : "None";
  const body = (reply && reply.length > 4000)
    ? reply.slice(0, 4000) + "\n\n*[truncated — full reply was shown in the dashboard chat]*"
    : (reply && reply.trim()) || "(no text reply — tool/file actions only)";
  const entry = [
    `\n## ${timestamp}`, ``, `**Topic:** ${lastUserText(messages).slice(0, 300)}`, ``,
    `**Specialists called:** ${specLine}`, ``, `**Max's reply:**`, ``, body, ``, `---`,
  ].join("\n");
  const header = `# Max Prime Conversation Log — ${monthKey}\n\n*Every conversation with Max Prime is recorded here so he can recall past chats.*\n`;

  let localContent = "";
  try { localContent = fs.readFileSync(absLog, "utf-8"); } catch {}
  const newContent = (localContent || header) + entry;
  try {
    fs.mkdirSync(path.dirname(absLog), { recursive: true });
    fs.writeFileSync(absLog, newContent, "utf-8");
  } catch (err) { console.error("Max Prime local log write failed:", err && err.message); }

  if (!process.env.GITHUB_TOKEN_HIGA) return;
  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN_HIGA });
    let sha;
    try {
      const { data } = await octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: logPath, ref: DEFAULT_BRANCH });
      if (!Array.isArray(data)) sha = data.sha;
    } catch {}
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER, repo: REPO_NAME, path: logPath, branch: DEFAULT_BRANCH,
      message: `log: Max Prime conversation — ${timestamp}`,
      content: Buffer.from(newContent, "utf-8").toString("base64"), sha,
    });
  } catch (err) { console.error("Max Prime GitHub log commit failed:", err && err.message); }
}
