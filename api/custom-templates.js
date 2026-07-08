import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { supabase } from "./lib/supabase.js";

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

// ── action: "upload-init" ──────────────────────────────────────────────────────
// Issues a short-lived signed upload URL so the browser can PUT the file
// straight into Supabase Storage without routing the bytes through this
// function (which has a ~4.5MB request body cap on Vercel). Private,
// permanent bucket — unlike standards-uploads (a relay that gets deleted
// after processing), the uploaded .docx here IS the export source of truth.
async function handleUploadInit(req, res) {
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
    console.error("[custom-templates:upload-init] createSignedUploadUrl error:", error.message);
    return res.status(500).json({ error: "Could not prepare upload." });
  }

  return res.status(200).json({ path: data.path, token: data.token });
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

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(path);

  if (downloadError) {
    console.error("[custom-templates:register] download error:", downloadError.message);
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
    console.error("[custom-templates:register] placeholder detection failed:", err.message);
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
