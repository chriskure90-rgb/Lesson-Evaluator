import { supabase } from "./supabase";
import type { Template1Lesson } from "../App";
import type { ExportDocument } from "./export";

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

// Phase 3 layout recognition/preview (see detectTemplateLayout in
// api/custom-templates.js) — a third, independent structural pass over the
// same uploaded file, separate from detected_sections. sectionIds is
// parallel to labels (same index/length): the exact DetectedSectionItem.id
// each label matched, or null if unmatched. Deliberately NOT normalizedKey —
// normalizedKey can be shared by multiple items, so it can't identify which
// specific item a cell corresponds to the way id can; normalizedKey stays
// inside DetectedSectionItem only.
export type LayoutCell = {
  id: string;
  order: number;
  colspan: number;
  rowspan: number;
  labels: string[];
  sectionIds: (string | null)[];
};

export type LayoutRow = {
  id: string;
  order: number;
  cells: LayoutCell[];
};

export type LayoutTable = {
  id: string;
  order: number;
  rows: LayoutRow[];
};

export type DetectedLayout = {
  version: number;
  sourceType: "docx" | "pdf";
  tables: LayoutTable[];
  // detected_sections item ids matched to no cell anywhere in `tables`.
  unmatchedSectionIds: string[];
};

export const DEFAULT_DETECTED_LAYOUT: DetectedLayout = {
  version: 1,
  sourceType: "docx",
  tables: [],
  unmatchedSectionIds: [],
};

/* ── Phase 5: teacher-reviewable field mapping ────────────────────────────────
   A fourth, independent pass, stored in field_map/field_map_status/
   field_map_error — never touches detected_sections/detected_layout or their
   columns. Root problem it solves: detected_layout only ever modeled LABELS
   (heading/bold text), so generated content had nowhere reliable to land
   except wherever a label happened to match — sometimes landing on the
   heading or instructional text itself instead of the actual blank/
   editable spot. field_map introduces REGIONS with an explicit role, so
   mappings (and therefore generated content) can only ever target
   editable_field/checkbox_group regions — headings and instructions are
   permanently read-only context, never a mapping target, by construction.
────────────────────────────────────────────────────────────────────────────── */

export type RegionRole = "heading" | "instruction" | "editable_field" | "blank" | "checkbox_group";

// "explicit": a genuine blank paragraph/cell or a recognized placeholder
// (e.g. "Click or tap here to enter text.") was found in the document.
// "implicit": no blank/placeholder existed at all (just a label, nothing
// else) — the system synthesized a fill point after it. Implicit regions
// are inherently less certain, so they always start at "needs_review",
// never "ready" (see buildFieldMap).
export type RegionSource = "explicit" | "implicit";

// Only meaningful for editable_field/checkbox_group regions — "text" is a
// normal AI-generated-prose target; single_select/multi_select are
// checkbox groups, which display selected options rather than prose.
export type RegionOutputMode = "text" | "single_select" | "multi_select";

export type TemplateRegion = {
  id: string;
  order: number;
  role: RegionRole;
  text: string;
  source: RegionSource;
  outputMode?: RegionOutputMode;
  checkboxOptions?: string[];
  // Nearest preceding heading/instruction text at detection time — used to
  // build the dynamic-generation prompt and to show context in the mapping
  // UI, without needing to re-walk the document at generation time.
  contextLabel?: string;
  contextInstruction?: string;
  tableId?: string;
  rowId?: string;
  cellId?: string;
};

export const CANONICAL_FIELD_TARGETS = [
  "lesson_title", "date", "grade_level", "subject", "learning_objectives",
  "standards", "learner_background", "materials", "introduction", "instruction",
  "student_activities", "assessment", "accommodations", "culturally_responsive_education",
  "closure", "reflection",
] as const;
export type CanonicalFieldTarget = (typeof CANONICAL_FIELD_TARGETS)[number];

export const CANONICAL_FIELD_TARGET_LABELS: Record<CanonicalFieldTarget, string> = {
  lesson_title: "Lesson Title",
  date: "Date",
  grade_level: "Grade Level",
  subject: "Subject",
  learning_objectives: "Learning Objectives",
  standards: "Standards",
  learner_background: "Learner Background / Knowledge of Students",
  materials: "Materials",
  introduction: "Introduction",
  instruction: "Instruction",
  student_activities: "Student Activities",
  assessment: "Assessment",
  accommodations: "Accommodations",
  culturally_responsive_education: "Culturally Responsive Education",
  closure: "Closure",
  reflection: "Reflection",
};

export type FieldMappingTarget =
  | CanonicalFieldTarget
  | "custom_section"
  | "manual_entry"
  | "leave_blank"
  | "fixed_original_text";

// Teacher-facing status — deliberately not the internal role/source
// vocabulary ("linked"/"unmatched" from the old Layout Preview never
// appear here).
export type FieldMappingStatus = "ready" | "needs_review" | "manual_entry" | "leave_blank";

export type FieldMapping = {
  regionId: string;
  target: FieldMappingTarget;
  // Required (validated at confirm time) when target === "custom_section".
  customLabel?: string;
  suggestedTarget: FieldMappingTarget | null;
  suggestedConfidence: number;
  status: FieldMappingStatus;
};

export type TemplateFieldMap = {
  version: number;
  regions: TemplateRegion[];
  mappings: FieldMapping[];
  confirmed: boolean;
};

export const DEFAULT_FIELD_MAP: TemplateFieldMap = {
  version: 1,
  regions: [],
  mappings: [],
  confirmed: false,
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
  detected_layout: DetectedLayout;
  layout_detection_status: string | null;
  layout_detection_error: string | null;
  field_map: TemplateFieldMap;
  field_map_status: string | null;
  field_map_error: string | null;
  status: CustomTemplateStatus;
  error_message: string | null;
  created_at: string;
  // Soft-delete marker (scripts/sql/add-custom-templates-deleted-at-column.sql)
  // — fetchCustomTemplates excludes rows where this is set; fetchCustomTemplateById
  // deliberately does not, so a historical lesson's already-referenced template
  // stays fully readable after being "deleted" from the account's active list.
  deleted_at: string | null;
};

// ── Two INDEPENDENT decisions — never conflate them ─────────────────────────
// getLessonDisplayFormat answers "how should this template be generated,
// edited, and previewed on screen." getDocxExportStrategy answers "which
// merge engine should build the exported .docx." A template can (and for
// e.g. the UIUC template, does) answer these two questions differently: it
// has both recognized {{TOKEN}} placeholders AND usable field_map regions,
// so its lesson is generated/edited/previewed via the richer field-map
// layout, but its DOCX export still merges into the original {{TAG}} text
// via Docxtemplater, since that's what the uploaded file actually contains.
// A single shared "custom vs dynamic" variable previously drove both
// questions at once — routing tokens-first for export (correct) also
// silently routed the SAME template's display/generation to the generic
// Template1 cards instead of its own detected layout (the regression this
// separation fixes). Every call site that needs one of these two answers
// must call the matching function below — never derive either from the
// other's result, and never introduce a third shared variable that answers
// both again.

export function hasRecognizedPlaceholders(t: CustomTemplate | null | undefined): boolean {
  return (t?.recognized_placeholders?.length ?? 0) > 0;
}

// A template is eligible for the region-based ("dynamic") generation
// pipeline as soon as it has any detected field_map regions — this is
// deliberately not gated on field_map.confirmed. Confirmation is still
// tracked and shown (FieldMappingPanel/FieldMappingReviewDrawer), but it's
// no longer a requirement for Generate Lesson to use it; api/generate.js
// independently validates there's at least one real generatable field.
export function hasFieldMapRegions(t: CustomTemplate | null | undefined): boolean {
  return (t?.field_map?.regions?.length ?? 0) > 0;
}

// DISPLAY/GENERATION routing — field_map wins whenever it has usable
// regions, regardless of whether {{TOKEN}} placeholders are ALSO present:
// the field-map layout is strictly richer (real table/row/cell structure,
// per-region editing) than the generic Template1 cards, so a template with
// both is still best generated/edited/previewed through it. Falls back to
// "custom" — matching this decision's own long-standing prior behavor —
// only when field_map has no usable regions at all; the CustomTemplate type
// has no separate "unconfigured" format value to fall back to instead
// (status: "processing"/"error" already covers "not usable yet"
// independently of this decision).
export function getLessonDisplayFormat(template: CustomTemplate): "custom" | "dynamic" {
  return hasFieldMapRegions(template) ? "dynamic" : "custom";
}

// DOCX EXPORT routing — completely independent of getLessonDisplayFormat
// above. Recognized {{TOKEN}} placeholders always win here: a teacher who
// authored a template with real {{OBJECTIVES}}/{{GRADE_LEVEL}}-style tags
// clearly intended Docxtemplater's {{TAG}} substitution to run against the
// original file — regardless of which pipeline generated the on-screen
// content — since that's the only merge engine that understands {{TAG}}
// syntax at all (the dynamic/field_map merge doesn't; see
// mergeDynamicLessonIntoDocumentXml's own docs). Falls back to "dynamic"
// only when there are no recognized tokens AND field_map has usable
// regions; falls back to "token" (not "dynamic") when NEITHER exists,
// matching handleExport's own existing structured-fields-only case (a
// template with zero narrative {{TOKEN}}s but real {{FIELD_*}} checklist
// tokens still needs Docxtemplater, never the field_map merge).
//
// When this returns "token" for a template whose DISPLAY format resolved
// to "dynamic" (the hybrid case), the caller cannot pass the on-screen
// DynamicLessonPlan straight to exportCustomTemplateLessonDocx — it needs a
// Template1Lesson-shaped object first; see buildTemplate1LessonFromDynamicPlan.
export function getDocxExportStrategy(template: CustomTemplate): "token" | "dynamic" {
  if (hasRecognizedPlaceholders(template)) return "token";
  return hasFieldMapRegions(template) ? "dynamic" : "token";
}

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
// /api/custom-templates runs with the service-role key (bypasses RLS), so it
// can't lean on RLS for authorization the way direct client calls elsewhere
// in this file do — it validates this token against Supabase Auth itself and
// uses THAT user id for every user_id/ownership check, never trusting a
// client-supplied userId in the request body.
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function uploadCustomTemplateFile(file: File, userId: string): Promise<{ path: string }> {
  const initRes = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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

function logSectionDetectionDebug(
  engineVersion: string | undefined,
  entries: unknown[] | undefined | null,
  extraction: Record<string, unknown> | undefined | null
) {
  if (!TEMP_DEBUG_SECTIONS) return;

  console.log(
    `%c[TEMP_DEBUG_SECTIONS] sectionDetectionEngineVersion = "${engineVersion ?? "(missing — this response came from a build without this field at all)"}"`,
    "font-weight:bold;font-size:13px"
  );

  if (extraction) {
    console.group("%c[TEMP_DEBUG_SECTIONS] sectionExtractionDebug (mammoth HTML + table structure)", "font-weight:bold");
    console.log(`html length: ${extraction.htmlLength} chars (engineVersion in this payload: ${extraction.engineVersion})`);
    console.log("full HTML (string — may be truncated, see htmlLength for the real total):", extraction.html);
    const rows = (extraction.tableRows as Record<string, unknown>[] | undefined) ?? [];
    console.log(`${rows.length} table rows detected:`);
    for (const row of rows) {
      console.group(`table=${row.tableIndex} row=${row.rowIndex} cellCount=${row.cellCount} rowHasAnyValue=${row.rowHasAnyValue}`);
      for (const cell of (row.cells as Record<string, unknown>[] | undefined) ?? []) {
        const units = (cell.units as Record<string, unknown>[] | undefined) ?? [];
        console.group(`cell[${cell.index}] — ${units.length} candidate unit(s)${cell.note ? ` (${cell.note})` : ""}`);
        for (const unit of units) {
          console.log(
            `%cunit[${unit.unitIndex}] "${unit.text}" signal=${unit.signal} isValueLike=${unit.isValueLike} retained=${unit.retained}`,
            unit.retained ? "color:#2a7" : "color:#b33"
          );
        }
        console.groupEnd();
      }
      console.groupEnd();
    }
    console.log("final raw candidate list (post-extraction, pre-classification):", extraction.rawCandidates);
    console.groupEnd();
  } else {
    console.warn("[TEMP_DEBUG_SECTIONS] no sectionExtractionDebug in the response (debugSections may not have reached the server, or this was a PDF upload — extraction debug is DOCX-only).");
  }

  if (!Array.isArray(entries)) {
    console.warn("[TEMP_DEBUG_SECTIONS] no sectionDetectionDebug in the response (debugSections may not have reached the server).");
    return;
  }
  console.group(`%c[TEMP_DEBUG_SECTIONS] sectionDetectionDebug — ${entries.length} raw candidates (post-classification)`, "font-weight:bold");
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

// ── TEMPORARY DEBUGGING — layout recognition (Phase 3) ────────────────────────
// Same idea as TEMP_DEBUG_SECTIONS above, for the layout-detection pass (see
// buildLayoutDebugInfo in api/custom-templates.js). To remove: delete this
// block and the two marked lines below it in registerCustomTemplate.
const TEMP_DEBUG_LAYOUT = true;

function logLayoutDetectionDebug(
  engineVersion: string | undefined,
  debugInfo: Record<string, unknown> | undefined | null
) {
  if (!TEMP_DEBUG_LAYOUT) return;

  console.log(
    `%c[TEMP_DEBUG_LAYOUT] layoutDetectionEngineVersion = "${engineVersion ?? "(missing)"}"`,
    "font-weight:bold;font-size:13px"
  );

  if (!debugInfo) {
    console.warn("[TEMP_DEBUG_LAYOUT] no layoutDetectionDebug in the response (debugLayout may not have reached the server).");
    return;
  }

  console.group("%c[TEMP_DEBUG_LAYOUT] layoutDetectionDebug", "font-weight:bold");
  console.log(`htmlLength=${debugInfo.htmlLength} tableCount=${debugInfo.tableCount} rowCount=${debugInfo.rowCount} cellCount=${debugInfo.cellCount}`);
  console.log("cells:", debugInfo.cells);
  console.log("matches (label -> sectionId):", debugInfo.matches);
  console.log("unmatchedLabels:", debugInfo.unmatchedLabels);
  console.log("unmatchedSectionIds:", debugInfo.unmatchedSectionIds);
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
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    // TEMP DEBUG — remove debugSections/debugLayout when done
    body: JSON.stringify({ action: "register", ...params, debugSections: TEMP_DEBUG_SECTIONS, debugLayout: TEMP_DEBUG_LAYOUT }),
  });
  const isPdf = params.filename.toLowerCase().endsWith(".pdf");
  const result = await parseCustomTemplatesResponse<
    CustomTemplate & {
      sectionDetectionEngineVersion?: string;
      sectionDetectionDebug?: unknown[];
      sectionExtractionDebug?: Record<string, unknown>;
      layoutDetectionEngineVersion?: string;
      layoutDetectionDebug?: Record<string, unknown>;
    }
  >(
    res,
    isPdf
      ? "PDF processing failed. Please try another PDF or upload a DOCX file."
      : "Could not register this template. Please try again."
  );
  // TEMP DEBUG — remove these two calls when done
  logSectionDetectionDebug(result.sectionDetectionEngineVersion, result.sectionDetectionDebug, result.sectionExtractionDebug);
  logLayoutDetectionDebug(result.layoutDetectionEngineVersion, result.layoutDetectionDebug);
  // The API response is the raw DB row — columns for migrations that
  // haven't been run yet (e.g. field_map) are entirely absent, not just
  // null. Normalize the same way fetchCustomTemplates/fetchCustomTemplateById
  // do, so callers never see a partially-shaped CustomTemplate.
  return normalizeCustomTemplateRow(result as unknown as Record<string, unknown>);
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
const OPTIONAL_COLUMNS = [
  "structured_fields", "detected_sections", "section_detection_status", "section_detection_error",
  "detected_layout", "layout_detection_status", "layout_detection_error",
  "field_map", "field_map_status", "field_map_error",
  "deleted_at",
] as const;

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

function normalizeDetectedLayout(raw: unknown): DetectedLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_DETECTED_LAYOUT;
  const r = raw as Record<string, unknown>;
  return {
    version: typeof r.version === "number" ? r.version : 1,
    sourceType: r.sourceType === "pdf" ? "pdf" : "docx",
    tables: Array.isArray(r.tables) ? (r.tables as LayoutTable[]) : [],
    unmatchedSectionIds: Array.isArray(r.unmatchedSectionIds) ? (r.unmatchedSectionIds as string[]) : [],
  };
}

function normalizeFieldMap(raw: unknown): TemplateFieldMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_FIELD_MAP;
  const r = raw as Record<string, unknown>;
  return {
    version: typeof r.version === "number" ? r.version : 1,
    regions: Array.isArray(r.regions) ? (r.regions as TemplateRegion[]) : [],
    mappings: Array.isArray(r.mappings) ? (r.mappings as FieldMapping[]) : [],
    confirmed: !!r.confirmed,
  };
}

export function normalizeCustomTemplateRow(row: Record<string, unknown>): CustomTemplate {
  return {
    ...(row as Omit<
      CustomTemplate,
      "structured_fields" | "detected_sections" | "section_detection_status" | "section_detection_error"
      | "detected_layout" | "layout_detection_status" | "layout_detection_error"
      | "field_map" | "field_map_status" | "field_map_error" | "deleted_at"
    >),
    structured_fields: Array.isArray(row.structured_fields)
      ? (row.structured_fields as CustomTemplateStructuredField[])
      : [],
    detected_sections: normalizeDetectedSections(row.detected_sections),
    section_detection_status: typeof row.section_detection_status === "string" ? row.section_detection_status : null,
    section_detection_error: typeof row.section_detection_error === "string" ? row.section_detection_error : null,
    detected_layout: normalizeDetectedLayout(row.detected_layout),
    layout_detection_status: typeof row.layout_detection_status === "string" ? row.layout_detection_status : null,
    layout_detection_error: typeof row.layout_detection_error === "string" ? row.layout_detection_error : null,
    field_map: normalizeFieldMap(row.field_map),
    field_map_status: typeof row.field_map_status === "string" ? row.field_map_status : null,
    field_map_error: typeof row.field_map_error === "string" ? row.field_map_error : null,
    deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
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
    let query = supabase
      .from("custom_templates")
      .select(buildSelectColumns(excluded))
      .eq("user_id", userId);
    // Soft-deleted templates must never appear in the account's active
    // list (see scripts/sql/add-custom-templates-deleted-at-column.sql) —
    // omitted once a prior attempt below shows the column doesn't exist
    // yet, same graceful-degradation as every other optional column here.
    if (!excluded.has("deleted_at")) query = query.is("deleted_at", null);
    const result = (await query.order("created_at", { ascending: false })) as unknown as {
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

// Field mappings (Phase 5) are saved incrementally as the teacher edits
// each one (not just at "Confirm Field Mapping" time) so progress is never
// lost — `confirmed` itself is only ever flipped true by the explicit
// confirm action (see ManageTemplatesModal), and flipped back to false the
// moment any mapping changes after being confirmed (both handled by the
// caller before invoking this). This just persists whatever it's given,
// after dropping any mapping that doesn't point at an editable_field/
// checkbox_group region — headings/instructions can never be mapping
// targets, enforced here as well as by construction in the UI.
function sanitizeFieldMap(fieldMap: TemplateFieldMap): TemplateFieldMap {
  const regionById = new Map(fieldMap.regions.map((r) => [r.id, r]));
  const mappings = fieldMap.mappings.filter((m) => {
    const region = regionById.get(m.regionId);
    return !!region && (region.role === "editable_field" || region.role === "checkbox_group");
  });
  return {
    version: typeof fieldMap.version === "number" ? fieldMap.version : 1,
    regions: fieldMap.regions,
    mappings,
    confirmed: !!fieldMap.confirmed,
  };
}

export async function updateFieldMap(
  id: string,
  userId: string,
  fieldMap: TemplateFieldMap
): Promise<TemplateFieldMap> {
  const sanitized = sanitizeFieldMap(fieldMap);
  const { error } = await supabase
    .from("custom_templates")
    .update({ field_map: sanitized })
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
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action: "export", customTemplateId, userId, lessonData }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  return res.blob();
}

/* ── Phase 2: dynamic lesson generation ───────────────────────────────────────
   Entirely separate from Lesson/Template1Lesson — the schema itself comes
   from a template's own detected_sections.contentSections rather than being
   fixed. See buildDynamicLessonPrompt in api/generate.js. ──────────────────── */

export type DynamicLessonSection = {
  id: string;
  originalLabel: string;
  content: string;
  // "manual" = a target: "manual_entry" region (teacher-specific planning
  // content the LLM was never asked to generate for — see
  // TEACHER_PLANNING_FIELD_PHRASES in api/custom-templates.js); starts with
  // content: "" and is filled in by the teacher directly in the preview.
  // Omitted/undefined = AI-generated (every section before this field
  // existed, and everything generation actually produces, is this case) —
  // so a lesson saved before this field existed still loads and renders
  // exactly as before with no migration needed.
  origin?: "manual";
};

export type DynamicLessonPlan = {
  sections: DynamicLessonSection[];
};

// Phase 5: the model returns a flat object keyed by REGION ID (see
// buildDynamicLessonPromptFromFieldMap's OUTPUT FORMAT in api/generate.js),
// not by label — duplicate canonical targets are explicitly allowed, so
// label text alone couldn't disambiguate two regions mapped to the same
// target the way a stable id can. Only editable_field mappings that were
// actually eligible for generation are included (leave_blank/manual_entry/
// fixed_original_text mappings, and checkbox_group regions, are excluded —
// nothing was ever asked of the model for those). originalLabel here is a
// human-readable label for display (the canonical target's label, or the
// teacher's own customLabel for a custom section), not the region's raw
// detected text.
// These 4 canonical targets are metadata the Generator page already
// collects as its own inputs (grade/subject) or that no input exists for
// yet (date/lesson_title) — mirrors METADATA_SOURCED_TARGETS in
// api/generate.js (duplicated there since api/ has no shared import from
// src/). The AI is never asked to generate them; ReproducedTemplatePreview
// fills grade_level/subject from Generator state directly instead.
export const METADATA_SOURCED_TARGETS: ReadonlySet<FieldMappingTarget> = new Set(["lesson_title", "date", "grade_level", "subject"]);

export function toDynamicLessonPlanFromFieldMap(
  rawResponse: Record<string, unknown>,
  fieldMap: TemplateFieldMap
): DynamicLessonPlan {
  const regionById = new Map(fieldMap.regions.map((r) => [r.id, r]));
  const generatedSections = fieldMap.mappings
    .filter((m) => {
      if (m.target === "leave_blank" || m.target === "manual_entry" || m.target === "fixed_original_text") return false;
      if (METADATA_SOURCED_TARGETS.has(m.target)) return false;
      const region = regionById.get(m.regionId);
      return !!region && region.role === "editable_field";
    })
    .map((m) => {
      const region = regionById.get(m.regionId);
      const label = m.target === "custom_section"
        ? (m.customLabel || region?.contextLabel || "Custom Section")
        : (CANONICAL_FIELD_TARGET_LABELS[m.target as CanonicalFieldTarget] ?? m.target);
      const value = rawResponse?.[m.regionId];
      return {
        id: m.regionId,
        originalLabel: label,
        content: typeof value === "string" ? value : "",
      };
    });
  // manual_entry regions were never sent to (or asked of) the LLM, so
  // there's no rawResponse value to read for them — they still need a
  // section entry (content: "") so the same edit/save/export/reload path
  // generated sections already go through also works for these, from the
  // moment the plan is first created. See ReproducedTemplatePreview's
  // valueForRegion in src/App.tsx for how these render as an editable field.
  const manualSections: DynamicLessonSection[] = fieldMap.mappings
    .filter((m) => {
      if (m.target !== "manual_entry") return false;
      const region = regionById.get(m.regionId);
      return !!region && region.role === "editable_field";
    })
    .map((m) => {
      const region = regionById.get(m.regionId);
      return {
        id: m.regionId,
        originalLabel: m.customLabel || region?.contextLabel || "Notes",
        content: "",
        origin: "manual",
      };
    });
  return { sections: [...generatedSections, ...manualSections] };
}

// Generic export for dynamic (field-map-driven) generation — one
// ExportSection per section (generated and manual-entry alike). Lives here
// rather than in App.tsx (a React component file, where an exported plain
// function breaks Vite Fast Refresh) even though every caller today is in
// App.tsx. Deliberately does NOT attempt to reproduce the uploaded
// template's table layout (that's final-DOCX reproduction, out of scope
// here) — just the content, same generic .txt/.docx/.pdf converters
// everything else already uses.
export function buildDynamicLessonExportDocument(plan: DynamicLessonPlan, title: string): ExportDocument {
  return {
    title: title || "Lesson Plan",
    sections: plan.sections.map((section) => ({
      heading: section.originalLabel,
      // A manual-entry field left unfilled reads as "(empty)" — the same
      // placeholder the teacher's own template/preview uses for it — never
      // "(no content generated)", since nothing was ever supposed to
      // generate it in the first place.
      paragraphs: [section.content || (section.origin === "manual" ? "(empty)" : "(no content generated)")],
    })),
  };
}

// Best-effort content bridge for the HYBRID case (see getDocxExportStrategy):
// a template whose on-screen lesson was generated/edited via the dynamic
// field-map pipeline (DynamicLessonPlan, keyed by region id) but whose DOCX
// export must go through the token/Docxtemplater path, because the original
// file has recognized {{TOKEN}} placeholders. That path expects a
// Template1Lesson-shaped object (see buildRenderData/PLACEHOLDER_CATALOG in
// api/custom-templates.js, which read fixed fields like .lessonObjectives/
// .subjectGradeLevel) — not plan.sections' flat, region-id-keyed shape. Maps
// each section back to a Template1Lesson field via the SAME canonical
// target its field_map mapping already recorded (the meaning
// classifyRegionTarget or the teacher's own Field Mapping Review assigned
// it), not a fresh guess.
//
// Deliberately partial: field_map's canonical target vocabulary (see
// CANONICAL_FIELD_TARGETS) is broader than Template1Lesson's fixed shape —
// targets with no reasonable Template1Lesson home (custom_section,
// learner_background, accommodations, culturally_responsive_education) are
// dropped rather than guessed at, and centralFocus has no field_map
// counterpart at all, so it's always empty here. Multiple regions sharing
// one target are joined with a blank line, in field_map detection order.
export function buildTemplate1LessonFromDynamicPlan(
  plan: DynamicLessonPlan,
  fieldMap: TemplateFieldMap,
  // Raw components, not pre-formatted strings — formatted the exact same
  // way normaliseTemplate1Lesson's own caller does (App.tsx), so a hybrid
  // template's exported subjectGradeLevel/lessonDuration text matches a
  // genuinely-generated Template1Lesson's byte-for-byte.
  meta: { subject: string; gradeLabel: string; duration: number }
): Template1Lesson {
  const contentById = new Map(plan.sections.map((s) => [s.id, s.content]));
  const targetById = new Map(fieldMap.mappings.map((m) => [m.regionId, m.target]));
  // Regions in detection order, so a target shared by multiple regions joins
  // in a stable, document-faithful order rather than plan.sections' own
  // (unspecified, generation-response-dependent) order.
  const orderedRegionIds = [...fieldMap.regions].sort((a, b) => a.order - b.order).map((r) => r.id);

  function contentFor(target: FieldMappingTarget): string {
    return orderedRegionIds
      .filter((id) => targetById.get(id) === target)
      .map((id) => contentById.get(id))
      .filter((text): text is string => !!text && text.trim().length > 0)
      .join("\n\n");
  }
  function linesFor(target: FieldMappingTarget): string[] {
    const text = contentFor(target);
    return text ? text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean) : [];
  }

  return {
    lessonTitle: contentFor("lesson_title"),
    teacherName: "",
    subjectGradeLevel: `${meta.subject} — Grade ${meta.gradeLabel}`,
    lessonDuration: `${meta.duration} minutes`,
    centralFocus: "",
    standardsAddressed: contentFor("standards"),
    lessonObjectives: linesFor("learning_objectives"),
    materials: linesFor("materials"),
    introduction: { teacherActions: contentFor("introduction"), studentActions: "", studentSupport: "" },
    mainLearningActivities: { teacherActions: contentFor("instruction"), studentActions: contentFor("student_activities"), studentSupport: "" },
    closure: { teacherActions: contentFor("closure"), studentActions: contentFor("reflection") },
    assessment: { howObjectivesAssessed: contentFor("assessment") },
  };
}

// Real-template-preserving DOCX export for the dynamic (field_map) pipeline —
// same request/response shape as exportCustomTemplateLessonDocx above, but
// hits the server's "export-dynamic" action (handleExportDynamic in
// api/custom-templates.js), which merges plan.sections into the ORIGINAL
// uploaded .docx by region position rather than building a generic document
// from scratch (see ReproducedTemplatePreview/buildDynamicLessonExportDocument
// for the on-screen preview and PDF/TXT export, which still use the generic
// flat conversion — only the Word (.docx) option for this format uses this).
export async function exportDynamicLessonDocx(
  customTemplateId: string,
  userId: string,
  lessonData: DynamicLessonPlan
): Promise<Blob> {
  const res = await fetch("/api/custom-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action: "export-dynamic", customTemplateId, userId, lessonData }),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let details: string | undefined;
    try {
      details = JSON.parse(raw)?.error;
    } catch {
      // not JSON — fall through to raw text below
    }
    throw new Error(details || raw || `Server error ${res.status}`);
  }
  return res.blob();
}
