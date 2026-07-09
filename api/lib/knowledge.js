// Knowledge base — semantic search over the repo's business files, backed by
// the local @zvec/zvec vector database and a local embedding model. No external
// API or paid service: the embedding model runs entirely on this server.
//
// The vector collection is built by scripts/index-knowledge.js and is read
// here by Max's search_knowledge tool.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the built vector collection lives (created by the indexing script).
export const COLLECTION_PATH = path.join(__dirname, "..", "..", "data", "zvec-knowledge");
// Small, fast, free embedding model — runs locally, 384-dimension output.
export const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";

let _extractor = null;

// Turn text into a vector. The model is downloaded once on first use and then
// cached; loading is deferred so it never slows Max's startup.
export async function embed(text) {
  if (!_extractor) {
    const { pipeline } = await import("@huggingface/transformers");
    _extractor = await pipeline("feature-extraction", EMBED_MODEL);
  }
  const out = await _extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

// Semantic search the knowledge base. Returns { available, results }.
// Returns available:false (rather than throwing) when the index has not been
// built yet, so Max can fall back to reading files directly.
export async function searchKnowledge(query, topk = 6) {
  if (!fs.existsSync(COLLECTION_PATH)) {
    return { available: false, results: [] };
  }
  const { ZVecOpen } = await import("@zvec/zvec");
  const vector = await embed(query);
  const col = ZVecOpen(COLLECTION_PATH, { readOnly: true });
  try {
    const docs = col.querySync({
      fieldName: "embedding",
      vector,
      topk,
      outputFields: ["text", "source"],
    });
    // zvec's COSINE score is a distance (0 = identical) — convert to a 0–1
    // similarity so the result reads naturally.
    return {
      available: true,
      results: docs.map((d) => ({
        source: d.fields.source,
        similarity: Number(Math.max(0, 1 - d.score).toFixed(3)),
        text: d.fields.text,
      })),
    };
  } finally {
    col.closeSync();
  }
}
