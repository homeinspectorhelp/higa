# HIGA Dashboard Restore — Session Handoff
**Date:** 2026-06-04
**For:** The Claude Code session working directly on the HIGA server / higa-dashboard

---

## What Happened (Root Cause)

A Claude Code session on the HIGA server (`/var/www/higa-dashboard`) ran:

```bash
git stash && git pull origin main
```

This caused two problems:
1. **`git stash`** — stashed the correct HIGA `dashboard/index.html` (the full-featured version)
2. **`git pull origin main`** — replaced `dashboard/index.html` with the **HIH/Nikki Pro** dashboard content (wrong file, wrong dashboard entirely)

The live site at `dashboard.homeinspectorgrowthacademy.net` started serving the Nikki Pro dashboard instead of the HIGA dashboard.

---

## What Was in the Stash

There were two stashes on the server:

| Stash | Features | Notes |
|---|---|---|
| `stash@{0}` | Journal, Calendars, Contacts, Support Service, 95 maxpro refs | **The correct, most complete HIGA dashboard** |
| `stash@{1}` | Simpler version — no Journal, Calendars, Contacts | Older version, don't use |

`stash@{0}` is the one that was restored.

---

## How It Was Fixed

**Step 1 — Restored the live dashboard:**
```bash
git stash pop    # restored dashboard/index.html from stash@{0}
pm2 reload max   # picked up the correct file without downtime
```

There was a conflict in `CLAUDE.md` only (not the dashboard file). Resolved by keeping the stash (HIGA) version:
```bash
git checkout --theirs CLAUDE.md
git add CLAUDE.md
git stash drop
```

**Step 2 — Made it permanent in the HIH repo:**
```bash
cp /var/www/higa-dashboard/dashboard/index.html /tmp/hih/dashboard-upgraded.html
cd /tmp/hih
git add dashboard-upgraded.html
git commit -m "Restore full HIGA dashboard — Journal, Calendars, Contacts, Support Service tabs"
git push origin main
```

Commit: `73b8d4a` pushed to `homeinspectorhelp/hih` main branch.

---

## How Deployment Works (Critical Context)

The HIGA server **does not use git for live updates**. The deploy workflow (`.github/workflows/deploy.yml`) runs on every push to `main` of the `homeinspectorhelp/hih` repo and does this:

```bash
# Pulls HIH repo into /tmp/hih
git -C /tmp/hih pull "https://..." main

# Copies dashboard file directly
cp /tmp/hih/dashboard-upgraded.html /var/www/higa-dashboard/dashboard/index.html

# Copies server-side files
cp /tmp/hih/owners-inbox/max-pro-fix/server.js  /var/www/higa-dashboard/server.js
cp /tmp/hih/owners-inbox/max-pro-fix/chat.js    /var/www/higa-dashboard/api/max-pro/chat.js
```

**Rules that must never be broken:**
- **Never run `git stash`, `git pull`, or `git reset` inside `/var/www/higa-dashboard`** — git is not how this directory gets updated
- **Never edit `dashboard/index.html` directly on the server** — any direct edit will be overwritten by the next deploy
- To update the HIGA dashboard: edit `dashboard-upgraded.html` in the `homeinspectorhelp/hih` repo and push to main

---

## Repo & File Map

| What | Where |
|---|---|
| HIGA dashboard source file | `homeinspectorhelp/hih` → `dashboard-upgraded.html` |
| HIGA server files (server.js, chat.js, etc.) | `homeinspectorhelp/hih` → `owners-inbox/max-pro-fix/` |
| HIH (Nikki Pro) dashboard | `homeinspectorhelp/hih` → `dashboard/index.html` |
| Deploy workflow | `homeinspectorhelp/hih` → `.github/workflows/deploy.yml` |
| Live HIH clone on server | `/tmp/hih` (used by deploy, not for editing) |
| HIGA server directory | `/var/www/higa-dashboard` |

---

## Current State (as of 2026-06-04)

- Live dashboard at `dashboard.homeinspectorgrowthacademy.net` is **working correctly**
- Full feature set restored: Journal, Calendars, Contacts, Support Service, Max Pro chat
- `dashboard-upgraded.html` in HIH repo main is the correct authoritative version
- All future edits to the HIGA dashboard should be made to `dashboard-upgraded.html` in the HIH repo and pushed to main

---

## How Dil Works — Workflow for This Session

**Dil does not log into GitHub directly.** All interaction happens through **PowerShell on the server** — Dil SSHes into the server, runs commands, and pastes the terminal output back into the chat.

This means:
- You give Dil a command to run → Dil pastes the output back → you read it and give the next command
- Do not ask Dil to open GitHub in a browser, create PRs manually, or use the GitHub UI
- Do not assume Dil can see file contents without running `cat` — always give the full command
- When you need a file pushed to the HIH repo, give Dil the exact commands to run from `/tmp/hih` on the server (that's the live HIH clone)
- When something needs to be restarted, `pm2 reload max` is the command — no need for a full restart

**Example workflow:**
1. You say: "Run this on the server: `cat /var/www/higa-dashboard/dashboard/index.html | head -20`"
2. Dil runs it in PowerShell and pastes the output back
3. You read it, make a decision, give the next command

Always give Dil **one clear block of commands at a time** so the output is easy to match back to what you asked.

---

## For Future Edits

The authoritative source for the HIGA dashboard is `dashboard-upgraded.html` in the `homeinspectorhelp/hih` repo (main branch). To make a change:

1. Edit the file on the server at `/tmp/hih/dashboard-upgraded.html` (or generate new content and write it there)
2. Commit and push from `/tmp/hih`:
   ```bash
   cd /tmp/hih
   git add dashboard-upgraded.html
   git commit -m "describe the change"
   git push origin main
   ```
3. The deploy workflow fires automatically and copies the file to the live server

Do **not** make edits directly to `/var/www/higa-dashboard/dashboard/index.html` — the next deploy will overwrite it.
