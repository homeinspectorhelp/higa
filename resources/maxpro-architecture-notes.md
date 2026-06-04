# Max Pro Architecture — Dispatch, Not Hat-Switching

**Date:** 2026-06-04
**Topic:** Why Max Pro runs specialists as independent subagents instead of one model "switching hats."

---

## The two architectures

There are two common ways to build a multi-agent AI team:

| | Hat-switching (one model, one context) | Subagent dispatch (what HIGA does) |
|---|---|---|
| **How it works** | A single model role-plays each "specialist" (Pax, Nolan, …) inside the same conversation/context. | Each specialist runs as a **genuinely separate Claude API session** — its own system prompt, its own tools, its own context — launched on demand. |
| **Pros** | Context coherence; lower latency and cost (no separate calls). | True independence; focused expertise; each specialist has its own tools (e.g. Pax's own live web search). |
| **Cons** | No real separation between agents; attribution blurs; one model pretending to be many. | Handoff cost (the specialist has **no conversation history**); orchestration overhead. |

Hat-switching is usually a *fallback* — it's what platforms do when the underlying LLM **cannot** launch subagents. When a platform can spawn real subagents, dispatch is the stronger pattern: it keeps each agent focused on its specific expertise with its own capabilities.

---

## What HIGA does

Max Pro uses **true subagent dispatch**, not hat-switching:

- The `call_specialist` tool spins up each specialist (Pax, Nolan, …) as a **separate Claude API call** with its own `systemPrompt`, `tools`, and `model` (`api/lib/specialists.js`).
- The specialist runs independently, uses its own tools (web search, repo read/write, etc.), and returns a deliverable tagged `[SPECIALIST OUTPUT — PRODUCED BY <NAME>]`.
- Max's job is to **route, synthesize, and report** — never to do the specialist's work itself.

This is enforced by the **Iron Rule** in Max's system prompt: *"You NEVER execute specialist work yourself … You route, synthesize, and report. You do NOT wear hats."*

---

## Why this matters (the failure mode it prevents)

When Max breaks the Iron Rule and produces a specialist's work itself — then presents it under the specialist's name — that is a **hat-switching leak**. It looks like delegation but isn't, and it produces two problems:

1. **Unsourced output presented as researched work** — Max has no web search of its own, so research it writes itself comes from training data, not live sources.
2. **Attribution confusion** — Max can't reliably report who actually did the work.

Both were observed and fixed (2026-06-04):

- **Sourcing** — specialist prompts now *require* `web_search` for any factual claim and tag anything unverified `[NEEDS SOURCE]`.
- **Attribution honesty** — Max now defers to the server's specialist tags/badges (the source of truth) instead of guessing, so it can't falsely claim or deny authorship.

---

## The trade-off HIGA accepts

Dispatch costs more than hat-switching: the specialist starts with **no conversation history**, so Max must write a complete, self-contained brief every time (the `BRIEF QUALITY` rule), and there's extra orchestration overhead. HIGA accepts that cost deliberately — the payoff is real, tool-equipped, independent expertise (e.g. Pax doing genuine, cited web research) instead of one model impersonating a team.

**Rule of thumb for future work:** keep specialists as independent, tool-equipped subagents. Strengthen the *brief* and the *attribution*, not the temptation to let Max do the work in-context.
