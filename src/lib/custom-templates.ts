import { supabase } from "./supabase";
import type { Template1Lesson } from "../App";

export type CustomTemplateStatus = "processing" | "ready" | "error";

// A detected checklist / repeated-option-list section (e.g. a "Teaching
// Strategy" heading followed by checkbox options) — see detectStructuredFields
// in api/custom-templates.js. Distinct from placeholders/recognized_placeholders,
// which cover free-narrative sections mapped to the fixed PLACEHOLDER_CATALOG.
export type CustomTemplateStructuredField = {
  type: "checklist" | "list";
  field: string;
  label: string;
  token: string;
  options: string[];
};

// Phase 1 section recognition (see detectTemplateSections in
// api/custom-templates.js) — a second, independent classification of the
// document's actual sections, separate from placeholders/
// recognized_placeholders/structured_fields (which the existing generation/
// export pipeline reads from and which this phase never touches).
export type DetectedSectionType = "content_section" | "metadata_field" | "instruction_text";

export type DetectedSectionItem = {
  id: string;
  originalLabel: string;
  normalizedKey: string;
  type: DetectedSectionType;
  order: number;
  confidence: number;
  detectionReason?: string;
};

export type DetectedSections = {
  contentSections: DetectedSectionItem[];
  metadataFields: DetectedSectionItem[];
  instructionTexts: DetectedSectionItem[];
  confirmed: boolean;
  version: number;
};

export const DEFAULT_DETECTED_SECTIONS: DetectedSections = {
  contentSections: [],
  metadataFields: [],
  instructionTexts: [],
  confirmed: false,
  version: 1,
};

export type CustomTemplate = {
  id: string;
  user_id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  placeholders: string[];
  recognized_placeholders: string[];
  unrecognized_placeholders: string[];
  structured_fields: CustomTemplateStructuredField[];
  detected_sections: DetectedSections;
  section_detection_status: string | null;
  section_detection_error: string | null;
  status: CustomTemplateStatus;
  error_message: string | null;
  created_at: string;
};

const BUCKET = "custom-templates";

// A server-side crash (e.g. a serverless function invocation failure) can
// return a plain-text/HTML error page instead of JSON — calling
// response.json() unconditionally on that throws a confusing
// "Unexpected token ... is not valid JSON" error instead of a useful
// message. This checks the content-type first: parses JSON when the server
// actually sent JSON (including error responses shaped like { error }),
// and otherwise logs the raw body (for debugging) while surfacing
// `fallbackErrorMessage` to the caller instead of the raw server output.
async function parseCustomTemplatesResponse<T>(res: Response, fallbackErrorMessage: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || fallbackErrorMessage);
    return data as T;
  }

  const rawText = await res.text().catch(() => "");
  console.error("[custom-templates] non-JSON response:", res.status, rawText.slice(0, 500));
  throw new Error(fallbackErrorMessage);
}

/* ── Custom DOCX template upload ───────────────────────────────────────────────
   Same two-step signed-upload-URL pattern as the standards upload (see
   uploadFileToStorage in App.tsx): the browser PUTs the file straight into
   Supabase Storage, never routing the raw bytes through a Vercel serverless
   function (which caps request bodies at ~4.5MB). Unlike that pipeline,
   the uploaded file here is never deleted afterward — it's the permanent
   export template, not a processing relay.

   All three actions (upload-init/register/export) are served by the single
   /api/custom-templates route (dispatched via `action` in the body) rather
   than one file each — Vercel's Hobby plan caps a project at 12 Serverless
   Functions and every file under /api counts toward that.
────────────────────────────────────────────────────────────────────────────── */
export async function uploadCustomTemplateFile(file: File, userId: string): Promise<{ path: string }> {
  const initRes = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "upload-init", filename: file.name, mimeType: file.type, userId }),
  });
  const initData = await parseCustomTemplatesResponse<{ path: string; token: string }>(
    initRes,
    "Could not prepare the upload. Please try again."
  );

  const { error: storageError } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(initData.path, initData.token, file);
  if (storageError) throw new Error(storageError.message);

  return { path: initData.path };
}

// ── TEMPORARY DEBUGGING — remove after LessonPlanTemplate2.docx is diagnosed ──
// Turns on the server's section-detection debug mode (see handleRegister in
// api/custom-templates.js) for every registration and dumps the resulting
// sectionDetectionDebug array to the console. To remove: delete this block
// and the two marked lines below it in registerCustomTemplate.
const TEMP_DEBUG_SECTIONS = true;

function logSectionDetectionDebug(entries: unknown[] | undefined | null) {
  if (!TEMP_DEBUG_SECTIONS) return;
  if (!Array.isArray(entries)) {
    console.warn("[TEMP_DEBUG_SECTIONS] no sectionDetectionDebug in the response (debugSections may not have reached the server).");
    return;
  }
  console.group(`%c[TEMP_DEBUG_SECTIONS] sectionDetectionDebug — ${entries.length} raw candidates`, "font-weight:bold");
  console.log("Full array (expand to inspect every candidate):", entries);
  for (const entry of entries as Record<string, unknown>[]) {
    const tag = `#${entry.index} "${entry.text}" (signal=${entry.signal})`;
    if (entry.outcome === "discarded" || entry.outcome === "duplicate") {
      console.log(`%c${tag} -> ${entry.outcome}`, "color:#b33", "—", entry.discardReason);
    } else {
      console.log(
        `%c${tag} -> ${entry.outcome}`,
        "color:#2a7",
        `— normalizedKey=${entry.normalizedKey}, confidence=${entry.confidence}, reason="${entry.detectionReason}"`
      );
    }
    console.log("  trace:", entry.trace);
  }
  console.groupEnd();
}
// ── END TEMPORARY DEBUGGING ───────────────────────────────────────────────────

export async function registerCustomTemplate(params: {
  path: string;
  filename: string;
  name: string;
  userId: string;
}): Promise<CustomTemplate> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register", ...params, debugSections: TEMP_DEBUG_SECTIONS }), // TEMP DEBUG — remove debugSections when done
  });
  const isPdf = params.filename.toLowerCase().endsWith(".pdf");
  const result = await parseCustomTemplatesResponse<CustomTemplate & { sectionDetectionDebug?: unknown[] }>(
    res,
    isPdf
      ? "PDF processing failed. Please try another PDF or upload a DOCX file."
      : "Could not register this template. Please try again."
  );
  logSectionDetectionDebug(result.sectionDetectionDebug); // TEMP DEBUG — remove when done
  return result;
}

// structured_fields and detected_sections/section_detection_status/
// section_detection_error (scripts/sql/add-structured-fields-column.sql,
// add-detected-sections-columns.sql) are all recent columns — a database
// that hasn't had a migration applied yet returns a hard 400 ("column ...
// does not exist", PostgREST code 42703) for ANY select naming it, which
// would otherwise break every custom-template fetch (not just the parts
// that care about the new column) the moment this client code deploys
// ahead of the migration. BASE_COLUMNS is always safe to select; each
// select tries every OPTIONAL_COLUMN first and drops whichever one the
// error names, one at a time, until it succeeds — handles any subset of
// the migrations having been run, not just all-or-nothing.
const BASE_COLUMNS =
  "id, user_id, name, original_filename, storage_path, placeholders, recognized_placeholders, unrecognized_placeholders, status, error_message, created_at";
const OPTIONAL_COLUMNS = ["structured_fields", "detected_sections", "section_detection_status", "section_detection_error"] as const;

function isMissingColumnError(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  return error.code === "42703" && new RegExp(column, "i").test(error.message || "");
}

function buildSelectColumns(excluded: ReadonlySet<string>): string {
  const optional = OPTIONAL_COLUMNS.filter((c) => !excluded.has(c));
  return [BASE_COLUMNS, ...optional].join(", ");
}

function normalizeDetectedSections(raw: unknown): DetectedSections {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_DETECTED_SECTIONS;
  const r = raw as Record<string, unknown>;
  return {
    contentSections: Array.isArray(r.contentSections) ? (r.contentSections as DetectedSectionItem[]) : [],
    metadataFields: Array.isArray(r.metadataFields) ? (r.metadataFields as DetectedSectionItem[]) : [],
    instructionTexts: Array.isArray(r.instructionTexts) ? (r.instructionTexts as DetectedSectionItem[]) : [],
    confirmed: !!r.confirmed,
    version: typeof r.version === "number" ? r.version : 1,
  };
}

function normalizeCustomTemplateRow(row: Record<string, unknown>): CustomTemplate {
  return {
    ...(row as Omit<CustomTemplate, "structured_fields" | "detected_sections" | "section_detection_status" | "section_detection_error">),
    structured_fields: Array.isArray(row.structured_fields)
      ? (row.structured_fields as CustomTemplateStructuredField[])
      : [],
    detected_sections: normalizeDetectedSections(row.detected_sections),
    section_detection_status: typeof row.section_detection_status === "string" ? row.section_detection_status : null,
    section_detection_error: typeof row.section_detection_error === "string" ? row.section_detection_error : null,
  };
}

export async function fetchCustomTemplates(userId: string): Promise<CustomTemplate[]> {
  const excluded = new Set<string>();
  let data: Record<string, unknown>[] | null = null;
  let error: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    // The select column list is built at runtime (not a string literal), so
    // supabase-js can't infer a row type from it — cast to the shape we
    // handle manually via normalizeCustomTemplateRow below regardless.
    const result = (await supabase
      .from("custom_templates")
      .select(buildSelectColumns(excluded))
      .eq("user_id", userId)
      .order("created_at", { ascending: false })) as unknown as {
      data: Record<string, unknown>[] | null;
      error: { code?: string; message?: string } | null;
    };
    data = result.data;
    error = result.error;

    if (!error) break;
    const missingCol = OPTIONAL_COLUMNS.find((c) => !excluded.has(c) && isMissingColumnError(error, c));
    if (!missingCol) break;
    console.warn(`[custom-templates] ${missingCol} column not available yet — retrying without it. Run the matching migration in scripts/sql/.`);
    excluded.add(missingCol);
  }

  if (error) throw error;
  return (data ?? []).map(normalizeCustomTemplateRow);
}

// Single-row lookup for reopening/evaluating a lesson that was generated
// against a specific custom template (EvaluatorPage, LibraryPage) — those
// flows only have the id (from lesson_generation.custom_template_id), not
// the full list uploaded-templates state that GeneratorPage already holds.
export async function fetchCustomTemplateById(id: string): Promise<CustomTemplate | null> {
  const excluded = new Set<string>();
  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const result = (await supabase
      .from("custom_templates")
      .select(buildSelectColumns(excluded))
      .eq("id", id)
      .maybeSingle()) as unknown as {
      data: Record<string, unknown> | null;
      error: { code?: string; message?: string } | null;
    };
    data = result.data;
    error = result.error;

    if (!error) break;
    const missingCol = OPTIONAL_COLUMNS.find((c) => !excluded.has(c) && isMissingColumnError(error, c));
    if (!missingCol) break;
    console.warn(`[custom-templates] ${missingCol} column not available yet — retrying without it. Run the matching migration in scripts/sql/.`);
    excluded.add(missingCol);
  }

  if (error) throw error;
  return data ? normalizeCustomTemplateRow(data) : null;
}

// Renaming is just a metadata update (no Storage/service-role work needed),
// so it goes straight through the browser's Supabase client, same as other
// direct row updates in this app (e.g. lesson_json edits).
export async function renameCustomTemplate(id: string, name: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("custom_templates")
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
}

const DETECTED_SECTION_TYPES: DetectedSectionType[] = ["content_section", "metadata_field", "instruction_text"];

// Recalculates order (1-based, per array) and guarantees every item has a
// non-empty label, a valid type, and a unique id — applied to whatever the
// teacher's edits (rename/remove/add) produced before it's saved, so a bad
// edit (emptied label, duplicated id from a copy/paste bug, etc.) can't
// corrupt the stored record.
function sanitizeDetectedSectionList(items: DetectedSectionItem[], idPrefix: string): DetectedSectionItem[] {
  const seenIds = new Set<string>();
  const out: DetectedSectionItem[] = [];
  for (const item of items) {
    const originalLabel = (item?.originalLabel ?? "").trim();
    if (!originalLabel) continue; // originalLabel must be a non-empty trimmed string
    const type = DETECTED_SECTION_TYPES.includes(item?.type) ? item.type : "content_section";
    let id = (item?.id ?? "").trim();
    if (!id || seenIds.has(id)) id = `${idPrefix}_${crypto.randomUUID().slice(0, 8)}`;
    seenIds.add(id);
    out.push({
      id,
      originalLabel,
      normalizedKey: (item?.normalizedKey ?? "").trim() || "custom_section",
      type,
      order: out.length + 1, // recalculated, not trusted from the caller
      confidence: typeof item?.confidence === "number" ? item.confidence : 0.5,
      ...(item?.detectionReason ? { detectionReason: item.detectionReason } : {}),
    });
  }
  return out;
}

export function sanitizeDetectedSections(input: DetectedSections): DetectedSections {
  return {
    contentSections: sanitizeDetectedSectionList(input?.contentSections ?? [], "section"),
    metadataFields: sanitizeDetectedSectionList(input?.metadataFields ?? [], "metadata"),
    instructionTexts: sanitizeDetectedSectionList(input?.instructionTexts ?? [], "instruction"),
    confirmed: !!input?.confirmed,
    version: typeof input?.version === "number" ? input.version : 1,
  };
}

// Rename/remove/add/confirm all funnel through here — a direct client-side
// update to detected_sections (RLS already scopes writes to the owning
// user_id, same as renameCustomTemplate above), no server round-trip needed
// for this phase. Always sanitizes before saving so malformed edits never
// reach the database.
export async function updateDetectedSections(
  id: string,
  userId: string,
  sections: DetectedSections
): Promise<DetectedSections> {
  const sanitized = sanitizeDetectedSections(sections);
  const { error } = await supabase
    .from("custom_templates")
    .update({ detected_sections: sanitized })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return sanitized;
}

// Deletion removes the Storage object too, which requires the service-role
// key (the bucket is private) — routed through /api/custom-templates
// (action: "delete") rather than done directly from the browser.
export async function deleteCustomTemplate(id: string, userId: string): Promise<void> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", customTemplateId: id, userId }),
  });
  if (res.ok) return;
  await parseCustomTemplatesResponse(res, "Could not delete template. Please try again.");
}

// Server-side merge (docxtemplater) of the teacher's uploaded .docx with the
// generated Template1Lesson content — see api/custom-templates.js (action: "export").
// The built-in Template1 DOCX builder is never used for custom templates.
export async function exportCustomTemplateLessonDocx(
  customTemplateId: string,
  userId: string,
  lessonData: Template1Lesson
): Promise<Blob> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "export", customTemplateId, userId, lessonData }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  return res.blob();
}
