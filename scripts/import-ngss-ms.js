/**
 * scripts/import-ngss-ms.js
 *
 * Reads data/ngss-ms-standards.json and inserts every standard into the
 * Supabase `standards` table.  Rows that already exist (matched by
 * framework + standard_code) are skipped so the script is safe to re-run.
 *
 * Usage:
 *   node scripts/import-ngss-ms.js
 *
 * Credentials are read from the project .env file automatically.
 * If you have a SUPABASE_SERVICE_ROLE_KEY, add it to .env — it bypasses
 * RLS and is strongly preferred for import scripts.  Without it the script
 * falls back to the anon key, which works only when the `standards` table
 * has a public INSERT policy or RLS is disabled.
 */

import { readFileSync, existsSync } from "fs";
import { createClient }             from "@supabase/supabase-js";
import { fileURLToPath }            from "url";
import { dirname, join, resolve }   from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

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
const url = process.env.SUPABASE_URL      ?? process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY   ??   // best: bypasses RLS
  process.env.SUPABASE_ANON_KEY           ??
  process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "\nERROR: Supabase credentials not found.\n" +
    "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env\n"
  );
  process.exit(1);
}

const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`Supabase URL    : ${url}`);
console.log(`Key type        : ${usingServiceRole ? "service_role (RLS bypassed)" : "anon (RLS applies)"}`);

const supabase = createClient(url, key);

// ── 3. Read JSON ──────────────────────────────────────────────────────────────
const jsonPath = join(ROOT, "data", "ngss-ms-standards.json");
if (!existsSync(jsonPath)) {
  console.error(`\nERROR: file not found: ${jsonPath}\n`);
  process.exit(1);
}
const { standards } = JSON.parse(readFileSync(jsonPath, "utf-8"));
console.log(`\nStandards in file : ${standards.length}`);

// ── 4. Build the content string ───────────────────────────────────────────────
function buildContent(s) {
  const parts = [];

  if (s.performance_expectation?.trim()) {
    parts.push(`Performance Expectation: ${s.performance_expectation.trim()}`);
  }

  if (s.sep) {
    const sepLabel = [s.sep.name?.trim(), s.sep.description?.trim()]
      .filter(Boolean).join(": ");
    if (sepLabel) parts.push(`Science and Engineering Practice — ${sepLabel}`);
  }

  if (s.dci) {
    const dciLabel = [
      s.dci.code?.trim(),
      s.dci.name?.trim(),
      s.dci.description?.trim(),
    ].filter(Boolean).join(" — ");
    if (dciLabel) parts.push(`Disciplinary Core Idea — ${dciLabel}`);
  }

  if (s.ccc) {
    const cccLabel = [s.ccc.name?.trim(), s.ccc.description?.trim()]
      .filter(Boolean).join(": ");
    if (cccLabel) parts.push(`Crosscutting Concept — ${cccLabel}`);
  }

  if (s.keywords?.length) {
    parts.push(`Keywords: ${s.keywords.join(", ")}`);
  }

  return parts.join("\n\n");
}

// ── 5. Fetch existing codes to detect duplicates ──────────────────────────────
const { data: existing, error: fetchError } = await supabase
  .from("standards")
  .select("standard_code")
  .eq("framework", "NGSS");

if (fetchError) {
  console.error("\nERROR fetching existing rows:", fetchError.message);
  if (!usingServiceRole) {
    console.error("Hint: this may be an RLS issue. Add SUPABASE_SERVICE_ROLE_KEY to .env\n");
  }
  process.exit(1);
}

const existingCodes = new Set((existing ?? []).map((r) => r.standard_code));
console.log(`Already in DB    : ${existingCodes.size}\n`);

// ── 6. Insert loop ────────────────────────────────────────────────────────────
let inserted = 0;
let skipped  = 0;
let failed   = 0;

for (const s of standards) {
  const code = (s.code ?? "").trim();
  if (!code) {
    console.log(`  SKIP  (no code) — topic: ${s.topic}`);
    skipped++;
    continue;
  }

  if (existingCodes.has(code)) {
    console.log(`  SKIP  ${code} — already exists`);
    skipped++;
    continue;
  }

  const row = {
    framework:     "NGSS",
    standard_code: code,
    title:         (s.topic ?? "").trim() || null,
    content:       buildContent(s),
    source:        "system",
  };

  const { error } = await supabase.from("standards").insert(row);

  if (error) {
    console.error(`  FAIL  ${code}: ${error.message}`);
    if (!usingServiceRole && error.code === "42501") {
      console.error("         → RLS blocked this insert. Add SUPABASE_SERVICE_ROLE_KEY to .env");
    }
    failed++;
  } else {
    console.log(`  OK    ${code}`);
    inserted++;
  }
}

// ── 7. Summary ────────────────────────────────────────────────────────────────
console.log("\n── Summary ──────────────────────────");
console.log(`  Total in file : ${standards.length}`);
console.log(`  Inserted      : ${inserted}`);
console.log(`  Skipped       : ${skipped}`);
console.log(`  Failed        : ${failed}`);

if (failed > 0 && !usingServiceRole) {
  console.log(
    "\nTip: Add SUPABASE_SERVICE_ROLE_KEY to .env for full RLS bypass on import scripts."
  );
}
