// Bulk-update all student/course info files from a CSV export.
// POST /api/bulk-update-clients  { csv: "<full csv text>" }
// Groups rows by company/name, matches each to a /students/ (or /clients/) folder slug,
// then writes all files to GitHub in one pass — no per-file tool-call overhead.

import { Octokit } from "@octokit/rest";

const REPO_OWNER    = "homeinspectorhelp";
const REPO_NAME     = "higa";
const DEFAULT_BRANCH = "main";

// ── slug helpers ─────────────────────────────────────────────────────────────

function toSlug(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[''&]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Score how well two slugs match (higher = better). Tries exact, then prefix,
// then checks if all words of one appear in the other.
function matchScore(folderSlug, companySlug) {
  if (folderSlug === companySlug) return 100;
  if (folderSlug.includes(companySlug) || companySlug.includes(folderSlug)) return 80;
  const fWords = new Set(folderSlug.split("-").filter(Boolean));
  const cWords = companySlug.split("-").filter(Boolean);
  const hits = cWords.filter(w => fWords.has(w)).length;
  if (hits === 0) return 0;
  return Math.round((hits / Math.max(fWords.size, cWords.length)) * 60);
}

function bestMatch(companyName, folderNames) {
  const slug = toSlug(companyName);
  let best = null, bestScore = 0;
  for (const f of folderNames) {
    const s = matchScore(f, slug);
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return bestScore >= 40 ? best : null;
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || "").trim(); });
    if (row.company) rows.push(row);
  }
  return rows;
}

// Group CSV rows by company, collecting all membership/service lines per company.
function groupByCompany(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.company;
    if (!map.has(key)) {
      map.set(key, {
        firstName:  row["first name"] || "",
        lastName:   row["last name"]  || "",
        company:    row.company,
        street:     row.street        || "",
        city:       row.city          || "",
        state:      row.state         || "",
        zip:        row.zip           || "",
        email:      row.email         || "",
        phone:      row["phone number"] || "",
        services:   [],
      });
    }
    const membership = row.membership || row["membership"] || "";
    if (membership) map.get(key).services.push(membership);
  }
  return map;
}

// ── Markdown builder ──────────────────────────────────────────────────────────

function buildClientInfo(client, existing) {
  // Preserve everything below the Account Overview block if the file has real data.
  // Otherwise start from the template and fill in what we know.
  const name     = `${client.firstName} ${client.lastName}`.trim();
  const address  = [client.street, client.city, client.state, client.zip].filter(Boolean).join(", ");
  const services = client.services.join(" | ");

  // If there's already a populated file, just update the services line and contact.
  if (existing && existing.length > 400) {
    let md = existing;
    // Update Services/Courses line
    md = md.replace(/(\*\*Services from HIGA:\*\*).*/, `$1 ${services}`);
    md = md.replace(/(\*\*Services from HIH:\*\*).*/, `$1 ${services}`);
    md = md.replace(/(\*\*Courses:\*\*).*/, `$1 ${services}`);
    // Update Primary Contact
    md = md.replace(/(\*\*Primary Contact:\*\*).*/, `$1 ${name}`);
    // Update Primary Email
    md = md.replace(/(\*\*Primary Email:\*\*).*/, `$1 ${client.email}`);
    // Update phone
    md = md.replace(/(\| Local Phone Number \|)[^|]*(\|)/, `$1 ${client.phone} $2`);
    // Update address
    md = md.replace(/(\| Address \/ NAP[^|]*\|)[^|]*(\|)/, `$1 ${address} $2`);
    return md;
  }

  // Build a fresh populated file from scratch
  return `# Student Information — ${client.company}

## Account Overview
- **Enrollment Date:**
- **Courses:** ${services}
- **Student Status:**
- **Notes:**

## Contact Details

| Field | Value |
|---|---|
| Address | ${address} |
| Phone | ${client.phone} |
| Website URL | |

## Contacts
- **Primary Contact:** ${name}
- **Primary Email:** ${client.email}
- **Secondary Contact:**
- **Secondary Email:**

## Course Progress
- **Current Course:**
- **Completed Modules:**
- **Next Steps:**

## Business Profile
- **Business Name:** ${client.company}
- **City/State:** ${client.city}, ${client.state}
- **Specialties:**
`;
}

// ── GitHub helpers ────────────────────────────────────────────────────────────

async function getFileSha(octokit, path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path, ref: DEFAULT_BRANCH,
    });
    return { sha: data.sha, content: Buffer.from(data.content, "base64").toString("utf-8") };
  } catch (e) {
    if (e.status === 404) return { sha: null, content: null };
    throw e;
  }
}

async function writeFile(octokit, path, content, sha, message) {
  await octokit.repos.createOrUpdateFileContents({
    owner: REPO_OWNER, repo: REPO_NAME, path,
    branch: DEFAULT_BRANCH, message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    ...(sha ? { sha } : {}),
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const token = process.env.GITHUB_TOKEN_HIGA;
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN_HIGA not configured" });

  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: "csv field required" });

  const octokit = new Octokit({ auth: token });

  // Try /students/ first, fall back to /clients/
  let folderNames = [];
  let rootFolder = "students";
  try {
    const { data: rootContents } = await octokit.repos.getContent({
      owner: REPO_OWNER, repo: REPO_NAME, path: "students", ref: DEFAULT_BRANCH,
    });
    folderNames = rootContents
      .filter(f => f.type === "dir")
      .map(f => f.name);
  } catch (e) {
    // Fall back to clients folder
    try {
      rootFolder = "clients";
      const { data: rootContents } = await octokit.repos.getContent({
        owner: REPO_OWNER, repo: REPO_NAME, path: "clients", ref: DEFAULT_BRANCH,
      });
      folderNames = rootContents
        .filter(f => f.type === "dir")
        .map(f => f.name);
    } catch (e2) {
      folderNames = [];
    }
  }

  const rows     = parseCsv(csv);
  const clients  = groupByCompany(rows);

  const updated  = [];
  const created  = [];
  const skipped  = [];

  for (const [company, client] of clients) {
    const folder = bestMatch(company, folderNames);
    if (!folder) { skipped.push({ company, reason: "no matching folder" }); continue; }

    const filePath = `${rootFolder}/${folder}/STUDENT_INFO.md`;
    const { sha, content: existing } = await getFileSha(octokit, filePath);
    const markdown = buildClientInfo(client, existing);

    const action = sha ? "update" : "create";
    await writeFile(
      octokit, filePath, markdown, sha,
      `student(${folder}): ${action} STUDENT_INFO from CSV import`
    );

    if (sha) updated.push({ company, folder });
    else     created.push({ company, folder });

    // Small delay to stay within GitHub secondary rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  return res.json({
    summary: {
      total:   clients.size,
      updated: updated.length,
      created: created.length,
      skipped: skipped.length,
    },
    updated,
    created,
    skipped,
  });
}
