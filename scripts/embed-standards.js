/**
 * scripts/embed-standards.js
 *
 * Finds every row in the Supabase `standards` table with a NULL `embedding`,
 * generates a 1536-dimension embedding for its `content` with OpenAI's
 * text-embedding-3-small model, and writes the vector back into the
 * `embedding` column (vector(1536)).
 *
 * Requests are sent in small batches to stay well under OpenAI rate limits.
 *
 * Usage:
 *   node scripts/embed-standards.js
 *
 * Credentials are read from the project .env file automatically:
 *   OPENAI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL
 */

import { readFileSync, existsSync } from "fs";
import { createClient }             from "@supabase/supabase-js";
import OpenAI                       from "openai";
import { fileURLToPath }            from "url";
import { dirname, join, resolve }   from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS  = 1536;
const BATCH_SIZE      = 25;   // rows per OpenAI request / per DB page
const BATCH_DELAY_MS  = 300;  // pause between batches to avoid rate limits
const MAX_RETRIES     = 3;

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
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey    = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "\nERROR: Supabase credentials not found.\n" +
    "Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env\n"
  );
  process.exit(1);
}

if (!openaiKey) {
  console.error(
    "\nERROR: OPENAI_API_KEY not found.\n" +
    "Add OPENAI_API_KEY=... to .env\n"
  );
  process.exit(1);
}

console.log(`Supabase URL    : ${supabaseUrl}`);
console.log(`Key type        : service_role (RLS bypassed)`);
console.log(`Embedding model : ${EMBEDDING_MODEL} (${EMBEDDING_DIMS} dims)`);

const supabase = createClient(supabaseUrl, supabaseKey);
const openai   = new OpenAI({ apiKey: openaiKey });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 3. Fetch every row with a NULL embedding (paginated) ─────────────────────
const PAGE_SIZE = 1000;
const rows = [];
let from = 0;

while (true) {
  const { data, error } = await supabase
    .from("standards")
    .select("id, content")
    .is("embedding", null)
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("\nERROR fetching rows:", error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  rows.push(...data);
  if (data.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
}

console.log(`\nRows to embed   : ${rows.length}\n`);

// ── 4. Embed + update in small batches ────────────────────────────────────────
let embedded = 0;
let skipped  = 0;
let failed   = 0;

async function embedWithRetry(inputs) {
  let attempt = 0;
  while (true) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
      });
      return response.data;
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) throw err;
      const backoff = BATCH_DELAY_MS * 2 ** attempt;
      console.error(`  ... embedding request failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message}. Retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);

  const toEmbed = batch.filter((r) => r.content && r.content.trim());
  const empty   = batch.length - toEmbed.length;
  skipped += empty;

  if (toEmbed.length > 0) {
    try {
      const embeddings = await embedWithRetry(toEmbed.map((r) => r.content));

      for (let j = 0; j < toEmbed.length; j++) {
        const row    = toEmbed[j];
        const vector = embeddings[j].embedding;

        const { error: updateError } = await supabase
          .from("standards")
          .update({ embedding: vector })
          .eq("id", row.id);

        if (updateError) {
          console.error(`  FAIL  id=${row.id}: ${updateError.message}`);
          failed++;
        } else {
          embedded++;
        }
      }
    } catch (err) {
      console.error(`  FAIL  batch starting at row ${i}: ${err.message}`);
      failed += toEmbed.length;
    }
  }

  const processed = Math.min(i + BATCH_SIZE, rows.length);
  console.log(`  ... processed ${processed}/${rows.length}`);

  if (i + BATCH_SIZE < rows.length) {
    await sleep(BATCH_DELAY_MS);
  }
}

// ── 5. Summary ────────────────────────────────────────────────────────────────
console.log("\n── Summary ──────────────────────────");
console.log(`  Total rows   : ${rows.length}`);
console.log(`  Embedded     : ${embedded}`);
console.log(`  Skipped      : ${skipped}`);
console.log(`  Failed       : ${failed}`);
