import type { Template1Lesson } from "../App";
import type { CustomTemplate, CustomTemplateStructuredField } from "./custom-templates";

/* ── Grid layout metadata for recognized templates ─────────────────────────────
   pdf-parse's getText() (see extractPdfText in api/custom-templates.js) only
   returns flat text — no bounding boxes, font sizes, or page coordinates are
   available anywhere in the extraction pipeline — so a real position-derived
   layout can't be computed from an arbitrary uploaded PDF. Instead, this
   recognizes specific known template shapes by name and attaches a hand-built
   grid layout for them; anything not recognized here has no `layout` and
   CustomTemplateLessonView falls back to its plain vertical section-by-
   section renderer (driven by recognized_placeholders, unaffected by this
   file). This never touches DOCX export — that still merges lessonData into
   the real uploaded/synthesized template via docxtemplater regardless of
   what's defined here.
────────────────────────────────────────────────────────────────────────────── */

export type GridLayoutSection = {
  key: string;
  colStart: number;
  colSpan: number;
  row: number;
  /** Compact metadata boxes (Grade/Subject/Date/Lesson #) get a smaller min-height. */
  compact?: boolean;
  /** Learning Focus and Goals / Structure-Activity / Assessment get a taller min-height. */
  tall?: boolean;
  label: string;
};

export type GridLayout = {
  type: "grid";
  columns: number;
  sections: GridLayoutSection[];
};

const DISCOVER_LAYOUT: GridLayout = {
  type: "grid",
  columns: 6,
  sections: [
    { key: "grade",              label: "Grade",                     colStart: 1, colSpan: 2, row: 1, compact: true },
    { key: "subject",             label: "Subject",                   colStart: 3, colSpan: 2, row: 1, compact: true },
    { key: "date",                label: "Date",                      colStart: 5, colSpan: 2, row: 1, compact: true },
    { key: "topic",                label: "Topic",                     colStart: 1, colSpan: 3, row: 2 },
    { key: "lessonNumber",         label: "Lesson #",                  colStart: 4, colSpan: 3, row: 2 },
    { key: "learningFocusGoals",   label: "Learning Focus and Goals",  colStart: 1, colSpan: 6, row: 3, tall: true },
    { key: "materials",            label: "Materials Needed",          colStart: 1, colSpan: 3, row: 4 },
    { key: "objectives",           label: "Learning Objectives",       colStart: 4, colSpan: 3, row: 4 },
    { key: "structureActivity",    label: "Structure/Activity",        colStart: 1, colSpan: 6, row: 5, tall: true },
    { key: "assessment",           label: "Assessment",                colStart: 1, colSpan: 6, row: 6, tall: true },
  ],
};

/* ── Table-grid layout: two-column body + checklist panels ────────────────────
   A second known template shape: a 3-column pastel header row (Lesson Plan /
   Unit / Date), a full-width Unit Goal row, then five rows each split into a
   left narrative writing area and a right pale-yellow checklist panel.

   Unlike DISCOVER_LAYOUT (recognized by filename alone, since Discover has no
   detected structured fields to key off of), this one is recognized by
   fingerprinting the template's OWN detectStructuredFields output — its
   checklist field labels (Teaching Strategy, Teaching Activity, Assessment
   for/as Learning, Items Needed) are distinctive enough that matching ≥2 of
   them is a reliable, data-driven signal, not a guess from the filename. The
   checklist fields on the right are matched by label at render time (see
   findStructuredFieldByLabel) rather than by an assumed field-name/key,
   since fieldKeyFromLabel's exact output depends on the uploaded document's
   own wording and isn't something this file can predict in advance.
────────────────────────────────────────────────────────────────────────────── */

export type TableGridRow = {
  // Looked up via extractChecklistTableFieldContent below (like
  // GridLayoutSection.key for DISCOVER_LAYOUT — a small fixed vocabulary of
  // narrative slots this specific layout knows how to fill).
  leftKey: string;
  leftLabel: string;
  // Matched against structured_fields[].label at render time.
  rightMatch: RegExp;
  rightFallbackLabel: string;
  minHeight: number;
};

export type TableGridLayout = {
  type: "table-grid";
  columnFractions: [number, number];
  headerCells: { key: string; label: string; bg: string }[];
  unitGoalKey: string;
  unitGoalLabel: string;
  checklistBg: string;
  rows: TableGridRow[];
};

const CHECKLIST_TABLE_LAYOUT: TableGridLayout = {
  type: "table-grid",
  columnFractions: [0.62, 0.38],
  headerCells: [
    { key: "lessonPlan", label: "Lesson Plan", bg: "#dbeeff" },
    { key: "unit", label: "Unit", bg: "#e3f5df" },
    { key: "date", label: "Date", bg: "#ffe6da" },
  ],
  unitGoalKey: "unitGoal",
  unitGoalLabel: "Unit Goal",
  checklistBg: "#fdf6d2",
  rows: [
    { leftKey: "objectives",   leftLabel: "Lesson Objective / Learning Target",     rightMatch: /teaching\s*strateg/i,          rightFallbackLabel: "Teaching Strategy",        minHeight: 160 },
    { leftKey: "mainActivity", leftLabel: "Introduction/Steps",                     rightMatch: /teaching\s*activit/i,          rightFallbackLabel: "Teaching Activity",        minHeight: 180 },
    { leftKey: "closure",      leftLabel: "Conclusion/Intro of Next Lesson",        rightMatch: /assessment\s*for\s*learning/i, rightFallbackLabel: "Assessment for Learning",  minHeight: 190 },
    { leftKey: "reflection",   leftLabel: "Reflection/Highlights",                  rightMatch: /assessment\s*as\s*learning/i,  rightFallbackLabel: "Assessment as Learning",   minHeight: 120 },
    { leftKey: "questions",    leftLabel: "Questions/Anything to Revisit",          rightMatch: /items?\s*needed|photocop/i,    rightFallbackLabel: "Items Needed/Photocopying", minHeight: 150 },
  ],
};

// ≥2 of these 5 label patterns present among the template's OWN detected
// structured fields is treated as "this is the checklist-table template" —
// data-driven, not a filename guess. A template with only 1 (or 0) matches
// falls through to the generic vertical renderer instead.
const CHECKLIST_TABLE_FINGERPRINT: RegExp[] = [
  /teaching\s*strateg/i,
  /teaching\s*activit/i,
  /assessment\s*for\s*learning/i,
  /assessment\s*as\s*learning/i,
  /items?\s*needed|photocop/i,
];

function matchesChecklistTableFingerprint(template: CustomTemplate): boolean {
  const fields = Array.isArray(template?.structured_fields) ? template.structured_fields : [];
  const labels = fields.map((f) => f?.label || "");
  const matchCount = CHECKLIST_TABLE_FINGERPRINT.filter((pattern) => labels.some((label) => pattern.test(label))).length;
  return matchCount >= 2;
}

// Finds the structured field whose label matches a row's rightMatch pattern.
// Returns null (not a throw) when the template doesn't actually have that
// field — e.g. detection missed one heading — so the caller can render a
// "no matching checklist detected" fallback for just that cell instead of
// crashing the whole preview.
export function findStructuredFieldByLabel(
  structuredFields: CustomTemplateStructuredField[],
  pattern: RegExp
): CustomTemplateStructuredField | null {
  return structuredFields.find((f) => pattern.test(f?.label || "")) ?? null;
}

// Maps a CHECKLIST_TABLE_LAYOUT slot key to its content. reflection/questions
// have no corresponding Template1Lesson field (the AI generation schema has
// no "reflection" or "revisit questions" concept) — left blank rather than
// approximated from an unrelated field, same as Discover's Date/Lesson #
// when no source data exists.
export function extractChecklistTableFieldContent(key: string, lesson: Template1Lesson): GridFieldContent {
  switch (key) {
    case "lessonPlan":
      return { kind: "text", value: lesson.lessonTitle };
    case "unit":
      return { kind: "text", value: "" };
    case "unitGoal":
      return { kind: "text", value: lesson.centralFocus };
    case "objectives":
      return { kind: "list", value: lesson.lessonObjectives };
    case "mainActivity":
      return {
        kind: "teacherStudent",
        teacher: lesson.mainLearningActivities.teacherActions,
        student: lesson.mainLearningActivities.studentActions,
      };
    case "closure":
      return {
        kind: "teacherStudent",
        teacher: lesson.closure.teacherActions,
        student: lesson.closure.studentActions,
      };
    case "reflection":
    case "questions":
      return { kind: "text", value: "" };
    default:
      return { kind: "text", value: "" };
  }
}

// Recognized primarily by the template's own detected structured-field
// fingerprint (data-driven); Discover has no structured fields to key off
// of, so it still falls back to a filename hint — the only signal available
// for a layout with no distinguishing checklist content. Add more entries
// here as more known template shapes need their own layout; anything not
// recognized has no `layout` and CustomTemplateLessonView falls back to its
// plain vertical section-by-section renderer.
export function getLayoutForTemplate(template: CustomTemplate): GridLayout | TableGridLayout | null {
  if (matchesChecklistTableFingerprint(template)) return CHECKLIST_TABLE_LAYOUT;
  const haystack = `${template.name} ${template.original_filename}`.toLowerCase();
  if (haystack.includes("discover")) return DISCOVER_LAYOUT;
  return null;
}

export type GridFieldContent =
  | { kind: "text"; value: string }
  | { kind: "list"; value: string[] }
  | { kind: "teacherStudent"; teacher: string; student: string };

// "Subject — Grade X" is the exact, deterministic format normaliseTemplate1Lesson
// always produces (see App.tsx) — split on it to recover the two halves for
// the Grade/Subject boxes. Falls back to showing the whole string as the
// grade if the format doesn't match (e.g. an older/unexpected value).
function splitSubjectGrade(subjectGradeLevel: string): { subject: string; grade: string } {
  const match = (subjectGradeLevel || "").match(/^(.*?)\s*—\s*Grade\s*(.*)$/i);
  if (match) return { subject: match[1].trim(), grade: match[2].trim() };
  return { subject: "", grade: subjectGradeLevel || "" };
}

// Maps a DISCOVER_LAYOUT section key to its content, straight from
// Template1Lesson — independent of the generic PLACEHOLDER_CATALOG (see
// custom-template-placeholders.ts), since this layout's boxes don't line up
// 1:1 with that token set (e.g. Structure/Activity combines two tokens,
// Subject/Date have no token at all).
export function extractDiscoverFieldContent(
  key: string,
  lesson: Template1Lesson,
  date: string | null
): GridFieldContent {
  switch (key) {
    case "grade":
      return { kind: "text", value: splitSubjectGrade(lesson.subjectGradeLevel).grade };
    case "subject":
      return { kind: "text", value: splitSubjectGrade(lesson.subjectGradeLevel).subject };
    case "date":
      return { kind: "text", value: date ?? "" };
    case "topic":
      return { kind: "text", value: lesson.lessonTitle };
    case "lessonNumber":
      return { kind: "text", value: "" };
    case "learningFocusGoals":
      return { kind: "text", value: lesson.centralFocus };
    case "materials":
      return { kind: "list", value: lesson.materials };
    case "objectives":
      return { kind: "list", value: lesson.lessonObjectives };
    case "structureActivity":
      return {
        kind: "teacherStudent",
        teacher: lesson.mainLearningActivities.teacherActions,
        student: lesson.mainLearningActivities.studentActions,
      };
    case "assessment":
      return { kind: "text", value: lesson.assessment.howObjectivesAssessed };
    default:
      return { kind: "text", value: "" };
  }
}
