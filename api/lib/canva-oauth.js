// Canva Connect API OAuth (PKCE required). Lets Brie push design decisions into
// real Canva Brand Template autofills + exports instead of just written specs.
// Tokens stored in .canva-oauth-tokens.json on the server.
//
// Setup (human step, done once in the Canva Developer Portal at canva.com/developers):
//   1. Create an Integration for The Inspector Playbook's Canva account.
//   2. Set redirect URI to https://<dashboard-host>/api/canva/callback
//   3. Select scopes matching SCOPES below (the token request scope must be a
//      subset of what's checked in the Integration's settings).
//   4. Copy the Client ID + Client Secret into this server's environment as
//      CANVA_CLIENT_ID / CANVA_CLIENT_SECRET (.env, gitignored) — never commit them.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, "../../.canva-oauth-tokens.json");

const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";

const SCOPES = [
  "asset:read",
  "asset:write",
  "brandtemplate:content:read",
  "brandtemplate:meta:read",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "folder:read",
].join(" ");

// In-memory PKCE state, keyed by the `state` param. Short-lived — only needs
// to survive the redirect round trip to Canva and back.
const pendingAuth = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function cleanupPending() {
  const now = Date.now();
  for (const [state, entry] of pendingAuth) {
    if (now - entry.createdAt > PENDING_TTL_MS) pendingAuth.delete(state);
  }
}

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePkce() {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function getConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
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

function basicAuthHeader(config) {
  return "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

export async function getCanvaAccessToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return null;

  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000) {
    return tokens.access_token;
  }

  const config = getConfig();
  if (!config) return null;

  const resp = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(config),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Canva token refresh failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  tokens.access_token = data.access_token;
  tokens.refresh_token = data.refresh_token || tokens.refresh_token;
  tokens.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  saveTokens(tokens);
  return tokens.access_token;
}

export function canvaAuthHandler(req, res) {
  const config = getConfig();
  if (!config) return res.status(500).json({ error: "CANVA_CLIENT_ID and CANVA_CLIENT_SECRET not configured" });

  cleanupPending();
  const state = base64url(crypto.randomBytes(24));
  const { verifier, challenge } = generatePkce();
  pendingAuth.set(state, { verifier, createdAt: Date.now() });

  const redirectUri = `https://${req.get("host")}/api/canva/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  res.redirect(`${CANVA_AUTH_URL}?${params.toString()}`);
}

export async function canvaCallbackHandler(req, res) {
  const config = getConfig();
  if (!config) return res.status(500).json({ error: "Canva not configured" });

  const { code, state, error } = req.query;
  if (error) return res.status(400).json({ error: `Canva denied authorization: ${error}` });
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const pending = pendingAuth.get(state);
  if (!pending) return res.status(400).json({ error: "Unknown or expired state — restart the connect flow" });
  pendingAuth.delete(state);

  const redirectUri = `https://${req.get("host")}/api/canva/callback`;

  try {
    const resp = await fetch(CANVA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(config),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: pending.verifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: `Token exchange failed: ${text}` });
    }

    const data = await resp.json();
    saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      scope: data.scope,
    });

    res.redirect("/?canva=connected");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function canvaStatusHandler(req, res) {
  const tokens = loadTokens();
  res.json({
    connected: !!(tokens && tokens.refresh_token),
    scope: tokens?.scope || "",
  });
}
