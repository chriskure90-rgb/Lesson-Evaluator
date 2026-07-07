/**
 * scripts/backfill-ngss-grade-metadata.js
 *
 * One-off backfill: populates grade_level/grade_band on every existing NGSS
 * row in the Supabase `standards` table, inferring them from standard_code
 * (or title, as a fallback for un-coded chunks) via scripts/lib/ngss-grade.js.
 *
 * Requires the `grade_level`/`grade_band` columns to already exist — run
 * scripts/sql/match_standards.sql in the Supabase SQL editor first.
 *
 * Usage:
 *   node scripts/backfill-ngss-grade-metadata.js
 *
 * Safe to re-run: it only overwrites rows whose current grade_band would
 * change, so it converges rather than double-counting on repeat runs.
 */

import { readFileSync, existsSync } from "fs";
import { createClient }             from "@supabase/supabase-js";
import { fileURLToPath }            from "url";
import { dirname, join, resolve }   from "path";
import { inferNgssGrade }           from "./lib/ngss-grade.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

// ── 1. Load .env manually ─────────────────────────────────────────────────────
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

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
console.log(`Key type        : service_role (RLS bypassed)\n`);

const supabase = createClient(url, key);

// ── 2. Fetch every NGSS row (paginated — table can exceed 1000 rows) ─────────
const PAGE_SIZE = 1000;
const rows = [];
let from = 0;

while (true) {
  const { data, error } = await supabase
    .from("standards")
    .select("id, standard_code, title, grade_level, grade_band")
    .eq("framework", "NGSS")
    .range(from, from + PAGE_SIZE - 1);

  if (error) {
    console.error("\nERROR fetching NGSS rows:", error.message);
    if (error.message?.includes("grade_level") || error.message?.includes("grade_band")) {
      console.error(
        "Hint: the grade_level/grade_band columns don't exist yet.\n" +
        "Run scripts/sql/match_standards.sql in the Supabase SQL editor first.\n"
      );
    }
    process.exit(1);
  }
  if (!data || data.length === 0) break;

  rows.push(...data);
  if (data.length < PAGE_SIZE) break;
  from += PAGE_SIZE;
}

console.log(`NGSS rows found : ${rows.length}\n`);

// ── 3. Infer + update ──────────────────────────────────────────────────────────
let taggedByCode  = 0;
let taggedByTitle = 0;
let untagged      = 0;
let unchanged     = 0;
let updated       = 0;
let failed        = 0;

for (const [i, row] of rows.entries()) {
  const { grade_level, grade_band } = inferNgssGrade(row.standard_code, row.title);

  if (grade_level === row.grade_level && grade_band === row.grade_band) {
    unchanged++;
  } else {
    const { error } = await supabase
      .from("standards")
      .update({ grade_level, grade_band })
      .eq("id", row.id);

    if (error) {
      console.error(`  FAIL  id=${row.id}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  if (grade_band === null) {
    untagged++;
  } else if (row.standard_code) {
    taggedByCode++;
  } else {
    taggedByTitle++;
  }

  if ((i + 1) % 100 === 0) {
    console.log(`  ... processed ${i + 1}/${rows.length}`);
  }
}

// ── 4. Summary ────────────────────────────────────────────────────────────────
console.log("\n── Summary ──────────────────────────");
console.log(`  Total NGSS rows   : ${rows.length}`);
console.log(`  Tagged (by code)  : ${taggedByCode}`);
console.log(`  Tagged (by title) : ${taggedByTitle}`);
console.log(`  Left untagged     : ${untagged}`);
console.log(`  Updated           : ${updated}`);
console.log(`  Already correct   : ${unchanged}`);
console.log(`  Failed            : ${failed}`);
