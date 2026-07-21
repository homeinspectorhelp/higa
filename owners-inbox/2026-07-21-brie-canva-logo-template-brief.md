# Brie — Canva Logo Brand Template Brief
**Filed by:** Claude Code (technical build) · **Date:** 2026-07-21
**For:** Brie (Brand Designer) · paste-able into Brie's Dashboard chat
**Related:** `owners-inbox/2026-07-20-brie-canva-api-integration.md` (the API build) · `owners-inbox/brie-brand-designer-role-spec.md` (role spec)

---

## Status: Canva integration is LIVE

Brie's Canva Connect API connection is active on the dashboard as of 2026-07-21.
Authorized on the `ken@thesavvyinspector.com` Canva account (Canva Pro), all eight
scopes granted:

```
asset:read asset:write brandtemplate:content:read brandtemplate:meta:read
design:content:read design:content:write design:meta:read folder:read
```

`GET /api/canva/status` returns `{"connected": true, ...}`. Brie can now push design
decisions into real exported files, not just written specs.

---

## How the Canva pipeline actually works (and its limits)

Canva's API does **not** generate a logo from a prompt. It **autofills a pre-built
Brand Template** with values, then **exports** the result as PNG/SVG.

| Can Brie control per request? | Via API? | How |
|---|---|---|
| Wordmark / text | ✅ Yes | Text autofill field |
| Tagline | ✅ Yes | Text autofill field |
| Icon / symbol image | ✅ Yes | Image autofill field (uploaded asset) |
| Colors | ❌ No | Baked into the template design |
| Fonts / typography | ❌ No | Baked into the template design |
| Layout | ❌ No | Baked into the template design |

**To offer color/style variants, build separate Brand Templates** (e.g. "Wordmark –
Navy," "Wordmark – Black," "Icon + Wordmark – Navy"). Brie chooses which template to
fill. Brie stays the decision layer — concept, wordmark, tagline, and which variant —
and the template turns those decisions into files.

---

## One-time setup: building a logo Brand Template in Canva (human step)

Whoever builds the template (Ken or a designer) does this once per logo concept:

1. Create a **Brand Template** in Canva (Canva Pro supports Brand Templates).
2. Design the logo on it.
3. On each element Brie should be able to change, add a Canva **autofill data field**
   and give it a **clear, lowercase, no-spaces name**.
4. Recommended fields for a logo template:
   - `business_name` — text (the wordmark)
   - `tagline` — text, optional
   - `icon` — image, optional (only if the mark has a swappable symbol)
5. Save it as a Brand Template.

> ⚠️ The field **names** in the template must match exactly what the API passes
> (`business_name`, `tagline`, `icon`). If the designer uses different names, update
> the field names in the API call (or tell Claude Code to match the code to them).

---

## Brie's workflow once a template exists

1. **List templates** → `GET /api/canva/brand-templates`
   Returns each template's **ID** and name.
2. **Pick** the template ID that matches the concept/color wanted.
3. **Fill + export** → `POST /api/canva/logo`

```json
{
  "brandTemplateId": "THE_TEMPLATE_ID",
  "title": "Acme Home Inspections — Logo",
  "data": {
    "business_name": { "type": "text", "text": "Acme Home Inspections" },
    "tagline":       { "type": "text", "text": "Trusted. Thorough. Local." }
  },
  "format": { "type": "png" }
}
```

4. Returns the finished design + export URL (PNG or SVG).

For an image field (e.g. `icon`), pass `{ "type": "image", "asset_id": "<uploaded asset id>" }`
instead of a text value.

---

## Endpoints (reference)

| Endpoint | Purpose |
|---|---|
| `GET /api/canva/status` | Connection check — `{"connected": true/false, scope}` |
| `GET /api/canva/auth` | One-time OAuth connect (redirects to Canva approval) |
| `GET /api/canva/brand-templates` | List available Brand Templates (IDs + names) |
| `POST /api/canva/logo` | Autofill a template + export → `{ design, exportUrls }` |

Code: `api/lib/canva-oauth.js` (OAuth2 + PKCE) and `api/canva/design.js` (autofill/export).

---

## Remaining loose end (not blocking Canva)

Per the 2026-07-17 log, `Team/BRIE.md` was reported created but is **not** in the repo —
Brie's role spec (`owners-inbox/brie-brand-designer-role-spec.md`) is still marked
DRAFT/PENDING. Activating Brie on the roster (creating `Team/BRIE.md` + adding her to
`CLAUDE.md`) is Nolan's step and needs Ken's explicit sign-off per the repo Rules. It's
independent of the Canva wiring, which is done.
