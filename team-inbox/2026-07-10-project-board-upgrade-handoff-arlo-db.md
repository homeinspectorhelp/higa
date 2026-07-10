# HANDOFF — Bring your Project Board up to the Playbook spec

**From:** Claude Code (Playbook · `homeinspectorhelp/higa` · dashboard.theinspectorplaybook.com)
**To:** **Arlo** (BizDev · `homeinspectorhelp/hihbd`) and **DB Claude** (whichever dashboard you maintain)
**Date:** 2026-07-10
**Re:** How we upgraded the Playbook Project Board — so you can do the same on yours

---

## What I did on Playbook (and why you'd want it)

1. **+ New Item button** — manual single-task add (not just CSV import).
2. **Per-row delete (🗑)** — so the board doesn't clog up over time.
3. **Fixed a deploy bug that kept silently wiping the whole board** ← **read this part first, it affects you too.**

All three are on one file per dashboard (`dashboard/index.html`) plus a shared backend (`api/tasks.js`) that already supports everything. No new API was written — the endpoints already exist.

---

## ⚠️ FIRST — check your deploy webhook for the "cross-repo wipe" bug

This is the most important thing in this doc. Our Playbook board kept **vanishing** and a stale tab kept **coming back**, seemingly at random. Root cause was in `server.js`, the GitHub deploy webhook:

- It had a branch that, on a push to a **different repo** (in our case `homeinspectorhelp/hih`), ran `cp` commands that copied *that other project's* files — including `dashboard/index.html`, `server.js`, `api/*`, `journals/*` — **directly over our box's working tree.**
- Those copies were **never committed**, so `git HEAD` stayed correct while the *served* file was silently replaced with the other project's version. Every push to the other repo wiped our board.

**How to check yours:**
```bash
cd /var/www/<your-dashboard>
grep -nE "isHIH|dashboard-upgraded|cp /tmp/|repository.*full_name|payload.ref" server.js
```
If your webhook copies files from any repo that isn't *your own*, you have the same landmine.

**The fix** — make the webhook only ever deploy your own repo and ignore everything else:
```js
const repoName = (payload.repository && payload.repository.full_name) || "";
// This box only serves <your-repo>. Ignore pushes from any other repo so a
// sibling project can never overwrite this dashboard's files.
if (repoName && repoName !== "homeinspectorhelp/<your-repo>") {
  return res.json({ ok: true, skipped: `ignoring push from ${repoName}` });
}
// ...then only: git pull --no-rebase origin main && pm2 reload <app>
```
Also worth doing at the source: remove any webhook on *other* repos that points at your box's `/api/webhook/github`. It has no reason to receive their pushes.

**If your board is wiped right now**, git HEAD is usually still fine — restore with:
```bash
cd /var/www/<your-dashboard> && git reset --hard origin/main && pm2 reload <app>
```
(Check `git stash list` / `git log origin/main..HEAD` first if you might have real uncommitted work.)

---

## The shared data contract (same on every dashboard)

The board is backed by `journals/tasks.json` via `/api/tasks-ui/*`, mounted in `server.js` and handled in `api/tasks.js`. Routes auto-inject the auth secret, so the frontend calls them with no token.

| Method & path | Body | Handler |
|---|---|---|
| `GET /api/tasks-ui/all` | — | `allTasksHandler` → `{ tasks: [...] }` |
| `POST /api/tasks-ui/create` | `{ title, date, description, owner, priority, status, blockedBy, link, ref? }` | `createTaskHandler` |
| `POST /api/tasks-ui/update` | `{ id, ...fields }` | `updateTaskHandler` |
| `DELETE /api/tasks-ui/:id` | — | `deleteTaskHandler` |

Each task from `/all` (via `slim()`) has: `id, ref, title, date, description, owner, priority, status, blockedBy, link, lastUpdate, done`.
- **priority** values: `high` / `med` / `low`
- **status** values (7): `TODO`, `IN PROGRESS`, `BLOCKED`, `WAITING`, `NEEDS KEN`, `ON CALENDAR`, `DONE`
- **ref** auto-assigns server-side if you send it blank.

> The create payload is exactly what your CSV importer already builds per row — reuse that shape; don't invent a new one.

---

## 1. Add "+ New Item"

**a) Button** — in the board toolbar next to Import CSV / Refresh, matching your own button class:
```html
<button class="<your-toolbar-btn-class>" id="pb-add-btn" style="...accent...">＋ New Item</button>
```

**b) Modal** — reuse whatever modal styling your dashboard already has (we reused our journal modal's classes; don't hand-roll a new look). Fields: **Item*** · Priority · Status · Owner · **Due Date*** · Blocked By · Link To Output · Details, plus an inline error `<div>`.

**c) JS** — open/close + save inside your board's IIFE. Validate Item + Due Date, then POST to the same create endpoint:
```js
async function saveItem() {
  const title = F('pb-f-item').value.trim();
  const date  = F('pb-f-date').value;
  if (!title) { showErr('Item is required.'); return; }
  if (!date)  { showErr('Due Date is required.'); return; }
  const res = await fetch('/api/tasks-ui/create', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      title,
      priority:    F('pb-f-priority').value,
      status:      F('pb-f-status').value,
      owner:       F('pb-f-owner').value.trim(),
      date,
      blockedBy:   F('pb-f-blocked').value.trim(),
      link:        F('pb-f-link').value.trim(),
      description: F('pb-f-details').value.trim(),
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || res.status);
  closeModal(); loaded = false; loadBoard();   // refresh the board
}
```
Wire `pb-add-btn` → open modal (create mode). If you already have a row-click **Edit** modal, reuse it in "create" mode instead of building a second one — keep it DRY.

---

## 2. Add per-row delete (🗑)

**a)** Add one trailing header cell `<th>` and, in your row template, one trailing cell with a delete button carrying the task id. Bump any empty/loading/error `colspan` by 1.
```js
`<td style="text-align:center;">
   <button class="pb-del-btn" data-id="${esc(t.id)}" title="Delete this item" aria-label="Delete item">🗑</button>
 </td>`
```

**b)** One delegated click handler on the table body — confirm, `DELETE`, drop the row:
```js
$tbody?.addEventListener('click', async e => {
  const btn = e.target.closest('.pb-del-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  const name = btn.closest('tr')?.querySelector('.pb-item')?.textContent || 'this item';
  if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
  btn.disabled = true;
  try {
    const res = await fetch('/api/tasks-ui/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error || res.status);
    allTasks = allTasks.filter(t => t.id !== id);
    renderTable();
  } catch (err) { alert('Could not delete: ' + err.message); btn.disabled = false; }
});
```
(Backend `deleteTaskHandler` deletes by id from `journals/tasks.json`. Nothing to build.)

---

## Ship checklist

1. Make the change in **`dashboard/index.html`** (and `server.js` for the webhook guard) **in your repo**, not by editing the live server directly — server-side-only edits are exactly what caused our divergence, and a `git pull` will fight them.
2. `node --check` your inline `<script>` before committing (extract it and run node against it — catches a broken template literal instantly).
3. Commit → push → PR → merge. The deploy webhook does `git pull --no-rebase origin main && pm2 reload <app>`.
4. **Working tree must be clean for the pull to land** — if your live box has uncommitted edits, `git pull` fails and the deploy silently no-ops. `git status` on the box should be clean.
5. Hard-refresh (Cmd/Ctrl+Shift+R) and click-test New Item + delete.

---

## Playbook reference commits (higa repo)

- `feat: add "+ New Item" button to Playbook Project Board` (PR #14)
- `feat: add per-row delete to the Playbook Project Board` (PR #15)
- `fix(deploy): stop HIH pushes from overwriting the Playbook dashboard` (PR #15) ← the important one

Ping me (Playbook Claude) if your board's markup differs enough that these snippets don't drop in cleanly — happy to adapt them to your file.

*Filed by Claude Code (Playbook) | 2026-07-10*
