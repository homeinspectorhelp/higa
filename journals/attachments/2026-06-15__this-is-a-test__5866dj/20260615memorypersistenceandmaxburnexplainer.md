# Memory, Persistence & Max-Burn — Plain-English Answers
**For:** Ken (and Dil / Beth) · **Date:** June 15, 2026
*Answers action items #7, #8, #9, #10 from the June 14 session notes.*

---

## Part 1 — How the memory actually works (the honest version)

Your agents have **two different kinds of memory**, and almost all the confusion comes from mixing them up. Here's the clean version:

### 🧠 Memory #1 — "Working memory" (one chat only)
- This is the back-and-forth **inside the chat you're in right now**.
- It lives in **your browser** (the dashboard remembers the conversation and re-sends it to Nikki every time you hit send).
- **It is NOT durable.** Open a new chat, switch devices, or clear the browser → that conversation is gone. Nikki on another chat cannot see it.
- This is exactly why "Austin can't pull up conversations from the past" — those past chats were never written down anywhere permanent.

### 📁 Memory #2 — "Long-term memory" (forever, shared by everyone)
- These are **actual files saved on the server** (in the repo): the journals (`corporate-journal`, `ken-journal`, `beth-journal`), `team-learnings.md`, your client files, the Monday-posts log, and everything in the Owner's Inbox.
- Nikki **reads these the moment a new chat starts**, and can search/open them any time.
- **This memory is rock-solid.** It survives new chats, new devices, server restarts — because it's a saved file, backed up in GitHub.

> **The one rule that makes persistence trustworthy:**
> **If it's saved to a file, it persists — 100%, forever. If it only happened in a chat, it doesn't.**
> "Refreshing the state" is simply the act of getting the important parts of a conversation **written into a file** before you move on. It's not magic, and it's not unreliable — memory is reliable for exactly what got written down, and only that.

### So why do you have to "refresh the state" manually right now?
Because the **live Nikki (the new "Prime" engine) does not automatically save a full copy of each conversation.** It auto-saves short one-line "lessons" at the end of a task, and it reads all the journals on startup — but it does **not** keep a running transcript log on its own.

*(Side note: the OLD Nikki engine and the Outcrop "Q" agent DO auto-log every conversation to a file. Nikki lost that when we upgraded her engine. That's the gap — and it's fixable, see the recommendation below.)*

So today, the reliable way to build memory is: **when something matters, tell Nikki to save it to a journal / file** (or save it yourself). Once it's a file, it's permanent.

---

## Part 2 — Dil's question: does the *terminal* side also need a refresh?

**Short answer: No — there is only ONE long-term memory, and both sides share it.**

- Ken works in the **dashboard**; Dil works in the **terminal**. Those are two different doors into the **same house** — the same repo files on the same server.
- Each door has its own **working memory** (the dashboard chat vs. the terminal session) — and those are separate and temporary, just like two people's short-term memory of a phone call.
- But the **long-term memory (the files) is shared and identical.** If Dil saves something to a journal in the terminal, Nikki in the dashboard sees it. If Nikki saves something from the dashboard, Dil sees it in the terminal.

**Practical answer for Dil:** you don't need a separate "terminal refresh" to make memory persist. Both sides read and write the same files. The only thing each side has its own private copy of is the *unsaved current chat* — which was never durable on either side. **Save it to a file and it's shared everywhere.**

---

## Part 3 — Is it safe to load all of Beth's content into Nikki? (the blocker, #9)

**Yes — with one condition that makes it bulletproof:**

✅ **Load it as files, or have Nikki write it to files.** Anything that becomes a file in the repo (a client doc, a journal entry, an Owner's Inbox file) is permanent and Nikki will always find it.

⚠️ **Don't load it by "just telling Nikki in a chat" and trusting she'll remember next week.** That content lives only in the browser chat and will not carry to the next session.

**Proof it works:** the journals and `team-learnings.md` are real, saved files in the repo **right now** — the team's durable memory is already there and already working. The mechanism is sound; we just have to make sure the content lands in files, not just chats.

### ✅ My recommendation — remove the manual step entirely
The cleanest fix to your confidence problem: **add an automatic conversation logger to Nikki** — the same one the old engine and Outcrop's Q already have. Then **every chat auto-saves to a dated log file**, and you'd **never have to "refresh the state" manually again.** Memory becomes automatic and you stop having to think about it.

This is a small, contained build (Q already does exactly this). **Want me to wire it into Nikki?** That single change is the real answer to *"what do we have to do manually to build memory"* → **nothing.**

---

## Part 4 — Max possible token burn (#10)

**Bottom line: a mistake can no longer run to thousands. It's capped twice over.**

First, the facts from the incident:
- The scary "$346 / $363" number was a **runaway loop** re-sending huge context thousands of times. The **true model spend was ~$89** (Sonnet, around June 9).
- That loop is **fixed in code** — every agent turn is now capped at **40 steps**, so no single conversation can spin forever.

Now, your three guardrails (worst-case to best-case):

| Guard | What it caps | The number |
|---|---|---|
| **Per-conversation turn cap (code)** | One runaway chat | ~40 steps max → a few dollars at most, then it stops on its own |
| **$500 org spend cap (Anthropic)** | Total spend in the period | **Hard ceiling — the API stops serving at $500.** It physically cannot bill past it. |
| **$100 email alert** | Early warning | You get an email long before the cap |

**So the true maximum a mistake can burn is the gap between current spend and the $500 cap — and not a penny more.** It cannot quietly run to thousands.

### One clarification on the $500 cap vs. auto-reload
- **Auto-reload** tops up your **prepaid balance** when it runs low — that just keeps the lights on (and is what unblocked Hanif's testing).
- The **$500 spend cap** is the real ceiling. Auto-reload does **not** override it. Even with auto-reload on, spending stops at $500.
- So having auto-reload on does **not** mean "it could burn $500 of mistakes." It means "it won't run out of balance mid-task." The cap + the 40-step code limit are what actually protect you.

If you ever want a tighter ceiling, we can simply lower the $500 cap (e.g. to $300) — it's a one-click change in the Anthropic console.

---

## Quick recap — what to tell Beth & Dil
1. **Memory is reliable for anything saved to a file** — and only that. "Refresh the state" = save it to a file.
2. **One shared long-term memory.** Dashboard and terminal both read/write the same files; no separate terminal refresh needed.
3. **Safe to load Nikki** — as long as content lands in files (I recommend auto-logging so it's automatic).
4. **Max burn is capped at $500, hard** — plus a 40-step code limit per chat. The $89 runaway can't recur.
