import type { Template1Lesson } from "../App";
import type { CustomTemplate } from "./custom-templates";

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

// Recognized purely by name/filename — the only signal available without
// real position data. Add more entries here as more known template shapes
// need their own grid; anything else keeps the generic vertical renderer.
export function getLayoutForTemplate(template: CustomTemplate): GridLayout | null {
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
