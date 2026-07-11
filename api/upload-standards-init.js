import { randomUUID } from "node:crypto";
import { supabase } from "../server-lib/supabase.js";

// Bucket used purely as a relay: the browser uploads the raw file here
// directly (bypassing the serverless function body-size limit), then
// api/upload-standards-process.js downloads it server-side and deletes it.
const BUCKET = "standards-uploads";

const ALLOWED_EXTENSIONS = [".pdf", ".docx"];

// Dev-mode-only: surface the real error message in the response. Never
// exposed in production (gated on VERCEL_ENV, which Vercel always sets in
// deployed environments but is absent locally).
const IS_DEV = process.env.VERCEL_ENV !== "production";

// Issues a short-lived signed upload URL so the browser can PUT the file
// straight into Supabase Storage without routing the bytes through this
// function (which has a ~4.5MB request body cap on Vercel).
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { filename } = req.body ?? {};
    const trimmedName = (filename || "").trim();
    const lower = trimmedName.toLowerCase();

    if (!trimmedName || !ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return res.status(400).json({ error: "Please upload a PDF or DOCX file." });
    }

    const path = `${Date.now()}-${randomUUID()}-${trimmedName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      console.error("[upload-standards-init] createSignedUploadUrl error:", error);
      return res.status(500).json({
        error: "Could not prepare upload.",
        ...(IS_DEV ? { details: error.message } : {}),
      });
    }

    return res.status(200).json({ path: data.path, token: data.token });
  } catch (error) {
    console.error("[upload-standards-init] error:", error);
    return res.status(500).json({
      error: "Could not prepare upload.",
      ...(IS_DEV ? { details: error?.message || String(error) } : {}),
    });
  }
}
