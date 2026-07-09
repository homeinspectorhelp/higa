# Team Learnings — The Inspector Playbook Agent Memory

A compact, **append-only** log of durable lessons. Agents **read this on session start** to begin current, and **append a one-line lesson at end of task** when something durable is learned.

## How to use
- **ON SESSION START:** read this file.
- **END OF TASK — CAPTURE:** if a task surfaced something durable (a decision Ken made, a new fact/preference, a fix, a "what works"), append one dated line below and cite it in your badge PROOF.
- **Format:** `- YYYY-MM-DD — [category] one-line lesson (source)` — categories: [decision], [course], [tooling], [process], [architecture], [what-works].
- Reusable lessons only, not routine steps. Newest first.

---

## Learnings (newest first)

- 2026-07-09 — [ops] Always commit live edits to the higa repo immediately — untracked files are lost on PM2 restart/redeploy. Create a .gitignore excluding node_modules/, .env, *.bak-*, and location-tokens.json before first big commit.
- 2026-06-12 — [architecture] Max Prime runs on the Claude Code (Agent SDK) engine, delegates to specialist sub-agents (pax, nolan) via the Task tool, ends with an ORCHESTRATOR BADGE, and never wears a hat. Auto-learning is on (read this on start, append at end of task).
