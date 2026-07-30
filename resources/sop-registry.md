# The Inspector Playbook — SOP Registry

**Owner:** Max (AI Orchestrator) · **Maintained by:** Max  
**Created:** 2026-07-30 · **Last updated:** 2026-07-30

> **This is the single source of truth for "is there a procedure for this?"**  
> Before you invent a process, search this file. Before you ask a human how something is done,
> search this file. If you build a repeatable process and it is not listed here, add it here.
>
> **Cross-repo rule:** When work touches an HIH service line (GBP, websites, newsletter, Google Ads,
> reporting), also check `/var/www/dbclaude-dashboard/resources/sop-registry.md` — the HIH master
> registry — before inventing a process.

---

## How to use this registry

| If you are… | Do this |
|---|---|
| **Max** (Orchestrator) | Grep this file at session start on any ops/delivery task. Route work *with* the SOP path in the brief. |
| **A specialist** (cora, vince, ellie, gus, wren, glen, skye, emma, cole, etc.) | Read your owning SOP before starting. Cite the SOP path in your BADGE PROOF. |
| **Ken** | Find the row, open the file via the dashboard Download chip. Rows marked **Non-technical** need no server or GitHub skills. |

---

## Registry maintenance rules

1. **New procedure → new row, same commit.** Never merge a procedure file without its registry row.
2. **One canonical path per procedure.** If a procedure exists in two places, pick canonical, note the other as companion.
3. **Owner is a person or agent, never "the team."** Someone owns every SOP.
4. **Mark non-technical SOPs.** Ken needs to know which ones he can run himself.
5. **Retired procedures are struck through, not deleted** — `.md` files are never deleted without Ken's explicit permission.

---

## 1. Course Production

| SOP | Path | Owner | Use when |
|---|---|---|---|
| Inspector Playbook Course Production | `resources/procedure-inspector-playbook-course-production.md` | Max / Cora | Building any Inspector Playbook course — full pipeline from brief to publish |

> **Note:** `procedure-inspector-playbook-course-production.md` is referenced in the HIH SOP registry (section 5 — Content) but has not yet been written. **This is an open gap.** Max should route its creation to Cora before the next course build begins.

---

## 2. Marketing & Content

*(No procedures registered yet — add here when built.)*

---

## 3. GHL Platform

*(No procedures registered yet — add here when built.)*

---

## 4. Reporting

*(No procedures registered yet — add here when built.)*

---

## 5. Team Operating Standards (not procedures, but binding)

| Document | Path | Applies to |
|---|---|---|
| Badge Handoff Pattern | (CLAUDE.md — "The Badge Handoff" section) | Every agent, every task |
| HIH Ecosystem Strategy 2026 | `resources/hih-ecosystem-strategy-2026.md` | Anything touching ads, pricing, CRM, cross-company |
| Team Learnings (durable lessons) | `journals/team-learnings.md` | Read on session start |
| HIH Master SOP Registry | `/var/www/dbclaude-dashboard/resources/sop-registry.md` | Any task touching HIH service lines |
