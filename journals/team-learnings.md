# Team Learnings — The Inspector Playbook Agent Memory

A compact, **append-only** log of durable lessons. Agents **read this on session start** to begin current, and **append a one-line lesson at end of task** when something durable is learned.

## How to use
- **ON SESSION START:** read this file.
- **END OF TASK — CAPTURE:** if a task surfaced something durable (a decision Ken made, a new fact/preference, a fix, a "what works"), append one dated line below and cite it in your badge PROOF.
- **Format:** `- YYYY-MM-DD — [category] one-line lesson (source)` — categories: [decision], [course], [tooling], [process], [architecture], [what-works].
- Reusable lessons only, not routine steps. Newest first.

---

## Learnings (newest first)

- 2026-07-09 — [decision] Overview KPI strip: Ken wants courses first (Courses Available, Courses in Production), then students/completion — Monthly Revenue goes in a secondary Revenue Snapshot card below, not at the top.
- 2026-07-09 — [ops] Always commit live edits to the higa repo immediately — untracked files are lost on PM2 restart/redeploy. Create a .gitignore excluding node_modules/, .env, *.bak-*, and location-tokens.json before first big commit.
- 2026-06-12 — [architecture] Max Prime runs on the Claude Code (Agent SDK) engine, delegates to specialist sub-agents (pax, nolan) via the Task tool, ends with an ORCHESTRATOR BADGE, and never wears a hat. Auto-learning is on (read this on start, append at end of task).
- 2026-07-20 — [integration] Canva Connect API requires PKCE on every OAuth flow (even confidential clients) and the requested scope string must be a subset of the scopes checked in the Integration's Developer Portal settings, or the token exchange fails. Autofill (POST /autofills → poll GET /autofills/{id}) produces a design from a Brand Template; Export (POST /exports → poll GET /exports/{id}) is a separate second step to get an actual PNG/SVG file. Wiring lives in api/lib/canva-oauth.js + api/canva/design.js, same pattern as the existing Google/GHL OAuth modules. Brie's profile file still does not exist in Team/ despite a prior session log claiming it was created — verify against the actual repo, not the log, before assuming an agent is live.
- 2026-07-21 — [accountability] A badge PROOF that cites a Write to a server-local path (e.g. /var/www/.../Team/BRIE.md) is NOT proof of durable completion — the server's untracked files are wiped on PM2 restart and its tree drifts from git. Nolan's 2026-07-17 badge claimed Team/BRIE.md was "created" this way; it was never committed and never reached the dashboard, so Brie didn't exist for 4 days while everyone believed she did. Real proof = a git commit SHA on main (or a merged PR), not a filesystem path. To make an agent actually appear/spawnable in the dashboard you must commit BOTH Team/<NAME>.md (profile) AND .claude/agents/<name>.md (the spawnable agent), plus add them to the CLAUDE.md roster.
