import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { randomUUID } from "node:crypto";
import { supabase, SUPABASE_KEY_SOURCE } from "./lib/supabase.js";
import { ensurePdfEnvironmentReady } from "./lib/pdf-node-setup.js";

// Dev-mode-only: surface the real error message in the response so upload
// failures are debuggable locally without digging through server logs. Never
// exposed in production (gated on VERCEL_ENV, which Vercel always sets in
// deployed environments but is absent locally).
const IS_DEV = process.env.VERCEL_ENV !== "production";

// pdf-parse and docx are imported lazily (inside extractPdfText/
// synthesizeDocxFromPdfSections below) rather than statically at the top of
// the file. If either ever fails to load in the deployed serverless
// environment (e.g. a native-dependency or bundling issue), a static import
// would crash the whole module at cold start — breaking upload-init/delete/
// export/docx-only register too, not just PDF processing. A lazy import
// confines any such failure to the try/catch that already wraps the PDF
// branch in handleRegister, which turns it into a normal status:"error" row
// instead of an unhandled function crash.

/* ── Custom DOCX template routes, combined into one function ──────────────────
   Vercel's Hobby plan caps a project at 12 Serverless Functions, and every
   file under /api counts toward that limit. This single file replaces what
   were previously three separate route files (upload-init, register, export)
   so the feature costs one function slot instead of three. Dispatch is by
   `action` in the JSON body — behavior is unchanged from the split version.
────────────────────────────────────────────────────────────────────────────── */

const BUCKET = "custom-templates";

// ── Placeholder catalog ────────────────────────────────────────────────────────
// Maps each {{TOKEN}} a teacher's uploaded DOCX template can use to a piece of
// Template1Lesson content. Mirrors src/lib/custom-template-placeholders.ts
// (kept in sync by hand — that TS copy is used client-side for the same
// token list; api/ has no TypeScript build step so it can't import it directly).
const PLACEHOLDER_CATALOG = {
  LESSON_TITLE:   { kind: "text", extract: (l) => l.lessonTitle },
  GRADE_LEVEL:    { kind: "text", extract: (l) => l.subjectGradeLevel },
  OBJECTIVES:     { kind: "list", extract: (l) => l.lessonObjectives },
  MATERIALS:      { kind: "list", extract: (l) => l.materials },
  INTRO_TEACHER:  { kind: "text", extract: (l) => l.introduction?.teacherActions },
  INTRO_STUDENTS: { kind: "text", extract: (l) => l.introduction?.studentActions },
  MAIN_TEACHER:   { kind: "text", extract: (l) => l.mainLearningActivities?.teacherActions },
  MAIN_STUDENTS:  { kind: "text", extract: (l) => l.mainLearningActivities?.studentActions },
  CLOSURE:        { kind: "text", extract: (l) => `${l.closure?.teacherActions ?? ""}\n\n${l.closure?.studentActions ?? ""}` },
  ASSESSMENT:     { kind: "text", extract: (l) => l.assessment?.howObjectivesAssessed },
};

const KNOWN_PLACEHOLDER_TOKENS = Object.keys(PLACEHOLDER_CATALOG);

// Builds the docxtemplater .render() data object, restricted to only the
// placeholders this specific template actually uses (template.recognized_placeholders).
// List-kind values (OBJECTIVES/MATERIALS) are joined into bullet lines — the
// uploaded template has a single {{TOKEN}}, not a loop construct, so an array
// value is rendered as one multi-line block (linebreaks: true in the
// Docxtemplater options turns the "\n" below into real Word line breaks).
function buildRenderData(lesson, recognizedTokens) {
  const data = {};
  for (const token of recognizedTokens || []) {
    const entry = PLACEHOLDER_CATALOG[token];
    if (!entry) continue;
    const value = entry.extract(lesson);
    if (entry.kind === "list" && Array.isArray(value)) {
      data[token] = value.map((v) => `• ${v}`).join("\n");
    } else {
      data[token] = value ?? "";
    }
  }
  return data;
}

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

// ── PDF template conversion ──────────────────────────────────────────────────
// A PDF has no editable {{PLACEHOLDER}} tags and isn't a reflowable format
// docxtemplater can merge into directly, so an uploaded PDF is converted
// once, at registration time, into a synthesized .docx that DOES use our
// normal {{TOKEN}} placeholder syntax. From that point on it's stored and
// treated exactly like any other custom template — same table, same export
// path, same everything (see handleRegister below). storage_path ends up
// pointing at the synthesized file, not the original PDF.
//
// Keyword -> catalog token mapping used to recognize section headings in the
// PDF's extracted plain text. Deliberately keyword-based rather than a
// generic layout/heading detector, since pdf-parse only returns flat text
// with no font-size/bold metadata to lean on — lesson-plan templates
// reliably use these words as section labels, which keeps false positives
// low. Table structure isn't reconstructed (not reliably possible from flat
// PDF text without page-position data) — only section titles/order carry
// over.
const PDF_SECTION_KEYWORDS = [
  { tokens: ["LESSON_TITLE"],                     pattern: /\blesson\s*title\b|^title$/i },
  { tokens: ["GRADE_LEVEL"],                      pattern: /\bgrade(\s*level)?\b/i },
  { tokens: ["OBJECTIVES"],                        pattern: /\bobjectives?\b|\blearning\s*goals?\b/i },
  { tokens: ["MATERIALS"],                         pattern: /\bmaterials?\b|\bresources?\b/i },
  { tokens: ["INTRO_TEACHER", "INTRO_STUDENTS"],    pattern: /\bintroduction\b|\bwarm[\s-]?up\b|\bopening\b|\bhook\b/i },
  { tokens: ["MAIN_TEACHER", "MAIN_STUDENTS"],      pattern: /\bprocedure\b|\bactivit(y|ies)\b|\bmain\s*(lesson|activity|activities)\b|\binstruction(al)?\s*steps?\b/i },
  { tokens: ["CLOSURE"],                            pattern: /\bclosure\b|\bconclusion\b|\bwrap[\s-]?up\b|\bsummary\b/i },
  { tokens: ["ASSESSMENT"],                         pattern: /\bassessment\b|\bevaluation\b|\bexit\s*ticket\b/i },
];

// Scans extracted PDF text line by line for section-heading candidates
// (short lines that don't end in sentence punctuation) matching a known
// keyword, preserving the order they appear in. Each token is only ever
// claimed once, so a keyword mentioned again later in body text doesn't
// spawn a duplicate section.
function detectPdfSections(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const sections = [];
  const claimedTokens = new Set();

  for (const line of lines) {
    if (line.length > 70 || /[.?!]$/.test(line)) continue;

    for (const entry of PDF_SECTION_KEYWORDS) {
      if (!entry.pattern.test(line)) continue;
      const tokens = entry.tokens.filter((t) => !claimedTokens.has(t));
      if (tokens.length === 0) break; // this concept was already captured under an earlier heading
      tokens.forEach((t) => claimedTokens.add(t));
      sections.push({ heading: line.replace(/:\s*$/, ""), tokens });
      break;
    }
  }

  return sections;
}

// Builds a new .docx (via the `docx` library) reproducing the detected
// sections in their original order: each as a bold heading (the PDF's own
// wording) followed by one {{TOKEN}} placeholder paragraph per mapped
// token — a real docxtemplater-compatible template from here on.
async function synthesizeDocxFromPdfSections(sections) {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");

  const children = [];
  for (const section of sections) {
    children.push(new Paragraph({
      children: [new TextRun({ text: section.heading, bold: true, size: 26 })],
      spacing: { before: 240, after: 100 },
    }));
    for (const token of section.tokens) {
      // A heading like "Introduction" maps to two tokens (teacher + student
      // actions) — label each so the exported document reads clearly rather
      // than running both blocks of text together.
      const label = token.endsWith("_TEACHER") ? "Teacher: " : token.endsWith("_STUDENTS") ? "Students: " : null;
      children.push(new Paragraph({
        children: label
          ? [new TextRun({ text: label, bold: true }), new TextRun(`{{${token}}}`)]
          : [new TextRun(`{{${token}}}`)],
        spacing: { after: 200 },
      }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function extractPdfText(buffer) {
  // Sanity-check the buffer itself before handing it to the parser — this is
  // the only way to tell "we got a truncated/non-PDF buffer from Storage"
  // apart from "pdf-parse choked on a structurally valid PDF", which are two
  // very different bugs with the same user-facing symptom.
  const header = buffer.subarray(0, 8).toString("latin1");
  console.log("[custom-templates:extract-pdf] buffer diagnostics:", {
    byteLength: buffer.length,
    isBuffer: Buffer.isBuffer(buffer),
    header, // a valid PDF always starts with "%PDF-1.x"
    looksLikePdf: header.startsWith("%PDF-"),
  });

  // Installs the @napi-rs/canvas DOMMatrix/ImageData/Path2D polyfills and
  // points pdfjs-dist's fake-worker loader at an absolute, resolved path to
  // pdf.worker.mjs — see api/lib/pdf-node-setup.js for why both are needed
  // in a Vercel serverless function specifically.
  await ensurePdfEnvironmentReady();
  const { PDFParse } = await import("pdf-parse");
  // pdf-parse's own constructor already converts a Buffer to Uint8Array
  // internally (see node_modules/pdf-parse .../PDFParse.js), so passing the
  // Buffer straight through is equivalent to the manual `new Uint8Array(buffer)`
  // wrap that used to be here — kept explicit only for clarity.
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    console.log("[custom-templates:extract-pdf] extracted text length:", result.text?.length ?? 0);
    return result.text;
  } catch (err) {
    // pdf-parse normalizes pdfjs-dist failures into named exception types
    // (InvalidPDFException, PasswordException, FormatError,
    // UnknownErrorException w/ .details, ResponseException w/ .status) —
    // log every field individually since a bare Error passed to
    // console.error can render as "{}" in some log pipelines.
    console.error("[custom-templates:extract-pdf] parser threw — name:", err?.name);
    console.error("[custom-templates:extract-pdf] parser threw — message:", err?.message);
    console.error("[custom-templates:extract-pdf] parser threw — details:", err?.details);
    console.error("[custom-templates:extract-pdf] parser threw — status:", err?.status);
    console.error("[custom-templates:extract-pdf] parser threw — statusCode:", err?.statusCode);
    console.error("[custom-templates:extract-pdf] parser threw — stack:", err?.stack);
    throw err;
  } finally {
    await parser.destroy();
  }
}

// ── action: "upload-init" ──────────────────────────────────────────────────────
// Issues a short-lived signed upload URL so the browser can PUT the file
// straight into Supabase Storage without routing the bytes through this
// function (which has a ~4.5MB request body cap on Vercel). Private,
// permanent bucket — unlike standards-uploads (a relay that gets deleted
// after processing), the uploaded file here IS the export source of truth
// (for a .docx directly; for a .pdf, register converts it into one — see
// handleRegister).
// Logs every field of a caught error individually (message/name/status/
// statusCode/stack) rather than passing the raw object to console.error —
// some log pipelines (Vercel's included) collapse a bare Error object down
// to "{}" or drop everything after the first arg, which is exactly why the
// prior version of this handler's logs went dark right at this call.
function logFullError(label, error) {
  console.error(`${label} message:`, error?.message);
  console.error(`${label} name:`, error?.name);
  console.error(`${label} status:`, error?.status);
  console.error(`${label} statusCode:`, error?.statusCode);
  console.error(`${label} stack:`, error?.stack);
}

async function handleUploadInit(req, res) {
  const { filename, userId, mimeType } = req.body ?? {};
  const trimmedName = (filename || "").trim();
  const lower = trimmedName.toLowerCase();
  const extension = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "(none)";

  console.log("[custom-templates:upload-init] request:", {
    filename: trimmedName || "(empty)",
    extension,
    mimeType: mimeType || "(not sent by client)",
    userId: userId || "(missing)",
    usingServiceRole: SUPABASE_KEY_SOURCE === "SUPABASE_SERVICE_ROLE_KEY",
    keySource: SUPABASE_KEY_SOURCE,
  });

  if (!userId) {
    return res.status(400).json({ error: "Missing userId." });
  }
  if (!trimmedName || (!lower.endsWith(".docx") && !lower.endsWith(".pdf"))) {
    console.log("[custom-templates:upload-init] rejected: unsupported extension", extension);
    return res.status(400).json({ error: "Please upload a .docx or .pdf file." });
  }

  const safeName = trimmedName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${Date.now()}-${randomUUID()}-${safeName}`;
  console.log("[custom-templates:upload-init] validation passed:", { bucket: BUCKET, path });

  // Confirm the bucket itself is reachable with the key this function is
  // actually using before attempting the signed URL — if this fails, the
  // problem is bucket-existence/permissions, not createSignedUploadUrl.
  const { data: bucketInfo, error: bucketError } = await supabase.storage.getBucket(BUCKET);
  if (bucketError) {
    logFullError("[custom-templates:upload-init] getBucket error —", bucketError);
    return res.status(500).json({
      error: "Could not prepare upload.",
      ...(IS_DEV ? { details: `Bucket check failed: ${bucketError.message}` } : {}),
    });
  }
  console.log("[custom-templates:upload-init] bucket confirmed:", {
    id: bucketInfo?.id,
    public: bucketInfo?.public,
    allowed_mime_types: bucketInfo?.allowed_mime_types,
  });

  try {
    console.log("[custom-templates:upload-init] calling createSignedUploadUrl with:", {
      bucket: BUCKET,
      path,
    });
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);

    if (error) {
      logFullError("[custom-templates:upload-init] createSignedUploadUrl error —", error);
      return res.status(500).json({
        error: "Could not prepare upload.",
        ...(IS_DEV
          ? { details: `${error.name || "Error"} (status ${error.status ?? "?"}/${error.statusCode ?? "?"}): ${error.message}` }
          : {}),
      });
    }

    console.log("[custom-templates:upload-init] signed URL created:", data.path);
    return res.status(200).json({ path: data.path, token: data.token });
  } catch (err) {
    logFullError("[custom-templates:upload-init] unexpected exception —", err);
    return res.status(500).json({
      error: "Could not prepare upload.",
      ...(IS_DEV ? { details: err?.message || String(err) } : {}),
    });
  }
}

// ── action: "register" ─────────────────────────────────────────────────────────
// Downloads the .docx the browser already placed in Supabase Storage (via
// the upload-init action), detects its placeholders, and registers it in
// custom_templates. Unlike the standards-upload pipeline, the storage object
// is never deleted here — it's the permanent export template, not a
// processing relay.
async function handleRegister(req, res) {
  const { path, filename, name, userId } = req.body ?? {};
  if (!path)   return res.status(400).json({ error: "Missing upload path." });
  if (!userId) return res.status(400).json({ error: "Missing userId." });

  const templateName = (name || filename || "Untitled Template").trim();
  const isPdf = (filename || path || "").toLowerCase().endsWith(".pdf");

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (downloadError) {
    console.error("[custom-templates:register] download error:", downloadError.message);
    return res.status(400).json({ error: "Could not read the uploaded file." });
  }

  let buffer = Buffer.from(await fileData.arrayBuffer());
  let storagePath = path;
  let detected = { all: [], recognized: [], unrecognized: [] };
  let status = "ready";
  let errorMessage = null;

  // A PDF isn't a template docxtemplater can merge into directly, so convert
  // it once into a synthesized {{TOKEN}}-based .docx first. storagePath then
  // points at that synthesized file, never the original PDF — from there on,
  // placeholder detection below (and every other action) treats it exactly
  // like a normal uploaded .docx.
  if (isPdf) {
    try {
      const text = await extractPdfText(buffer);
      if (!text || !text.trim()) {
        status = "error";
        errorMessage = "Could not extract any text from this PDF. It may be a scanned image rather than a text-based document.";
      } else {
        const sections = detectPdfSections(text);
        if (sections.length === 0) {
          status = "error";
          errorMessage = "Could not detect any recognizable lesson-plan sections in this PDF (e.g. Objectives, Materials, Procedure, Assessment). Try a Word (.docx) template instead, or add clearer section headings.";
        } else {
          const synthesizedBuffer = await synthesizeDocxFromPdfSections(sections);
          const synthesizedPath = `${path.replace(/\.pdf$/i, "")}-converted.docx`;

          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(synthesizedPath, synthesizedBuffer, {
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });

          if (uploadError) {
            console.error("[custom-templates:register] synthesized docx upload error:", uploadError.message);
            status = "error";
            errorMessage = "Could not save the converted template. Please try again.";
          } else {
            buffer = synthesizedBuffer;
            storagePath = synthesizedPath;
          }
        }
      }
    } catch (err) {
      // Logged field-by-field (not the bare Error object) since this is the
      // one place a serverless-environment-specific failure (e.g. a
      // pdf-parse/docx dependency issue) is most likely to show up, and a
      // bare Error passed to console.error can collapse to "{}" in some log
      // pipelines — that's what made the previous version of this handler's
      // logs go dark right here.
      console.error("[custom-templates:register] PDF conversion failed — name:", err?.name);
      console.error("[custom-templates:register] PDF conversion failed — message:", err?.message);
      console.error("[custom-templates:register] PDF conversion failed — details:", err?.details);
      console.error("[custom-templates:register] PDF conversion failed — status:", err?.status);
      console.error("[custom-templates:register] PDF conversion failed — statusCode:", err?.statusCode);
      console.error("[custom-templates:register] PDF conversion failed — stack:", err?.stack);
      status = "error";
      errorMessage = IS_DEV
        ? `Could not read this PDF. [dev] ${err?.name || "Error"} (status=${err?.status ?? "n/a"}, statusCode=${err?.statusCode ?? "n/a"}): ${err?.message || String(err)}`
        : "Could not read this PDF. It may be corrupted, password-protected, or in an unsupported format.";
    }
  }

  // Skip placeholder detection if the PDF branch above already failed —
  // buffer/storagePath point at a real .docx either way otherwise (the
  // original upload, or the just-synthesized one).
  if (status !== "error") {
    try {
      detected = detectPlaceholders(buffer);
      if (detected.recognized.length === 0) {
        status = "error";
        errorMessage = isPdf
          ? "Could not map any detected sections to a supported placeholder. Try a Word (.docx) template instead."
          : "No recognized placeholders were found in this document. Check that it uses tags like {{LESSON_TITLE}}, {{OBJECTIVES}}, etc.";
      }
    } catch (err) {
      console.error("[custom-templates:register] placeholder detection failed:", err.message);
      status = "error";
      errorMessage = "Could not read this file as a valid Word template. It may be corrupted or use unsupported formatting.";
    }
  }

  const insertPayload = {
    user_id:                   userId,
    name:                      templateName,
    original_filename:         filename || path,
    storage_path:              storagePath,
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
    console.error("[custom-templates:register] insert error:", insertError.message);
    return res.status(500).json({ error: "Could not save the template." });
  }

  return res.status(200).json(saved);
}

// ── action: "delete" ───────────────────────────────────────────────────────────
// Removes the Storage object and the custom_templates row. Requires the
// service-role key (the bucket is private, so the browser can't do this
// directly) — that's why this lives here rather than as a direct client
// Supabase call like renameCustomTemplate.
async function handleDelete(req, res) {
  const { customTemplateId, userId } = req.body ?? {};
  if (!customTemplateId) return res.status(400).json({ error: "Missing customTemplateId." });
  if (!userId)           return res.status(400).json({ error: "Missing userId." });

  const { data: template, error: fetchError } = await supabase
    .from("custom_templates")
    .select("*")
    .eq("id", customTemplateId)
    .single();

  if (fetchError || !template) {
    return res.status(404).json({ error: "Template not found." });
  }
  if (template.user_id !== userId) {
    return res.status(403).json({ error: "You do not have access to this template." });
  }

  const { error: removeError } = await supabase.storage.from(BUCKET).remove([template.storage_path]);
  if (removeError) {
    // Don't block deleting the row over a storage cleanup failure — an
    // orphaned file in a private bucket is harmless, an undeletable row isn't.
    console.warn("[custom-templates:delete] storage remove failed:", removeError.message);
  }

  const { error: deleteError } = await supabase
    .from("custom_templates")
    .delete()
    .eq("id", customTemplateId);

  if (deleteError) {
    console.error("[custom-templates:delete] delete error:", deleteError.message);
    if (deleteError.code === "23503") {
      return res.status(409).json({ error: "This template has saved lessons using it and can't be deleted." });
    }
    return res.status(500).json({ error: "Could not delete the template." });
  }

  return res.status(200).json({ success: true });
}

// ── action: "export" ───────────────────────────────────────────────────────────
// Loads the teacher's uploaded .docx template, fills in its recognized
// {{PLACEHOLDER}} tokens from the (Template1Lesson-shaped) lessonData, and
// streams the merged .docx back. The built-in Template1 DOCX builder
// (src/lib/template1-docx.ts) is never used for custom templates — this is
// the only export path for template_type "custom".
async function handleExport(req, res) {
  const { customTemplateId, userId, lessonData } = req.body ?? {};
  if (!customTemplateId) return res.status(400).json({ error: "Missing customTemplateId." });
  if (!userId)           return res.status(400).json({ error: "Missing userId." });
  if (!lessonData)       return res.status(400).json({ error: "Missing lessonData." });

  const { data: template, error: fetchError } = await supabase
    .from("custom_templates")
    .select("*")
    .eq("id", customTemplateId)
    .single();

  if (fetchError || !template) {
    return res.status(404).json({ error: "Template not found." });
  }
  if (template.user_id !== userId) {
    return res.status(403).json({ error: "You do not have access to this template." });
  }
  if (template.status !== "ready") {
    return res.status(400).json({ error: "This template is not ready for export." });
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(template.storage_path);

  if (downloadError) {
    console.error("[custom-templates:export] download error:", downloadError.message);
    return res.status(500).json({ error: "Could not load the template file." });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "", // any tag not in recognized_placeholders resolves to blank rather than throwing
  });

  const renderData = buildRenderData(lessonData, template.recognized_placeholders || []);
  doc.render(renderData);

  const outBuffer = doc.getZip().generate({ type: "nodebuffer" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", 'attachment; filename="lesson-plan.docx"');
  return res.status(200).send(outBuffer);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { action } = req.body ?? {};
    switch (action) {
      case "upload-init": return await handleUploadInit(req, res);
      case "register":    return await handleRegister(req, res);
      case "delete":      return await handleDelete(req, res);
      case "export":      return await handleExport(req, res);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (error) {
    console.error("[custom-templates] error:", error);
    return res.status(500).json({ error: error.message || "Request failed." });
  }
}
