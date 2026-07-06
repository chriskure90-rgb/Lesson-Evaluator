/**
 * scripts/import-ngss-pdf.js
 *
 * Extracts text from data/AllTopic.pdf, splits it into ~500-1000 character
 * chunks, and inserts each chunk into the Supabase `standards` table as a
 * raw-text NGSS reference row (framework = "NGSS", source = "system_pdf").
 *
 * This does NOT generate embeddings — it only stores the extracted text so
 * a later pass can embed it.
 *
 * Usage:
 *   node scripts/import-ngss-pdf.js
 *
 * Credentials are read from the project .env file automatically.
 * SUPABASE_SERVICE_ROLE_KEY is required so inserts bypass RLS.
 */

import { readFileSync, existsSync } from "fs";
import { createClient }             from "@supabase/supabase-js";
import { PDFParse }                 from "pdf-parse";
import { fileURLToPath }            from "url";
import { dirname, join, resolve }   from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

const MIN_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 1000;

// ── 1. Load .env manually (no dotenv dependency needed) ──────────────────────
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;   // don't overwrite shell env
  }
}

// ── 2. Resolve credentials ────────────────────────────────────────────────────
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\nERROR: Supabase credentials not found.\n" +
    "Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env\n"
  );
  process.exit(1);
}

console.log(`Supabase URL    : ${url}`);
console.log(`Key type        : service_role (RLS bypassed)`);

const supabase = createClient(url, key);

// ── 3. Extract text from the PDF ──────────────────────────────────────────────
const pdfPath = join(ROOT, "data", "AllTopic.pdf");
if (!existsSync(pdfPath)) {
  console.error(`\nERROR: file not found: ${pdfPath}\n`);
  process.exit(1);
}

console.log(`\nReading PDF     : ${pdfPath}`);
const pdfBuffer = readFileSync(pdfPath);
const parser    = new PDFParse({ data: new Uint8Array(pdfBuffer) });
const parsed    = await parser.getText();
await parser.destroy();
console.log(`Extracted chars : ${parsed.text.length}`);

// ── 4. Clean up recurring page furniture (headers/footers/TOC dot-leaders) ───
const FOOTER_RE     = /Achieve, Inc\.\s*All rights reserved/i;
const PAGE_MARKER_RE = /^-- \d+ of \d+ --$/;
const TOC_LEADER_RE  = /\.{4,}\s*\d+\s*$/;

const rawLines = parsed.text.split(/\r?\n/);
const lines = rawLines.filter((line) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (FOOTER_RE.test(trimmed)) return false;
  if (PAGE_MARKER_RE.test(trimmed)) return false;
  if (TOC_LEADER_RE.test(trimmed)) return false;
  return true;
});

// ── 5. Detect section headings and group lines into sections ─────────────────
// NGSS topic headings look like "K.Forces and Interactions: Pushes and Pulls",
// "3-5.Engineering Design", "MS.Energy", "HS.Earth's Systems", etc.
const HEADING_RE = /^(?:K|[1-8]|K-2|3-5|MS|HS)\.[A-Z][\w .,:;'’&()/-]{2,90}$/;

const sections = []; // { title: string|null, lines: string[] }
let current = { title: null, lines: [] };

for (const line of lines) {
  const trimmed = line.trim();
  if (HEADING_RE.test(trimmed)) {
    if (current.lines.length) sections.push(current);
    current = { title: trimmed, lines: [] };
  } else {
    current.lines.push(trimmed);
  }
}
if (current.lines.length) sections.push(current);

console.log(`Sections found  : ${sections.length}`);

// ── 6. Split each section's text into ~500-1000 character chunks ─────────────
function splitIntoChunks(text) {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (buffer.length >= MIN_CHUNK_SIZE && buffer.length + sentence.length + 1 > MAX_CHUNK_SIZE) {
      chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  // Hard-split any chunk that still exceeds the max (e.g. one very long sentence).
  return chunks.flatMap((chunk) => {
    if (chunk.length <= MAX_CHUNK_SIZE) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += MAX_CHUNK_SIZE) {
      parts.push(chunk.slice(i, i + MAX_CHUNK_SIZE));
    }
    return parts;
  });
}

const CODE_RE = /\b(?:K|[1-8]|K-2|3-5|MS|HS)-(?:PS|LS|ESS|ETS)\d?-\d+\b/;

const chunkRows = [];
for (const section of sections) {
  const sectionText = section.lines.join(" ").replace(/\s+/g, " ").trim();
  if (!sectionText) continue;

  for (const chunkText of splitIntoChunks(sectionText)) {
    if (chunkText.length < 20) continue; // skip stray fragments
    const codeMatch = chunkText.match(CODE_RE);
    chunkRows.push({
      framework:     "NGSS",
      standard_code: codeMatch ? codeMatch[0] : null,
      title:         section.title,
      content:       chunkText,
      source:        "system_pdf",
    });
  }
}

console.log(`Total chunks    : ${chunkRows.length}\n`);

// ── 7. Fetch existing content for this framework/source to skip duplicates ───
const { data: existingRows, error: fetchError } = await supabase
  .from("standards")
  .select("content")
  .eq("framework", "NGSS")
  .eq("source", "system_pdf");

if (fetchError) {
  console.error("\nERROR fetching existing rows:", fetchError.message);
  process.exit(1);
}

const existingContent = new Set((existingRows ?? []).map((r) => r.content));
console.log(`Already in DB   : ${existingContent.size}\n`);

// ── 8. Insert loop ─────────────────────────────────────────────────────────────
let inserted = 0;
let skipped  = 0;
let failed   = 0;

for (const [i, row] of chunkRows.entries()) {
  if (existingContent.has(row.content)) {
    skipped++;
    continue;
  }

  const { error } = await supabase.from("standards").insert(row);

  if (error) {
    console.error(`  FAIL  chunk ${i + 1}: ${error.message}`);
    failed++;
  } else {
    existingContent.add(row.content);
    inserted++;
  }

  if ((i + 1) % 50 === 0) {
    console.log(`  ... processed ${i + 1}/${chunkRows.length}`);
  }
}

// ── 9. Summary ────────────────────────────────────────────────────────────────
console.log("\n── Summary ──────────────────────────");
console.log(`  Total chunks : ${chunkRows.length}`);
console.log(`  Inserted     : ${inserted}`);
console.log(`  Skipped      : ${skipped}`);
console.log(`  Failed       : ${failed}`);
