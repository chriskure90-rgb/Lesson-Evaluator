import type { Template1Lesson } from "../App";

/* ── Placeholder catalog ───────────────────────────────────────────────────────
   Maps each {{TOKEN}} a teacher's uploaded DOCX template can use to a piece of
   Template1Lesson content. Custom templates are only a different DOCX *skin*
   over that same data shape (see api/custom-template-export.js) — adding
   support for a new placeholder is a new entry here, not a new generation
   schema.

   Mirrored in plain JS at api/lib/custom-template-placeholders.js (api/ has no
   TypeScript build step in this repo, so the two are kept in sync by hand —
   update both when adding a token).
────────────────────────────────────────────────────────────────────────────── */

export type PlaceholderKind = "text" | "list";

export type PlaceholderCatalogEntry = {
  kind: PlaceholderKind;
  label: string;
  extract: (lesson: Template1Lesson) => string | string[];
};

export const PLACEHOLDER_CATALOG: Record<string, PlaceholderCatalogEntry> = {
  LESSON_TITLE:   { kind: "text", label: "Lesson Title",             extract: l => l.lessonTitle },
  GRADE_LEVEL:    { kind: "text", label: "Grade Level",              extract: l => l.subjectGradeLevel },
  OBJECTIVES:     { kind: "list", label: "Objectives",               extract: l => l.lessonObjectives },
  MATERIALS:      { kind: "list", label: "Materials",                extract: l => l.materials },
  INTRO_TEACHER:  { kind: "text", label: "Introduction — Teacher",   extract: l => l.introduction.teacherActions },
  INTRO_STUDENTS: { kind: "text", label: "Introduction — Students",  extract: l => l.introduction.studentActions },
  MAIN_TEACHER:   { kind: "text", label: "Main Activity — Teacher",  extract: l => l.mainLearningActivities.teacherActions },
  MAIN_STUDENTS:  { kind: "text", label: "Main Activity — Students", extract: l => l.mainLearningActivities.studentActions },
  CLOSURE:        { kind: "text", label: "Closure",                 extract: l => `${l.closure.teacherActions}\n\n${l.closure.studentActions}` },
  ASSESSMENT:     { kind: "text", label: "Assessment",               extract: l => l.assessment.howObjectivesAssessed },
};

export const KNOWN_PLACEHOLDER_TOKENS = Object.keys(PLACEHOLDER_CATALOG);
