import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { randomUUID } from "node:crypto";
import { supabase, SUPABASE_KEY_SOURCE } from "../server-lib/supabase.js";
import { ensurePdfEnvironmentReady } from "../server-lib/pdf-node-setup.js";

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
//
// structuredFields (template.structured_fields — checklists/option lists,
// see detectStructuredFields) render the same way: one {{FIELD_TOKEN}} per
// field, its full option list rendered as one block with a checked/unchecked
// box per option — ☑ for options present in
// lesson.customFieldSelections[field.field] (populated at generation time,
// see api/generate.js's buildStructuredFieldsPrompt), ☐ otherwise. A lesson
// generated before this feature existed (or against a template with no
// structured fields) simply has no customFieldSelections — every option
// renders unchecked rather than erroring.
function buildRenderData(lesson, recognizedTokens, structuredFields) {
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
  for (const field of structuredFields || []) {
    const selected = new Set(lesson?.customFieldSelections?.[field.field] || []);
    data[field.token] = field.options
      .map((opt) => `${selected.has(opt) ? "☑" : "☐"} ${opt}`)
      .join("\n");
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
  // FIELD_* tokens are structured-field placeholders emitted by
  // synthesizeDocxFromPdfSections (see detectStructuredFields) — not in
  // PLACEHOLDER_CATALOG (a fixed narrative-only catalog), but not "left
  // blank on export" either: buildRenderData renders them separately from
  // template.structured_fields. Excluded from `unrecognized` so the UI's
  // "⚠ Unrecognized (left blank on export)" warning doesn't misreport them.
  const isFieldToken = (t) => t.startsWith("FIELD_");
  return {
    all: unique,
    recognized: unique.filter((t) => KNOWN_PLACEHOLDER_TOKENS.includes(t)),
    unrecognized: unique.filter((t) => !KNOWN_PLACEHOLDER_TOKENS.includes(t) && !isFieldToken(t)),
  };
}

// ── Heading-based template conversion (PDF, and tag-free DOCX) ────────────────
// A PDF has no editable {{PLACEHOLDER}} tags and isn't a reflowable format
// docxtemplater can merge into directly, so an uploaded PDF is converted
// once, at registration time, into a synthesized .docx that DOES use our
// normal {{TOKEN}} placeholder syntax. From that point on it's stored and
// treated exactly like any other custom template — same table, same export
// path, same everything (see handleRegister below). storage_path ends up
// pointing at the synthesized file, not the original PDF.
//
// The same heading detection also serves as a fallback for an uploaded
// .docx that has no {{PLACEHOLDER}} tags at all (an ordinary lesson-plan
// document a teacher wrote without knowing about the placeholder syntax) —
// mammoth's extracted text (see extractDocxText below) is just as "flat" as
// pdf-parse's, so the same line-scanning heuristic applies either way. A
// docx that DOES have {{...}} tags, even unrecognized ones, never goes
// through this path — see handleRegister's isPdf/no-tags branching.
//
// Keyword -> catalog token mapping used to recognize section headings in the
// extracted plain text. Deliberately keyword-based rather than a generic
// layout/heading detector, since neither pdf-parse nor mammoth's plain-text
// output has font-size/bold metadata to lean on — lesson-plan templates
// reliably use these words as section labels, which keeps false positives
// low. Table structure isn't reconstructed (not reliably possible from flat
// text without page/run-position data) — only section titles/order carry
// over.
const PDF_SECTION_KEYWORDS = [
  { tokens: ["LESSON_TITLE"],                     pattern: /\blesson\s*title\b|^title$/i },
  { tokens: ["GRADE_LEVEL"],                      pattern: /\bgrade(\s*level)?\b/i },
  { tokens: ["OBJECTIVES"],                        pattern: /\bobjectives?\b|\blearning\s*(goals?|targets?)\b/i },
  { tokens: ["MATERIALS"],                         pattern: /\bmaterials?\b|\bresources?\b|\bitems?\s*needed\b/i },
  { tokens: ["INTRO_TEACHER", "INTRO_STUDENTS"],    pattern: /\bintroduction\b|\bwarm[\s-]?up\b|\bopening\b|\bhook\b/i },
  { tokens: ["MAIN_TEACHER", "MAIN_STUDENTS"],      pattern: /\bprocedure\b|\bactivit(y|ies)\b|\bmain\s*(lesson|activity|activities)\b|\binstruction(al)?\s*steps?\b|\bteaching\s*strateg(y|ies)\b/i },
  { tokens: ["CLOSURE"],                            pattern: /\bclosure\b|\bconclusion\b|\bwrap[\s-]?up\b|\bsummary\b|\breflection\b/i },
  { tokens: ["ASSESSMENT"],                         pattern: /\bassessment\b|\bevaluation\b|\bexit\s*ticket\b/i },
];

function splitTextLines(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Scans extracted plain text (PDF or DOCX) line by line for section-heading
// candidates (short lines that don't end in sentence punctuation) matching a
// known keyword, preserving the order they appear in. Each token is only
// ever claimed once, so a keyword mentioned again later in body text doesn't
// spawn a duplicate section. `skipHeadingLines` (a Set of trimmed line
// strings) lets analyzeTemplateText below exclude headings already claimed
// by detectStructuredFields, so e.g. a "Teaching Strategy" heading followed
// by checkboxes becomes a checklist field, not ALSO a MAIN_TEACHER/
// MAIN_STUDENTS narrative section.
function detectPdfSections(text, skipHeadingLines = null) {
  const lines = splitTextLines(text);

  const sections = [];
  const claimedTokens = new Set();

  for (const line of lines) {
    if (skipHeadingLines?.has(line)) continue;
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

// ── Structured form controls (checklists / repeated option lists) ────────────
// A checklist section like:
//   Teaching Strategy
//   □ Direct instruction
//   □ Group work
//   □ Stations
// isn't narrative text to fill in — it's a fixed set of options the AI
// should pick applicable one(s) from at generation time (see
// buildStructuredFieldsPrompt in api/generate.js) rather than replace with
// prose. Detected the same way as narrative sections (line-scanning; no
// font/position metadata available — see the file header comment above),
// but kept as a separate `{ type, field, label, token, options }` list
// rather than mapped into PLACEHOLDER_CATALOG, since the option set (and
// therefore the field) is different for every template, not a fixed catalog
// entry. Table-based checklists/two-column layouts are not yet detected —
// mammoth/pdf-parse's plain-text output flattens tables into running text
// with no cell boundaries, so that needs a materially different (HTML/table-
// aware) extraction path than this line scanner.
const CHECKBOX_LINE = /^(?:[□☐▢☑☒]|\[\s?[xX]?\s?\])\s*(.+)$/;
const BULLET_LINE = /^(?:[•\-*]|\d+[.)])\s*(.+)$/;

// "Teaching Strategy" -> "teachingStrategy" (for a future structured
// lesson-data field, mirroring the app's other camelCase field names).
function fieldKeyFromLabel(label) {
  const words = (label || "").replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "field";
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

// "Teaching Strategy" -> "FIELD_TEACHING_STRATEGY" — the {{TOKEN}} emitted
// into the synthesized docx (see synthesizeDocxFromPdfSections) and later
// rendered at export time from the lesson's customFieldSelections.
function fieldTokenFromLabel(label) {
  const words = (label || "").replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  return `FIELD_${words.map((w) => w.toUpperCase()).join("_") || "OPTIONS"}`;
}

// Scans the same line list detectPdfSections uses for a heading immediately
// followed by 2+ checkbox-prefixed lines (checklist) or, failing that and
// only when the heading doesn't already match a narrative keyword above,
// 2+ plain bulleted/numbered lines (a "repeated option list" with no literal
// checkboxes — still a fixed set of options, not prose). Checklist detection
// always takes priority over a narrative keyword match for the same
// heading — see the file header comment. Returns the detected fields plus
// the set of heading-line strings they consumed, for detectPdfSections to skip.
function detectStructuredFields(lines) {
  const fields = [];
  const consumedHeadingLines = new Set();
  const usedIndices = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (usedIndices.has(i)) continue;
    const line = lines[i];
    if (line.length > 70 || /[.?!]$/.test(line) || CHECKBOX_LINE.test(line) || BULLET_LINE.test(line)) continue;

    let j = i + 1;
    const checklistOptions = [];
    while (j < lines.length && CHECKBOX_LINE.test(lines[j])) {
      checklistOptions.push(lines[j].match(CHECKBOX_LINE)[1].trim());
      j++;
    }
    if (checklistOptions.length >= 2) {
      const label = line.replace(/:\s*$/, "");
      fields.push({ type: "checklist", field: fieldKeyFromLabel(label), label, token: fieldTokenFromLabel(label), options: checklistOptions });
      consumedHeadingLines.add(line);
      for (let k = i; k < j; k++) usedIndices.add(k);
      i = j - 1;
      continue;
    }

    if (!PDF_SECTION_KEYWORDS.some((entry) => entry.pattern.test(line))) {
      let k = i + 1;
      const listOptions = [];
      while (k < lines.length && BULLET_LINE.test(lines[k])) {
        listOptions.push(lines[k].match(BULLET_LINE)[1].trim());
        k++;
      }
      if (listOptions.length >= 2) {
        const label = line.replace(/:\s*$/, "");
        fields.push({ type: "list", field: fieldKeyFromLabel(label), label, token: fieldTokenFromLabel(label), options: listOptions });
        consumedHeadingLines.add(line);
        for (let m = i; m < k; m++) usedIndices.add(m);
        i = k - 1;
        continue;
      }
    }
  }

  return { fields, consumedHeadingLines };
}

// Single entry point combining both detectors over the same text — used by
// convertHeadingsToPlaceholderDocx below instead of calling detectPdfSections
// directly, so structured fields and narrative sections never claim the same
// heading twice.
function analyzeTemplateText(text) {
  const lines = splitTextLines(text);
  const { fields, consumedHeadingLines } = detectStructuredFields(lines);
  const sections = detectPdfSections(text, consumedHeadingLines);
  return { sections, structuredFields: fields };
}

/* ══════════════════════════════════════════════════════════════════════════
   Section recognition (Phase 1) — ADDITIVE ONLY.

   This is a second, independent pass over the same uploaded file, storing
   its own result in detected_sections/section_detection_status/
   section_detection_error. It never touches placeholders/
   recognized_placeholders/unrecognized_placeholders/structured_fields, the
   DOCX synthesis pipeline, export, or api/generate.js — those all keep
   working exactly as before, reading from their own existing fields. This
   pass's only job is to detect and classify the sections a teacher's
   uploaded document actually contains, preserve their original labels and
   order, and let the teacher review/edit that list — nothing here feeds
   into generation or export yet.
═══════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_DETECTED_SECTIONS = {
  contentSections: [],
  metadataFields: [],
  instructionTexts: [],
  confirmed: false,
  version: 1,
};

// Phase 3: layout recognition/preview — a THIRD, independent pass over the
// same uploaded file, storing its own result in detected_layout/
// layout_detection_status/layout_detection_error. Never touches
// placeholders/structured_fields/detected_sections or their columns, and
// nothing here feeds into generation, export, or DOCX synthesis — see
// detectTemplateLayout below.
export const DEFAULT_DETECTED_LAYOUT = {
  version: 1,
  sourceType: "docx",
  tables: [],
  unmatchedSectionIds: [],
};

// Same purpose as SECTION_DETECTION_ENGINE_VERSION above — lets a caller
// confirm which deployed build handled a given register request.
const LAYOUT_DETECTION_ENGINE_VERSION = "layout-v1";

// TEMPORARY — lets a caller confirm which deployed build of this file
// actually handled a given register request, without needing Vercel log
// access (a recurring friction point). Bump the string whenever the
// section-detection logic changes; remove entirely once the row-level
// extraction fix is confirmed live and working.
const SECTION_DETECTION_ENGINE_VERSION = "cell-units-v2";

// ── Dictionaries ─────────────────────────────────────────────────────────────
// normalizedKey -> label variants recognized as an exact/near-exact match.
// Separate from PLACEHOLDER_CATALOG/KNOWN_PLACEHOLDER_TOKENS on purpose —
// this phase doesn't map onto the fixed Template1Lesson schema at all, it's
// a superset vocabulary describing what's actually IN the document.
const CONTENT_SECTION_DICTIONARY = {
  objectives:            ["learning target", "lesson objective", "learning objective", "objectives", "learning objectives", "essential learning target", "essential learning targets"],
  standards:             ["standards", "standards addressed", "standard"],
  materials:             ["materials needed", "materials", "items needed"],
  warmup:                ["warm-up", "warm up", "bell ringer", "hook"],
  teacherActivities:     ["teacher activities", "teacher actions"],
  studentActivities:     ["student activities", "student actions"],
  guidedPractice:        ["guided practice"],
  assessmentForLearning: ["assessment for learning", "assessment", "evaluation", "assessments"],
  differentiation:       ["differentiation", "student support"],
  technologyIntegration: ["technology integration", "technology"],
  closure:               ["closure", "conclusion", "wrap-up", "wrap up", "summary"],
  reflection:            ["reflection", "highlights"],
  essentialQuestions:    ["essential question", "essential questions"],
  lessonProcedures:      ["lesson procedures", "lesson procedure", "procedures"],
};

const METADATA_FIELD_DICTIONARY = {
  teacher:      ["teacher"],
  teacherName:  ["teacher name", "tc name"],
  school:       ["school"],
  date:         ["date"],
  gradeLevel:   ["grade level", "grade"],
  subject:      ["subject"],
  topic:        ["topic", "lesson topic"],
  duration:     ["duration", "time duration", "lesson duration"],
  classPeriod:  ["class period", "period"],
};

// Broader fuzzy patterns for the same normalizedKeys, checked only after an
// exact/normalized dictionary match fails — this is what lets e.g. "Teacher
// Actions During Lesson" still resolve to teacherActivities.
const CONTENT_SECTION_PATTERNS = [
  ["objectives",            /\bobjectives?\b|\blearning\s*(goals?|targets?)\b/i],
  ["standards",             /\bstandards?\b/i],
  ["materials",             /\bmaterials?\b|\bresources?\b|\bitems?\s*needed\b/i],
  ["warmup",                /\bwarm[\s-]?up\b|\bbell\s*ringer\b|\bhook\b/i],
  ["teacherActivities",     /\bteacher\s*activit(y|ies)\b|\bteacher\s*action/i],
  ["studentActivities",     /\bstudent\s*activit(y|ies)\b|\bstudent\s*action/i],
  ["guidedPractice",        /\bguided\s*practice\b/i],
  ["essentialQuestions",    /\bessential\s*questions?\b/i],
  ["lessonProcedures",      /\blesson\s*procedures?\b|\bprocedures?\b/i],
  ["assessmentForLearning", /\bassessments?\b|\bevaluations?\b|\bexit\s*ticket\b/i],
  ["differentiation",       /\bdifferentiation\b|\bstudent\s*support\b/i],
  ["technologyIntegration", /\btechnology\b/i],
  ["closure",               /\bclosure\b|\bconclusion\b|\bwrap[\s-]?up\b|\bsummary\b/i],
  ["reflection",            /\breflection\b|\bhighlights?\b/i],
];

const METADATA_FIELD_PATTERNS = [
  // Negative lookahead keeps this from stealing "Teacher Activities/Actions"
  // (a content_section, matched by its own exact dictionary entry above —
  // this fuzzy pattern only matters for wording that dictionary doesn't
  // catch, so the guard is what keeps the two from colliding there too).
  ["teacher",     /\bteacher\b(?!\s*(activit|action))/i],
  ["teacherName", /\bteacher\s*name\b|\btc\s*name\b/i],
  ["school",      /\bschool\b/i],
  ["date",        /\bdate\b/i],
  ["gradeLevel",  /\bgrade(\s*level)?\b/i],
  ["subject",     /\bsubject\b/i],
  ["topic",       /\btopic\b/i],
  ["duration",    /\bduration\b/i],
  ["classPeriod", /\bclass\s*period\b|\bperiod\b/i],
];

const INSTRUCTION_VERB_PATTERN = /^(describe|explain|list|identify|provide|write|state|summarize|include|indicate|discuss)\b/i;

function normalizeForMatch(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupDictionary(dictionary, normalized) {
  for (const [key, variants] of Object.entries(dictionary)) {
    if (variants.includes(normalized)) return key;
  }
  return null;
}

function lookupPatterns(patterns, text) {
  for (const [key, pattern] of patterns) {
    if (pattern.test(text)) return key;
  }
  return null;
}

// Signals a candidate can carry, in descending strength — determines both
// which structural-signal tier applies (0.75 vs 0.60) and the human-readable
// detectionReason. "colon"/"all-caps" are computed from the text itself;
// the rest come from where the candidate was extracted from (DOCX heading/
// bold-table-cell/bold-text, or a plain table cell / short line).
const STRONG_SIGNALS = new Set(["heading", "bold-table-cell", "bold-text", "all-caps", "colon"]);
const SIGNAL_LABELS = {
  heading:          "heading element",
  "bold-table-cell": "bold standalone table cell",
  "bold-text":       "bold standalone text",
  "table-cell":      "table cell",
  "all-caps":        "ALL-CAPS short line",
  colon:             "colon-terminated label",
  "short-line":      "short standalone line",
};

// Classifies one extracted candidate. Returns null for anything that isn't
// a plausible section candidate at all (too long, mid-sentence, empty).
// Confidence is a transparent heuristic (see the tiers in the SQL migration
// comment / this session's design discussion), not a model-derived
// probability: exact dictionary match (0.98) > normalized match (0.90) >
// fuzzy pattern match backed by a strong structural signal (0.75) > fuzzy
// pattern match with only a weak signal (0.60) > no match at all, preserved
// as custom_section (0.50) — matches every unrecognized heading is kept,
// never silently dropped.
//
// `trace`, if given an array, gets a human-readable line pushed at every
// decision point — purely for debug mode (see handleRegister's
// debugSections handling); it never changes what this function returns, so
// passing it can't affect real classification behavior, only observability
// of it.
function classifySectionCandidate(rawLabel, signal, trace = null) {
  const log = (msg) => { if (trace) trace.push(msg); };

  const trimmed = (rawLabel || "").trim();
  if (!trimmed) {
    log("discarded: empty/whitespace-only text");
    return null;
  }

  // Instruction text: an imperative sentence, not a label — checked first
  // since it's the one candidate type that's expected to end in a period
  // (every other branch below rejects sentence-ending text as too long/
  // too sentence-like to be a section label).
  if (/[.?!]$/.test(trimmed) && trimmed.length <= 200 && INSTRUCTION_VERB_PATTERN.test(trimmed)) {
    log(`matched instruction_text: ends in sentence punctuation, <=200 chars, starts with an imperative verb (${INSTRUCTION_VERB_PATTERN})`);
    return {
      type: "instruction_text",
      normalizedKey: "instruction",
      confidence: 0.75,
      detectionReason: `instructional sentence (${SIGNAL_LABELS[signal] || "text"})`,
    };
  }
  log("not instruction_text: doesn't end in ./?/! + imperative verb, or is over 200 chars");

  const endsInColon = /:\s*$/.test(trimmed);
  const core = trimmed.replace(/:\s*$/, "").trim();
  if (!core) {
    log("discarded: only a colon, no label text");
    return null;
  }
  // Section labels are short and don't end mid-sentence — a colon at the
  // end is the one exception (e.g. "Materials Needed:" is still a label).
  if (!endsInColon && (core.length > 70 || /[.?!]$/.test(core))) {
    log(`discarded: not colon-terminated and ${core.length > 70 ? `over 70 chars (${core.length})` : "ends in sentence punctuation"} — treated as body text, not a label`);
    return null;
  }
  log(`passed heading-candidacy gate: endsInColon=${endsInColon}, length=${core.length}`);

  const normalized = normalizeForMatch(core);
  const isExactText = (variants) => variants.includes(core.toLowerCase());

  const metaExact = lookupDictionary(METADATA_FIELD_DICTIONARY, normalized);
  if (metaExact) {
    const exact = isExactText(METADATA_FIELD_DICTIONARY[metaExact]);
    log(`matched metadata_field dictionary: normalizedKey="${metaExact}", exactText=${exact}`);
    return {
      type: "metadata_field",
      normalizedKey: metaExact,
      confidence: exact ? 0.98 : 0.90,
      detectionReason: exact ? "exact dictionary match" : "normalized exact match",
    };
  }
  log(`no metadata_field dictionary match for normalized text "${normalized}"`);

  const contentExact = lookupDictionary(CONTENT_SECTION_DICTIONARY, normalized);
  if (contentExact) {
    const exact = isExactText(CONTENT_SECTION_DICTIONARY[contentExact]);
    log(`matched content_section dictionary: normalizedKey="${contentExact}", exactText=${exact}`);
    return {
      type: "content_section",
      normalizedKey: contentExact,
      confidence: exact ? 0.98 : 0.90,
      detectionReason: exact ? "exact dictionary match" : "normalized exact match",
    };
  }
  log(`no content_section dictionary match for normalized text "${normalized}"`);

  // No exact/normalized dictionary hit — try fuzzy patterns. A match here
  // is a real (if uncertain) concept identification, tiered by how strong
  // the structural signal that surfaced it was.
  const metaFuzzy = lookupPatterns(METADATA_FIELD_PATTERNS, core);
  const contentFuzzy = !metaFuzzy ? lookupPatterns(CONTENT_SECTION_PATTERNS, core) : null;
  const fuzzyKey = metaFuzzy || contentFuzzy;
  if (fuzzyKey) {
    const strong = STRONG_SIGNALS.has(signal) || endsInColon;
    log(`matched fuzzy pattern: normalizedKey="${fuzzyKey}" (${metaFuzzy ? "metadata" : "content"}), signal="${signal}", strongSignal=${strong}`);
    return {
      type: metaFuzzy ? "metadata_field" : "content_section",
      normalizedKey: fuzzyKey,
      confidence: strong ? 0.75 : 0.60,
      detectionReason: strong ? SIGNAL_LABELS[endsInColon ? "colon" : signal] : "weak heading candidate (text length and placement)",
    };
  }
  log("no fuzzy pattern match either — falling back to unrecognized custom_section");

  // Nothing recognized it at all — preserve it rather than drop it.
  return {
    type: "content_section",
    normalizedKey: "custom_section",
    confidence: 0.5,
    detectionReason: "unknown heading candidate",
  };
}

function isAllCapsLine(text) {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase();
}

// Recognizes text that's clearly a filled-in VALUE (a name, a date, a grade
// level) rather than a label — used to tell a label apart from a value by
// what the cell's own text actually looks like, instead of guessing from
// its position in the row (see extractDocxSectionCandidates: a table row's
// cells are only excluded here if row-level context says the row has a mix
// of labels and values; a row that's entirely labels, e.g. "Teacher |
// Grade | School | Date", keeps every cell regardless of these patterns).
const VALUE_LIKE_PATTERNS = [
  /^(mr|mrs|ms|dr|miss|prof)\.?\s+\S+/i,                                                  // "Mr. Lee", "Ms. Smith"
  /^\d{1,2}(st|nd|rd|th)\b(\s*grade)?$/i,                                                 // "5th", "5th Grade"
  /^grade\s*\d{1,2}$/i,                                                                   // "Grade 5"
  /^\d{4}-\d{1,2}-\d{1,2}$/,                                                              // "2026-07-13"
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,                                                          // "7/13/2026"
  /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}$/i, // "July 13, 2026"
];

function isValueLikeText(text) {
  const t = text.trim();
  return VALUE_LIKE_PATTERNS.some((pattern) => pattern.test(t));
}

// ── PDF candidates ────────────────────────────────────────────────────────────
// Reuses the same flat text every other PDF detector in this file reads —
// per the "this phase will not detect PDF coordinates or visual layout"
// scope, no new PDF extraction is added. Every line is a candidate; the
// classifier above is what actually filters out body-text noise.
// pdf-parse's getText() appends its own "-- N of M --" page marker by
// default (confirmed directly against the live parser — not document
// content) — filtered here rather than in extractPdfText/detectPdfSections,
// since this is specifically about candidate noise for section detection,
// not a change to what those existing functions return.
const PDF_PAGE_MARKER = /^--\s*\d+\s*of\s*\d+\s*--$/i;

function extractPdfSectionCandidates(text) {
  return splitTextLines(text)
    .filter((line) => !PDF_PAGE_MARKER.test(line))
    .map((line) => {
      let signal;
      if (/:\s*$/.test(line)) signal = "colon";
      else if (isAllCapsLine(line)) signal = "all-caps";
      else signal = "short-line";
      return { text: line, signal };
    });
}

// ── DOCX candidates ───────────────────────────────────────────────────────────
// Uses mammoth.convertToHtml() specifically (NOT extractRawText, which the
// existing tag-free-DOCX fallback still uses and keeps using) because only
// convertToHtml preserves heading styles, bold runs, and table structure —
// extractRawText flattens all of that into plain text. Lazy-imported for the
// same reason pdf-parse/docx are lazy elsewhere in this file.
async function extractDocxHtml(buffer) {
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.convertToHtml({ buffer });
  return result.value;
}

function stripHtmlTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// True when the ENTIRE cell/paragraph content is one bold run (not just
// bold text somewhere inside a longer sentence) — that distinction is what
// separates a "bold standalone" heading-like label from ordinary emphasis.
function isEntirelyBold(innerHtml) {
  // Table cell contents come wrapped in their own <p>...</p> (e.g.
  // "<p><strong>Teacher Name:</strong></p>"), unlike a bold top-level
  // paragraph's inner content (just "<strong>...</strong>") — strip one
  // optional wrapping <p> before checking so both cases match the same way.
  const trimmed = innerHtml.trim().replace(/^<p>([\s\S]*)<\/p>$/, "$1").trim();
  return /^<strong>[\s\S]*<\/strong>$/.test(trimmed) || /^<b>[\s\S]*<\/b>$/.test(trimmed);
}

function classifyDocxBlockSignal(text, innerHtml, boldSignal) {
  if (isEntirelyBold(innerHtml)) return boldSignal;
  if (/:\s*$/.test(text)) return "colon";
  if (isAllCapsLine(text)) return "all-caps";
  return boldSignal === "bold-table-cell" ? "table-cell" : "short-line";
}

// Single sequential scan over mammoth's HTML output (headings, paragraphs,
// tables as one alternation regex) so candidates come out in original
// document order — a table's cells are extracted together at the position
// the table itself occupies. Known limitation: this is a regex-based walk,
// not a full HTML parser, so it assumes mammoth's typical flat output
// (headings/paragraphs/tables not nested inside one another at the top
// level) — an unusually complex DOCX structure could confuse it.
// A single <td>/<th> can contain multiple stacked labels, each its own
// <p> — e.g. <td><p><strong>Teacher:</strong></p><p><strong>Grade:</strong></p></td>
// is TWO candidates, not one flattened string. Splits on <p> first (the
// common case for mammoth's output); if a cell has no <p> wrapping at all,
// falls back to splitting on standalone <strong> runs (requirement 4);
// falls back to the whole cell as a single unit only if neither applies.
function extractCellUnits(innerHtml) {
  const units = [];
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = paraRegex.exec(innerHtml)) !== null) units.push(m[1]);

  if (units.length === 0) {
    const strongMatches = innerHtml.match(/<strong>[\s\S]*?<\/strong>/g);
    if (strongMatches && strongMatches.length > 0) units.push(...strongMatches);
    else units.push(innerHtml);
  }

  return units
    .map((unitHtml) => ({ text: stripHtmlTags(unitHtml), html: unitHtml }))
    .filter((u) => u.text);
}

// `extractionTrace`, when given an object with a `rows` array, gets one
// entry per table row: tableIndex/rowIndex/cellCount/rowHasAnyValue, and
// per cell, every candidate unit's index/text/signal/isValueLike/retained
// — purely additive observability for verifying extraction against a real
// document's actual HTML structure; doesn't change what candidates are
// produced.
function extractDocxSectionCandidates(html, extractionTrace = null) {
  const candidates = [];
  // [^>]* after each tag name tolerates attributes (colspan="2", style=...,
  // etc.) — the previous bare <t[dh]>/<table>/<tr>/<p>/<h1-6> forms only
  // matched a tag with NO attributes at all, silently failing to match (and
  // therefore silently dropping) any cell/table/row/paragraph/heading that
  // had one. Confirmed directly: a <td colspan="2"> containing "Assessments"
  // was invisible to the old regex for exactly this reason.
  const blockRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>|<table[^>]*>([\s\S]*?)<\/table>/g;
  let match;
  let tableIndex = -1;
  while ((match = blockRegex.exec(html)) !== null) {
    if (match[1] !== undefined) {
      const text = stripHtmlTags(match[2]);
      if (text) candidates.push({ text, signal: "heading" });
    } else if (match[3] !== undefined) {
      const text = stripHtmlTags(match[3]);
      if (text) candidates.push({ text, signal: classifyDocxBlockSignal(text, match[3], "bold-text") });
    } else if (match[4] !== undefined) {
      tableIndex++;
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
      let rowMatch;
      let rowIndex = -1;
      while ((rowMatch = rowRegex.exec(match[4])) !== null) {
        rowIndex++;
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
        let cellMatch;
        let cellIndex = -1;
        // Every candidate unit from every cell in the row is collected
        // into one flat list first (position never excludes anything on
        // its own — requirement 2) so the row can be judged as a whole
        // before deciding what to keep.
        const rowRecords = [];
        const cellNotes = [];
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          cellIndex++;
          const cellUnits = extractCellUnits(cellMatch[1]);
          if (cellUnits.length === 0) {
            cellNotes.push({ index: cellIndex, note: "empty cell — skipped" });
            continue;
          }
          cellUnits.forEach((u, unitIndex) => {
            rowRecords.push({
              cellIndex,
              unitIndex,
              text: u.text,
              signal: classifyDocxBlockSignal(u.text, u.html, "bold-table-cell"),
              isValueLike: isValueLikeText(u.text),
            });
          });
        }
        // Row-level context, not cell position or one-unit-per-cell: only
        // exclude a unit when something ELSE in the same row is a
        // confirmed value. A row where nothing looks like a value (e.g.
        // three stacked labels in one cell, or "Teacher | Grade | School |
        // Date" across separate cells) keeps every unit.
        const rowHasAnyValue = rowRecords.some((r) => r.isValueLike);
        for (const r of rowRecords) {
          r.retained = !(rowHasAnyValue && r.isValueLike);
          if (r.retained) candidates.push({ text: r.text, signal: r.signal });
        }
        if (extractionTrace) {
          const cellMap = new Map();
          for (const note of cellNotes) cellMap.set(note.index, { index: note.index, units: [], note: note.note });
          for (const r of rowRecords) {
            if (!cellMap.has(r.cellIndex)) cellMap.set(r.cellIndex, { index: r.cellIndex, units: [] });
            cellMap.get(r.cellIndex).units.push({
              unitIndex: r.unitIndex,
              text: r.text,
              signal: r.signal,
              isValueLike: r.isValueLike,
              retained: r.retained,
            });
          }
          const cells = Array.from(cellMap.values()).sort((a, b) => a.index - b.index);
          extractionTrace.rows.push({ tableIndex, rowIndex, cellCount: cellIndex + 1, rowHasAnyValue, cells });
        }
      }
    }
  }
  return candidates;
}

// Orchestrator: classifies every candidate, buckets it into the right array,
// dedupes exact repeats (same type + same lowercased label), and assigns
// stable ids/order. Never throws on a per-candidate basis — a candidate that
// doesn't classify to anything is just skipped (classifySectionCandidate
// returning null), not an error.
// `debug`, when true, returns a second value: one entry per RAW candidate
// (before classification/dedup), recording exactly what happened to it —
// its extracted text/signal, the step-by-step reasoning trace from
// classifySectionCandidate, the final outcome (which bucket it landed in,
// or "discarded"/"duplicate" and why), and its confidence/detectionReason
// when classified. This is pure observability — the classification/dedup
// logic itself is unchanged whether debug is on or off.
function buildDetectedSections(candidates, debug = false) {
  const contentSections = [];
  const metadataFields = [];
  const instructionTexts = [];
  const seen = new Set();
  const debugLog = debug ? [] : null;

  candidates.forEach((candidate, index) => {
    const trace = debug ? [] : null;
    const result = classifySectionCandidate(candidate.text, candidate.signal, trace);

    if (!result) {
      if (debugLog) {
        debugLog.push({
          index,
          text: candidate.text,
          signal: candidate.signal,
          outcome: "discarded",
          discardReason: trace[trace.length - 1] || "discarded (no reason recorded)",
          trace,
        });
      }
      return;
    }

    const cleanLabel = result.type === "instruction_text"
      ? candidate.text.trim()
      : candidate.text.replace(/:\s*$/, "").trim();
    const dedupeKey = `${result.type}:${cleanLabel.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      if (debugLog) {
        debugLog.push({
          index,
          text: candidate.text,
          signal: candidate.signal,
          outcome: "duplicate",
          discardReason: `duplicate of an earlier ${result.type} candidate with the same text ("${cleanLabel}")`,
          normalizedKey: result.normalizedKey,
          confidence: result.confidence,
          detectionReason: result.detectionReason,
          trace,
        });
      }
      return;
    }
    seen.add(dedupeKey);

    const target = result.type === "metadata_field" ? metadataFields
      : result.type === "instruction_text" ? instructionTexts
      : contentSections;
    const idPrefix = result.type === "metadata_field" ? "metadata"
      : result.type === "instruction_text" ? "instruction"
      : "section";

    target.push({
      id: `${idPrefix}_${target.length + 1}`,
      originalLabel: cleanLabel,
      normalizedKey: result.normalizedKey,
      type: result.type,
      order: target.length + 1,
      confidence: result.confidence,
      detectionReason: result.detectionReason,
    });

    if (debugLog) {
      debugLog.push({
        index,
        text: candidate.text,
        signal: candidate.signal,
        outcome: result.type,
        normalizedKey: result.normalizedKey,
        confidence: result.confidence,
        detectionReason: result.detectionReason,
        trace,
      });
    }
  });

  return { detected: { contentSections, metadataFields, instructionTexts, confirmed: false, version: 1 }, debugLog };
}

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 3 — TEMPLATE LAYOUT RECOGNITION (preview only)

   A separate walk of the same mammoth HTML used by extractDocxSectionCandidates
   above, but building a nested table/row/cell TREE instead of a flat
   candidate list. Deliberately not a reuse of that function or its output:
   section detection only ever needed a flat, order-preserved list of
   candidate labels, so it discards which table/row/cell/colspan/rowspan each
   one came from, and it skips empty cells outright (they classify to
   nothing). Layout needs exactly the things that function throws away —
   cell IDENTITY, span geometry, and empty cells (which still occupy a
   column position and affect visual alignment even with no text in them).

   Storage: detected_layout/layout_detection_status/layout_detection_error —
   its own columns, never touching detected_sections or its columns. Nothing
   here is read by generation, export, or DOCX synthesis in this phase.
═══════════════════════════════════════════════════════════════════════════ */

// Walks <table>/<tr>/<td> the same attribute-tolerant way as
// extractDocxSectionCandidates, but captures the cell's own opening-tag
// attributes (for colspan/rowspan) and keeps every cell — including empty
// ones — rather than flattening/filtering into a candidate list.
function extractDocxLayout(html) {
  const tables = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/g;
  let tableMatch;
  let tableOrder = 0;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    tableOrder++;
    const rows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch;
    let rowOrder = 0;
    while ((rowMatch = rowRegex.exec(tableMatch[1])) !== null) {
      rowOrder++;
      const cells = [];
      const cellRegex = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g;
      let cellMatch;
      let cellOrder = 0;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cellOrder++;
        const attrs = cellMatch[1] || "";
        const colspanMatch = /colspan\s*=\s*"?(\d+)"?/i.exec(attrs);
        const rowspanMatch = /rowspan\s*=\s*"?(\d+)"?/i.exec(attrs);
        const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) || 1 : 1;
        const rowspan = rowspanMatch ? parseInt(rowspanMatch[1], 10) || 1 : 1;
        // Kept even when empty (labels: []) — an empty cell still occupies
        // a column and affects the grid's alignment.
        const labels = extractCellUnits(cellMatch[2]).map((u) => u.text);
        cells.push({
          id: `table_${tableOrder}_row_${rowOrder}_cell_${cellOrder}`,
          order: cellOrder,
          colspan,
          rowspan,
          labels,
          sectionIds: [], // filled in by mapSectionsToLayout below
        });
      }
      rows.push({ id: `table_${tableOrder}_row_${rowOrder}`, order: rowOrder, cells });
    }
    tables.push({ id: `table_${tableOrder}`, order: tableOrder, rows });
  }
  return { version: 1, sourceType: "docx", tables, unmatchedSectionIds: [] };
}

// Connects each cell label to the detected_sections item it came from, by
// id (never normalizedKey — normalizedKey can be shared across multiple
// items, e.g. two custom_section headings, so it can't uniquely identify
// which specific item a cell corresponds to the way id can).
// Matching order: exact originalLabel first, then a normalized
// (punctuation/case-insensitive) fallback — reusing normalizeForMatch
// verbatim rather than a second normalizer. Never forces a match: a label
// with no corresponding detected section keeps its text with a null
// sectionIds entry at the same index; a detected section matched to no
// cell anywhere is surfaced in the returned unmatchedSectionIds list.
function mapSectionsToLayout(layout, detectedSections) {
  const allSections = [
    ...(detectedSections?.contentSections || []),
    ...(detectedSections?.metadataFields || []),
    ...(detectedSections?.instructionTexts || []),
  ];
  const byExactLabel = new Map(allSections.map((s) => [s.originalLabel, s.id]));
  const byNormalizedLabel = new Map(allSections.map((s) => [normalizeForMatch(s.originalLabel), s.id]));
  const matchedIds = new Set();

  for (const table of layout.tables) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        cell.sectionIds = cell.labels.map((label) => {
          const id = byExactLabel.get(label) ?? byNormalizedLabel.get(normalizeForMatch(label)) ?? null;
          if (id) matchedIds.add(id);
          return id;
        });
      }
    }
  }

  const unmatchedSectionIds = allSections.filter((s) => !matchedIds.has(s.id)).map((s) => s.id);
  return { ...layout, unmatchedSectionIds };
}

// Diagnostics only (see handleRegister's debugLayout gating) — walks the
// already-built/mapped layout to report exactly what requirement 7 asks
// for: table/row/cell counts, every cell's span + labels, which labels
// matched which section id, and which labels/sections didn't match.
function buildLayoutDebugInfo(html, layout) {
  const cells = [];
  const matches = [];
  const unmatchedLabels = [];
  let rowCount = 0;

  for (const table of layout.tables) {
    rowCount += table.rows.length;
    for (const row of table.rows) {
      for (const cell of row.cells) {
        cells.push({
          tableOrder: table.order,
          rowOrder: row.order,
          cellOrder: cell.order,
          colspan: cell.colspan,
          rowspan: cell.rowspan,
          labels: cell.labels,
        });
        cell.labels.forEach((label, i) => {
          const sectionId = cell.sectionIds[i];
          const location = { tableOrder: table.order, rowOrder: row.order, cellOrder: cell.order };
          if (sectionId) matches.push({ label, sectionId, ...location });
          else unmatchedLabels.push({ label, ...location });
        });
      }
    }
  }

  return {
    engineVersion: LAYOUT_DETECTION_ENGINE_VERSION,
    htmlLength: html.length,
    tableCount: layout.tables.length,
    rowCount,
    cellCount: cells.length,
    cells,
    matches,
    unmatchedLabels,
    unmatchedSectionIds: layout.unmatchedSectionIds,
  };
}

// Top-level entry point called from handleRegister, mirroring
// detectTemplateSections's shape/error-handling pattern. PDF templates are
// explicitly out of scope this phase — returns an empty, "unsupported"
// layout immediately rather than attempting any PDF-specific parsing (PDF
// section-detection itself, extractPdfSectionCandidates, is untouched).
async function detectTemplateLayout({ isPdf, buffer, detectedSections, debug = false }) {
  if (isPdf) {
    return {
      layout: { version: 1, sourceType: "pdf", tables: [], unmatchedSectionIds: [] },
      status: "unsupported",
      error: null,
      debugInfo: debug
        ? { engineVersion: LAYOUT_DETECTION_ENGINE_VERSION, sourceType: "pdf", note: "Layout recognition is currently available for DOCX templates only." }
        : null,
    };
  }

  const html = await extractDocxHtml(buffer);
  const rawLayout = extractDocxLayout(html);
  const layout = mapSectionsToLayout(rawLayout, detectedSections);
  const debugInfo = debug ? buildLayoutDebugInfo(html, layout) : null;
  return { layout, status: "ready", error: null, debugInfo };
}

// Top-level entry point called from handleRegister. isPdf selects which
// candidate extractor runs; both converge on the same classifier/orchestrator.
// Truncation cap for the raw mammoth HTML dump in extractionDebug — this is
// meant for eyeballing structure (are there real <table>/<tr>/<td> tags at
// all, roughly how many), not for reproducing the whole document; capped
// to keep the response/log size sane for a large template.
const EXTRACTION_HTML_DEBUG_LIMIT = 20000;

async function detectTemplateSections({ isPdf, buffer, pdfText, debug = false }) {
  let candidates;
  let extractionDebug = null;

  if (isPdf) {
    candidates = extractPdfSectionCandidates(pdfText);
  } else {
    const html = await extractDocxHtml(buffer);
    const extractionTrace = debug ? { rows: [] } : null;
    candidates = extractDocxSectionCandidates(html, extractionTrace);
    if (debug) {
      extractionDebug = {
        engineVersion: SECTION_DETECTION_ENGINE_VERSION,
        htmlLength: html.length,
        html: html.length > EXTRACTION_HTML_DEBUG_LIMIT
          ? `${html.slice(0, EXTRACTION_HTML_DEBUG_LIMIT)}\n...[truncated, full length ${html.length} chars]`
          : html,
        tableRows: extractionTrace.rows,
        rawCandidates: candidates,
      };
      console.log(`[custom-templates:register] EXTRACTION DEBUG — engineVersion=${SECTION_DETECTION_ENGINE_VERSION}, mammoth HTML length=${html.length}`);
      console.log("[custom-templates:register] EXTRACTION DEBUG — full HTML (may be truncated):", extractionDebug.html);
      console.log(`[custom-templates:register] EXTRACTION DEBUG — ${extractionTrace.rows.length} table rows detected:`);
      for (const row of extractionTrace.rows) {
        console.log(`[custom-templates:register] EXTRACTION DEBUG table=${row.tableIndex} row=${row.rowIndex} cellCount=${row.cellCount} rowHasAnyValue=${row.rowHasAnyValue}`);
        for (const cell of row.cells) {
          console.log(`[custom-templates:register] EXTRACTION DEBUG   cell[${cell.index}] — ${cell.units.length} candidate unit(s)${cell.note ? ` (${cell.note})` : ""}`);
          for (const unit of cell.units) {
            console.log(
              `[custom-templates:register] EXTRACTION DEBUG     unit[${unit.unitIndex}] "${unit.text}" signal=${unit.signal} isValueLike=${unit.isValueLike} retained=${unit.retained}`
            );
          }
        }
      }
      console.log("[custom-templates:register] EXTRACTION DEBUG — final raw candidate list:", candidates);
    }
  }

  const { detected, debugLog } = buildDetectedSections(candidates, debug);

  if (debugLog) {
    console.log(`[custom-templates:register] SECTION DEBUG — ${candidates.length} raw candidates:`);
    for (const entry of debugLog) {
      console.log(
        `[custom-templates:register] SECTION DEBUG #${entry.index} "${entry.text}" (signal=${entry.signal}) -> ${entry.outcome}` +
        (entry.outcome === "discarded" || entry.outcome === "duplicate"
          ? ` — ${entry.discardReason}`
          : ` — normalizedKey=${entry.normalizedKey}, confidence=${entry.confidence}, reason="${entry.detectionReason}"`)
      );
      console.log(`[custom-templates:register] SECTION DEBUG #${entry.index} trace:`, entry.trace);
    }
  }

  console.log("[custom-templates:register] section detection —", {
    engineVersion: SECTION_DETECTION_ENGINE_VERSION,
    candidateCount: candidates.length,
    contentSectionCount: detected.contentSections.length,
    metadataFieldCount: detected.metadataFields.length,
    instructionTextCount: detected.instructionTexts.length,
    unknownSectionCount: detected.contentSections.filter((s) => s.normalizedKey === "custom_section").length,
  });

  return { detected, debugLog, extractionDebug };
}

// Builds a new .docx (via the `docx` library) reproducing the detected
// sections in their original order: each as a bold heading (the PDF's own
// wording) followed by one {{TOKEN}} placeholder paragraph per mapped
// token — a real docxtemplater-compatible template from here on. Structured
// fields (checklists/option lists) are appended after the narrative
// sections, each as its own heading + single {{FIELD_TOKEN}} placeholder
// (rendered at export time from the lesson's customFieldSelections — see
// buildRenderData) — narrative/structured relative ordering isn't preserved
// against each other, only within each group, since they're detected as two
// separate passes over the same text (see analyzeTemplateText).
async function synthesizeDocxFromPdfSections(sections, structuredFields = []) {
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
  for (const field of structuredFields) {
    children.push(new Paragraph({
      children: [new TextRun({ text: field.label, bold: true, size: 26 })],
      spacing: { before: 240, after: 100 },
    }));
    children.push(new Paragraph({
      children: [new TextRun(`{{${field.token}}}`)],
      spacing: { after: 200 },
    }));
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
  // pdf.worker.mjs — see server-lib/pdf-node-setup.js for why both are needed
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

// Plain-text extraction for the "no {{PLACEHOLDER}} tags" DOCX fallback —
// mammoth is imported lazily (like pdf-parse/docx above) so a module-load
// failure can't crash the whole route, only this specific conversion attempt.
async function extractDocxText(buffer) {
  const { default: mammoth } = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Shared by the PDF branch and the tag-free-DOCX fallback in handleRegister:
// given plain extracted text and the original storage path, detects both
// narrative sections and structured fields (checklists/option lists) and —
// if either is found — synthesizes a real {{TOKEN}} docx from them and
// uploads it. Returns { ok: false, reason: "no-sections" | "upload-failed" }
// so each caller can set its own precise, format-appropriate error message;
// never throws for those two cases (only lets unexpected exceptions from
// extraction/synthesis propagate to the caller's own try/catch).
async function convertHeadingsToPlaceholderDocx(text, originalPath) {
  const { sections, structuredFields } = analyzeTemplateText(text);
  if (sections.length === 0 && structuredFields.length === 0) return { ok: false, reason: "no-sections" };

  const synthesizedBuffer = await synthesizeDocxFromPdfSections(sections, structuredFields);
  const synthesizedPath = `${originalPath.replace(/\.(pdf|docx)$/i, "")}-converted.docx`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(synthesizedPath, synthesizedBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  if (uploadError) {
    console.error("[custom-templates:register] synthesized docx upload error:", uploadError.message);
    return { ok: false, reason: "upload-failed" };
  }

  return { ok: true, buffer: synthesizedBuffer, storagePath: synthesizedPath, structuredFields };
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
  const { path, filename, name, userId, debugSections, debugLayout } = req.body ?? {};
  if (!path)   return res.status(400).json({ error: "Missing upload path." });
  if (!userId) return res.status(400).json({ error: "Missing userId." });

  // Debug mode for the section-recognition pipeline specifically (separate
  // from IS_DEV, which gates unrelated error-detail exposure elsewhere in
  // this file) — opt-in via the request body so it can be turned on for one
  // specific upload without needing a non-production deploy. Logs every raw
  // candidate, why it was discarded (if it was), and its final
  // classification/confidence, and echoes the same trace back in the
  // response so it's visible without needing server log access.
  const sectionDebugEnabled = debugSections === true;
  // Same idea, for layout recognition (Phase 3) — see buildLayoutDebugInfo.
  const layoutDebugEnabled = debugLayout === true;

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
  // Kept aside for section detection below, which always re-reads the
  // ORIGINAL uploaded file — for a PDF, `buffer` gets reassigned to the
  // synthesized docx further down, but section recognition should reflect
  // exactly what the teacher uploaded, not the converted intermediate.
  const originalBuffer = buffer;
  let storagePath = path;
  let detected = { all: [], recognized: [], unrecognized: [] };
  let structuredFields = [];
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
        const converted = await convertHeadingsToPlaceholderDocx(text, path);
        if (!converted.ok) {
          status = "error";
          errorMessage = converted.reason === "upload-failed"
            ? "Could not save the converted template. Please try again."
            : "Could not detect any recognizable lesson-plan sections in this PDF (e.g. Objectives, Materials, Procedure, Assessment). Try a Word (.docx) template instead, or add clearer section headings.";
        } else {
          buffer = converted.buffer;
          storagePath = converted.storagePath;
          structuredFields = converted.structuredFields;
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

  // A .docx with no {{PLACEHOLDER}} tags at all (an ordinary lesson-plan
  // document, not one written for this feature) falls back to the same
  // heading-keyword detection the PDF pipeline uses, then gets converted
  // into a synthesized {{TOKEN}} docx exactly like a PDF upload — from
  // there on it's indistinguishable from any other custom template. A docx
  // that DOES have {{...}} tags — even ones that don't match a known
  // token — is left alone here; it still goes through the normal
  // "unrecognized placeholder" path below rather than being silently
  // reinterpreted by heading, since a teacher who attempted the tag syntax
  // likely wants to know their tags didn't match, not have them ignored.
  let usedHeadingFallback = false;
  if (!isPdf && status !== "error") {
    let initialDetected;
    try {
      // Same call the later block below makes — done early here only to
      // decide whether to attempt heading detection at all. Guarded the
      // same way: an unreadable/corrupted .docx must fail with the normal
      // "not a valid Word template" message, not an unhandled exception.
      initialDetected = detectPlaceholders(buffer);
    } catch (err) {
      console.error("[custom-templates:register] initial placeholder scan failed:", err.message);
      status = "error";
      errorMessage = "Could not read this file as a valid Word template. It may be corrupted or use unsupported formatting.";
    }
    if (status !== "error" && initialDetected.all.length === 0) {
      console.log("[custom-templates:register] no {{PLACEHOLDER}} tags found in DOCX — trying heading detection");
      try {
        const text = await extractDocxText(buffer);
        if (!text || !text.trim()) {
          status = "error";
          errorMessage = "Could not extract any text from this document.";
        } else {
          const converted = await convertHeadingsToPlaceholderDocx(text, path);
          if (!converted.ok) {
            status = "error";
            errorMessage = converted.reason === "upload-failed"
              ? "Could not save the converted template. Please try again."
              : "No {{PLACEHOLDER}} tags or recognizable section headings (e.g. Objectives, Materials, Procedure, Assessment) were found in this document.";
          } else {
            buffer = converted.buffer;
            storagePath = converted.storagePath;
            usedHeadingFallback = true;
            structuredFields = converted.structuredFields;
          }
        }
      } catch (err) {
        console.error("[custom-templates:register] heading-based DOCX conversion failed — name:", err?.name);
        console.error("[custom-templates:register] heading-based DOCX conversion failed — message:", err?.message);
        console.error("[custom-templates:register] heading-based DOCX conversion failed — stack:", err?.stack);
        status = "error";
        errorMessage = IS_DEV
          ? `Could not analyze this document's headings. [dev] ${err?.name || "Error"}: ${err?.message || String(err)}`
          : "Could not analyze this document's structure. Please try again, or use {{PLACEHOLDER}} tags instead.";
      }
    }
  }

  // Skip placeholder detection if an earlier branch above already failed —
  // buffer/storagePath point at a real .docx either way otherwise (the
  // original upload, or a just-synthesized one from either fallback).
  if (status !== "error") {
    try {
      detected = detectPlaceholders(buffer);
      // A template can be entirely structured fields (e.g. a document made
      // up of nothing but checklists) with zero PLACEHOLDER_CATALOG matches
      // — that's still a valid, ready template, not an error.
      if (detected.recognized.length === 0 && structuredFields.length === 0) {
        status = "error";
        errorMessage = isPdf
          ? "Could not map any detected sections to a supported placeholder. Try a Word (.docx) template instead."
          : usedHeadingFallback
          ? "Could not map any detected section headings to a supported placeholder. Try adding clearer headings (e.g. Objectives, Materials, Procedure, Assessment)."
          : "No recognized placeholders were found in this document. Check that it uses tags like {{LESSON_TITLE}}, {{OBJECTIVES}}, etc.";
      }
    } catch (err) {
      console.error("[custom-templates:register] placeholder detection failed:", err.message);
      status = "error";
      errorMessage = "Could not read this file as a valid Word template. It may be corrupted or use unsupported formatting.";
    }
  }

  console.log("[custom-templates:register] detected structured fields:", structuredFields);

  // Section recognition (Phase 1) — runs independently of everything above.
  // A failure here never affects template registration itself: status/
  // errorMessage (the existing pipeline's own outcome) are untouched; only
  // section_detection_status/section_detection_error record this pass's
  // own result. Always re-reads from originalBuffer (the file as uploaded),
  // not the synthesized docx a PDF gets converted into above.
  let detectedSections = DEFAULT_DETECTED_SECTIONS;
  let sectionDetectionStatus = "ready";
  let sectionDetectionError = null;
  let sectionDebugLog = null;
  let sectionExtractionDebug = null;
  try {
    let pdfText = null;
    if (isPdf) pdfText = await extractPdfText(originalBuffer);
    const result = await detectTemplateSections({ isPdf, buffer: originalBuffer, pdfText, debug: sectionDebugEnabled });
    detectedSections = result.detected;
    sectionDebugLog = result.debugLog;
    sectionExtractionDebug = result.extractionDebug;
  } catch (err) {
    console.error("[custom-templates:register] section detection failed — name:", err?.name);
    console.error("[custom-templates:register] section detection failed — message:", err?.message);
    console.error("[custom-templates:register] section detection failed — stack:", err?.stack);
    sectionDetectionStatus = "error";
    sectionDetectionError = err?.message || String(err);
  }

  // Layout recognition (Phase 3) — a third, independent pass, same isolation
  // guarantee as section detection above: a failure here never affects
  // template registration's own status/errorMessage, or detected_sections/
  // section_detection_status. Runs after section detection so it can map
  // cell labels to the just-computed detectedSections. Always re-reads from
  // originalBuffer for the same reason section detection does.
  let detectedLayout = DEFAULT_DETECTED_LAYOUT;
  let layoutDetectionStatus = "ready";
  let layoutDetectionError = null;
  let layoutDetectionDebug = null;
  try {
    const result = await detectTemplateLayout({ isPdf, buffer: originalBuffer, detectedSections, debug: layoutDebugEnabled });
    detectedLayout = result.layout;
    layoutDetectionStatus = result.status;
    layoutDetectionDebug = result.debugInfo;
  } catch (err) {
    console.error("[custom-templates:register] layout detection failed — name:", err?.name);
    console.error("[custom-templates:register] layout detection failed — message:", err?.message);
    console.error("[custom-templates:register] layout detection failed — stack:", err?.stack);
    layoutDetectionStatus = "error";
    layoutDetectionError = err?.message || String(err);
  }

  const insertPayload = {
    user_id:                    userId,
    name:                       templateName,
    original_filename:          filename || path,
    storage_path:               storagePath,
    placeholders:               detected.all,
    recognized_placeholders:    detected.recognized,
    unrecognized_placeholders:  detected.unrecognized,
    structured_fields:          structuredFields,
    detected_sections:          detectedSections,
    section_detection_status:   sectionDetectionStatus,
    section_detection_error:    sectionDetectionError,
    detected_layout:            detectedLayout,
    layout_detection_status:    layoutDetectionStatus,
    layout_detection_error:     layoutDetectionError,
    status,
    error_message:              errorMessage,
  };

  // structured_fields/detected_sections/section_detection_*/detected_layout/
  // layout_detection_* are all recent additions (see scripts/sql/
  // add-structured-fields-column.sql, add-detected-sections-columns.sql,
  // add-detected-layout-columns.sql) — every registration includes them in
  // the insert now, so until those migrations are run every template upload
  // would otherwise start failing. Retry, dropping one offending column at
  // a time, rather than hard-failing registration for an unrelated
  // deploy-vs-migration ordering issue — those fields are simply absent
  // from the saved row until their column exists.
  const OPTIONAL_INSERT_COLUMNS = [
    "structured_fields", "detected_sections", "section_detection_status", "section_detection_error",
    "detected_layout", "layout_detection_status", "layout_detection_error",
  ];
  let payload = insertPayload;
  let saved, insertError;
  for (let attempt = 0; attempt <= OPTIONAL_INSERT_COLUMNS.length; attempt++) {
    ({ data: saved, error: insertError } = await supabase
      .from("custom_templates")
      .insert([payload])
      .select("*")
      .single());

    if (!insertError) break;
    const missingCol = OPTIONAL_INSERT_COLUMNS.find(
      (col) => col in payload && new RegExp(col, "i").test(insertError.message || "")
    );
    if (!missingCol) break;
    console.warn(`[custom-templates:register] ${missingCol} column missing — retrying insert without it. Run the matching migration in scripts/sql/.`);
    const { [missingCol]: _omit, ...rest } = payload;
    payload = rest;
  }

  if (insertError) {
    console.error("[custom-templates:register] insert error:", insertError.message);
    return res.status(500).json({ error: "Could not save the template." });
  }

  // sectionDetectionEngineVersion is always included (not gated on
  // debugSections) specifically so it's possible to tell, from the
  // response alone, whether the deployment that handled this request
  // actually contains the latest section-detection code — no server log
  // access needed. The two debug payloads below stay debugSections-gated
  // and are never persisted (not part of insertPayload/detected_sections).
  return res.status(200).json({
    ...saved,
    sectionDetectionEngineVersion: SECTION_DETECTION_ENGINE_VERSION,
    ...(sectionDebugEnabled ? { sectionDetectionDebug: sectionDebugLog, sectionExtractionDebug } : {}),
    layoutDetectionEngineVersion: LAYOUT_DETECTION_ENGINE_VERSION,
    ...(layoutDebugEnabled ? { layoutDetectionDebug } : {}),
  });
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

  const renderData = buildRenderData(lessonData, template.recognized_placeholders || [], template.structured_fields || []);
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
