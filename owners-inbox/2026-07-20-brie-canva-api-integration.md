# Brie ↔ Canva API Integration — Build Report
**Built by:** Claude Code (direct technical build — no specialist on the current roster owns API/platform wiring)
**Date:** 2026-07-20
**Requested by:** Ken, relayed by Dil

---

## What this is

Ken approved Brie (Brand Designer) on 2026-07-17 and asked Dil to connect a Canva API
integration so Brie can produce actual logo files (SVG/PNG), not just written specs.
This is the technical build for that connection — see `owners-inbox/brie-brand-designer-role-spec.md`
for Brie's role spec and `owner-logs/max-prime-log-2026-07.md` (2026-07-17 23:22 UTC entry)
for Ken's original ask.

Note: that log entry says Nolan created `Team/BRIE.md`. It is **not** in the repo —
verified via `git ls-files` / directory listing at the current HEAD. Brie is not actually
live on the roster yet. That's a separate, small follow-up (Nolan's call, needs Ken's
sign-off per the Rules section of CLAUDE.md) — not blocking on the Canva build below.

---

## What was built (this repo, `homeinspectorhelp/higa`)

| File | Purpose |
|---|---|
| `api/lib/canva-oauth.js` | OAuth2 + PKCE flow against Canva's Connect API. Handles `/api/canva/auth` (redirect to Canva), `/api/canva/callback` (token exchange), `/api/canva/status`, and token refresh. Tokens persist to `.canva-oauth-tokens.json` (gitignored). |
| `api/canva/design.js` | `listBrandTemplates()`, `autofillBrandTemplate()` (POST /autofills → poll), `exportDesign()` (POST /exports → poll). Exposes `GET /api/canva/brand-templates` and `POST /api/canva/logo`. |
| `server.js` | Wired the four new routes in, following the exact pattern already used for GHL and Google OAuth. |
| `.gitignore` | Added `.canva-oauth-tokens.json`; also added `.google-oauth-tokens.json`, which was missing and should have been there already (no secrets were actually committed — checked `git ls-files` — but the gap existed). |

This follows the same shape as the existing `api/lib/google-oauth.js` module, so it's
consistent with how the rest of the dashboard talks to external APIs.

**Important — what Canva's API actually does:** there is no "generate a logo from a prompt"
endpoint. The real capability is the **Autofill API**: it fills a pre-built Canva **Brand
Template** with text/image field values, then the **Export API** turns that filled design
into a PNG/SVG/PDF. So Brie's logo pipeline needs at least one Brand Template built in Canva
first — Brie (or a human) defines the concept/colors/typography, and that gets built as a
Canva Brand Template with named fields, which `POST /api/canva/logo` then autofills per
request.

---

## Still open — needs a human in the loop

1. **Canva account + plan.** Autofill + Brand Template access requires a Canva plan that
   includes the Connect API (Canva for Teams or above at last check — verify current
   requirements in Canva's Developer docs, this has changed before).
2. **Register the Integration.** In the Canva Developer Portal (canva.com/developers) →
   create an Integration for The Inspector Playbook's Canva account → set redirect URI to
   `https://<dashboard-host>/api/canva/callback` → check the scopes listed at the top of
   `api/lib/canva-oauth.js` (`asset:read`, `asset:write`, `brandtemplate:content:read`,
   `brandtemplate:meta:read`, `design:content:read`, `design:content:write`,
   `design:meta:read`, `folder:read`).
3. **Set credentials as env vars, not in chat/repo.** Put `CANVA_CLIENT_ID` and
   `CANVA_CLIENT_SECRET` in the server's `.env` file directly (SSH/console access), the
   same way `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and the GHL credentials are already
   set up. Do not paste the Client Secret into a chat session — anything typed there can
   end up logged.
4. **Deploy + connect.** After env vars are set and the server restarts, visit
   `/api/canva/auth` once to complete the OAuth handshake (redirects to Canva, you approve,
   redirects back). Check `/api/canva/status` to confirm `connected: true`.
5. **Build at least one Brand Template in Canva** for Brie's logo output before calling
   `POST /api/canva/logo`.

Once steps 1–4 are done, `GET /api/canva/brand-templates` will list available templates and
`POST /api/canva/logo` (`{ brandTemplateId, data, title, format }`) will autofill + export a
real logo file.

---

## Verification done

- No existing secrets were exposed — confirmed `.env` and any `*-oauth-tokens.json` files are
  not tracked in git (`git ls-files`).
- Code follows the existing GHL/Google OAuth pattern already in this repo; no new
  dependencies added (uses Node's built-in `fetch` and `crypto`, same as the Google module).
- Not yet runtime-tested end-to-end — that requires real Canva credentials, which only Dil/Ken
  can generate (Canva Developer Portal login).
