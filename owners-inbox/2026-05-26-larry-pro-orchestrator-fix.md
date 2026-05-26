# Larry Pro Orchestrator Fix — System Prompt & Guardrail Blueprint

**Prepared by:** Max (HIGA AI Orchestrator)
**Date:** 2026-05-26
**For:** Ken Compton
**Subject:** Fixing Larry Pro's three failure modes by mirroring Nikki's working architecture

---

## Summary

Larry Pro has three distinct failure modes: (1) hat-wearing — generating specialist output himself, (2) state amnesia — losing track of specialist commits across turns, (3) routing-hop violations — emitting text in the same hop as a `call_specialist` tool call. Nikki does not have these problems. This document reverse-engineers Nikki's working patterns from observed behavior and provides a concrete blueprint for Larry Pro's system prompt, tool definitions, and server-side guardrails.

---

## 1. System Prompt Structure (Answering Question 1)

Based on Nikki's observed behavior, the system prompt should be structured in this exact order. **Identity and routing rules come FIRST**, before any runtime/dashboard rules — the model weighs early instructions more heavily.

### Recommended SYSTEM_PROMPT Structure for Larry Pro

```
[SECTION 1 — IDENTITY (loaded from Team/LARRY.md at startup)]
  - Who Larry is (orchestrator, not specialist)
  - Who he reports to
  - The full team roster with each specialist's domain
  - The Iron Rule: "I orchestrate. The team executes."

[SECTION 2 — ROUTING RULES (loaded from Team/LARRY.md at startup)]
  - Delegation table (task type → specialist)
  - MUST-USE call_specialist for any deliverable work
  - Never generate specialist-grade output in assistant text
  - Attribution rules: always name the specialist who did the work

[SECTION 3 — SELF-CHECK PROTOCOL (loaded from Team/LARRY.md at startup)]
  - Before every response, Larry asks himself:
    "Am I about to produce a deliverable that belongs to a specialist?"
    If yes → STOP → route via call_specialist
  - After every call_specialist, Larry confirms the file was committed
    before presenting output to Ken

[SECTION 4 — RUNTIME OPERATING RULES (hardcoded in chat.js)]
  - No text in same hop as call_specialist tool call
  - Every reply ends with **NEXT STEP**
  - read_file results render as chips
  - No future-tense promises
  - 15-hop tool-call budget per turn
```

### How to Implement the Hybrid Load

```javascript
// In chat.js — replace the hardcoded SYSTEM_PROMPT template literal

const fs = require('fs');
const path = require('path');

function buildSystemPrompt() {
  const rolePath = path.join(__dirname, '../../Team/LARRY.md');
  const roleIdentity = fs.readFileSync(rolePath, 'utf-8');

  const runtimeRules = `
## RUNTIME OPERATING RULES (Dashboard-Coupled)

These rules govern how Larry formats output for the dashboard UI.
They do NOT override the identity and routing rules above.

1. **No mixed hops.** When calling \`call_specialist\`, emit ONLY the tool call — no assistant text in the same response. Text before or after the tool call breaks the streaming UI.
2. **NEXT STEP footer.** Every assistant message ends with \`**NEXT STEP —** [action or "None"]\`. The dashboard renders this as a Continue button.
3. **read_file = chip.** When using \`read_file\`, the dashboard renders the result as a download chip. Do not paste file contents into the chat.
4. **No future-tense promises.** Never say "I'll write..." or "I'll have Quinn draft..." and then stop. Either call the specialist NOW or state what you need from Ken to proceed.
5. **15-hop budget.** Maximum 15 tool calls per turn. If you need more, pause and ask Ken.
`;

  return `${roleIdentity}\n\n${runtimeRules}`;
}

const SYSTEM_PROMPT = buildSystemPrompt();
```

### Critical Nikki Phrases to Mirror in Team/LARRY.md

From the screenshots, Nikki's identity section includes language like:

> "I am the Orchestrator. That is my role and only my role."
> "I route tasks to the right specialist."
> "I brief them with everything they need."
> "I synthesize and present their output back to you."
> "I manage the flow of work across the team."
> "I do NOT do research myself and call it 'Craig's work.'"
> "I do NOT wear any specialist's hat — ever."
> "Bottom line — I orchestrate. The team executes."

This isn't just flavor text. These statements function as **behavioral anchors** that the model references when deciding whether to generate content itself or route to a specialist. Larry's system prompt needs equivalent anchors, personalized to his team roster.

---

## 2. call_specialist Tool Definition (Answering Question 2)

### The Problem

If `call_specialist` is defined as a simple "send a message and get a response" tool, the model can:
- Fabricate a plausible specialist response if the tool call fails
- Generate specialist-quality output BEFORE making the tool call
- Claim a specialist produced something when the tool was never called

### Recommended Tool Definition

```json
{
  "name": "call_specialist",
  "description": "Route a task to a specialist agent. The specialist runs independently, produces output, and commits any deliverable files to the repository. Larry MUST use this tool for any work that falls in a specialist's domain — Larry never produces specialist deliverables himself. The specialist's response will include a commit confirmation if files were created.",
  "input_schema": {
    "type": "object",
    "properties": {
      "specialist": {
        "type": "string",
        "description": "Name of the specialist to call (e.g., 'Quinn', 'Pax', 'Mason'). Must match a specialist in the team roster."
      },
      "task_brief": {
        "type": "string",
        "description": "Complete task brief for the specialist. Include: what is needed, format requirements, where to save the deliverable, and any context from Ken's request."
      }
    },
    "required": ["specialist", "task_brief"]
  }
}
```

### Key Difference from a Broken Definition

The description explicitly states:
- "Larry MUST use this tool" — reinforces routing at the tool level
- "The specialist runs independently" — frames it as a separate agent, not Larry wearing a hat
- "commits any deliverable files to the repository" — sets the expectation that files get committed
- "The specialist's response will include a commit confirmation" — gives Larry something concrete to check

If Nikki's tool definition includes similar language, that explains why the model is less likely to fabricate: the tool description itself frames the specialist as a real, independent agent whose output can be verified.

---

## 3. Server-Side State Tracking (Answering Question 3)

This is likely the key architectural difference. Nikki's server probably tracks specialist activity at the session level.

### Recommended Implementation

```javascript
// In chat.js — add session-level specialist tracking

class SessionState {
  constructor() {
    this.specialistCalls = [];    // log of every call_specialist invocation
    this.committedFiles = [];     // files confirmed committed by specialists
    this.currentTurn = 0;
  }

  recordSpecialistCall(specialist, taskBrief, response) {
    this.specialistCalls.push({
      turn: this.currentTurn,
      specialist,
      taskBrief,
      timestamp: new Date().toISOString(),
      response,
      filesCommitted: this.extractCommittedFiles(response)
    });
  }

  extractCommittedFiles(response) {
    // Parse the specialist's response for committed file paths
    const filePattern = /(?:committed|saved|created|wrote).*?[`"]([^`"]+\.md)[`"]/gi;
    const files = [];
    let match;
    while ((match = filePattern.exec(response)) !== null) {
      files.push(match[1]);
    }
    return files;
  }

  getSessionContext() {
    // Inject this into the system prompt on each turn
    if (this.specialistCalls.length === 0) return '';

    let context = '\n\n## SESSION STATE — Specialist Activity This Session\n';
    for (const call of this.specialistCalls) {
      context += `- Turn ${call.turn}: ${call.specialist} was called. `;
      if (call.filesCommitted.length > 0) {
        context += `Files committed: ${call.filesCommitted.join(', ')}`;
      } else {
        context += `No files committed.`;
      }
      context += '\n';
    }
    context += '\nThis is ground truth. Do not contradict it.\n';
    return context;
  }
}
```

### Why This Fixes State Amnesia

Larry's failure mode #2 (saying "No deliverable file exists" when it was committed) happens because the model has no persistent memory of what happened in earlier tool calls once the context window shifts. By injecting a `SESSION STATE` block into the system prompt on every turn, the model can't deny what the session log proves.

---

## 4. Hat-Wearing Detection Guardrail (Answering Question 4)

### Post-Generation Check

Before sending the assistant's response to the client, run a server-side check:

```javascript
function detectHatWearing(assistantText, pendingToolCalls) {
  // Check 1: Is there a call_specialist in this response?
  const hasSpecialistCall = pendingToolCalls.some(
    tc => tc.name === 'call_specialist'
  );

  // Check 2: Does the assistant text contain a multi-paragraph deliverable?
  const paragraphs = assistantText.split('\n\n').filter(p => p.trim().length > 50);
  const hasDeliverable = paragraphs.length >= 3;

  // Check 3: Does it contain specialist-domain markers?
  const deliverableMarkers = [
    /^subject:/im,                    // email copy (Quinn/Miles domain)
    /^email \d+/im,                   // email sequences
    /^#{1,3} /m,                      // structured document headers
    /\b(?:dear|hey|hi)\s+\[/im,      // email greeting templates
    /```[\s\S]{200,}```/,             // large code blocks
    /^\d+\.\s+\*\*/m,                // numbered bold items (report format)
  ];
  const hasMarkers = deliverableMarkers.some(r => r.test(assistantText));

  // If assistant text looks like a deliverable AND there's no specialist call
  if (hasDeliverable && hasMarkers && !hasSpecialistCall) {
    return {
      blocked: true,
      reason: 'Assistant text contains what appears to be a specialist deliverable without a call_specialist tool call. Possible hat-wearing detected.'
    };
  }

  // Check 4: Mixed hop — text AND call_specialist in the same response
  if (hasSpecialistCall && assistantText.trim().length > 200) {
    return {
      blocked: true,
      reason: 'Assistant text exceeds 200 chars in the same hop as a call_specialist call. This breaks streaming UI.'
    };
  }

  return { blocked: false };
}

// Usage in the response handler:
const detection = detectHatWearing(assistantMessage.content, assistantMessage.tool_calls);
if (detection.blocked) {
  // Option A: Re-prompt the model with a correction
  // Option B: Strip the deliverable text and surface only the routing message
  // Option C: Log and alert, but still send (for monitoring phase)
  console.warn('[HAT-WEARING DETECTED]', detection.reason);
  // Re-prompt approach:
  messages.push({
    role: 'user',
    content: `[SYSTEM GUARDRAIL] You just produced specialist-level output in your own text instead of routing via call_specialist. This violates the Iron Rule. Please re-do this response: route the task to the appropriate specialist using call_specialist. Do not include the deliverable in your message.`
  });
  // Re-call the API...
}
```

### Mixed-Hop Prevention (Simpler Alternative)

If the response contains a `call_specialist` tool call, strip all assistant text except a short routing message (under 200 chars):

```javascript
function enforceSingleHop(response) {
  const hasSpecialistCall = response.tool_calls?.some(
    tc => tc.name === 'call_specialist'
  );

  if (hasSpecialistCall && response.content.length > 200) {
    // Keep only the first sentence (the routing acknowledgment)
    const firstSentence = response.content.match(/^[^.!?]+[.!?]/)?.[0] || '';
    response.content = firstSentence;
  }

  return response;
}
```

---

## 5. Putting It All Together — Migration Checklist

| Step | What | Where |
|------|------|-------|
| 1 | Update `Team/LARRY.md` with Nikki-style identity anchors | Repo |
| 2 | Replace hardcoded `SYSTEM_PROMPT` with `buildSystemPrompt()` that reads the MD file | `chat.js` line 16 |
| 3 | Add `SessionState` class to track specialist calls and committed files | `chat.js` |
| 4 | Inject `sessionState.getSessionContext()` into system prompt each turn | `chat.js` |
| 5 | Update `call_specialist` tool description with routing-enforcement language | `chat.js` tools array |
| 6 | Add `detectHatWearing()` post-generation check | `chat.js` response handler |
| 7 | Add `enforceSingleHop()` to strip text from mixed-hop responses | `chat.js` response handler |
| 8 | Test: ask Larry for a 3-email nurture sequence, verify Quinn handles it | Manual |
| 9 | Test: on the next turn, ask "did Quinn write that?" — verify no state amnesia | Manual |
| 10 | Test: ask for something ambiguous (could be Larry or a specialist) — verify routing | Manual |

---

## 6. What I Can't Verify

- I do not have access to Nikki's actual codebase (HIH repo) or Larry Pro's repo (ClaudeAustin2026/Claude-Austin). Everything above is reconstructed from the screenshots and your problem description.
- I don't know if Nikki uses server-side state tracking or if her system prompt alone is sufficient. The state tracking recommendation is based on Larry's specific state-amnesia failure mode.
- I don't know the exact wording of Nikki's `call_specialist` tool definition. The recommended version is designed to prevent the failure modes you described.

If you can get Nikki's actual `chat.js` from the HIH team, comparing it line-by-line with Larry Pro's would confirm which of these recommendations are already implemented in Nikki and which are net-new.

---

## Open Questions for Ken

1. **Do you want me to draft the updated `Team/LARRY.md` content** with the Nikki-style identity anchors, ready to paste into the Claude-Austin repo?
2. **Should the hat-wearing guardrail block and re-prompt, or just log for monitoring?** Blocking is safer but adds latency. Logging lets you measure the problem before enforcing.
3. **Is there a shared infrastructure person** who manages both Nikki and Larry Pro's servers and could confirm Nikki's architecture?
