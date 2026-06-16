# Home Inspector Training (HIT) — WordPress Rebuild Brief
**Site:** homeinspectorgrowthacademy.com
**Prepared by:** Wes, Web Designer
**Date:** 2026-06-16
**Purpose:** Inform Ken's decision on whether to rebuild HIT in-place (Elementor) or migrate to a real LMS plugin.

---

## 1. What Exists — Current Architecture

### Platform Stack
- **WordPress** with **Elementor Pro** as the page builder
- **BuddyBoss** for community features (member types, invites, profiles)
- **Modern Events Calendar** for events
- **No LMS plugin** — LearnDash, LifterLMS, Tutor LMS, and BuddyBoss's native course post type are all absent

### How "Courses" Are Currently Built
The HIT area is a hand-built pseudo-LMS using WordPress pages and Elementor widgets:

- A **hub page** (ID: 45307, slug: `home-inspector-training`) presents 6 path cards with 2 intro `.mp4` videos. When a visitor clicks a card, their chosen path is stored in `localStorage` — no server-side enrollment, no user record.
- **6 path pages** (IDs: 49787, 40482, 40488, 40485, 48956, 40491) each contain an Elementor `e-n-tabs` widget with two tabs: Courses and Tools & Templates.
- **Courses tab:** Contains a 30-Day Action Plan section followed by individual course listings (title, description, lesson list). Audio lessons are `.mp3` files served inside HTML `<video>` tags — no native audio player widget.
- **Tools & Templates tab:** Downloadable PDFs and DOCXs linked directly from `/wp-content/uploads/`.

### What Is Working
- Content exists and is organized. The 6-path model is pedagogically sound.
- BuddyBoss community is active alongside the HIT pages (member types, invites in use).
- The Elementor tab layout gives a clean two-section UI without requiring an LMS license.
- File downloads are functional as direct upload links.
- The localStorage path-selection mechanism works for a stateless experience.

### What Is Missing or Broken
- **No enrollment or progress tracking.** There is no record of which lessons a member has started, completed, or skipped.
- **No access control at the lesson level.** MemberPress may gate the parent page, but tabs and files inside are unprotected at the content layer.
- **Audio player UX is degraded.** `.mp3` files loaded in a `<video>` tag render with a full video player chrome rather than a compact audio player.
- **No course completion certificates or gamification.**
- **Path selection is client-side only.** If a member clears their browser or switches devices, their path choice is lost.
- **Content gaps** (see Section 4).

---

## 2. Rebuild Recommendations — LMS vs. Elementor In-Place

### Option A — Stay with Elementor (In-Place Rebuild)
**Best if:** Ken's priority is a fast, low-cost refresh with no plugin migration risk.

Elementor tabs can be cleaned up with a custom CSS/JS layer that adds:
- An accordion or card layout per course
- A proper `<audio>` HTML5 element replacing `<video>` for MP3s
- A "Mark Complete" button per lesson that saves state to user meta via a simple REST API call

**Pros:** No plugin migration. No content re-entry. BuddyBoss integration stays intact. Page IDs and slugs preserved.

**Cons:** Still not a real LMS. Progress tracking requires custom dev. Content scale (592 lines for New/Small Multi-Inspector Firm alone) becomes very hard to maintain inside Elementor.

**Estimate of effort:** Medium — primarily a template/CSS/JS cleanup with one small custom plugin for progress state.

### Option B — LearnDash (Recommended)
**Best if:** Ken wants real LMS features — progress tracking, certificates, drip content, quizzes.

LearnDash is the market leader on WordPress and has **first-party BuddyBoss integration** (co-developed partners). LearnDash's course/lesson/topic hierarchy maps directly onto the existing structure (Path = Course Group, Course = Course, Lesson = Lesson, Audio = Lesson with MP3 attachment).

**Pros:**
- Real progress tracking per member, per lesson
- BuddyBoss Social Learner theme/integration is native
- MemberPress + LearnDash integration is well-documented
- Certificates, drip schedules, quizzes all available
- Course Groups can map to the 6 paths

**Cons:** All 6 path pages must be rebuilt as LearnDash course structures. Content must be migrated from Elementor tab text blocks into individual lesson posts. Migration effort is significant — roughly 60+ lessons across all paths.

**Estimate of effort:** High — but a one-time investment that delivers a maintainable, scalable LMS.

**License cost:** LearnDash starts at $199/year (1 site).

### Option C — LifterLMS
Not recommended over LearnDash for a site already running BuddyBoss community features. BuddyBoss integration is less mature.

### Recommendation
**LearnDash (Option B)** is the right long-term choice given BuddyBoss is already active and Ken's business model is course delivery. The Elementor path trades short-term speed for long-term technical debt.

**If budget or timeline is the constraint:** Do a fast Elementor cleanup now (fix audio player, add basic progress via meta), then migrate to LearnDash in a second phase once content gaps are filled.

---

## 3. Page Architecture for the Rebuild

### Hub Page — Keep and Extend
- **Preserve slug:** `home-inspector-training`
- **Preserve page ID 45307** — audit BuddyBoss/MemberPress references before rebuilding
- Replace `localStorage`-only path selection with server-side user meta write on card click
- The 2 intro `.mp4` videos stay as-is

### Path Pages — Migrate to LearnDash Course Groups (Option B)

| Path | New Structure |
|---|---|
| Just Graduated (49787) | Course Group → Courses → Lessons (21 audio lessons as lesson posts) |
| In Business 24 Months (40482) | Course Group → Courses → Lessons (0 audio — flag; see Section 4) |
| One-Man Shop Systems (40488) | Course Group → Courses → Lessons (9 audio) |
| One-Man Shop Multi (40485) | Course Group → Courses → Lessons (6 audio) |
| New/Small Multi (48956) | Course Group → Courses → Lessons (20 audio) |
| Established Multi (40491) | Course Group → Courses → Lessons (4 audio) |

Each Course Group page should be published at the matching slug to avoid breaking existing URLs.

### Tools & Templates Tab — Rebuild as a Download Library
Move downloadable files to a structured Download Library (WP File Download or Download Monitor, or a simple Custom Post Type tagged by path). This makes it maintainable — adding a new PDF does not require opening an Elementor page.

### Audio Lessons — Fix the Player
- Replace all `<video>` tags wrapping `.mp3` files with HTML5 `<audio>` tags or WordPress `[audio src="..."]` shortcode
- In LearnDash: each audio lesson becomes a Lesson post with the audio embedded in the lesson content area
- Files stay in `/wp-content/uploads/` — no CDN migration needed

---

## 4. Gaps Flagged for Ken

### Gap 1 — One-Man Shop Needing Systems: Tools & Templates Tab is Empty
- **Path page:** ID 40488, slug `one-man-shop-needing-systems-and-procedures`
- **Issue:** Tools & Templates tab contains no files (0 PDFs, 0 DOCXs)
- **Impact:** Members on this path receive no downloadable resources — especially notable since this is the systems-focused path
- **Action needed:** Upload appropriate SOPs, checklists, and templates before rebuild goes live

### Gap 2 — In Business 24 Months or Less: Zero Audio Lessons
- **Path page:** ID 40482, slug `in-business-for-24-months-or-less-but-needs-more-sales`
- **Issue:** 0 MP3 audio lessons — the only path with no audio content
- **Impact:** Members get a text/PDF-only experience; all other paths have 4–21 audio lessons
- **Action needed:** Determine if audio was never recorded or not uploaded; likely warrants audio lesson creation given this is a critical inspector growth stage

### Gap 3 — Content Scale Imbalance
- Just Graduated (482 lines) and New/Small Multi (592 lines) are dramatically larger than In Business 24 Months (83 lines) and Established Multi (105 lines)
- **Action needed:** Confirm content depth per path is intentional before rebuilding

### Gap 4 — No Server-Side Path Enrollment Record
- **Issue:** Path selection is stored in `localStorage` only — server has no record
- **Impact:** Cannot personalize email sequences, BuddyBoss group assignments, or MemberPress rules by path
- **Action needed:** On rebuild, write path selection to user meta (`update_user_meta`) on card click

---

## 5. Migration Notes — What Must Be Preserved

### Slugs to Preserve (Do Not Change)

| Page | Slug |
|---|---|
| Hub | `home-inspector-training` |
| Just Graduated | `just-graduated-home-inspection-school` |
| In Business 24 Months | `in-business-for-24-months-or-less-but-needs-more-sales` |
| One-Man Shop Systems | `one-man-shop-needing-systems-and-procedures` |
| One-Man Shop Multi | `one-man-shop-wanting-to-be-a-multi-inspector-firm` |
| New/Small Multi | `new-small-multi-inspector-firm` |
| Established Multi | `a-multi-inspector-firm` |

### Page IDs — Audit Before Touching
Page IDs 45307, 49787, 40482, 40488, 40485, 48956, 40491 — audit BuddyBoss member-type rules and MemberPress protected pages list for direct ID references.

### localStorage → Server-Side
The JavaScript `localStorage` path-selection logic must be ported to server-side user meta on rebuild. Replace with a PHP template tag reading `get_user_meta(get_current_user_id(), 'hit_selected_path', true)`.

### Media Files — No Migration Needed
All `.mp3`, `.mp4`, `.pdf`, `.docx` in `/wp-content/uploads/` stay in place. The rebuild only changes how they are referenced.

### BuddyBoss — Check Before Rebuild
- Confirm whether BuddyBoss member types are tied to path page IDs/slugs
- Confirm whether BuddyBoss Groups are mapped to the 6 paths

---

## 6. Decision Summary for Ken

| Question | Answer |
|---|---|
| Does the site have a real LMS? | No. Content lives in Elementor page tabs. |
| Is BuddyBoss community active? | Yes. Member types and invites are in use. |
| Best LMS choice if upgrading? | LearnDash — native BuddyBoss integration. |
| Can we stay with Elementor? | Yes, with custom dev for progress tracking. |
| What content gaps block the rebuild? | Gap 1 (no tools for Systems path), Gap 2 (no audio for 24-Month path). |
| Must we preserve page slugs? | Yes — all 7 slugs must be preserved or 301-redirected. |
| Can we change page IDs? | Only after auditing BuddyBoss and MemberPress references. |
| Single highest-impact fix? | Replace localStorage path selection with server-side user meta. |

---

*─── BADGE — Wes, Web Designer ───*
*DID: Full HIT WordPress Rebuild Brief — 6 sections, architecture analysis, LMS recommendation, gap flags, migration notes*
*HANDED OFF: Ken (Option A vs B decision), Content team (Gap 1 & 2), Dev (page ID audit)*
