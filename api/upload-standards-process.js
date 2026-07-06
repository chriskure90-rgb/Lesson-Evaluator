import { PDFParse }        from "pdf-parse";
import mammoth              from "mammoth";
import { supabase }         from "./lib/supabase.js";
import { splitIntoChunks }  from "./lib/chunk-text.js";
import { embedBatch }       from "./lib/embeddings.js";

const BUCKET          = "standards-uploads";
const EMBED_BATCH_SIZE = 20;

async function extractText(buffer, filename) {
  const lower = (filename || "").toLowerCase();

  if (lower.endsWith(".pdf")) {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error("Unsupported file type. Please upload a PDF or DOCX file.");
}

// Downloads the file the browser already placed in Supabase Storage
// (via api/upload-standards-init.js), extracts its text, chunks it,
// embeds each chunk, and inserts it into `standards` as framework="Custom",
// source="teacher_upload" so it is immediately searchable via match_standards().
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { path, filename } = req.body ?? {};

  try {
    if (!supabase) return res.status(500).json({ error: "Supabase is not configured." });
    if (!path)      return res.status(400).json({ error: "Missing upload path." });

    try {
      return await processUpload({ path, filename, res });
    } finally {
      // Always clear the relay file, whether processing succeeded or bailed
      // out early (unsupported type, empty text, etc.) — it's write-only
      // scratch space, never a source of truth.
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
      if (removeError) {
        console.warn("[upload-standards-process] cleanup failed:", removeError.message);
      }
    }
  } catch (error) {
    console.error("[upload-standards-process] error:", error);
    return res.status(500).json({ error: error.message || "Upload processing failed." });
  }
}

async function processUpload({ path, filename, res }) {
  const { data: fileData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (downloadError) {
    console.error("[upload-standards-process] download error:", downloadError.message);
    return res.status(400).json({ error: "Could not read the uploaded file." });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const text   = await extractText(buffer, filename || path);

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "No extractable text found in the document." });
  }

  const chunks = splitIntoChunks(text.replace(/\s+/g, " ").trim())
    .filter((c) => c.length >= 20);

  const total = chunks.length;

  if (total === 0) {
    return res.status(400).json({ error: "Document produced no usable text chunks." });
  }

  // ── Dedupe against existing teacher-uploaded content ─────────────────────
  const { data: existingRows, error: fetchError } = await supabase
    .from("standards")
    .select("content")
    .eq("framework", "Custom")
    .eq("source", "teacher_upload");

  if (fetchError) {
    console.error("[upload-standards-process] fetch existing error:", fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  const existingContent = new Set((existingRows ?? []).map((r) => r.content));

  let embedded = 0;
  let skipped  = 0;
  let failed   = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch   = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const toEmbed = batch.filter((c) => !existingContent.has(c));
    skipped += batch.length - toEmbed.length;
    if (toEmbed.length === 0) continue;

    let vectors;
    try {
      vectors = await embedBatch(toEmbed);
    } catch (err) {
      console.error("[upload-standards-process] embedding batch failed:", err.message);
      failed += toEmbed.length;
      continue;
    }

    for (let j = 0; j < toEmbed.length; j++) {
      const content = toEmbed[j];
      const { error: insertError } = await supabase.from("standards").insert({
        framework:     "Custom",
        standard_code: null,
        title:         filename || null,
        content,
        source:        "teacher_upload",
        embedding:     vectors[j],
      });

      if (insertError) {
        console.error("[upload-standards-process] insert failed:", insertError.message);
        failed++;
      } else {
        embedded++;
        existingContent.add(content);
      }
    }
  }

  return res.status(200).json({ total, embedded, skipped, failed });
}
