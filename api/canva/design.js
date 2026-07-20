// Canva Connect API calls that turn Brie's design decisions into real files:
// list Brand Templates, autofill one with Brie's spec, export the result.
// Requires the OAuth connection set up in api/lib/canva-oauth.js.

import { getCanvaAccessToken } from "../lib/canva-oauth.js";

const API_BASE = "https://api.canva.com/rest/v1";

async function canvaFetch(pathname, options = {}) {
  const token = await getCanvaAccessToken();
  if (!token) {
    const err = new Error("Canva not connected — visit /api/canva/auth to connect");
    err.status = 409;
    throw err;
  }

  const resp = await fetch(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Canva API ${pathname} failed (${resp.status}): ${text.slice(0, 300)}`);
    err.status = resp.status;
    throw err;
  }

  return resp.json();
}

async function pollJob(fetchJob, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const job = await fetchJob();
    if (job.status === "success") return job;
    if (job.status === "failed") throw new Error(`Canva job failed: ${job.error?.message || "unknown error"}`);
    if (Date.now() > deadline) throw new Error("Canva job timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function listBrandTemplates() {
  const data = await canvaFetch("/brand-templates");
  return data.items || [];
}

// data shape per Canva's Autofill API: { fieldName: { type: "text", text } | { type: "image", asset_id } }
export async function autofillBrandTemplate(brandTemplateId, data, title) {
  const started = await canvaFetch("/autofills", {
    method: "POST",
    body: JSON.stringify({ brand_template_id: brandTemplateId, title, data }),
  });

  const job = await pollJob(async () => {
    const status = await canvaFetch(`/autofills/${started.job.id}`);
    return status.job;
  });

  return job.result.design; // { id, title, url, ... }
}

export async function exportDesign(designId, format = { type: "png" }) {
  const started = await canvaFetch("/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format }),
  });

  const job = await pollJob(async () => {
    const status = await canvaFetch(`/exports/${started.job.id}`);
    return status.job;
  });

  return job.urls || [];
}

export async function listBrandTemplatesHandler(req, res) {
  try {
    res.json(await listBrandTemplates());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

// POST /api/canva/logo
// { brandTemplateId, data: { <field>: {type:"text",text} | {type:"image",asset_id} }, title, format }
export async function produceLogoHandler(req, res) {
  const { brandTemplateId, data, title, format } = req.body || {};
  if (!brandTemplateId || !data) {
    return res.status(400).json({ error: "brandTemplateId and data are required" });
  }

  try {
    const design = await autofillBrandTemplate(brandTemplateId, data, title || "Logo");
    const exportUrls = await exportDesign(design.id, format || { type: "png" });
    res.json({ design, exportUrls });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}
