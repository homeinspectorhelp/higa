// Max Prime — The Inspector Playbook business integrations for the Claude Code engine.
//
// Mirrors the Nikki Prime pattern (in-process MCP server, tools appear as
// mcp__hih__<name>). Scoped to what Max actually uses: Monday.com (task/board
// management) and GoHighLevel (the course/membership platform). Google
// Analytics/Search Console can be added later once HIGA's auth lib is confirmed.
//
// Everything degrades gracefully: a missing secret or lib makes a tool return
// "not configured" rather than crashing the engine.

import { getValidToken, getLocationToken } from "../ghl/auth.js";

const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
const fail = (msg) => ({ content: [{ type: "text", text: JSON.stringify({ error: String(msg) }) }], isError: true });

export function buildHihMcpServer(sdk, z) {
  const { tool, createSdkMcpServer } = sdk || {};
  if (!tool || !createSdkMcpServer || !z) return null;

  // ── Monday.com ──────────────────────────────────────────────────────────
  const mondayTool = tool(
    "monday_com",
    "Read and post to The Inspector Playbook's Monday.com. actions: get_boards, get_workspaces, get_board (needs board_id), update_status (item_id,column_id,label), add_update (item_id,body — subitems are items too, pass the SUBITEM's id), create_item (board_id,item_name, optional group_id). Never claim something is posted unless this tool returns posted:true with an update_id. Every write action (create_item, add_update, update_status) returns a `url` to the Monday item — ALWAYS give Ken that clickable URL when you report a Monday change; a Monday update with no link is useless to him.",
    { action: z.string(), board_id: z.string().optional(), workspace_id: z.string().optional(), item_id: z.string().optional(), column_id: z.string().optional(), label: z.string().optional(), body: z.string().optional(), item_name: z.string().optional(), group_id: z.string().optional() },
    async (input) => {
      try {
        const token = process.env.MONDAY_API_KEY;
        if (!token) return fail("MONDAY_API_KEY not configured on the server.");
        async function mq(query, variables) {
          const resp = await fetch("https://api.monday.com/v2", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": token, "API-Version": "2024-10" }, body: JSON.stringify({ query, variables }) });
          if (!resp.ok) throw new Error(`Monday.com API ${resp.status}`);
          const json = await resp.json();
          if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
          return json.data;
        }
        const a = input.action;
        if (a === "get_workspaces") { const d = await mq(`{ workspaces { id name kind description } }`); return ok({ workspaces: d.workspaces || [] }); }
        if (a === "get_boards") {
          const wsFilter = input.workspace_id ? `, workspace_ids: [${input.workspace_id}]` : "";
          let all = [], page = 1, more = true;
          while (more && page <= 100) {
            const d = await mq(`{ boards(limit: 200, page: ${page}${wsFilter}) { id name description board_kind workspace { id name } } }`);
            const raw = d.boards || [];
            all = all.concat(raw.filter(b => !b.name.toLowerCase().startsWith("subitems of")));
            more = raw.length === 200; page++;
          }
          return ok({ boards: all.map(b => ({ id: b.id, name: b.name, description: b.description, workspace: b.workspace?.name || "Main" })), total: all.length });
        }
        if (a === "get_board") {
          if (!input.board_id) return fail("board_id is required");
          const d = await mq(`query ($ids: [ID!]) { boards(ids: $ids) { id name columns { id title type } groups { id title } items_page(limit: 200) { items { id name group { id title } column_values { id text } subitems { id name column_values { id text } } updates(limit: 2) { text_body created_at creator { name } } } } } }`, { ids: [input.board_id] });
          const board = d.boards && d.boards[0];
          if (!board) return fail("Board not found");
          const items = (board.items_page?.items || []).map(item => {
            const cols = {}; for (const cv of item.column_values) if (cv.text) cols[cv.id] = cv.text;
            return { id: item.id, name: item.name, group: item.group?.title || "Ungrouped", columns: cols, subitems: (item.subitems || []).map(s => { const sc = {}; for (const cv of s.column_values) if (cv.text) sc[cv.id] = cv.text; return { id: s.id, name: s.name, columns: sc }; }), latest_update: item.updates?.[0] ? { by: item.updates[0].creator?.name, text: item.updates[0].text_body?.slice(0, 200), date: item.updates[0].created_at } : null };
          });
          return ok({ board: board.name, board_id: board.id, columns: board.columns.map(c => ({ id: c.id, title: c.title, type: c.type })), groups: board.groups, items });
        }
        if (a === "update_status") {
          if (!input.item_id || !input.column_id || !input.label) return fail("item_id, column_id, and label are required");
          const d = await mq(`mutation ($item: ID!, $col: String!, $val: JSON!) { change_column_value(item_id: $item, column_id: $col, board_id: 0, value: $val) { id name board { id name } } }`, { item: input.item_id, col: input.column_id, val: JSON.stringify({ label: input.label }) });
          const it = d.change_column_value || {};
          return ok({
            updated: true, item: { id: it.id, name: it.name }, board_name: it.board?.name || null,
            url: it.board?.id && it.id ? `https://home-inspector-help.monday.com/boards/${it.board.id}/pulls/${it.id}` : null,
            verify_note: "Give Ken the `url` so he can open the item — never report a Monday change without the link.",
          });
        }
        if (a === "add_update") {
          if (!input.item_id || !input.body) return fail("item_id and body are required");
          const d = await mq(`mutation ($item: ID!, $body: String!) { create_update(item_id: $item, body: $body) { id created_at item { id name board { id name } parent_item { id name } } } }`, { item: input.item_id, body: input.body });
          const u = d.create_update, it = u.item || {};
          return ok({ posted: true, update_id: u.id, posted_to: { item_id: it.id, item_name: it.name, board_name: it.board?.name, is_subitem: !!it.parent_item, parent_item_name: it.parent_item?.name || null } });
        }
        if (a === "create_item") {
          if (!input.board_id || !input.item_name) return fail("board_id and item_name are required");
          const vars = { board: input.board_id, name: input.item_name };
          let m = `mutation ($board: ID!, $name: String!) { create_item(board_id: $board, item_name: $name) { id name board { id name } } }`;
          if (input.group_id) { m = `mutation ($board: ID!, $name: String!, $group: String!) { create_item(board_id: $board, group_id: $group, item_name: $name) { id name board { id name } } }`; vars.group = input.group_id; }
          const d = await mq(m, vars);
          const it = d.create_item || {};
          const boardId = it.board?.id || input.board_id;
          return ok({
            created: true, item: { id: it.id, name: it.name }, board_name: it.board?.name || null,
            url: boardId && it.id ? `https://home-inspector-help.monday.com/boards/${boardId}/pulls/${it.id}` : null,
            verify_note: "Give Ken the `url` so he can open the new item — never report a Monday item created without the link.",
          });
        }
        return fail(`Unknown Monday.com action: ${a}`);
      } catch (e) { return fail(e.message || e); }
    }
  );

  // ── GoHighLevel (course/membership platform) ────────────────────────────
  const GHL_BASE = "https://services.leadconnectorhq.com";
  const GHL_VERSION = "2021-07-28";
  const ghlTool = tool(
    "ghl",
    "Query The Inspector Playbook's GoHighLevel (courses, contacts/students, pipelines, conversations, calendars, workflows, funnels). actions: list_locations; get_location (location_id); search_contacts (location_id, query); get_contact (contact_id); list_pipelines (location_id); list_opportunities (location_id, optional pipeline_id); list_calendars (location_id); list_conversations (location_id); list_workflows (location_id); list_funnels (location_id); custom (method, endpoint, optional body JSON; pass location_id for sub-account endpoints).",
    { action: z.string(), location_id: z.string().optional(), contact_id: z.string().optional(), conversation_id: z.string().optional(), pipeline_id: z.string().optional(), query: z.string().optional(), method: z.string().optional(), endpoint: z.string().optional(), body: z.string().optional() },
    async (input) => {
      try {
        const agencyToken = process.env.GHL_API_KEY, locationToken = process.env.GHL_LOCATION_KEY;
        let oauth = null; try { oauth = await getValidToken(); } catch {}
        if (!agencyToken && !locationToken && !oauth) return fail("GHL not configured. Add GHL_API_KEY or authorize via /api/ghl/auth.");
        async function gf(method, p, body, locationId) {
          let token;
          if (locationId && oauth?.access_token) { if (locationId === oauth.location_id) token = oauth.access_token; else { try { const lt = await getLocationToken(locationId); if (lt) token = lt; } catch {} } }
          if (!token) token = agencyToken || (oauth && oauth.access_token) || locationToken;
          if (!token) throw new Error("No GHL token available.");
          const headers = { "Accept": "application/json", "Authorization": `Bearer ${token}`, "Version": GHL_VERSION };
          if (body) headers["Content-Type"] = "application/json";
          const opts = { method, headers }; if (body) opts.body = typeof body === "string" ? body : JSON.stringify(body);
          const resp = await fetch(`${GHL_BASE}${p}`, opts);
          if (!resp.ok) throw new Error(`GHL API ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
          return resp.json();
        }
        const a = input.action, lid = input.location_id;
        if (a === "list_locations") { const d = await gf("GET", "/locations/search?limit=100&order=asc"); return ok({ locations: (d.locations || []).map(l => ({ id: l.id, name: l.name, email: l.email, phone: l.phone, city: l.city, state: l.state })), count: (d.locations || []).length }); }
        if (a === "get_location") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/locations/${lid}`); return ok({ location: d.location || d }); }
        if (a === "search_contacts") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/contacts/?locationId=${lid}&query=${encodeURIComponent(input.query || "")}&limit=20`, null, lid); return ok({ contacts: (d.contacts || []).map(c => ({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim(), email: c.email, phone: c.phone, tags: c.tags })) }); }
        if (a === "get_contact") { if (!input.contact_id) return fail("contact_id is required"); const d = await gf("GET", `/contacts/${input.contact_id}`, null, lid); return ok({ contact: d.contact || d }); }
        if (a === "list_pipelines") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/opportunities/pipelines?locationId=${lid}`, null, lid); return ok({ pipelines: d.pipelines || d }); }
        if (a === "list_opportunities") { if (!lid) return fail("location_id is required"); let p = `/opportunities/search?location_id=${lid}&limit=20`; if (input.pipeline_id) p += `&pipeline_id=${input.pipeline_id}`; const d = await gf("GET", p, null, lid); return ok({ opportunities: d.opportunities || d }); }
        if (a === "list_calendars") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/calendars/?locationId=${lid}`, null, lid); return ok({ calendars: d.calendars || d }); }
        if (a === "list_conversations") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/conversations/search?locationId=${lid}&limit=20`, null, lid); return ok({ conversations: (d.conversations || []).map(c => ({ id: c.id, contactId: c.contactId, type: c.type, lastMessageDate: c.lastMessageDate, unreadCount: c.unreadCount })) }); }
        if (a === "list_workflows") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/workflows/?locationId=${lid}`, null, lid); return ok({ workflows: (d.workflows || []).map(w => ({ id: w.id, name: w.name, status: w.status })) }); }
        if (a === "list_funnels") { if (!lid) return fail("location_id is required"); const d = await gf("GET", `/funnels/funnel/list?locationId=${lid}&limit=50`, null, lid); return ok({ funnels: d.funnels || d }); }
        if (a === "custom") { if (!input.method || !input.endpoint) return fail("method and endpoint are required"); const body = input.body ? JSON.parse(input.body) : undefined; return ok(await gf(input.method.toUpperCase(), input.endpoint, body, lid)); }
        return fail(`Unknown GHL action: ${a}`);
      } catch (e) { return fail(e.message || e); }
    }
  );

  // ── WordPress (REST API + Application Password) ─────────────────────────
  // The Inspector Playbook / Home Inspector Growth Academy community site
  // (homeinspectorgrowthacademy.com) runs on WordPress with MemberPress +
  // BuddyBoss. This tool reads (and, with an admin Application Password, can
  // write) site data over the REST API. Owned at the roster level by Wes
  // (Web Designer). Degrades gracefully when the WP_* secrets are absent.
  const wpTool = tool(
    "wordpress",
    "Read The Inspector Playbook / Home Inspector Growth Academy WordPress site (homeinspectorgrowthacademy.com — WordPress + MemberPress + BuddyBoss) via its REST API using an Administrator Application Password. Use for member/student lookups, membership status, login activity, posts, and pages — pull the data, never guess. actions: get_site; list_users (per_page default 50 — the members roster: name, email, roles, registered); get_user (id); list_posts (optional search, status default 'publish', per_page default 10); get_post (id); create_post (title, content; optional status default 'draft' — 'publish' to publish, 'future' + date to schedule; excerpt; categories CSV of ids; tags CSV of ids; featured_media id); update_post (id + any of title/content/status/excerpt); delete_post (id, optional force=true); list_pages; create_page (title, content, optional status); update_page (id + fields); list_categories; list_tags; list_media; custom (method, endpoint e.g. '/mp/v1/members' for MemberPress or '/wp/v2/users', optional body JSON string — for anything not covered incl. MemberPress memberships, BuddyBoss, plugins, settings). Always confirm a publish actually returned status 'publish' before telling Ken it's live.",
    {
      action: z.string(),
      id: z.number().optional(),
      title: z.string().optional(),
      content: z.string().optional(),
      excerpt: z.string().optional(),
      status: z.string().optional(),
      date: z.string().optional(),
      categories: z.string().optional(),
      tags: z.string().optional(),
      featured_media: z.number().optional(),
      search: z.string().optional(),
      per_page: z.number().optional(),
      force: z.boolean().optional(),
      method: z.string().optional(),
      endpoint: z.string().optional(),
      body: z.string().optional(),
    },
    async (input) => {
      try {
        const base = (process.env.WP_SITE_URL || "").replace(/\/+$/, "").replace(/\/wp-admin$/, "");
        const user = process.env.WP_USERNAME;
        const pass = process.env.WP_APP_PASSWORD;
        if (!base || !user || !pass) return fail("WordPress not configured. Set WP_SITE_URL, WP_USERNAME, and WP_APP_PASSWORD in the server .env.");
        const auth = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
        const wp = async (method, endpoint, body) => {
          const headers = { "Authorization": auth, "Accept": "application/json" };
          if (body) headers["Content-Type"] = "application/json";
          const resp = await fetch(`${base}/wp-json${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
          const text = await resp.text();
          let data; try { data = JSON.parse(text); } catch { data = text; }
          if (!resp.ok) {
            const msg = typeof data === "string" ? data.slice(0, 300) : (data.message || JSON.stringify(data).slice(0, 300));
            throw new Error(`WP ${resp.status}: ${msg}`);
          }
          return data;
        };
        const idsFromCsv = (s) => String(s).split(",").map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
        const postFields = () => {
          const b = {};
          if (input.title != null) b.title = input.title;
          if (input.content != null) b.content = input.content;
          if (input.excerpt != null) b.excerpt = input.excerpt;
          if (input.status != null) b.status = input.status;
          if (input.date != null) b.date = input.date;
          if (input.categories != null) b.categories = idsFromCsv(input.categories);
          if (input.tags != null) b.tags = idsFromCsv(input.tags);
          if (input.featured_media != null) b.featured_media = input.featured_media;
          return b;
        };
        const slim = (p) => ({ id: p.id, status: p.status, title: p.title?.rendered ?? p.title, link: p.link, date: p.date, modified: p.modified });
        const a = input.action;

        if (a === "get_site") { return ok(await wp("GET", "/")); }
        if (a === "list_users") {
          const d = await wp("GET", `/wp/v2/users?context=edit&per_page=${input.per_page || 50}${input.search ? `&search=${encodeURIComponent(input.search)}` : ""}`);
          return ok({ users: (d || []).map(u => ({ id: u.id, name: u.name, email: u.email, roles: u.roles, registered: u.registered_date, slug: u.slug })), count: (d || []).length });
        }
        if (a === "get_user") { if (!input.id) return fail("id is required"); return ok(await wp("GET", `/wp/v2/users/${input.id}?context=edit`)); }
        if (a === "list_posts") {
          const q = new URLSearchParams({ context: "edit", per_page: String(input.per_page || 10), status: input.status || "publish" });
          if (input.search) q.set("search", input.search);
          const d = await wp("GET", `/wp/v2/posts?${q.toString()}`);
          return ok({ posts: (d || []).map(slim), count: (d || []).length });
        }
        if (a === "get_post") { if (!input.id) return fail("id is required"); return ok(await wp("GET", `/wp/v2/posts/${input.id}?context=edit`)); }
        if (a === "create_post") { if (!input.title && !input.content) return fail("title or content is required"); const b = postFields(); if (!b.status) b.status = "draft"; const d = await wp("POST", "/wp/v2/posts", b); return ok({ created: true, post: slim(d) }); }
        if (a === "update_post") { if (!input.id) return fail("id is required"); const d = await wp("POST", `/wp/v2/posts/${input.id}`, postFields()); return ok({ updated: true, post: slim(d) }); }
        if (a === "delete_post") { if (!input.id) return fail("id is required"); const d = await wp("DELETE", `/wp/v2/posts/${input.id}${input.force ? "?force=true" : ""}`); return ok({ deleted: true, result: d?.previous ? slim(d.previous) : d }); }

        if (a === "list_pages") { const q = new URLSearchParams({ context: "edit", per_page: String(input.per_page || 20), status: input.status || "publish" }); if (input.search) q.set("search", input.search); const d = await wp("GET", `/wp/v2/pages?${q.toString()}`); return ok({ pages: (d || []).map(slim), count: (d || []).length }); }
        if (a === "create_page") { if (!input.title && !input.content) return fail("title or content is required"); const b = postFields(); if (!b.status) b.status = "draft"; const d = await wp("POST", "/wp/v2/pages", b); return ok({ created: true, page: slim(d) }); }
        if (a === "update_page") { if (!input.id) return fail("id is required"); const d = await wp("POST", `/wp/v2/pages/${input.id}`, postFields()); return ok({ updated: true, page: slim(d) }); }

        if (a === "list_categories") { const d = await wp("GET", "/wp/v2/categories?per_page=100"); return ok({ categories: (d || []).map(c => ({ id: c.id, name: c.name, count: c.count, slug: c.slug })) }); }
        if (a === "list_tags") { const d = await wp("GET", "/wp/v2/tags?per_page=100"); return ok({ tags: (d || []).map(t => ({ id: t.id, name: t.name, count: t.count, slug: t.slug })) }); }
        if (a === "list_media") { const d = await wp("GET", `/wp/v2/media?per_page=${input.per_page || 20}`); return ok({ media: (d || []).map(m => ({ id: m.id, title: m.title?.rendered, url: m.source_url, mime: m.mime_type, date: m.date })) }); }

        if (a === "custom") { if (!input.method || !input.endpoint) return fail("method and endpoint are required"); const body = input.body ? JSON.parse(input.body) : undefined; const ep = input.endpoint.startsWith("/") ? input.endpoint : `/${input.endpoint}`; return ok(await wp(input.method.toUpperCase(), ep, body)); }

        return fail(`Unknown WordPress action: ${a}`);
      } catch (e) { return fail(e.message || e); }
    }
  );

  return createSdkMcpServer({ name: "hih", version: "1.0.0", tools: [mondayTool, ghlTool, wpTool] });
}
