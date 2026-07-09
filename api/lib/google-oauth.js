// Google OAuth flow for user-account access to Analytics + Search Console.
// Tokens stored in .google-oauth-tokens.json on the server.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "../../.google-oauth-tokens.json");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
].join(" ");

function getConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
  } catch {}
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export async function getGoogleAccessToken() {
  let tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return null;

  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  const config = getConfig();
  if (!config) return null;

  const resp = await fetch(GOOGLE_TOKEN_URL, {
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
    throw new Error(`Google token refresh failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  tokens.access_token = data.access_token;
  tokens.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  saveTokens(tokens);
  return tokens.access_token;
}

export function googleAuthHandler(req, res) {
  const config = getConfig();
  if (!config) return res.status(500).json({ error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not configured" });

  const redirectUri = `https://${req.get("host")}/api/google/callback`;
  const authUrl = `${GOOGLE_AUTH_URL}?response_type=code&client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  res.redirect(authUrl);
}

export async function googleCallbackHandler(req, res) {
  const config = getConfig();
  if (!config) return res.status(500).json({ error: "Google not configured" });

  const code = req.query.code;
  if (!code) return res.status(400).json({ error: "No authorization code" });

  const redirectUri = `https://${req.get("host")}/api/google/callback`;

  try {
    const resp = await fetch(GOOGLE_TOKEN_URL, {
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
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope,
    };
    saveTokens(tokens);

    res.redirect("/?google=connected");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function googleStatusHandler(req, res) {
  const tokens = loadTokens();
  res.json({
    connected: !!(tokens && tokens.refresh_token),
    scope: tokens?.scope || "",
  });
}
