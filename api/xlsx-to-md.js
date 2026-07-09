// Converts an uploaded Excel (.xlsx/.xls) file to Markdown.
// Each sheet becomes a ## section with a markdown table.
// POST /api/xlsx-to-md  { base64: "<base64 string>", filename: "file.xlsx" }

import * as XLSX from "xlsx";

function sheetToMarkdown(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) return `## ${sheetName}\n\n*(empty sheet)*\n`;

  // Find the last column with any data
  const maxCols = Math.max(...rows.map(r => r.length));
  if (maxCols === 0) return `## ${sheetName}\n\n*(empty sheet)*\n`;

  const pad = (row) => {
    const cells = Array.from({ length: maxCols }, (_, i) => String(row[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "));
    return "| " + cells.join(" | ") + " |";
  };

  const header = pad(rows[0]);
  const divider = "| " + Array(maxCols).fill("---").join(" | ") + " |";
  const body = rows.slice(1).map(pad).join("\n");

  return `## ${sheetName}\n\n${header}\n${divider}\n${body}\n`;
}

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { base64, filename = "spreadsheet.xlsx" } = req.body || {};
  if (!base64) return res.status(400).json({ error: "base64 field required" });

  try {
    const buf = Buffer.from(base64, "base64");
    const workbook = XLSX.read(buf, { type: "buffer" });

    const sections = workbook.SheetNames.map(name =>
      sheetToMarkdown(workbook.Sheets[name], name)
    );

    const md = `# ${filename.replace(/\.[^.]+$/, "")}\n\n` + sections.join("\n---\n\n");
    return res.json({ markdown: md, sheets: workbook.SheetNames });
  } catch (err) {
    return res.status(500).json({ error: "Could not parse file: " + err.message });
  }
}
