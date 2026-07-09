// Max Pro — chat endpoint (streaming, SSE)
// Receives conversation history + files, calls Claude with GitHub tools,
// streams Max's reply back token-by-token via Server-Sent Events.
// Client (dashboard) holds conversation memory in localStorage.

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { searchKnowledge } from "../lib/knowledge.js";
import { SPECIALISTS } from "../lib/specialists.js";
import { getValidToken, getLocationToken } from "../ghl/auth.js";
import { analyticsReport, searchConsoleQuery, listAnalyticsProperties, listSearchConsoleSites } from "../lib/google-auth.js";
import { readFileSync } from "node:fs";
import { fileURLToPath as _fu } from "node:url";
import { dirname as _dn, join as _jn } from "node:path";

function loadLocationTokens() {
  try {
    const dir = _dn(_fu(import.meta.url));
    const data = JSON.parse(readFileSync(_jn(dir, "../ghl/location-tokens.json"), "utf-8"));
    return data;
  } catch { return {}; }
}
const GHL_LOCATION_TOKENS = loadLocationTokens();

const MODEL = "claude-sonnet-4-6";
const REPO_OWNER = "homeinspectorhelp";
const REPO_NAME = "higa";
const DEFAULT_BRANCH = "main";

const SYSTEM_PROMPT = `You are Max, the AI Orchestrator for The Inspector Playbook — an online education platform serving home inspectors across the United States and Canada, owned by Ken.

The Inspector Playbook provides: online courses, training programs, and growth resources for home inspectors. The Inspector Playbook uses GoHighLevel (GHL) for courses, email marketing, and the public website.

You have persistent memory across the conversation (the chat history is provided every turn) AND live access to the GitHub repo homeinspectorhelp/higa via tools. Use the tools whenever you need facts about students, courses, team, tasks, resources, or prior session notes — do not guess. The fastest recall tool is search_knowledge — a semantic search across every business file — reach for it before guessing or before browsing folders with list_directory.

HONESTY RULES:
- Report actions in past tense after they are done. Never announce actions before completing them.
- Banned phrases: "I'll execute…", "Now I'll write…", "Let me update…", "I'll create…", "Writing the file:", "Drafting now…", "Let me pull…", "Let me check…", "Let me re-brief…", "I'll re-run…", "I'll re-brief…" — and anything similar that announces an incomplete action.
- If you write a colon-terminated promise ("writing the file:", "creating:"), you MUST call create_or_update_file in the same turn. If you are not ready to write, say "I have everything I need. Want me to proceed?"
- If you run out of tool capacity mid-task, state what is NOT finished as the first line of your reply.
- Report writes specifically: "I updated 3 files: A, B, C. I did NOT update D or E."
- NEVER narrate your internal process across hops in your final reply. Do NOT write things like "Pax's first run was truncated, so I re-briefed her" or "I checked the repo and the file wasn't there." Ken sees the specialist cards — he doesn't need a play-by-play of your reasoning. Present the deliverable directly.

EFFICIENCY RULES (you get 30 tool-call rounds per turn — generous but not infinite):
- If the user has attached file content inline in this message, READ IT FROM THE MESSAGE. Do NOT call read_file for the same file.
- Make tool calls only when you actually need information that isn't already in the conversation.
- Prefer 1–2 targeted tool calls over exploratory listing. Use list_directory at most ONCE per turn, and only when you don't already know the path. If you know (or can guess) the file path, go straight to read_file.
- If you can answer from existing conversation context, just answer.
- For multi-file write tasks the 30-hop budget comfortably handles ~12 reads + 12 writes in one turn. Plan the budget at the start of the task. If the work genuinely needs more than 30 calls, complete the first batch and tell Ken what's still pending — never promise a future-tense action you cannot complete this turn.
- MASS STUDENT UPDATES: When Ken asks you to update many student files from a CSV or spreadsheet, ALWAYS use the bulk_update_clients tool — it processes all students in ONE tool call instead of dozens. Never use individual create_or_update_file calls when bulk_update_clients can do the job.

Style: friendly, plain English, step-by-step. Ken is non-technical. Never invent student names, prices, or facts — read the repo.

THE The Inspector Playbook DASHBOARD — KNOW WHAT KEN IS LOOKING AT:
Ken runs The Inspector Playbook from the dashboard at dashboard.theinspectorplaybook.com. You live on its "Max Pro" tab. Know the full layout so you can guide Ken to the right place and help with what's on each tab:
- Overview — the Command Center: top-line KPIs (revenue, enrolled students, MRR, completion rate, refunds), an "Awaiting Your Review" list, a read-only "Agents · In Progress" status, and a Platform Snapshot.
- Contacts — students, members, and prospects. GoHighLevel is the CRM (tag-based: student / member / prospect / mastermind); there is no separate contact database.
- Calendars — team meetings, coaching/Mastermind calls, and campaign dates (GHL calendar).
- Journal — Corporate / Ken's / Beth's journals (see JOURNAL section below). GitHub-synced, with edit/delete/comment.
- GHL — the GoHighLevel platform view: the full course catalog and platform health. Courses, CRM, email, and website all run on GHL.
- Task / Support — build-out tasks and team work; the detailed board lives in Monday.com.
- Support Service — student/member support tickets, handled in Help Scout (no custom ticket system).
- Team — the The Inspector Playbook agent roster: Max (you), Pax (Research), Nolan (HR).
- Max Pro — this chat. You are the orchestrator here.
- Settings — business info, integrations, and the repository hard rules.
There is intentionally NO "Hamming Monitoring" tab on The Inspector Playbook — that belongs to Outcrop, not The Inspector Playbook.
When Ken asks "where do I find X" or "what's on the dashboard", answer from this map. When he asks about data behind a tab (courses, journal, students), use your tools to read the repo or the connected platform — don't guess.

When Ken uploads a file and asks you to file it somewhere (team-inbox, owners-inbox, students, meetings), use create_or_update_file to commit it to the correct folder with a descriptive filename.

GIVING FILES TO KEN — IMPORTANT:
When Ken asks you for a file, a deliverable, a work output, or says "send me X", "grab X", "get me the X", or "I need the X" — he CANNOT browse repo folders and CANNOT open a file from a path. NEVER reply with just a file path or "it's in the Owner's Inbox, you can download it there". Instead, in THIS SAME TURN, call read_file on the requested file. The dashboard turns every read_file result into a chip with a Download button — that chip IS how Ken receives the file. If you are unsure which file he means, use list_directory or search_knowledge to locate it first, then read_file the right one. Always hand him the file inside the chat; never point him at a folder.

When making any commit, use a clear commit message and commit to branch "main" unless told otherwise.

ORCHESTRATION RULES — THE IRON RULE:

You are the orchestrator. That is your title, your identity, and how you introduce yourself when asked. Never say you are not the orchestrator.

You NEVER execute specialist work yourself — that is the Iron Rule. You have a call_specialist tool that connects you to each team member as an independent AI. When a task belongs to a specialist's domain, you MUST use call_specialist to route it. You route, synthesize, and report. You do NOT wear hats.

ROUTING RULES:
When Ken asks for work that an agent owns (e.g. "have Pax pull the competitor analysis"):
1. Use call_specialist to route the task to the right agent with a clear, complete brief
2. The specialist will do the work — read files, produce deliverables, commit to the repo
3. When the specialist returns, synthesize their output for Ken in plain English
4. If a paper-trail task brief in /team-inbox/ is also useful, write it AS WELL

WHAT YOU DO DIRECTLY (without calling a specialist):
- Answer questions about the team, the business, or the repo structure
- Read files and look things up for Ken (search_knowledge, read_file, list_directory)
- File quick notes or logs (create_or_update_file for simple saves)
- Synthesize and summarize specialist outputs
- Run daily standups, session briefings, and status checks
- Check Monday.com tasks and project status (monday_com tool)
- Access GHL sub-accounts, contacts, pipelines, conversations, calendars, workflows, and funnels (ghl tool)
- Pull Google Analytics data: traffic, page views, sessions, conversions, top pages (google_analytics tool)
- Pull Google Search Console data: impressions, clicks, CTR, top queries, top pages (search_console tool)
- Read, summarize, and create journal entries (the Journal Tab in the The Inspector Playbook dashboard reads from the repo)

JOURNAL — YOU HAVE FULL ACCESS:
The The Inspector Playbook dashboard has a Journal Tab backed by markdown files in the repo:
- journals/corporate-journal.md — shared team journal
- journals/ken-journal.md — Ken's personal journal
- journals/beth-journal.md — Beth's personal journal

The Journal Tab supports full create / edit / delete / comment, and every change is committed to GitHub — so journal updates made from the Philippines or the USA all read and write the same source of truth. When Ken (or Dil/Beth) adds an entry in the dashboard, it lands in these files; when you write to these files, it shows up in the dashboard.

When Ken asks about journal entries, past notes, meeting notes, decisions, or anything "in the journal":
1. Use read_file on the relevant journal file (or search_knowledge if unsure which one)
2. Parse and summarize the entries in plain English
3. You can also CREATE new entries by writing to those files using create_or_update_file — follow the existing format: ## YYYY-MM-DD — Title, **Written by:**, **Category:**, **Status:**, content, then ---
Never say you "don't have visibility" into the journal — you have full read and write access via the repo tools.

DASHBOARD CHANGES — AUTO-DEPLOY RULE:
You have a deploy tool that pushes committed changes live to the dashboard server automatically. Ken should NEVER need to open a terminal, run git pull, or restart anything.

The rule is simple: any time you use create_or_update_file to change dashboard/index.html or server.js, you MUST call deploy in the very next tool call. No exceptions.

Correct sequence for a dashboard change:
1. create_or_update_file → commit the change to GitHub
2. deploy → pulls the commit and reloads the server (~10 seconds)
3. Tell the user: "Done — the change is live."

Never tell Ken to "pull and restart" or "go to the terminal". If the deploy tool returns an error, report it and tell Ken — do not leave them without a live update.

MONDAY.COM — YOU ARE KEN'S TASK ASSISTANT:
You have direct access to Monday.com via the monday_com tool. Use it proactively whenever Ken asks about tasks, project status, deadlines, who's working on what, what's overdue, or what's stuck.
- When Ken asks "what's going on" or "daily standup" or "what needs my attention" — pull Monday.com boards and identify overdue items, stuck tasks, and items with no updates.
- When Ken asks to update a task status — use update_status action.
- When Ken asks to add a comment or note to a task — use add_update action.
- When Ken asks to create a new task — use create_item action.
- Always start with get_boards to find available boards, then get_board to pull items.
- Report Monday.com data in a clean, scannable format: group tasks by status, flag overdue items, and highlight anything stuck.

GOHIGHLEVEL (GHL) — FULL ACCESS:
You have direct access to GHL via the ghl tool. The Inspector Playbook uses GHL for courses, email marketing, and the public website.
- Start with "list_locations" to see all sub-accounts (one per location or division)
- Use location_id to access any sub-account's contacts, pipelines, conversations, calendars, workflows, and funnels
- When Ken asks about a student or course, look up the relevant sub-account first, then pull the relevant data
- Use "custom" action for any GHL API endpoint not covered by the built-in actions
- GHL API docs base URL: https://services.leadconnectorhq.com

WHAT YOU ROUTE TO SPECIALISTS:
- Research tasks → Pax
- HR / team roster tasks → Nolan

WHEN A SPECIALIST RETURNS INCOMPLETE WORK:
Call call_specialist again with a better brief, or tell Ken what happened and ask for direction. Do not produce the work yourself.

BRIEF QUALITY:
When you call a specialist, the brief must be complete and self-contained — the specialist has NO conversation history. Include: what to do, which student/course/topic, relevant file paths, and the deliverable format. Do NOT tell the specialist to write to owners-inbox unless Ken explicitly asked for the output to be saved/filed.

NO TEXT IN THE ROUTING HOP — STREAMING RULE:
When you call call_specialist, your response must contain ONLY the tool_use block. Zero text. Your text streams to the dashboard before the specialist runs — if you write text and call the tool in the same hop, Ken reads your text instead of the specialist's output. Correct pattern: Hop 1 = tool call only, Hop 2 = present the specialist's output + synthesis + NEXT STEP.

PRESENTING SPECIALIST OUTPUT:
When a specialist returns their work, include the FULL content in your reply to Ken — do NOT just say "Pax wrote the report and filed it" or point Ken to a file path. Ken is in the chat and expects to receive the content HERE. Paste the specialist's full output directly into your reply, then add your own synthesis/summary below it.

HOW TO ANSWER ATTRIBUTION QUESTIONS:
When Ken asks "did you write this or did the specialist?", check your tool_result history. Specialist tool_results are tagged with "[SPECIALIST OUTPUT — PRODUCED BY <NAME>]" by the server. If that tag is present, the specialist produced the content — you are relaying it. Say: "The specialist wrote it. I called call_specialist, they ran independently, and I presented their output." Say "I wrote it" only when you did not call call_specialist at all.

EVERY TURN ENDS WITH A "NEXT STEP" SECTION:

The last paragraph of every reply must be titled "**NEXT STEP**" (literally that header). It tells Ken exactly what to do next, in one of three forms:

- "**NEXT STEP** — None. This is complete." (when the task is fully done)
- "**NEXT STEP** — Review the deliverable at [path] and tell me if you want changes." (when Ken needs to review)
- "**NEXT STEP** — To continue, paste this prompt back to me: \`<exact prompt text>\`" (when more work is queued and a follow-up turn is needed)

Never end a reply without one of these three. If you ever assign a task without doing the work, the NEXT STEP must contain the exact prompt Ken can paste to push the work forward — so he never has to guess.

PASTE-PROMPT QUALITY RULES (the frontend renders these as one-click Continue buttons — if the paste-prompt is junk, Ken clicks it and gets a useless turn):

- The paste-prompt MUST be a complete, self-contained instruction — a full sentence with a verb. Treat it like Ken is going to send it to you cold with no context.
- NEVER use a bare filename, folder name, person's name, status word, or single-word answer as a paste-prompt. Those are not instructions.
  - ❌ BAD: \`owners-inbox/2026-05-19-foo.md\`
  - ❌ BAD: \`Yes\`
  - ❌ BAD: \`Send it\`
  - ✅ GOOD: \`Max, read owners-inbox/2026-05-19-foo.md and summarize the open items in 3 bullets.\`
  - ✅ GOOD: \`Max, pull the competitor analysis for online home inspection courses and file it in owners-inbox.\`
- If the next step is genuinely a user-side action (like "review and approve"), use the second form ("Review the deliverable at [path] and tell me…") — NOT a paste-prompt with a useless filename.
- If the work is complete and no follow-up is needed, use the first form ("None. This is complete.") — do NOT invent a paste-prompt just to fill the slot.`;

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the The Inspector Playbook repo. Returns file contents as text.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative path, e.g. 'students/john-doe/STUDENT_INFO.md'" } },
      required: ["path"],
    },
  },
  {
    name: "list_directory",
    description: "List files and folders at a path in the The Inspector Playbook repo.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Repo-relative folder path, '' for root" } },
      required: ["path"],
    },
  },
  {
    name: "create_or_update_file",
    description: "Create a new file or update an existing one in the The Inspector Playbook repo. Commits directly to main.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path, e.g. 'owners-inbox/2026-05-22-pax-research.md'" },
        content: { type: "string", description: "Full file content (markdown or text)" },
        message: { type: "string", description: "Commit message" },
      },
      required: ["path", "content", "message"],
    },
  },
  {
    name: "list_open_pull_requests",
    description: "List open pull requests in the The Inspector Playbook repo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_recent_commits",
    description: "List the most recent commits on main branch.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many commits (default 10)" } },
    },
  },
  {
    name: "search_knowledge",
    description: "Semantic search across all The Inspector Playbook business files (students, courses, team profiles, meetings, resources). Finds relevant passages by meaning, even when you do not know the exact file or wording. Use this to recall facts before guessing or before browsing with list_directory.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What you want to find, in natural language" } },
      required: ["query"],
    },
  },
  {
    name: "bulk_update_clients",
    description: "Update all student/course info files in /students/ (or /clients/) from a CSV export in one server-side pass — no per-file tool calls needed. Pass the full CSV text and the server writes every record at once. Returns a summary of updated/created/skipped counts. Processes The Inspector Playbook students and course enrollments.",
    input_schema: {
      type: "object",
      properties: {
        csv: { type: "string", description: "Full CSV text from the The Inspector Playbook student/course export" },
      },
      required: ["csv"],
    },
  },
  {
    name: "call_specialist",
    description: "Route a task to an independent specialist agent. The specialist runs as a separate AI with their own expertise, reads/writes files on their own, and returns their completed work. Use this whenever a task belongs to a specialist's domain — do NOT do their work yourself. Available specialists: pax (Research), nolan (HR).",
    input_schema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Specialist name (lowercase): pax, nolan" },
        task: { type: "string", description: "Complete task brief for the specialist. Include all context they need — file paths, student/course names, deliverable format, where to save output. The specialist has no conversation history; this brief is all they see." },
      },
      required: ["agent", "task"],
    },
  },
  {
    name: "monday_com",
    description: `Query or update Monday.com boards, items, and tasks. Use this tool whenever Ken asks about tasks, project status, what's overdue, what's stuck, or anything related to Monday.com work management.

Actions:
- "get_boards" — list all boards in the workspace
- "get_board" — get all items, statuses, people, dates, updates, and subitems for a specific board (requires board_id)
- "update_status" — change an item's status column (requires item_id, column_id, label)
- "add_update" — post a comment/update on an item (requires item_id, body)
- "create_item" — create a new item on a board (requires board_id, item_name, optionally group_id)

Always start with "get_boards" to find available boards, then "get_board" to pull items from a specific board.`,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get_boards", "get_board", "update_status", "add_update", "create_item"], description: "The Monday.com action to perform" },
        board_id: { type: "string", description: "Board ID (required for get_board, create_item)" },
        item_id: { type: "string", description: "Item ID (required for update_status, add_update)" },
        column_id: { type: "string", description: "Column ID for status updates (required for update_status)" },
        label: { type: "string", description: "New status label, e.g. 'Done', 'Working on it', 'Stuck' (required for update_status)" },
        body: { type: "string", description: "Update/comment text (required for add_update)" },
        item_name: { type: "string", description: "Name for new item (required for create_item)" },
        group_id: { type: "string", description: "Group ID to place new item in (optional for create_item)" },
      },
      required: ["action"],
    },
  },
  {
    name: "ghl",
    description: `Query or manage GoHighLevel (GHL) data. The Inspector Playbook uses GHL for courses, email marketing, and the public website.

Actions:
- "list_locations" — list all sub-accounts/locations in the agency
- "get_location" — get details of a specific sub-account (requires location_id)
- "search_contacts" — search contacts in a sub-account (requires location_id, query)
- "get_contact" — get a specific contact's details (requires contact_id)
- "list_opportunities" — list opportunities/pipeline items (requires location_id, optionally pipeline_id)
- "list_pipelines" — list pipelines in a sub-account (requires location_id)
- "list_calendars" — list calendars in a sub-account (requires location_id)
- "list_conversations" — list recent conversations (requires location_id)
- "get_conversation" — get messages in a conversation (requires conversation_id)
- "list_workflows" — list workflows in a sub-account (requires location_id)
- "list_funnels" — list funnels/websites in a sub-account (requires location_id)
- "custom" — make a custom API call (requires method, endpoint, optionally body)

Start with "list_locations" to find sub-accounts, then use location_id for sub-account-specific queries.`,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "The GHL action to perform" },
        location_id: { type: "string", description: "Sub-account/location ID" },
        contact_id: { type: "string", description: "Contact ID" },
        conversation_id: { type: "string", description: "Conversation ID" },
        pipeline_id: { type: "string", description: "Pipeline ID" },
        query: { type: "string", description: "Search query for contacts" },
        method: { type: "string", description: "HTTP method for custom calls (GET, POST, PUT, DELETE)" },
        endpoint: { type: "string", description: "API endpoint path for custom calls (e.g. /contacts/)" },
        body: { type: "string", description: "JSON body for custom POST/PUT calls" },
      },
      required: ["action"],
    },
  },
  {
    name: "google_analytics",
    description: `Query Google Analytics (GA4) for any The Inspector Playbook website. Use this to check website traffic, page views, sessions, conversions, top pages, user demographics, and campaign performance.

Actions:
- "list_properties" — list all GA4 properties the service account has access to
- "report" — run a report on a specific property (requires property_id, date_range, metrics, optionally dimensions)

Common metrics: sessions, totalUsers, newUsers, screenPageViews, averageSessionDuration, bounceRate, conversions
Common dimensions: date, pagePath, city, country, sessionSource, sessionMedium, deviceCategory

Example: To get the last 30 days of traffic for a property, use action "report" with property_id, start_date "30daysAgo", end_date "today", metrics ["sessions","totalUsers","screenPageViews"].`,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_properties", "report"], description: "The action to perform" },
        property_id: { type: "string", description: "GA4 property ID (numeric, e.g. '123456789')" },
        start_date: { type: "string", description: "Start date: YYYY-MM-DD or relative like '30daysAgo', '7daysAgo'" },
        end_date: { type: "string", description: "End date: YYYY-MM-DD or 'today', 'yesterday'" },
        metrics: { type: "string", description: "Comma-separated metrics: sessions,totalUsers,screenPageViews,bounceRate,conversions" },
        dimensions: { type: "string", description: "Comma-separated dimensions: date,pagePath,city,sessionSource,deviceCategory" },
      },
      required: ["action"],
    },
  },
  {
    name: "search_console",
    description: `Query Google Search Console for any The Inspector Playbook website. Use this to check search performance: impressions, clicks, CTR, average position, top queries, top pages.

Actions:
- "list_sites" — list all Search Console properties the service account has access to
- "query" — run a search analytics query (requires site_url, start_date, end_date)

Dimensions: query, page, country, device, date
Metrics are always: clicks, impressions, ctr, position

Example: To get top search queries for a site, use action "query" with site_url, start_date, end_date, dimensions "query".`,
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_sites", "query"], description: "The action to perform" },
        site_url: { type: "string", description: "Site URL exactly as registered in Search Console (e.g. 'https://www.example.com' or 'sc-domain:example.com')" },
        start_date: { type: "string", description: "Start date: YYYY-MM-DD" },
        end_date: { type: "string", description: "End date: YYYY-MM-DD" },
        dimensions: { type: "string", description: "Comma-separated: query,page,country,device,date" },
        row_limit: { type: "number", description: "Max rows to return (default 25, max 25000)" },
      },
      required: ["action"],
    },
  },
  {
    name: "deploy",
    description: "Deploy the latest committed changes to the live The Inspector Playbook dashboard server. Call this immediately after any create_or_update_file that modifies dashboard/index.html or server.js — so Ken sees the change live without anyone touching the terminal.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

async function runTool(octokit, name, input) {
  try {
    if (name === "read_file") {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: input.path, ref: DEFAULT_BRANCH,
      });
      if (Array.isArray(data)) return { error: "Path is a directory, use list_directory" };
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return { path: input.path, content };
    }
    if (name === "list_directory") {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: input.path || "", ref: DEFAULT_BRANCH,
      });
      if (!Array.isArray(data)) return { error: "Path is a file, not a directory" };
      return { path: input.path, entries: data.map((e) => ({ name: e.name, type: e.type })) };
    }
    if (name === "create_or_update_file") {
      let sha;
      try {
        const { data } = await octokit.repos.getContent({
          owner: REPO_OWNER, repo: REPO_NAME, path: input.path, ref: DEFAULT_BRANCH,
        });
        if (!Array.isArray(data)) sha = data.sha;
      } catch (e) { /* file does not exist yet */ }
      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER, repo: REPO_NAME, path: input.path, branch: DEFAULT_BRANCH,
        message: input.message,
        content: Buffer.from(input.content, "utf-8").toString("base64"),
        sha,
      });
      return { path: input.path, commit_url: data.commit.html_url };
    }
    if (name === "list_open_pull_requests") {
      const { data } = await octokit.pulls.list({
        owner: REPO_OWNER, repo: REPO_NAME, state: "open", per_page: 20,
      });
      return { prs: data.map((p) => ({ number: p.number, title: p.title, url: p.html_url, branch: p.head.ref })) };
    }
    if (name === "list_recent_commits") {
      const { data } = await octokit.repos.listCommits({
        owner: REPO_OWNER, repo: REPO_NAME, sha: DEFAULT_BRANCH, per_page: input.limit || 10,
      });
      return { commits: data.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split("\n")[0], author: c.commit.author.name, date: c.commit.author.date })) };
    }
    if (name === "search_knowledge") {
      const res = await searchKnowledge(input.query, 6);
      if (!res.available) {
        return { note: "The knowledge index is not built yet — run 'npm run index-knowledge' on the server. Use read_file / list_directory instead for now." };
      }
      return { query: input.query, passages: res.results };
    }

    if (name === "ghl") {
      const agencyToken = process.env.GHL_API_KEY;
      const locationToken = process.env.GHL_LOCATION_KEY;
      let oauthTokens = await getValidToken();

      if (!agencyToken && !locationToken && !oauthTokens) return { error: "GHL not configured. Add GHL_API_KEY or GHL_LOCATION_KEY to .env, or visit /api/ghl/auth to authorize." };

      const GHL_BASE = "https://services.leadconnectorhq.com";
      const GHL_VERSION = "2021-07-28";

      async function ghlFetch(method, path, body, locationId) {
        let token;
        if (locationId) {
          const locEntry = GHL_LOCATION_TOKENS[locationId];
          if (locEntry && locEntry.token === "USE_GHL_LOCATION_KEY_ENV") {
            token = locationToken;
          } else if (locEntry && locEntry.token) {
            token = locEntry.token;
          }
          if (!token && oauthTokens && oauthTokens.access_token) {
            if (locationId === oauthTokens.location_id) token = oauthTokens.access_token;
            else { try { const lt = await getLocationToken(locationId); if (lt) token = lt; } catch(e) {} }
          }
        }
        if (!token && agencyToken) token = agencyToken;
        if (!token && oauthTokens) token = oauthTokens.access_token;
        if (!token) throw new Error("No GHL token available for this location. Add its token to location-tokens.json.");
        const headers = {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "Version": GHL_VERSION,
        };
        if (body) headers["Content-Type"] = "application/json";
        const opts = { method, headers };
        if (body) opts.body = typeof body === "string" ? body : JSON.stringify(body);
        const resp = await fetch(`${GHL_BASE}${path}`, opts);
        if (!resp.ok) {
          let errText = "";
          try { errText = await resp.text(); } catch(e) {}
          throw new Error(`GHL API ${resp.status}: ${errText.slice(0, 300)}`);
        }
        return resp.json();
      }

      if (input.action === "list_locations") {
        const data = await ghlFetch("GET", "/locations/search?limit=100&order=asc");
        const locs = (data.locations || []).map(l => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, city: l.city, state: l.state }));
        return { locations: locs, count: locs.length };
      }

      if (input.action === "get_location") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/locations/${input.location_id}`);
        return { location: data.location || data };
      }

      if (input.action === "search_contacts") {
        if (!input.location_id) return { error: "location_id is required" };
        const q = encodeURIComponent(input.query || "");
        const data = await ghlFetch("GET", `/contacts/?locationId=${input.location_id}&query=${q}&limit=20`, null, input.location_id);
        const contacts = (data.contacts || []).map(c => ({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim(), email: c.email, phone: c.phone, tags: c.tags, dateAdded: c.dateAdded }));
        return { contacts, count: contacts.length };
      }

      if (input.action === "get_contact") {
        if (!input.contact_id) return { error: "contact_id is required" };
        const data = await ghlFetch("GET", `/contacts/${input.contact_id}`, null, input.location_id);
        return { contact: data.contact || data };
      }

      if (input.action === "list_pipelines") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/opportunities/pipelines?locationId=${input.location_id}`, null, input.location_id);
        return { pipelines: data.pipelines || data };
      }

      if (input.action === "list_opportunities") {
        if (!input.location_id) return { error: "location_id is required" };
        let path = `/opportunities/search?location_id=${input.location_id}&limit=20`;
        if (input.pipeline_id) path += `&pipeline_id=${input.pipeline_id}`;
        const data = await ghlFetch("GET", path, null, input.location_id);
        return { opportunities: data.opportunities || data, count: data.meta?.total };
      }

      if (input.action === "list_calendars") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/calendars/?locationId=${input.location_id}`, null, input.location_id);
        return { calendars: data.calendars || data };
      }

      if (input.action === "list_conversations") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/conversations/search?locationId=${input.location_id}&limit=20`, null, input.location_id);
        return { conversations: (data.conversations || []).map(c => ({ id: c.id, contactId: c.contactId, type: c.type, lastMessageDate: c.lastMessageDate, unreadCount: c.unreadCount })) };
      }

      if (input.action === "get_conversation") {
        if (!input.conversation_id) return { error: "conversation_id is required" };
        const data = await ghlFetch("GET", `/conversations/${input.conversation_id}/messages`, null, input.location_id);
        return { messages: data.messages || data };
      }

      if (input.action === "list_workflows") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/workflows/?locationId=${input.location_id}`, null, input.location_id);
        return { workflows: (data.workflows || []).map(w => ({ id: w.id, name: w.name, status: w.status })) };
      }

      if (input.action === "list_funnels") {
        if (!input.location_id) return { error: "location_id is required" };
        const data = await ghlFetch("GET", `/funnels/funnel/list?locationId=${input.location_id}&limit=50`, null, input.location_id);
        return { funnels: data.funnels || data };
      }

      if (input.action === "custom") {
        if (!input.method || !input.endpoint) return { error: "method and endpoint are required" };
        const body = input.body ? JSON.parse(input.body) : undefined;
        const data = await ghlFetch(input.method.toUpperCase(), input.endpoint, body);
        return data;
      }

      return { error: `Unknown GHL action: ${input.action}` };
    }

    if (name === "deploy") {
      const host = process.env.DASHBOARD_HOST || "localhost:3002";
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const resp = await fetch(`${protocol}://${host}/api/deploy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GITHUB_TOKEN_HIGA}`,
        },
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.error || resp.statusText };
      return { ok: true, message: "Deployed. Changes will be live in ~10 seconds." };
    }

    if (name === "bulk_update_clients") {
      const host = process.env.DASHBOARD_HOST || "localhost:3002";
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const resp = await fetch(`${protocol}://${host}/api/bulk-update-clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: input.csv }),
      });
      const data = await resp.json();
      if (!resp.ok) return { error: data.error || resp.statusText };
      return data;
    }

    if (name === "monday_com") {
      const mondayToken = process.env.MONDAY_API_KEY;
      if (!mondayToken) return { error: "MONDAY_API_KEY not configured on the server. Add it to .env on the server." };

      async function mondayQuery(query, variables) {
        const resp = await fetch("https://api.monday.com/v2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": mondayToken, "API-Version": "2024-10" },
          body: JSON.stringify({ query, variables }),
        });
        if (!resp.ok) throw new Error(`Monday.com API returned ${resp.status}`);
        const json = await resp.json();
        if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
        return json.data;
      }

      if (input.action === "get_boards") {
        const data = await mondayQuery(`{ boards(limit: 50, board_kind: public) { id name description board_kind } }`);
        const boards = (data.boards || []).filter(b => !b.name.toLowerCase().startsWith("subitems of"));
        return { boards: boards.map(b => ({ id: b.id, name: b.name, description: b.description })) };
      }

      if (input.action === "get_board") {
        if (!input.board_id) return { error: "board_id is required for get_board" };
        const data = await mondayQuery(`query ($ids: [ID!]) {
          boards(ids: $ids) {
            id name
            columns { id title type }
            groups { id title color }
            items_page(limit: 200) {
              items {
                id name
                group { id title }
                column_values { id text type value }
                subitems { id name column_values { id text type value } }
                updates(limit: 2) { text_body created_at creator { name } }
              }
            }
          }
        }`, { ids: [input.board_id] });
        const board = data.boards && data.boards[0];
        if (!board) return { error: "Board not found" };
        const items = (board.items_page?.items || []).map(item => {
          const cols = {};
          for (const cv of item.column_values) {
            if (cv.text) cols[cv.id] = cv.text;
          }
          return {
            id: item.id, name: item.name, group: item.group?.title || "Ungrouped",
            columns: cols,
            subitems: (item.subitems || []).map(s => {
              const sc = {};
              for (const cv of s.column_values) { if (cv.text) sc[cv.id] = cv.text; }
              return { id: s.id, name: s.name, columns: sc };
            }),
            latest_update: item.updates?.[0] ? { by: item.updates[0].creator?.name, text: item.updates[0].text_body?.slice(0, 200), date: item.updates[0].created_at } : null,
          };
        });
        return { board: board.name, board_id: board.id, columns: board.columns.map(c => ({ id: c.id, title: c.title, type: c.type })), groups: board.groups, items };
      }

      if (input.action === "update_status") {
        if (!input.item_id || !input.column_id || !input.label) return { error: "item_id, column_id, and label are required" };
        const data = await mondayQuery(`mutation ($item: ID!, $col: String!, $val: JSON!) {
          change_column_value(item_id: $item, column_id: $col, board_id: 0, value: $val) { id name }
        }`, { item: input.item_id, col: input.column_id, val: JSON.stringify({ label: input.label }) });
        return { updated: true, item: data.change_column_value };
      }

      if (input.action === "add_update") {
        if (!input.item_id || !input.body) return { error: "item_id and body are required" };
        const data = await mondayQuery(`mutation ($item: ID!, $body: String!) {
          create_update(item_id: $item, body: $body) { id created_at }
        }`, { item: input.item_id, body: input.body });
        return { posted: true, update: data.create_update };
      }

      if (input.action === "create_item") {
        if (!input.board_id || !input.item_name) return { error: "board_id and item_name are required" };
        const vars = { board: input.board_id, name: input.item_name };
        let mutation = `mutation ($board: ID!, $name: String!) { create_item(board_id: $board, item_name: $name) { id name } }`;
        if (input.group_id) {
          mutation = `mutation ($board: ID!, $name: String!, $group: String!) { create_item(board_id: $board, group_id: $group, item_name: $name) { id name } }`;
          vars.group = input.group_id;
        }
        const data = await mondayQuery(mutation, vars);
        return { created: true, item: data.create_item };
      }

      return { error: `Unknown Monday.com action: ${input.action}` };
    }

    if (name === "google_analytics") {
      if (input.action === "list_properties") {
        const data = await listAnalyticsProperties();
        const props = (data.accountSummaries || []).flatMap(a =>
          (a.propertySummaries || []).map(p => ({ account: a.displayName, property: p.displayName, propertyId: p.property?.replace("properties/", "") }))
        );
        return { properties: props, count: props.length };
      }
      if (input.action === "report") {
        if (!input.property_id) return { error: "property_id is required" };
        const metrics = (input.metrics || "sessions,totalUsers,screenPageViews").split(",").map(m => ({ name: m.trim() }));
        const dimensions = input.dimensions ? input.dimensions.split(",").map(d => ({ name: d.trim() })) : undefined;
        const params = {
          dateRanges: [{ startDate: input.start_date || "30daysAgo", endDate: input.end_date || "today" }],
          metrics,
        };
        if (dimensions) params.dimensions = dimensions;
        const data = await analyticsReport(input.property_id, params);
        const headers = [...(data.dimensionHeaders || []).map(h => h.name), ...(data.metricHeaders || []).map(h => h.name)];
        const rows = (data.rows || []).map(r => {
          const vals = [...(r.dimensionValues || []).map(v => v.value), ...(r.metricValues || []).map(v => v.value)];
          const obj = {};
          headers.forEach((h, i) => obj[h] = vals[i]);
          return obj;
        });
        return { property_id: input.property_id, date_range: `${input.start_date || "30daysAgo"} to ${input.end_date || "today"}`, headers, rows, row_count: rows.length, totals: data.totals };
      }
      return { error: `Unknown analytics action: ${input.action}` };
    }

    if (name === "search_console") {
      if (input.action === "list_sites") {
        const data = await listSearchConsoleSites();
        return { sites: (data.siteEntry || []).map(s => ({ url: s.siteUrl, permission: s.permissionLevel })) };
      }
      if (input.action === "query") {
        if (!input.site_url) return { error: "site_url is required" };
        const params = {
          startDate: input.start_date || new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0],
          endDate: input.end_date || new Date().toISOString().split("T")[0],
          rowLimit: input.row_limit || 25,
        };
        if (input.dimensions) params.dimensions = input.dimensions.split(",").map(d => d.trim());
        const data = await searchConsoleQuery(input.site_url, params);
        return { site: input.site_url, date_range: `${params.startDate} to ${params.endDate}`, rows: data.rows || [], row_count: (data.rows || []).length };
      }
      return { error: `Unknown search_console action: ${input.action}` };
    }

    if (name === "fetch_url") {
      if (!input.url) return { error: "url is required" };
      const resp = await fetch(input.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; InspectorPlaybook-Agent/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return { error: `HTTP ${resp.status} fetching ${input.url}` };
      const raw = await resp.text();
      const contentType = resp.headers.get("content-type") || "";
      let content = raw;
      if (contentType.includes("text/html")) {
        content = raw
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
      const truncated = content.length > 15000;
      return { url: input.url, content: content.slice(0, 15000), truncated };
    }

    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

async function callSpecialist(anthropic, octokit, agentName, task, sendEvent) {
  const spec = SPECIALISTS[agentName.toLowerCase()];
  if (!spec) return { error: `Unknown specialist: ${agentName}. Available: ${Object.keys(SPECIALISTS).join(", ")}` };

  sendEvent("specialist_start", { agent: spec.name, title: spec.title, task });

  // Auto-load this specialist's charter from Team/<NAME>.md on main, live, on
  // every call. Makes the charter file the single durable source of truth: a
  // rule filed there reaches the specialist on its next call — no redeploy.
  let specialistSystem = spec.systemPrompt;
  if (spec.charterPath) {
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: spec.charterPath, ref: DEFAULT_BRANCH,
      });
      if (!Array.isArray(data) && data && data.content) {
        const charter = Buffer.from(data.content, "base64").toString("utf-8");
        specialistSystem = `${spec.systemPrompt}\n\n═══════ YOUR FULL CHARTER (${spec.charterPath}) ═══════\n${charter}`;
      }
    } catch { /* charter optional — fall back to base identity prompt */ }
  }

  const MAX_SPECIALIST_HOPS = 10;
  let working = [{ role: "user", content: task }];
  const toolsUsed = [];

  for (let hop = 0; hop < MAX_SPECIALIST_HOPS; hop++) {
    // Stream the specialist call: a non-streaming create() is rejected by the
    // Anthropic API when a request could run longer than 10 minutes (large
    // max_tokens + slow specialists), which times out the orchestrator's team.
    // .stream(...).finalMessage() returns the same Message shape.
    const response = await anthropic.messages.stream({
      model: spec.model,
      max_tokens: 4096,
      system: specialistSystem,
      tools: spec.tools,
      messages: working,
      ...(hop === MAX_SPECIALIST_HOPS - 1 ? { tool_choice: { type: "none" } } : {}),
    }).finalMessage();

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      sendEvent("specialist_done", { agent: spec.name, tools_used: toolsUsed });
      const taggedResponse = `[SPECIALIST OUTPUT — PRODUCED BY ${spec.name.toUpperCase()}, NOT BY MAX. ${spec.name} ran as an independent AI agent in a separate API session and produced the following output autonomously. Max is relaying this output, not authoring it.]\n\n${text}`;
      return { agent: spec.name, title: spec.title, response: taggedResponse, tools_used: toolsUsed };
    }

    working.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await runTool(octokit, block.name, block.input);
      const summary = { tool: block.name, input: block.input, ok: !result.error };
      if (result.commit_url) summary.commit_url = result.commit_url;
      toolsUsed.push(summary);
      sendEvent("specialist_tool", { agent: spec.name, ...summary });
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result).slice(0, 30000),
      });
    }
    working.push({ role: "user", content: toolResults });
  }

  sendEvent("specialist_done", { agent: spec.name, tools_used: toolsUsed });
  return { agent: spec.name, title: spec.title, response: "Specialist reached maximum tool calls.", tools_used: toolsUsed };
}

export default async function handler(req, res) {
  // CORS — allow the dashboard (and any origin) to call this API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  if (!process.env.GITHUB_TOKEN_HIGA) return res.status(500).json({ error: "GITHUB_TOKEN_HIGA not configured" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: "messages array required" });

  // Switch the response into a Server-Sent Events stream. The client appends
  // text deltas to the bubble as they arrive, so even a long answer feels
  // instant — and the connection staying alive keeps the proxy from killing
  // the request as quickly as a buffered response would.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const sendEvent = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  // Padding write forces the response handler to flush headers + first
  // chunk immediately, instead of waiting for Anthropic's first token.
  res.write(`: stream-open ${Date.now()}\n\n`);
  // Heartbeat every 10s during long stretches (e.g. while a tool call to
  // GitHub is in flight) so the proxy doesn't kill the connection.
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch {}
  }, 10000);
  const cleanup = () => { try { clearInterval(heartbeat); } catch {} };

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN_HIGA });

    // Auto-load Max's own charter from Team/MAX.md on main, the same way each
    // specialist's charter is loaded in callSpecialist. Makes Team/MAX.md the
    // single live source of truth: any rule filed there reaches Max on his next
    // message — no code change, no redeploy, no index rebuild.
    let systemBase = SYSTEM_PROMPT;
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: "Team/MAX.md", ref: DEFAULT_BRANCH,
      });
      if (!Array.isArray(data) && data && data.content) {
        const charter = Buffer.from(data.content, "base64").toString("utf-8");
        systemBase = `${SYSTEM_PROMPT}\n\n═══════ YOUR FULL CHARTER (Team/MAX.md) ═══════\n${charter}`;
      }
    } catch { /* charter optional — fall back to base identity prompt */ }

    let working = [...messages];

    // Tally tools used in THIS turn so we can surface a summary chip at the
    // end ("📖 N reads · ✏️ N writes"). Helps Ken see what actually happened —
    // critical for catching cases where Max talks but doesn't execute.
    const tally = { read_file: 0, list_directory: 0, create_or_update_file: 0, list_open_pull_requests: 0, list_recent_commits: 0, search_knowledge: 0, call_specialist: 0, monday_com: 0, ghl: 0, google_analytics: 0, search_console: 0, deploy: 0, bulk_update_clients: 0 };

    // Conversation log — accumulated across all hops in this turn
    let fullResponse = "";
    const specialistsCalled = [];

    // At ~6-10s per hop (Anthropic round-trip + tool execution + streaming),
    // 30 hops gives Max enough room for complex multi-file tasks while
    // still putting a hard ceiling on runaway loops.
    const MAX_HOPS = 30;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const isFinalHop = hop === MAX_HOPS - 1;
      // On the final allowed hop inject a system reminder telling Max he
      // has zero tools left — so he can't write code that says "I'll execute
      // now" while having no way to execute.
      let systemForHop = systemBase;
      if (isFinalHop) {
        systemForHop = systemBase + `\n\n[SYSTEM REMINDER — FINAL HOP] You have NO tool calls available on this reply. You CANNOT read, list, or write any files in this turn. Do NOT promise future actions ("I'll execute…", "Now I'll write…", etc.). Report only what you have ALREADY accomplished in this conversation using past tense. If a multi-step task is unfinished, the first line of your reply MUST clearly tell Ken what is still pending and ask him to send a follow-up message for the rest.`;
      }
      const callParams = {
        model: MODEL,
        max_tokens: 16384,
        system: systemForHop,
        tools: TOOLS,
        messages: working,
      };
      // On the final allowed hop, force a text answer (no more tools) so Ken
      // gets a real reply instead of a cryptic error.
      if (isFinalHop) {
        callParams.tool_choice = { type: "none" };
      }

      // Stream this hop. Track hopText separately so we can retract it if the
      // hop turns out to be a tool-use (routing) hop. The orchestrator must not
      // pass its own prose off as a specialist's output — if it writes text AND
      // calls call_specialist in the same hop, the text was a hat-wearing attempt
      // and we clear it from the client before the specialist's real output lands.
      const stream = anthropic.messages.stream(callParams);
      let hopText = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta &&
          event.delta.type === "text_delta" &&
          event.delta.text
        ) {
          sendEvent("text", { delta: event.delta.text });
          hopText += event.delta.text;
        }
      }
      const finalMessage = await stream.finalMessage();

      if (finalMessage.stop_reason !== "tool_use") {
        fullResponse += hopText; // text-only hop — real answer, keep it
        sendEvent("done", { stop_reason: finalMessage.stop_reason, tally });
        cleanup();
        await logConversation(octokit, messages, fullResponse, specialistsCalled);
        return res.end();
      }

      // Tool-use hop: retract any text Max streamed (hat-wearing attempt).
      // hopText is intentionally NOT added to fullResponse.
      if (hopText.trim()) sendEvent("retract", { reason: "text_in_tool_hop" });

      // Tool-use round: execute every tool block, stream events back, loop.
      working.push({ role: "assistant", content: finalMessage.content });
      const toolResults = [];
      for (const block of finalMessage.content) {
        if (block.type !== "tool_use") continue;
        tally[block.name] = (tally[block.name] || 0) + 1;
        sendEvent("tool_start", { tool: block.name, input: block.input });

        let result;
        if (block.name === "call_specialist") {
          result = await callSpecialist(anthropic, octokit, block.input.agent, block.input.task, sendEvent);
          if (result && result.agent) specialistsCalled.push({ name: result.agent, title: result.title || "" });
        } else {
          result = await runTool(octokit, block.name, block.input);
        }

        const preview = (() => {
          if (block.name === "call_specialist" && result && typeof result.response === "string") {
            return result.response.slice(0, 50000);
          }
          if (block.name === "create_or_update_file" && typeof block.input.content === "string") {
            return block.input.content.slice(0, 50000);
          }
          if (block.name === "read_file" && result && typeof result.content === "string") {
            return result.content.slice(0, 50000);
          }
          return null;
        })();
        sendEvent("tool_event", {
          tool: block.name,
          input: block.input,
          ok: !result.error,
          preview,
          commit_url: result && result.commit_url ? result.commit_url : null,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 60000),
        });
      }
      working.push({ role: "user", content: toolResults });
    }

    // Safety net — unreachable because the final hop forces tool_choice:"none".
    sendEvent("done", { stop_reason: "max_hops", tally });
    cleanup();
    await logConversation(octokit, messages, fullResponse, specialistsCalled);
    return res.end();
  } catch (err) {
    console.error("Max Pro handler error:", err);
    sendEvent("error", { error: err.message || String(err) });
    cleanup();
    return res.end();
  }
}

async function logConversation(octokit, messages, response, specialists) {
  try {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const timestamp = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const logPath = `owner-logs/max-pro-log-${monthKey}.md`;

    // Extract the most recent user message as the "topic"
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    let userText = "(no message)";
    if (lastUser) {
      if (typeof lastUser.content === "string") {
        userText = lastUser.content.trim();
      } else if (Array.isArray(lastUser.content)) {
        const textBlock = lastUser.content.find((b) => b.type === "text");
        if (textBlock) userText = textBlock.text.trim();
      }
    }

    const specLine = specialists.length
      ? specialists.map((s) => `${s.name}${s.title ? ` (${s.title})` : ""}`).join(", ")
      : "None";

    const responseBody = response.length > 3000
      ? response.slice(0, 3000) + "\n\n*[truncated — full reply visible in dashboard chat]*"
      : response || "(no response captured)";

    const entry = [
      `\n## ${timestamp}`,
      ``,
      `**Topic:** ${userText}`,
      ``,
      `**Specialists called:** ${specLine}`,
      ``,
      `**Max's reply:**`,
      responseBody,
      ``,
      `---`,
    ].join("\n");

    // Read existing file or start fresh header
    let currentContent = `# Max Pro Conversation Log — ${monthKey}\n\n*Every conversation with Max Pro is recorded here.*\n`;
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: logPath, ref: DEFAULT_BRANCH,
      });
      if (!Array.isArray(data)) {
        currentContent = Buffer.from(data.content, "base64").toString("utf-8");
        sha = data.sha;
      }
    } catch (_) { /* file doesn't exist yet — use default header */ }

    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER, repo: REPO_NAME, path: logPath, branch: DEFAULT_BRANCH,
      message: `log: Max Pro conversation — ${timestamp}`,
      content: Buffer.from(currentContent + entry, "utf-8").toString("base64"),
      sha,
    });
  } catch (err) {
    console.error("Conversation log write failed:", err.message);
    // Non-fatal — never block the response stream over a logging failure
  }
}
