// GHL OAuth flow — handles authorization start + callback + token refresh.
// Tokens are stored in a local JSON file on the server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "../../.ghl-tokens.json");

const GHL_AUTH_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";

function getConfig() {
  const clientId = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function getStoredTokens() {
  return loadTokens();
}

export async function refreshAccessToken() {
  const config = getConfig();
  const tokens = loadTokens();
  if (!config || !tokens || !tokens.refresh_token) return null;

  const resp = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token refresh failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in || 86400) * 1000,
    location_id: data.locationId || tokens.location_id,
    user_type: data.userType || tokens.user_type,
  };
  saveTokens(updated);
  return updated;
}

export async function getLocationToken(locationId) {
  const tokens = await getValidToken();
  if (!tokens) return null;

  const config = getConfig();
  if (!config) return null;

  const resp = await fetch("https://services.leadconnectorhq.com/oauth/locationToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Bearer ${tokens.access_token}`,
      "Version": "2021-07-28",
    },
    body: new URLSearchParams({
      companyId: tokens.company_id || "",
      locationId,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Location token failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.access_token;
}

export async function getValidToken() {
  let tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60000) {
    tokens = await refreshAccessToken();
  }
  return tokens;
}

export default async function handler(req, res) {
  const config = getConfig();
  if (!config) {
    return res.status(500).json({ error: "GHL_CLIENT_ID and GHL_CLIENT_SECRET not configured in .env" });
  }

  // GET /api/ghl/auth — start OAuth flow
  if (req.method === "GET" && !req.query.code) {
    const host = req.get("host");
    const redirectUri = `https://${host}/api/auth/callback`;

    const scopes = [
      "contacts.readonly", "contacts.write",
      "conversations.readonly", "conversations.write",
      "conversations/message.readonly", "conversations/message.write",
      "conversations/reports.readonly", "conversations/livechat.write",
      "opportunities.readonly", "opportunities.write",
      "calendars.readonly", "calendars.write",
      "calendars/events.readonly", "calendars/events.write",
      "calendars/groups.readonly", "calendars/groups.write",
      "calendars/resources.readonly", "calendars/resources.write",
      "campaigns.readonly",
      "emails.readonly",
      "workflows.readonly",
      "funnels/redirect.readonly", "funnels/page.readonly",
      "funnels/funnel.readonly", "funnels/pagecount.readonly", "funnels/redirect.write",
      "blogs/post.write", "blogs/post-update.write", "blogs/check-slug.readonly",
      "blogs/category.readonly", "blogs/author.readonly", "blogs/posts.readonly", "blogs/list.readonly",
      "forms.readonly", "forms.write",
      "surveys.readonly",
      "medias.readonly", "medias.write",
      "socialplanner/post.readonly", "socialplanner/post.write",
      "socialplanner/account.readonly", "socialplanner/account.write",
      "locations.readonly",
      "locations/customFields.readonly", "locations/customFields.write",
      "locations/customValues.readonly", "locations/customValues.write",
      "locations/tasks.readonly", "locations/tasks.write",
      "locations/tags.readonly", "locations/tags.write",
      "users.readonly", "users.write",
      "payments/orders.readonly", "payments/transactions.readonly",
      "payments/subscriptions.readonly",
      "invoices.readonly", "invoices.write",
      "businesses.readonly", "businesses.write",
      "links.readonly", "links.write",
      "courses.readonly", "courses.write",
    ].join(" ");

    const authUrl = `${GHL_AUTH_URL}?response_type=code&client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
    return res.redirect(authUrl);
  }

  return res.status(404).json({ error: "Not found" });
}

export async function callbackHandler(req, res) {
  const config = getConfig();
  if (!config) return res.status(500).json({ error: "GHL not configured" });

  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "No authorization code received" });

  const host = req.get("host");
  const redirectUri = `https://${host}/api/auth/callback`;

  try {
    const resp = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: `Token exchange failed: ${text}` });
    }

    const data = await resp.json();
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 86400) * 1000,
      location_id: data.locationId,
      company_id: data.companyId,
      user_type: data.userType,
    };
    saveTokens(tokens);

    // Redirect back to dashboard
    return res.redirect("/?ghl=connected#tasks");
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Status endpoint
export async function statusHandler(req, res) {
  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) {
    return res.json({ connected: false });
  }
  return res.json({
    connected: true,
    location_id: tokens.location_id,
    expires_at: tokens.expires_at,
    expired: tokens.expires_at ? Date.now() > tokens.expires_at : false,
  });
}
