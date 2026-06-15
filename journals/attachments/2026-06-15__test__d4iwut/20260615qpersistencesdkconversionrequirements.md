# Q Persistence — MUST-CARRY requirements for any SDK conversion

**For:** the Outcrop Claude (whoever rebuilds Q on the Claude Agent SDK)
**From:** the current Q dashboard team
**Date:** 2026-06-15
**Status:** Preventative — Q has persistence TODAY. This note exists so a future rewrite does not silently drop it (which is exactly how Nikki lost hers when her engine was upgraded to "Prime").

---

## Why this note exists (read first)

Nikki (Home Inspector Help) **had** automatic conversation logging. When her runtime was rebuilt on the new engine, the rewrite **silently dropped the auto-logger** — and nobody noticed until Ken couldn't pull up past conversations from a fresh chat. Beth has been manually "refreshing the state" ever since to paper over the gap.

**Q does NOT have that gap today.** But the moment Q is re-platformed onto the Agent SDK, it is the same risk. So these two behaviors are **hard requirements** of any Q rewrite — not nice-to-haves. If a conversion PR doesn't preserve both, it is incomplete.

---

## Requirement 1 — Auto-log every conversation to the repo (durable memory)

**What it does today:** at the end of *every* completed turn, Q commits that turn to a dated file on `main`, so Q can recall past conversations from a brand-new chat.

**Current implementation (the thing to preserve):**
- File: `api/q-pro/chat.js`, function `logConversation(octokit, messages, response, specialists)`.
- It is called at **every** exit path of the handler — normal completion AND the max-hops exit (`chat.js` ~lines 657 and 704).
- It writes to: `austin-logs/q-log-<YYYY-MM>.md` on branch `main` (one file per month, appended).
- Each entry records: UTC timestamp, **Topic** (last user message, first 200 chars), **Specialists called** (authoritative — written only when `call_specialist` actually ran), and **Q's reply** (first ~3,000 chars).
- Commit message: `Q log — <timestamp>`.

**Acceptance test for the SDK build:**
1. Send Q any message in a fresh chat.
2. Within seconds, confirm a new entry was appended to `austin-logs/q-log-<current-month>.md` on `main` (it should auto-commit via the GitHub API — this works even though the file pattern is unaffected by `.gitignore`, because writes go through the API, not git).
3. Open a **second, separate** chat and ask Q "what did we talk about in my last chat?" — Q must find and quote the logged entry (its system prompt already instructs it to `list_directory` on `austin-logs` and `read_file` the monthly log). If Q says "I don't remember," the logger or the recall instruction was lost.

**Do NOT:** rely on the browser/localStorage chat history as "memory." That is per-chat working memory only and dies on a new chat/device — it is NOT durable. The repo log is the durable layer.

---

## Requirement 2 — Load Q's charter live from `main` on every message (durable rules)

**What it does today:** Q's full charter (`Team/Q.md`) is fetched from `main` and appended to the system prompt on **every** request, so any rule filed into `Team/Q.md` reaches Q on its very next message — no redeploy.

**Current implementation (the thing to preserve):**
- `api/q-pro/chat.js` ~lines 598-612: fetch `Team/Q.md` via the GitHub Contents API at `ref: "main"`, append it under a `═══ YOUR FULL CHARTER (Team/Q.md) ═══` header to the base system prompt. Falls back to the base prompt if the fetch fails.
- The same pattern applies to specialists in `callSpecialist` (each loads `Team/<NAME>.md` via its `charterPath`).

**Acceptance test for the SDK build:**
1. Add a throwaway line to `Team/Q.md` on `main`, e.g. `STANDING TEST RULE: if asked "what is the test phrase", reply exactly "kingfisher-7".`
2. In a fresh Q chat ask "what is the test phrase". Q must reply `kingfisher-7` **with no tool calls** (the rule is in its system prompt, loaded live — it should not need to search/read a file).
3. Remove the test line from `Team/Q.md`. (This is the same proof the HIH team used to verify Arlo on June 10.)

---

## Summary checklist for the conversion PR

- [ ] Q auto-commits every turn to `austin-logs/q-log-<YYYY-MM>.md` on `main` (both normal and max-hops exits).
- [ ] Log entry captures timestamp, topic, specialists-called, and reply.
- [ ] Q's system prompt still instructs it to read those logs to recall past chats.
- [ ] `Team/Q.md` is loaded live from `main` into the system prompt on every message.
- [ ] Both acceptance tests above pass on the new build before it ships.

If any box is unchecked, Q will regress to the exact memory gap Nikki had. Keep both.
