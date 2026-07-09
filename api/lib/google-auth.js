// Google API auth — prefers OAuth user tokens, falls back to service account JWT.
// Handles Google Analytics Data API and Search Console API.

import { createSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGoogleAccessToken } from "./google-oauth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(__dirname, "../../.google-sa-key.json");

let cachedToken = null;
let tokenExpiry = 0;

function loadKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      return JSON.parse(fs.readFileSync(KEY_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function base64url(data) {
  return Buffer.from(data).toString("base64url");
}

function createJWT(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: key.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const signInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(key.private_key, "base64url");
  return `${signInput}.${signature}`;
}

export async function getAccessToken() {
  // Prefer OAuth user token
  try {
    const oauthToken = await getGoogleAccessToken();
    if (oauthToken) return oauthToken;
  } catch {}

  // Fall back to service account
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  const key = loadKey();
  if (!key) return null;

  const jwt = createJWT(key, [
    "https://www.googleapis.com/auth/analytics.readonly",
    "https://www.googleapis.com/auth/webmasters.readonly",
  ]);

  const resp = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google auth failed (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

export async function analyticsReport(propertyId, params) {
  const token = await getAccessToken();
  if (!token) throw new Error("No Google service account key. Add .google-sa-key.json to the server.");

  const resp = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Analytics API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

export async function searchConsoleQuery(siteUrl, params) {
  const token = await getAccessToken();
  if (!token) throw new Error("No Google service account key. Add .google-sa-key.json to the server.");

  const encodedUrl = encodeURIComponent(siteUrl);
  const resp = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodedUrl}/searchAnalytics/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Search Console API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

export async function listAnalyticsProperties() {
  const token = await getAccessToken();
  if (!token) throw new Error("No Google service account key.");

  const resp = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries", {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Analytics Admin API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

export async function listSearchConsoleSites() {
  const token = await getAccessToken();
  if (!token) throw new Error("No Google service account key.");

  const resp = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Search Console API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}
