# Max Pro Conversation Log — 2026-07

*Every conversation with Max Pro is recorded here.*

## 2026-07-02 18:08 UTC

**Topic:** Status check: Where are we on the new Udemy-style website for the Inspector Playbook courses? Ken wants a current update — what's been built, what's in progress, what's still pending, and any blockers. Please give a clear, honest status so Ken can decide next steps.

**Specialists called:** None

**Max's reply:**
Here's a clear, honest status on the Udemy-style Inspector Playbook LMS build:

---

## 🏗️ Inspector Playbook LMS — Status Report
*As of June 19, 2026*

---

### ✅ WHAT'S BUILT (Sprint 1 — Complete)

Three **static HTML preview pages** are live at `dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/`:

| Page | What It Is |
|------|-----------|
| `index.html` | Udemy-style course catalog — white nav, search bar, category tabs, 6 course cards |
| `course-just-graduated.html` | Full course detail page — dark navy header, $197 buy card, 10-module accordion |
| `lesson-player.html` | Full lesson player — progress bar, sidebar checklist, Prev/Next nav, localStorage progress tracking |

The real **Next.js app** (TypeScript) is scaffolded and sitting at `/var/www/inspector-playbook-lms/` on the server, ready for the auth/database sprint. The design system is locked in: **Navy + Orange + White**, Udemy-pattern UI, Ken Compton as instructor on all courses.

The **course content** for all 6 learning paths has been fully audited by Cora (108+ lessons mapped in rebuild-ready hierarchy).

---

### 🔲 WHAT'S NOT STARTED YET (Sprints 2–7)

| Sprint | Work |
|--------|------|
| **Sprint 2** | Register / Login pages + NextAuth.js authentication |
| **Sprint 3** | Stripe payment flow → user account created on purchase |
| **Sprint 4** | My Learning dashboard (shows courses the user owns) |
| **Sprint 5** | Real lesson player with database-backed progress tracking |
| **Sprint 6** | Paths 2–6 fully built out in the LMS |
| **Sprint 7** | Admin panel (upload lessons, manage students) |

The domain `courses.theinspectorplaybook.com` also hasn't been pointed yet — DNS + nginx config is needed before go-live.

---

### 🚧 BLOCKERS & OPEN DECISIONS KEN NEEDS TO MAKE

These are not minor — a few of them block entire sprints:

| # | Blocker | Impact |
|---|---------|--------|
| 🔴 | **Video hosting not chosen** — Vimeo ($20/mo), Bunny.net ($0.01/GB), or S3+CloudFront | Blocks Sprint 3 (payment) and Sprint 5 (lesson player) |
| 🔴 | **Path 2 has zero audio** — every other path has MP3 lessons; Path 2 has none | Needs Ken to decide: record new audio, or ship text-only for now |
| 🔴 | **Path 3 Tools tab is empty** — no downloadable PDFs for the Systems & Procedures path | Needs content uploaded before that path can launch |
| 🟡 | **Path 5 not fully audited** — richest path (82 PDFs, 20 MP3s), lesson list not fully extracted | Needs dedicated audit session before Sprint 6 touches it |
| 🟡 | **Pricing not finalized** — preview shows $197–$297 per path | Ken to confirm before Stripe is configured |
| 🟡 | **Domain not configured** — `courses.theinspectorplaybook.com` needs DNS work | Needed before go-live |

---

### 📋 BOTTOM LINE FOR KEN

The **UI/UX shell is done and looks great** — the three preview pages are live and demonstrate exactly what the finished product will feel like. The course content map is fully documented across all 6 paths.

What 

*[truncated — full reply visible in dashboard chat]*

---