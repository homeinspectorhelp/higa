# Inspector Playbook LMS — Status Report
**Date:** July 2, 2026
**Requested by:** Nick (Ken's Assistant)
**Prepared by:** Max, AI Orchestrator — The Inspector Playbook

---

## 1. WHAT IS BUILT AND LIVE RIGHT NOW

### Static HTML Preview (Live Now)
Three fully-designed static HTML previews are live and accessible at:
`https://dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/`

| Page | URL | What It Shows |
|------|-----|---------------|
| Course Catalog | `/index.html` | Udemy-style catalog — white nav, search bar, category tabs, 6 course cards |
| Course Detail (Path 1) | `/course-just-graduated.html` | Full course page — dark navy header, $197 buy card, 10-module JS accordion |
| Lesson Player | `/lesson-player.html` | Full lesson player — dark nav, progress bar, sidebar checklist with checkmarks, Prev/Next nav, localStorage progress tracking |

**Repo location:** `resources/sites/inspector-playbook-lms/`

These are **static previews only** — no auth, no payments, no database. They demonstrate the full intended UX and design pattern.

### Next.js App (Scaffolded — Not Yet Functional)
A Next.js (TypeScript) app has been initialized at `/var/www/inspector-playbook-lms/` on the server.

Key files in place:
- `app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- `data/courses.ts`
- `lib/db.ts`
- `next.config.ts`

**Status:** Scaffolded and structured. No auth, payment, or database sprint has started.

### Course Content Audit (Complete)
A full 6-path content audit was completed by Cora. Repo file: `owners-inbox/HIT-course-structure-map-CORA.md`

| Path | Lessons | Audio | PDFs | Audit Status |
|------|---------|-------|------|--------------|
| 1 — Just Graduated | 26 | 21 MP3s | TBD | ✅ Complete |
| 2 — In Business 24 Months | ~30 | **0 ⚠️** | 20 | ✅ Audited — gap flagged |
| 3 — One-Man Shop Systems | ~14 | 9 MP3s | 0 ⚠️ | ✅ Audited — gap flagged |
| 4 — One-Man Shop Multi | 30 | 6 MP3s | 36 | ✅ Complete |
| 5 — New/Small Multi | 50+ | 20 MP3s | 82 | ⚠️ Partial — full extraction needed |
| 6 — Established Multi | 31 | 4 MP3s | 24 | ✅ Complete |

### WordPress Architecture Analysis (Complete)
Wes produced a full WordPress rebuild brief. Repo file: `owners-inbox/HIT-wordpress-rebuild-brief-WES.md`

Key finding: The existing site at `homeinspectorgrowthacademy.com` has **no real LMS plugin** — all "courses" are hand-built Elementor page tabs with no enrollment tracking, no access control at lesson level, and no server-side progress.

---

## 2. WHAT IS IN PROGRESS

**Nothing is actively in progress as of this report.** The build is paused pending Ken's decisions (see Section 4).

The completed sprints are:
- ✅ Sprint 1 — Course catalog + Path 1 full course detail + lesson player (static preview done)
- ✅ Content audit — All 6 paths mapped, gaps flagged
- ✅ WordPress architecture analysis — LMS options evaluated

All remaining sprints have not started:

| Sprint | What to Build | Status |
|--------|--------------|--------|
| 2 | Register / Login pages + NextAuth.js auth | 🔲 Not started |
| 3 | Stripe payment flow → account created on purchase | 🔲 Not started |
| 4 | My Learning dashboard (shows owned courses) | 🔲 Not started |
| 5 | Real lesson player with DB-backed progress | 🔲 Not started |
| 6 | Remaining 5 paths built out (Paths 2–6) | 🔲 Not started |
| 7 | Admin panel (upload lessons, manage students) | 🔲 Not started |

---

## 3. WHAT IS BLOCKING THE NEXT SPRINT

### Blocker 1 — Video Hosting Platform Not Chosen (Blocks Sprint 3 & 5)
The lesson player is built to play video/audio. No decision has been made on where video will be hosted. Options evaluated:
- **Vimeo Pro** — ~$20/mo, easy embed, bandwidth included
- **Bunny.net** — ~$0.01/GB, cheapest at scale, slightly more setup
- **Self-hosted (S3 + CloudFront)** — most control, most dev work

**This decision must be made before Sprint 3 (Stripe + player) can start.** Video hosting affects the database schema, the lesson player code, and the upload workflow.

### Blocker 2 — Path 2 Has Zero Audio Lessons (Blocks Sprint 6 for Path 2)
Path 2 ("In Business 24 Months or Less") is the only path with no MP3 audio. Every other path has 4–21 audio lessons. Shipping Path 2 without audio creates a noticeably inferior student experience compared to every other path.

**Decision needed:** Record new audio for Path 2, or ship it text/PDF-only with a note.

### Blocker 3 — Path 3 Tools Tab is Empty (Blocks Sprint 6 for Path 3)
The "One-Man Shop Needing Systems" path has zero downloadable PDFs or tools in its Tools & Templates tab — despite being the systems-focused path. Five inline PDFs exist buried in the 30-Day Action Plan section but need to be moved to the Tools tab and supplemented.

**Decision needed:** Who creates/sources the missing tools content for Path 3?

### Blocker 4 — Path 5 Full Content Not Extracted (Blocks Sprint 6 for Path 5)
Path 5 ("New/Small Multi-Inspector Firm") is the largest path — 592 content lines, 20 MP3s, 82 PDFs. Cora's audit flagged it as requiring a dedicated extraction session before the lesson-by-lesson rebuild can begin.

**This path cannot be built until the full audit is done.**

### Blocker 5 — Domain Not Configured (Blocks Go-Live)
The intended domain `courses.theinspectorplaybook.com` has not been pointed to the server. DNS + nginx configuration is required before the app can go live at that URL.

---

## 4. DECISIONS KEN NEEDS TO MAKE

| # | Decision | Why It Matters | Options |
|---|----------|---------------|---------|
| 1 | **Video hosting platform** | Must be locked before auth/payment sprint begins. Changes database schema and player code. | Vimeo ($20/mo) / Bunny.net ($0.01/GB) / S3+CloudFront |
| 2 | **Path 2 audio — record or skip?** | Path 2 is the only path with no audio. All others have 4–21 MP3 lessons. | A) Record new audio for Path 2 before launch B) Ship text/PDF-only with a label |
| 3 | **Path 3 Tools tab — who fills it?** | Cannot launch Path 3 with an empty Tools tab on a systems-focused course. | A) Ken records/creates new tools B) Assign Cora to adapt content from other paths |
| 4 | **Path 5 full content audit — green-light it?** | Path 5 is the richest path and must be fully mapped before any build work. | Assign Cora/Pax to complete the dedicated extraction session |
| 5 | **Pricing — finalize course prices** | Preview pages show $197–$297 placeholders. Real Stripe integration needs actual prices. | Ken to confirm per-path pricing before Sprint 3 |
| 6 | **Domain DNS** | `courses.theinspectorplaybook.com` is not pointed anywhere. Needs to be done before go-live. | Assign whoever controls DNS (likely Wes or a server admin) |
| 7 | **13 shared/repeated lessons — build once or copy per path?** | 13 lessons appear across multiple paths. Building once saves time; copying per path is simpler to manage. | A) Core Lessons Library (recommended) B) Duplicate per path |

---

## 5. DESIGN DECISIONS ALREADY LOCKED IN

These do NOT require further input from Ken:
- ✅ Udemy-pattern UI — white background, sticky nav, card grid, orange CTAs
- ✅ No GHL, no WordPress, no LearnDash — fully custom-coded Next.js app
- ✅ Brand colors — Navy `#1c1d1f` + Orange `#f4813a` + White
- ✅ Instructor credit — Ken Compton on all courses
- ✅ The 6-path content structure is sound and approved

---

## 6. RECOMMENDED NEXT ACTION

**Ken should work through the 7 decisions in Section 4 in order.** Decision #1 (video hosting) and #5 (pricing) are the critical path items that unlock Sprint 2 and 3. Without those, the build cannot advance to a functional app.

Once video hosting and pricing are confirmed, Sprint 2 (auth) can start immediately and takes an estimated 1–2 sessions.

---

*Filed by Max — AI Orchestrator, The Inspector Playbook*
*Source files: owners-inbox/2026-06-19-inspector-playbook-lms-context-for-claude.md, owners-inbox/HIT-course-structure-map-CORA.md, owners-inbox/HIT-wordpress-rebuild-brief-WES.md*
