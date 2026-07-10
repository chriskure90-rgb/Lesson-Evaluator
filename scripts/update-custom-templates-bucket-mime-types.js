/**
 * scripts/update-custom-templates-bucket-mime-types.js
 *
 * One-off update: the "custom-templates" Supabase Storage bucket was
 * originally created allowing only .docx uploads. This adds "application/pdf"
 * to its allowed MIME types so teachers can upload PDF lesson-plan templates
 * too (see api/custom-templates.js's PDF-to-docx conversion in the "register"
 * action). Safe to re-run.
 *
 * Usage:
 *   node scripts/update-custom-templates-bucket-mime-types.js
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env — bucket admin operations
 * (updateBucket) are not permitted with the anon key.
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
    if (k && !process.env[k]) process.env[k] = v; // don't overwrite shell env
  }
}

// ── 2. Resolve credentials ────────────────────────────────────────────────────
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "\nERROR: Supabase credentials not found.\n" +
    "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.\n"
  );
  process.exit(1);
}

const supabase = createClient(url, key);
const BUCKET = "custom-templates";

const { data: existing, error: getError } = await supabase.storage.getBucket(BUCKET);
if (getError || !existing) {
  console.error(`Bucket "${BUCKET}" not found. Run scripts/create-custom-templates-bucket.js first.`);
  process.exit(1);
}

const { error } = await supabase.storage.updateBucket(BUCKET, {
  public: false,
  fileSizeLimit: "10MB",
  allowedMimeTypes: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/pdf",
  ],
});

if (error) {
  console.error("Failed to update bucket:", error.message);
  process.exit(1);
}

console.log(`Bucket "${BUCKET}" updated — now accepts .docx and .pdf uploads.`);
