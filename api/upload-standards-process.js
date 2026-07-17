import { PDFParse }        from "pdf-parse";
import mammoth              from "mammoth";
import { supabase }         from "../server-lib/supabase.js";
import { getAuthenticatedUserId } from "../server-lib/auth.js";
import { splitIntoChunks }  from "../server-lib/chunk-text.js";
import { embedBatch }       from "../server-lib/embeddings.js";
import { ensurePdfEnvironmentReady } from "../server-lib/pdf-node-setup.js";
import {
  scanDocumentContext,
  extractChunkMetadata,
} from "../server-lib/standards-metadata.js";

const BUCKET          = "standards-uploads";
const EMBED_BATCH_SIZE = 20;

async function extractText(buffer, filename) {
  const lower = (filename || "").toLowerCase();

  if (lower.endsWith(".pdf")) {
    // Same pdf-parse/pdfjs-dist Node-serverless setup custom-templates.js
    // needs — see server-lib/pdf-node-setup.js. This route hits the identical
    // "Setting up fake worker failed" / "DOMMatrix is not defined" crash on
    // Vercel without it, since it also parses PDFs directly.
    await ensurePdfEnvironmentReady();
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

    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    try {
      return await processUpload({ path, filename, userId, res });
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

async function processUpload({ path, filename, userId, res }) {
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

  const normalizedText = text.replace(/\s+/g, " ").trim();
  const chunks = splitIntoChunks(normalizedText).filter((c) => c.length >= 20);
  const total  = chunks.length;

  if (total === 0) {
    return res.status(400).json({ error: "Document produced no usable text chunks." });
  }

  // ── Document-level context scan ───────────────────────────────────────────
  const documentContext = scanDocumentContext(normalizedText);
  console.log("[upload-standards-process] document context:", documentContext);

  // ── Per-chunk metadata extraction ─────────────────────────────────────────
  const chunkMeta = chunks.map((content, i) =>
    extractChunkMetadata(content, {
      prevContent: i > 0 ? chunks[i - 1] : "",
      documentContext,
    })
  );

  const unknownCount = chunkMeta.filter((m) => m.extraction_source === "unknown").length;
  const bySource = {};
  for (const m of chunkMeta) bySource[m.extraction_source] = (bySource[m.extraction_source] ?? 0) + 1;
  console.log(
    `[upload-standards-process] ${total} chunks — extraction breakdown:`,
    bySource,
    `| unknown-grade: ${unknownCount}/${total}`
  );

  // ── Create the upload record FIRST so chunks can be linked via upload_id ──
  const { data: uploadRow, error: uploadCreateError } = await supabase
    .from("standard_uploads")
    .insert({
      user_id:    userId,
      filename:   filename || null,
      row_count:  0,
      subject:    documentContext.subject   ?? null,
      grade_band: documentContext.grade_band ?? null,
    })
    .select("id")
    .single();

  if (uploadCreateError) {
    console.error("[upload-standards-process] standard_uploads create failed:", uploadCreateError.message);
    return res.status(500).json({ error: "Could not create upload record." });
  }
  const uploadId = uploadRow.id;
  console.log(`[upload-standards-process] upload record created: uploadId=${uploadId} user_id=${userId}`);

  // ── Dedupe against this user's existing teacher-uploaded content ─────────
  const { data: existingRows, error: fetchError } = await supabase
    .from("standards")
    .select("content")
    .eq("framework", "Custom")
    .eq("source", "teacher_upload")
    .or(`user_id.eq.${userId},user_id.is.null`);

  if (fetchError) {
    console.error("[upload-standards-process] fetch existing error:", fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  const existingContent = new Set((existingRows ?? []).map((r) => r.content));

  let embedded = 0;
  let skipped  = 0;
  let failed   = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batchSlice   = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchMeta    = chunkMeta.slice(i, i + EMBED_BATCH_SIZE);
    const newIndices   = batchSlice.reduce((acc, c, j) => {
      if (!existingContent.has(c)) acc.push(j);
      return acc;
    }, []);

    skipped += batchSlice.length - newIndices.length;
    if (newIndices.length === 0) continue;

    const toEmbed = newIndices.map((j) => batchSlice[j]);
    let vectors;
    try {
      vectors = await embedBatch(toEmbed);
    } catch (err) {
      console.error("[upload-standards-process] embedding batch failed:", err.message);
      failed += toEmbed.length;
      continue;
    }

    for (let k = 0; k < newIndices.length; k++) {
      const j       = newIndices[k];
      const content = batchSlice[j];
      const meta    = batchMeta[j];

      console.log(
        `[upload-standards-process] chunk ${i + j + 1}/${total}`,
        `code=${meta.standard_code ?? "(none)"}`,
        `grade=${meta.grade_level ?? "?"}`,
        `band=${meta.grade_band ?? "?"}`,
        `subject=${meta.subject ?? "?"}`,
        `source=${meta.extraction_source}`
      );

      const { error: insertError } = await supabase.from("standards").insert({
        framework:     "Custom",
        standard_code: meta.standard_code ?? null,
        title:         filename || null,
        grade_level:   meta.grade_level  ?? null,
        grade_band:    meta.grade_band   ?? null,
        subject:       meta.subject      ?? null,
        content,
        source:        "teacher_upload",
        user_id:       userId,
        upload_id:     uploadId,
        embedding:     vectors[k],
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

  // ── Finalise the upload record ────────────────────────────────────────────
  if (embedded === 0 && skipped === 0) {
    // Nothing went in (all failed) — clean up the empty record
    await supabase.from("standard_uploads").delete().eq("id", uploadId);
    console.log(`[upload-standards-process] upload record deleted (all chunks failed): uploadId=${uploadId}`);
    return res.status(200).json({ total, embedded, skipped, failed, unknownGrade: unknownCount, uploadId: null });
  }

  const { error: updateError } = await supabase
    .from("standard_uploads")
    .update({ row_count: embedded })
    .eq("id", uploadId);

  if (updateError) {
    console.warn("[upload-standards-process] standard_uploads row_count update failed:", updateError.message);
  } else {
    console.log(`[upload-standards-process] upload saved: uploadId=${uploadId} rows_inserted=${embedded}`);
  }

  return res.status(200).json({ total, embedded, skipped, failed, unknownGrade: unknownCount, uploadId });
}
