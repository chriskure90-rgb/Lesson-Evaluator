import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { supabase } from "./lib/supabase.js";
import { KNOWN_PLACEHOLDER_TOKENS } from "./lib/custom-template-placeholders.js";

const BUCKET = "custom-templates";

// Reads every {{TOKEN}} in the document via Docxtemplater's getFullText()
// (which concatenates text across XML runs) rather than a naive regex over
// the raw document.xml — Word frequently splits a placeholder like
// {{LESSON_TITLE}} across multiple <w:r> runs due to autocorrect/spellcheck,
// which a raw-XML regex would miss.
function detectPlaceholders(buffer) {
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
  });
  const fullText = doc.getFullText();
  const matches = [...fullText.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);
  const unique = Array.from(new Set(matches));
  return {
    all: unique,
    recognized: unique.filter((t) => KNOWN_PLACEHOLDER_TOKENS.includes(t)),
    unrecognized: unique.filter((t) => !KNOWN_PLACEHOLDER_TOKENS.includes(t)),
  };
}

// Downloads the .docx the browser already placed in Supabase Storage (via
// api/custom-template-upload-init.js), detects its placeholders, and
// registers it in custom_templates. Unlike the standards-upload pipeline,
// the storage object is never deleted here — it's the permanent export
// template, not a processing relay.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { path, filename, name, userId } = req.body ?? {};
    if (!path)   return res.status(400).json({ error: "Missing upload path." });
    if (!userId) return res.status(400).json({ error: "Missing userId." });

    const templateName = (name || filename || "Untitled Template").trim();

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(path);

    if (downloadError) {
      console.error("[custom-template-register] download error:", downloadError.message);
      return res.status(400).json({ error: "Could not read the uploaded file." });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());

    let detected = { all: [], recognized: [], unrecognized: [] };
    let status = "ready";
    let errorMessage = null;

    try {
      detected = detectPlaceholders(buffer);
      if (detected.recognized.length === 0) {
        status = "error";
        errorMessage = "No recognized placeholders were found in this document. Check that it uses tags like {{LESSON_TITLE}}, {{OBJECTIVES}}, etc.";
      }
    } catch (err) {
      console.error("[custom-template-register] placeholder detection failed:", err.message);
      status = "error";
      errorMessage = "Could not read this file as a valid Word template. It may be corrupted or use unsupported formatting.";
    }

    const insertPayload = {
      user_id:                   userId,
      name:                      templateName,
      original_filename:         filename || path,
      storage_path:              path,
      placeholders:              detected.all,
      recognized_placeholders:   detected.recognized,
      unrecognized_placeholders: detected.unrecognized,
      status,
      error_message:             errorMessage,
    };

    const { data: saved, error: insertError } = await supabase
      .from("custom_templates")
      .insert([insertPayload])
      .select("*")
      .single();

    if (insertError) {
      console.error("[custom-template-register] insert error:", insertError.message);
      return res.status(500).json({ error: "Could not save the template." });
    }

    return res.status(200).json(saved);
  } catch (error) {
    console.error("[custom-template-register] error:", error);
    return res.status(500).json({ error: error.message || "Template registration failed." });
  }
}
