import { supabase } from "./lib/supabase.js";

// Private, permanent bucket — unlike standards-uploads (a relay that gets
// deleted after processing), the uploaded .docx here IS the export source of
// truth and must persist indefinitely.
const BUCKET = "custom-templates";

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

    const { filename, userId } = req.body ?? {};
    const trimmedName = (filename || "").trim();
    const lower = trimmedName.toLowerCase();

    if (!userId) {
      return res.status(400).json({ error: "Missing userId." });
    }
    if (!trimmedName || !lower.endsWith(".docx")) {
      return res.status(400).json({ error: "Please upload a .docx file." });
    }

    const safeName = trimmedName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      console.error("[custom-template-upload-init] createSignedUploadUrl error:", error.message);
      return res.status(500).json({ error: "Could not prepare upload." });
    }

    return res.status(200).json({ path: data.path, token: data.token });
  } catch (error) {
    console.error("[custom-template-upload-init] error:", error);
    return res.status(500).json({ error: "Could not prepare upload." });
  }
}
