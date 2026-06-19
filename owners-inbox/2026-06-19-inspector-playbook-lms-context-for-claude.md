# Inspector Playbook LMS — Build Context for Claude Code

**Date:** June 19, 2026  
**Owner:** Ken Compton — The Inspector Playbook  
**Project:** Custom-coded Udemy-style LMS for home inspectors  
**Tagline:** "Rebuild Smarter. Grow Faster."

---

## What This Project Is

We are building **The Inspector Playbook** — a custom LMS (Learning Management System) modeled on Udemy's UX pattern, purpose-built for home inspectors. It is **not** using GHL, LearnDash, BuddyBoss, or MemberPress. It is being coded directly in Claude Code.

The content source is the **Home Inspector Growth Academy (HIGA)** course library — 6 learning paths, 108+ lessons — which Ken has licensed and is migrating into this platform.

---

## The 5 Core Features (Udemy Pattern)

1. **Pay → get a login** — Stripe Checkout + user account creation
2. **Course catalog** — public browse, filtered by learning path / category
3. **My Learning** — dashboard filtered to courses the user has purchased
4. **Resume where you left off** — per-lesson progress saved to account
5. **Course player** — video/audio + lesson sidebar with checkmarks, Prev/Next nav

---

## What Has Been Built So Far (June 19, 2026)

### Live Preview Files
All live at: `https://dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/`

| File | URL | Description |
|------|-----|-------------|
| `index.html` | [Catalog](https://dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/) | Udemy-style course catalog — white nav, search, category tabs, 6 course cards |
| `course-just-graduated.html` | [Course Detail](https://dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/course-just-graduated.html) | Full course detail page — dark navy header, $197 buy card, 10-module JS accordion |
| `lesson-player.html` | [Lesson Player](https://dashboard.theinspectorplaybook.com/resources/sites/inspector-playbook-lms/lesson-player.html) | Full lesson player — dark nav, progress bar, sidebar checklist, Prev/Next nav, localStorage progress tracking |

### These are static HTML previews. The real Next.js app lives at:
`/var/www/inspector-playbook-lms/`

---

## Course Content Structure

### The 6 Learning Paths (from HIGA)

| # | Path Name | Target Student | Lessons | Audio | PDFs |
|---|-----------|---------------|---------|-------|------|
| 1 | Just Graduated Home Inspection School | Brand-new inspectors | 26 | 21 MP3s | — |
| 2 | In Business 24 Months or Less | Early-stage | ~30 | 0 ⚠️ | 20 |
| 3 | One-Man Shop Needing Systems & Procedures | Solo ops | 5 | 9 MP3s | 0 ⚠️ |
| 4 | One-Man Shop Wanting Multi-Inspector Firm | Growth-ready solos | 30 | 6 MP3s | 36 |
| 5 | New/Small Multi-Inspector Firm | Multi-inspector | 50+ | 20 MP3s | 82 |
| 6 | An Established Multi-Inspector Firm | Mature firms | 31 | 4 MP3s | 24 |

**Note:** 13 lessons repeat across multiple paths — a Core Lessons Library should be built once and referenced everywhere.

### Path 1 — "Just Graduated" Full Structure (already built into lesson-player.html)

**Module 0 — Foundations**
- Week 1 Action Plan
- Week 2 Action Plan
- Week 3 Action Plan
- Week 4 Action Plan

**Module 1 — Setting Up for Success**
- Setting Up Your Business Entity
- Business Bank Accounts and Finance Basics
- Building Your Brand Identity
- Essential Software and Tools

**Module 2 — Pricing and Packaging**
- How to Price Your Inspections
- Understanding Your Local Market
- Building Service Packages

**Module 3 — Marketing Fundamentals**
- Your Google Business Profile
- Social Media Foundations
- Networking with Real Estate Agents

**Module 4 — Your First Inspections**
- Pre-Inspection Preparation
- Conducting a Professional Inspection
- Report Writing Best Practices
- Client Communication

**Module 5 — Building Your Reputation**
- Getting Your First Reviews
- Referral Strategy
- Following Up After the Inspection

**Module 6 — Financial Foundations**
- Understanding Your Numbers
- Taxes for Home Inspectors
- Insurance Essentials

**Module 7 — Business Systems**
- Scheduling and Booking Systems
- CRM Basics
- Creating SOPs

**Module 8 — Growing Your Client Base**
- Direct-to-Consumer Marketing
- Building a Website That Converts
- Email List Building

**Module 9 — Preparing to Scale**
- When to Hire Your First Employee
- Building Your Team Culture
- Planning for Year Two

---

## Tech Stack

### Current (static preview):
- Self-contained HTML/CSS/JS files (no framework dependencies)
- localStorage for progress tracking in the preview
- Served from: `/var/www/higa-dashboard/resources/sites/inspector-playbook-lms/`

### Real App (Next.js — ready for auth/database sprint):
- **Framework:** Next.js (TypeScript)
- **Location:** `/var/www/inspector-playbook-lms/`
- **Key files:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `data/courses.ts`, `lib/db.ts`, `next.config.ts`

### Planned Stack for Full Build:
- **Auth:** NextAuth.js (email/password + magic link)
- **Database:** PostgreSQL or SQLite (users, courses, enrollments, progress)
- **Payments:** Stripe Checkout (one-time purchase per course or bundle)
- **Video hosting:** TBD (Vimeo, Bunny.net, or S3+CloudFront — Ken to decide)
- **Domain:** `courses.theinspectorplaybook.com` (not yet configured)

---

## What's Next — Build Sprints

| Sprint | What to Build | Status |
|--------|--------------|--------|
| 1 | Course catalog + Path 1 full course detail + lesson player | ✅ Done (static preview live) |
| 2 | Register / Login pages + NextAuth.js auth | 🔲 Not started |
| 3 | Stripe payment flow → account created on purchase | 🔲 Not started |
| 4 | My Learning dashboard (shows owned courses) | 🔲 Not started |
| 5 | Real lesson player with DB-backed progress | 🔲 Not started |
| 6 | Remaining 5 paths built out (Paths 2–6) | 🔲 Not started |
| 7 | Admin panel (upload lessons, manage students) | 🔲 Not started |

---

## Known Gaps / Open Decisions

1. **Path 2 has no audio** — every other path has MP3 lessons; Path 2 has none. Ken needs to decide: record new audio or ship text-only.
2. **Path 3 Tools tab is empty** — the Systems path has no downloadable PDFs. Needs content.
3. **Path 5 not fully audited** — it's the richest path (82 PDFs, 20 MP3s) and needs a dedicated content audit before build.
4. **Video hosting not chosen** — Vimeo ($20/mo), Bunny.net ($0.01/GB), or self-hosted. Decision needed before Sprint 3.
5. **Domain not pointed** — `courses.theinspectorplaybook.com` needs DNS + nginx config when going live.

---

## Design Decisions Already Made

- **Udemy-pattern UI** — white background, sticky top nav, card grid with thumbnails, star ratings, orange CTAs
- **No GHL** — this is completely separate from the GoHighLevel course/membership setup
- **No WordPress/BuddyBoss/LearnDash** — fully custom-coded
- **Brand colors:** Navy (`#1c1d1f`) + Orange (`#f4813a`) + White
- **Instructor name on all courses:** Ken Compton
- **Pricing (preview):** $197–$297 per path (not finalized)

---

## Files in This Repo to Read for More Context

| File | What's in it |
|------|-------------|
| `owners-inbox/HIT-course-structure-map-CORA.md` | Full 6-path lesson-by-lesson map from Cora's audit |
| `owners-inbox/HIT-wordpress-rebuild-brief-WES.md` | Wes's analysis of the original HIGA WordPress site |
| `resources/sites/inspector-playbook-lms/index.html` | Live catalog (self-contained HTML) |
| `resources/sites/inspector-playbook-lms/course-just-graduated.html` | Live course detail page |
| `resources/sites/inspector-playbook-lms/lesson-player.html` | Live lesson player |
| `/var/www/inspector-playbook-lms/` | Next.js app root (for continuing the real build) |

---

*This document was generated by Max (AI Orchestrator, The Inspector Playbook) on 2026-06-19 to provide full context for the Claude Code LMS build continuation.*
