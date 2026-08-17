# Handoff — Stop the Orchestrator From "Wearing Hats"

**Date:** 2026-06-04
**Purpose:** What to add to another dashboard's AI orchestrator so it dispatches work to real specialist subagents instead of doing the work itself and pretending to be them ("wearing hats").
**Source of truth:** Proven on the HIGA Max Pro orchestrator (`api/max-pro/chat.js`, `api/lib/specialists.js`). Use this as the blueprint.

---

## The problem (symptoms to look for)

The orchestrator is "wearing hats" when:

- You ask for specialist work (e.g. research) and the orchestrator **writes the answer itself** instead of routing it to the specialist.
- It then **presents that work under the specialist's name** ("Here's the report from Pax…") even though the specialist never ran.
- When challenged ("did you or the specialist do this?"), it gives **contradictory answers** — sometimes claiming it, sometimes denying it.
- "Research" comes back **unsourced** (from the model's memory) and is presented as if it were real, verified data.

This is the single-model "switching heads" pattern. It looks like a team but is one model role-playing. The fix is **true subagent dispatch**.

---

## The principle: dispatch, not hat-switching

| Hat-switching (bad) | Subagent dispatch (target) |
|---|---|
| One model role-plays each specialist in the same context. | Each specialist runs as a **separate AI session** — its own system prompt, its own tools, its own context. |
| No real independence; attribution blurs. | Real independence; the orchestrator only **routes, synthesizes, and reports.** |

---

## What to add — checklist

### 1. Give every specialist its OWN tools (make them real subagents)
A specialist with no tools is just the orchestrator talking to itself. Each specialist must have its own capabilities — at minimum **web search** so it can do genuine, sourced research.

- Use the platform's native web search (on Claude: the built-in `web_search` server tool — billed through your own API credits, no third-party key).
- Define specialists in a registry where each entry has: `name`, `title`, `model`, `tools`, `systemPrompt`.

> HIGA reference: `api/lib/specialists.js` — `WEB_TOOLS` (native `web_search` + a `fetch_url` tool), composed into `READ_TOOLS` / `WRITE_TOOLS`, assigned per specialist.

### 2. A `call_specialist` dispatch tool
The orchestrator must have a tool that spins up a specialist as an **independent API call** (own system prompt + tools), runs it to completion, and returns its output. The orchestrator does NOT execute the specialist's work in its own loop.

> HIGA reference: `callSpecialist()` in `chat.js` — separate `messages.create` with `system: spec.systemPrompt`, `tools: spec.tools`, its own hop loop.

### 3. Tag every specialist output at the server (source of truth)
When a specialist returns, wrap its output with a server-generated tag the orchestrator cannot fake, e.g.:
`[SPECIALIST OUTPUT — PRODUCED BY <NAME>, NOT BY THE ORCHESTRATOR. <NAME> ran as an independent AI session and produced this autonomously.]`
Also keep a server-side list of which specialists actually ran this turn, and surface it to the UI as a badge ("🤖 1 specialist · Pax"). **The badge is the truth, not the orchestrator's self-report.**

> HIGA reference: the `taggedResponse` string and the `specialistsCalled` array in `chat.js`.

### 4. The "Iron Rule" in the orchestrator's system prompt
Add explicit rules:
- "You NEVER execute specialist work yourself. When a task belongs to a specialist's domain, you MUST use `call_specialist`. You route, synthesize, and report. You do NOT wear hats."
- A routing map ("Research → Pax", "HR → Nolan", etc.).
- "When a specialist returns incomplete work, call it again with a better brief or ask the user — do NOT produce the work yourself."

### 5. The "no text in the routing hop" streaming rule
If the orchestrator streams text AND calls the specialist in the same step, the user reads the orchestrator's prose instead of the specialist's real output (a hat-wearing leak). Rule: **the routing step must contain ONLY the tool call, zero text.** Present the specialist's output on the next step.

> HIGA reference: the "NO TEXT IN THE ROUTING HOP" section + the server clearing `hopText` when text and `call_specialist` occur in the same hop.

### 6. Force sourcing inside the specialist prompts
- "For ANY external/factual claim (market data, competitors, pricing, trends, statistics), you MUST call `web_search` FIRST and base the claim on what you find. Do not answer factual questions from memory."
- "Never invent facts. Anything not personally verified this session must be looked up or tagged `[NEEDS SOURCE]`."
- "Lead the deliverable with a short **Sources** list."

### 7. Attribution honesty rule for the orchestrator
- "When asked 'did you or the specialist do this?', defer to the server's specialist tags/badges — they are the source of truth. If a `[SPECIALIST OUTPUT — PRODUCED BY <NAME>]` tag is present, the specialist did it and you are relaying it."
- Do **not** tell the orchestrator to "say 'I wrote it' when you didn't call a specialist" — that phrasing invites false confessions when the orchestrator can't see its own history. Have it defer to the badges instead of guessing.

---

## Known open item — true cross-turn memory (the deeper fix)

The above stops the orchestrator from *faking* hats and from *lying* about attribution. But there is a deeper issue to be aware of:

**The orchestrator's memory each turn is rebuilt from whatever the frontend resends — usually only the visible text bubbles, NOT the internal tool-call records or the specialist tags.** So on a *follow-up* question, the proof that "Pax did it" may be gone from context, and the orchestrator is guessing.

The real fix is **server-side conversation memory**: store each turn's full history (including the specialist tags) keyed to the conversation, and rebuild the orchestrator's context from that instead of the text-only history the browser sends. This is a medium-effort, server-only change. Until it's done, rely on rule #7 (defer to badges) as the mitigation.

---

## How to verify it's working

1. Ask for a research task. Confirm the UI shows a real **specialist badge** ("🤖 1 specialist") and a tool-call count — not just an orchestrator reply.
2. Confirm the deliverable **leads with sources / citations** (real URLs), not unsourced claims.
3. Ask "did you do this or the specialist?" — the orchestrator should attribute it to the specialist and not contradict itself.
4. Ask the orchestrator something factual it would normally guess — confirm it **web-searches first** rather than answering from memory.

---

## File map (HIGA blueprint to copy from)

| What | Where (HIGA) |
|---|---|
| Specialist registry (prompts + tools) | `api/lib/specialists.js` |
| Orchestrator system prompt (Iron Rule, routing, attribution) | `api/max-pro/chat.js` (the `SYSTEM_PROMPT` constant) |
| `call_specialist` dispatch + output tagging + badges | `api/max-pro/chat.js` (`callSpecialist`, `specialistsCalled`) |
| Architecture rationale | `resources/maxpro-architecture-notes.md` |
