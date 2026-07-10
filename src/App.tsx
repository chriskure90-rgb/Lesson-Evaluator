import { useState, useRef, useEffect } from "react";
import "./index.css";
import { supabase } from "./lib/supabase";
import { ExportDropdown } from "./components/ExportDropdown";
import { slugifyFilename, type ExportDocument } from "./lib/export";
import { buildTemplate1LessonDocx } from "./lib/template1-docx";
import { TemplateRenderer } from "./components/lesson-templates/TemplateRenderer";
import { Icon } from "./components/Icon";
import {
  fetchCustomTemplates,
  uploadCustomTemplateFile,
  registerCustomTemplate,
  renameCustomTemplate,
  deleteCustomTemplate,
  exportCustomTemplateLessonDocx,
  type CustomTemplate,
} from "./lib/custom-templates";
import {
  fetchTeachingStrategies,
  resolveTeachingStrategyNames,
  TEACHING_STRATEGY_CATEGORY_LABELS,
  type TeachingStrategy,
} from "./data/teachingStrategies";

/* ════════════════════════════════════════════════════════════
   TYPES
════════════════════════════════════════════════════════════ */

type Page = "login" | "generator" | "evaluator" | "library";

export type Activity = { name: string; minutes: number; detail: string };

export type Lesson = {
  title: string;
  objectives: string[];
  standards_alignment?: string; // optional — present when a standard code was matched
  materials: string[];
  activities: Activity[];
  assessment: string;
  differentiation?: string;
};

type LessonMeta = { model: string; grade: string; standards: string; duration: number };

// ── Template 1 (PSU/GTEP-style) lesson plan ───────────────────────────────────
// A completely separate data shape from Lesson — Template 1 is not "Standard
// lesson content re-styled", it's a structurally different lesson plan
// format (teacher/student action pairs per phase, differentiation folded
// into specific phases). The web preview, edit form, and DOCX export all
// read this shape directly; nothing adapts Lesson into it or vice versa.
export type Template1TeacherStudentPhase = {
  teacherActions: string;
  studentActions: string;
  studentSupport: string;
};

export type Template1ClosurePhase = {
  teacherActions: string;
  studentActions: string;
};

export type Template1Lesson = {
  lessonTitle: string;
  teacherName: string;         // always "" — no such input exists in this app
  subjectGradeLevel: string;   // derived from the form's subject + grade, not the model
  lessonDuration: string;      // derived from the form's duration, not the model
  centralFocus: string;
  standardsAddressed: string;
  lessonObjectives: string[];
  materials: string[];
  introduction: Template1TeacherStudentPhase;
  mainLearningActivities: Template1TeacherStudentPhase;
  closure: Template1ClosurePhase;
  assessment: { howObjectivesAssessed: string };
};

// Coerces a raw /api/generate response (Template 1 format) into a safe
// Template1Lesson. subjectGradeLevel/lessonDuration/teacherName are always
// set from known local values, never trusted from the model, since the
// model has no reliable source for them (avoids hallucinated metadata).
function normaliseTemplate1Lesson(
  raw: unknown,
  meta: { subject: string; gradeLabel: string; duration: number }
): Template1Lesson {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ensureArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const ensureStr = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.filter(Boolean).join(" ");
    return "";
  };
  const ensurePhase = (v: unknown): Template1TeacherStudentPhase => {
    const s = (v ?? {}) as Record<string, unknown>;
    return {
      teacherActions: ensureStr(s.teacherActions),
      studentActions: ensureStr(s.studentActions),
      studentSupport: ensureStr(s.studentSupport),
    };
  };
  const ensureClosure = (v: unknown): Template1ClosurePhase => {
    const s = (v ?? {}) as Record<string, unknown>;
    return {
      teacherActions: ensureStr(s.teacherActions),
      studentActions: ensureStr(s.studentActions),
    };
  };
  const assessmentRaw = (r.assessment ?? {}) as Record<string, unknown>;

  return {
    lessonTitle: ensureStr(r.lessonTitle),
    teacherName: "",
    subjectGradeLevel: `${meta.subject} — Grade ${meta.gradeLabel}`,
    lessonDuration: `${meta.duration} minutes`,
    centralFocus: ensureStr(r.centralFocus),
    standardsAddressed: ensureStr(r.standardsAddressed),
    lessonObjectives: ensureArr(r.lessonObjectives).map(ensureStr),
    materials: ensureArr(r.materials).map(ensureStr),
    introduction: ensurePhase(r.introduction),
    mainLearningActivities: ensurePhase(r.mainLearningActivities),
    closure: ensureClosure(r.closure),
    assessment: { howObjectivesAssessed: ensureStr(assessmentRaw.howObjectivesAssessed) },
  };
}

// Converts a Template1Lesson into the generic ExportDocument shape for the
// PDF/Text export options (DOCX uses buildTemplate1LessonDocx directly instead).
function buildTemplate1ExportDocument(lesson: Template1Lesson): ExportDocument {
  return {
    title: lesson.lessonTitle || "Lesson Plan",
    meta: [lesson.subjectGradeLevel, lesson.lessonDuration].filter(Boolean).join(" · "),
    sections: [
      { heading: "Central Focus of Lesson", paragraphs: [lesson.centralFocus || "Not specified."] },
      { heading: "Standard(s) Addressed", paragraphs: [lesson.standardsAddressed || "Not specified."] },
      { heading: "Lesson Objectives", bullets: lesson.lessonObjectives },
      { heading: "Materials", bullets: lesson.materials },
      {
        heading: "Introduction",
        paragraphs: [
          `Teacher: ${lesson.introduction.teacherActions}`,
          `Students: ${lesson.introduction.studentActions}`,
          `Student Support: ${lesson.introduction.studentSupport}`,
        ],
      },
      {
        heading: "Main Learning Activities",
        paragraphs: [
          `Teacher: ${lesson.mainLearningActivities.teacherActions}`,
          `Students: ${lesson.mainLearningActivities.studentActions}`,
          `Student Support: ${lesson.mainLearningActivities.studentSupport}`,
        ],
      },
      {
        heading: "Closure",
        paragraphs: [
          `Teacher: ${lesson.closure.teacherActions}`,
          `Students: ${lesson.closure.studentActions}`,
        ],
      },
      { heading: "How will you assess the objectives?", paragraphs: [lesson.assessment.howObjectivesAssessed || "Not specified."] },
    ],
  };
}

/**
 * Coerce a raw API response into a safe Lesson.
 * Guarantees every array field is actually an array, and every string field
 * is a string, so .map() calls in JSX can never throw.
 */
function normaliseLesson(raw: unknown): Lesson {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ensureArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  // ensureStr: handles both plain strings AND arrays (Mistral sometimes returns
  // assessment/differentiation as string[] even when prompted for a string).
  // Fix 4: join arrays into a single readable string instead of returning "".
  const ensureStr = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (Array.isArray(v))      return v.filter(Boolean).join(" ");
    return "";
  };

  const rawActivities = ensureArr(r.activities);
  const activities: Activity[] = rawActivities.map((a) => {
    const act = (a ?? {}) as Record<string, unknown>;

    // Fix 3 (belt-and-suspenders): accept both the correct schema (name/minutes/detail)
    // AND the old schema (title/time/description) in case an older response slips through.
    const name   = ensureStr(act.name   ?? act.title);
    const detail = ensureStr(act.detail ?? act.description);
    const rawMin = act.minutes ?? act.time;
    const minutes = typeof rawMin === "number"
      ? rawMin
      : typeof rawMin === "string"
        ? parseInt(rawMin, 10) || 0
        : 0;

    return { name, minutes, detail };
  });

  const lesson: Lesson = {
    title:      ensureStr(r.title),
    objectives: ensureArr(r.objectives).map(ensureStr),
    materials:  ensureArr(r.materials).map(ensureStr),
    activities,
    assessment: ensureStr(r.assessment),
  };

  if (r.standards_alignment !== undefined) {
    lesson.standards_alignment = ensureStr(r.standards_alignment);
  }
  if (r.differentiation !== undefined) {
    lesson.differentiation = ensureStr(r.differentiation);
  }

  console.debug("[normaliseLesson] result:", JSON.stringify(lesson, null, 2));
  return lesson;
}

// Converts a Lesson into the generic ExportDocument shape shared by the
// .docx/.pdf/.txt converters in lib/export.ts.
function buildLessonExportDocument(lesson: Lesson, meta: string): ExportDocument {
  const sections: ExportDocument["sections"] = [
    { heading: "Learning Objectives", bullets: lesson.objectives ?? [] },
  ];

  if (lesson.standards_alignment) {
    sections.push({ heading: "Standards Alignment", paragraphs: [lesson.standards_alignment] });
  }

  sections.push({ heading: "Materials", bullets: lesson.materials ?? [] });

  sections.push({
    heading: "Activities",
    bullets: (lesson.activities ?? []).map((a) => `${a.name} (${a.minutes} min) — ${a.detail}`),
  });

  sections.push({ heading: "Assessment", paragraphs: [lesson.assessment || "Not specified."] });

  if (lesson.differentiation) {
    sections.push({ heading: "Differentiation", paragraphs: [lesson.differentiation] });
  }

  return { title: lesson.title || "Lesson Plan", meta, sections };
}

/* ════════════════════════════════════════════════════════════
   API
════════════════════════════════════════════════════════════ */

/* ── API helpers ─────────────────────────────────────────────────────────────
   Both functions call your backend routes, not the Anthropic API directly.
   The backend is responsible for auth, prompt engineering, and parsing.
────────────────────────────────────────────────────────────────────────────── */

async function generateLesson(params: {
  grade: string;
  subject: string;
  frameworks: string[];
  code: string;
  topic: string;
  goal: string;
  duration: number;
  model: string;
  technologyUsage: TechnologyUsageLevel;
  technologyTools: string[];
  instructionalApproach: InstructionalApproach;
  teachingStrategies: string[];
}): Promise<Lesson> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, lessonFormat: "standard" }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  const raw = await res.json();
  return normaliseLesson(raw);
}

// Same /api/generate endpoint, different output schema — see
// buildTemplate1Prompt in api/generate.js. subjectLabel/gradeLabel/duration
// are used to fill in subjectGradeLevel/lessonDuration client-side (the
// model is never asked for them).
async function generateTemplate1Lesson(params: {
  grade: string;
  subject: string;
  frameworks: string[];
  code: string;
  topic: string;
  goal: string;
  duration: number;
  model: string;
  technologyUsage: TechnologyUsageLevel;
  technologyTools: string[];
  instructionalApproach: InstructionalApproach;
  teachingStrategies: string[];
  subjectLabel: string;
  gradeLabel: string;
}): Promise<Template1Lesson> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, lessonFormat: "template1" }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  const raw = await res.json();
  return normaliseTemplate1Lesson(raw, { subject: params.subjectLabel, gradeLabel: params.gradeLabel, duration: params.duration });
}

// Result shape returned by /api/upload-standards-process.
type UploadSummary = { total: number; embedded: number; skipped: number; failed: number };

/* ── Custom standards upload ──────────────────────────────────────────────────
   Split into two calls (same two endpoints as before — just split out here so
   the UI can show distinct "Uploading…" vs "Processing…" states):
     1. Ask the backend for a signed Supabase Storage upload URL, then PUT the
        file straight into Storage using it (never routes the raw bytes
        through a Vercel serverless function, which caps bodies at ~4.5MB).
     2. Ask the backend to download it from Storage, extract/chunk/embed the
        text, and insert it into `standards` (framework="Custom").
────────────────────────────────────────────────────────────────────────────── */
async function uploadFileToStorage(file: File): Promise<{ path: string }> {
  const initRes = await fetch("/api/upload-standards-init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || "Could not prepare upload.");

  const { error: storageError } = await supabase.storage
    .from("standards-uploads")
    .uploadToSignedUrl(initData.path, initData.token, file);
  if (storageError) throw new Error(storageError.message);

  return { path: initData.path as string };
}

async function processUploadedStandards(path: string, filename: string): Promise<UploadSummary> {
  const processRes = await fetch("/api/upload-standards-process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, filename }),
  });
  const processData = await processRes.json();
  if (!processRes.ok) throw new Error(processData.error || "Upload processing failed.");

  return processData as UploadSummary;
}

// Shape returned by /api/evaluate
type RubricRating = "high" | "medium" | "low";

const RATING_META: Record<RubricRating, { label: string; cat: "strong" | "amber" | "weak" }> = {
  high:   { label: "High",   cat: "strong" },
  medium: { label: "Medium", cat: "amber"  },
  low:    { label: "Low",    cat: "weak"   },
};

type EvaluationSection = {
  id: string;
  title: string;
  rating: RubricRating;
  feedback: string;    // AI-written feedback for this section
};

type EvaluationResult = {
  band: string;
  summary: string;
  sections: EvaluationSection[];
};

// Converts the currently displayed evaluation (real or demo/placeholder) into
// the generic ExportDocument shape shared by the .docx/.pdf/.txt converters.
function buildEvaluationExportDocument(
  title: string,
  meta: string,
  readiness: { status: string; totalScore: number; maxScore: number; lowCount: number },
  summary: string,
  sections: EvaluationSection[],
  activeRatings: RubricRating[],
  notes: Record<string, string>
): ExportDocument {
  const overviewParagraphs = [
    `Readiness: ${readiness.status} — ${readiness.totalScore}/${readiness.maxScore} points, ${readiness.lowCount} low rating(s).`,
  ];
  if (summary) overviewParagraphs.push(summary);

  const exportSections: ExportDocument["sections"] = [
    { heading: "Overview", paragraphs: overviewParagraphs },
  ];

  sections.forEach((s, i) => {
    const rating = activeRatings[i] ?? s.rating;
    const paragraphs = [s.feedback];
    const note = notes[s.id];
    if (note && note.trim()) paragraphs.push(`Teacher notes: ${note.trim()}`);
    exportSections.push({
      heading: `${s.title} — ${RATING_META[rating]?.label ?? rating}`,
      paragraphs,
    });
  });

  return { title: title || "Lesson Evaluation", meta, sections: exportSections };
}

// templateType tells the backend which field names to read when building the
// evaluation prompt ("standard" reads title/objectives/activities/etc.,
// "template1" reads centralFocus/lessonObjectives/introduction.teacherActions/
// etc. — see buildEvaluationPrompt in api/evaluate.js). lessonData is passed
// through as-is either way; it is never converted between formats.
async function evaluateLessonData(lessonData: Lesson | Template1Lesson, templateType: "standard" | "template1"): Promise<EvaluationResult> {
  const res = await fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lesson: lessonData, templateType }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  return res.json() as Promise<EvaluationResult>;
}

/* ── Profile helpers ─────────────────────────────────────────────────────────
   Loads the profiles row for the given user.
   If none exists yet (e.g. email-confirmed signup), creates one first.
────────────────────────────────────────────────────────────────────────────── */
type UserProfile = { id: number; user_id: string; email: string; created_at: string };

async function loadOrCreateProfile(userId: string, email: string): Promise<UserProfile | null> {
  // Try to load an existing profile
  const { data: existing } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existing) return existing as UserProfile;

  // No profile yet — create one (handles email-confirmed signups on first login)
  const { data: created } = await supabase
    .from("profiles")
    .insert({ user_id: userId, email })
    .select()
    .single();

  return (created as UserProfile) ?? null;
}

/* ── Audit log helpers ───────────────────────────────────────────────────────
   Fire-and-forget inserts into generator_log / evaluator_log.

   Run the SQL below once in the Supabase SQL editor to create both tables.

   ── generator_log ─────────────────────────────────────────────────────────
   CREATE TABLE generator_log (
     id             BIGSERIAL    PRIMARY KEY,
     lesson_id      BIGINT       REFERENCES lesson_generation(id) ON DELETE SET NULL,
     user_id        UUID         REFERENCES auth.users(id)        ON DELETE SET NULL,
     action_type    TEXT         NOT NULL,
     previous_data  JSONB,
     new_data       JSONB,
     changed_fields JSONB,
     api_model      TEXT,
     note           TEXT,
     created_at     TIMESTAMPTZ  DEFAULT NOW()
   );
   ALTER TABLE generator_log ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users manage own generator logs"
     ON generator_log FOR ALL USING (auth.uid() = user_id);

   ── evaluator_log ─────────────────────────────────────────────────────────
   CREATE TABLE evaluator_log (
     id                   BIGSERIAL    PRIMARY KEY,
     evaluation_id        BIGINT       REFERENCES lesson_evaluations(id) ON DELETE SET NULL,
     lesson_id            BIGINT       REFERENCES lesson_generation(id)  ON DELETE SET NULL,
     user_id              UUID         REFERENCES auth.users(id)         ON DELETE SET NULL,
     action_type          TEXT         NOT NULL,
     previous_rubric_json JSONB,
     new_rubric_json      JSONB,
     previous_notes_json  JSONB,
     new_notes_json       JSONB,
     previous_status      TEXT,
     new_status           TEXT,
     previous_score       INTEGER,
     new_score            INTEGER,
     created_at           TIMESTAMPTZ  DEFAULT NOW()
   );
   ALTER TABLE evaluator_log ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users manage own evaluator logs"
     ON evaluator_log FOR ALL USING (auth.uid() = user_id);
   ─────────────────────────────────────────────────────── */

type GeneratorActionType = "lesson_created" | "lesson_edited" | "lesson_regenerated";
type EvaluatorActionType = "evaluation_confirmed";

async function logGeneratorAction(entry: {
  lesson_id: number | null;
  user_id: string;
  action_type: GeneratorActionType;
  previous_data?: unknown;
  new_data?: unknown;
  changed_fields?: unknown;
  api_model?: string;
  note?: string;
}): Promise<void> {
  console.debug("[generation_logs] inserting:", entry.action_type, "lesson_id:", entry.lesson_id);
  const { error } = await supabase.from("generation_logs").insert([entry]);
  if (error) console.error("[generation_logs] insert failed:", error.message, error);
}

async function logEvaluatorAction(entry: {
  evaluation_id?: number | null;
  lesson_id: number | null;
  user_id: string;
  action_type: EvaluatorActionType;
  previous_rubric_json?: unknown;
  new_rubric_json?: unknown;
  previous_notes_json?: unknown;
  new_notes_json?: unknown;
  previous_status?: string | null;
  new_status?: string;
  previous_score?: number | null;
  new_score?: number;
}): Promise<void> {
  console.debug("[evaluation_logs] inserting:", entry.action_type, "lesson_id:", entry.lesson_id, "eval_id:", entry.evaluation_id);
  const { error } = await supabase.from("evaluation_logs").insert([entry]);
  if (error) console.error("[evaluation_logs] insert failed:", error.message, error);
}

function diffLessonFields(prev: Lesson, next: Lesson): string[] {
  return (Object.keys(next) as (keyof Lesson)[]).filter(
    k => JSON.stringify(prev[k]) !== JSON.stringify(next[k])
  );
}

/* Icon moved to ./components/Icon.tsx (imported above) — Fast Refresh
   breaks when a file exports both components and non-component values
   (Icon is a plain object, not a component). Import it from
   "./components/Icon" directly rather than re-exporting it here. */

/* ════════════════════════════════════════════════════════════
   PRIMITIVES
════════════════════════════════════════════════════════════ */

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function FieldLabel({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <div className="field-label-row">
      <label className="field-label" htmlFor={htmlFor}>{children}</label>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** One labeled category inside a collapsible options panel (e.g. the
 *  "Advanced Lesson Options" panel on GeneratorPage) — each future category
 *  (Technology Integration, Teaching Strategies, ...) is just another one
 *  of these, so adding one is a new sibling, not a layout change. */
function AdvancedOptionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="drawer-eyebrow" style={{ marginBottom: 10 }}>{title}</p>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

/** Animated accordion item */
export function AccordionItem({
  title,
  defaultOpen = false,
  children,
  right,
  isLast = false,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  right?: React.ReactNode;
  isLast?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">(defaultOpen ? "auto" : 0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (open) {
      const scrollH = el.scrollHeight;
      setHeight(scrollH);
      const timer = setTimeout(() => setHeight("auto"), 220);
      return () => clearTimeout(timer);
    } else {
      setHeight(el.scrollHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
    }
  }, [open]);

  return (
    <div className="accordion-item" style={isLast ? { borderBottom: "none" } : undefined}>
      <button
        type="button"
        className="accordion-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{title}</span>
          {right}
        </div>
        <span className={`accordion-chevron${open ? " open" : ""}`}>
          <Icon.Chevron />
        </span>
      </button>

      <div
        ref={bodyRef}
        className="accordion-body"
        style={{
          height: height === "auto" ? "auto" : `${height}px`,
          transition: "height 200ms ease",
          overflow: height === "auto" ? "visible" : "hidden",
        }}
      >
        <div className="accordion-content">{children}</div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   TEMPLATE 1 (PSU/GTEP-style) LESSON PLAN — EDIT FORM
   The read-only view lives in src/components/lesson-templates/
   Template1LessonView.tsx (shared by Generate/Evaluate/Library via
   TemplateRenderer) — only the Generate-specific edit form stays here.
════════════════════════════════════════════════════════════ */

export function Template1EditForm({
  draft,
  setField,
  setPhaseField,
  setClosureField,
  updateObjective,
  removeObjective,
  addObjective,
  updateMaterial,
  removeMaterial,
  addMaterial,
  onCancel,
  onSave,
}: {
  draft: Template1Lesson;
  setField: <K extends keyof Template1Lesson>(key: K, value: Template1Lesson[K]) => void;
  setPhaseField: (phase: "introduction" | "mainLearningActivities", field: keyof Template1TeacherStudentPhase, value: string) => void;
  setClosureField: (field: keyof Template1ClosurePhase, value: string) => void;
  updateObjective: (i: number, v: string) => void;
  removeObjective: (i: number) => void;
  addObjective: () => void;
  updateMaterial: (i: number, v: string) => void;
  removeMaterial: (i: number) => void;
  addMaterial: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="t1-page">
      <div className="lesson-edit-form">
        <div className="field">
          <FieldLabel>Lesson Title</FieldLabel>
          <input className="input" value={draft.lessonTitle} onChange={e => setField("lessonTitle", e.target.value)} />
        </div>

        <div className="field">
          <FieldLabel>Central Focus of Lesson</FieldLabel>
          <textarea className="textarea" rows={3} value={draft.centralFocus} onChange={e => setField("centralFocus", e.target.value)} />
        </div>

        <div className="field">
          <FieldLabel>Standard(s) Addressed</FieldLabel>
          <textarea className="textarea" rows={2} value={draft.standardsAddressed} onChange={e => setField("standardsAddressed", e.target.value)} />
        </div>

        <div>
          <p className="lesson-edit-section-title">Lesson Objectives</p>
          {draft.lessonObjectives.map((o, i) => (
            <div key={i} className="lesson-edit-item-row">
              <textarea className="textarea" rows={2} value={o} onChange={e => updateObjective(i, e.target.value)} />
              <button type="button" className="lesson-edit-remove-btn" onClick={() => removeObjective(i)} aria-label="Remove objective">×</button>
            </div>
          ))}
          <button type="button" className="lesson-edit-add-btn" onClick={addObjective}>+ Add objective</button>
        </div>

        <div>
          <p className="lesson-edit-section-title">Materials</p>
          {draft.materials.map((m, i) => (
            <div key={i} className="lesson-edit-item-row">
              <input className="input" value={m} onChange={e => updateMaterial(i, e.target.value)} />
              <button type="button" className="lesson-edit-remove-btn" onClick={() => removeMaterial(i)} aria-label="Remove material">×</button>
            </div>
          ))}
          <button type="button" className="lesson-edit-add-btn" onClick={addMaterial}>+ Add material</button>
        </div>

        <div>
          <p className="lesson-edit-section-title">Introduction — Teacher Actions</p>
          <textarea className="textarea" rows={3} value={draft.introduction.teacherActions}
            onChange={e => setPhaseField("introduction", "teacherActions", e.target.value)} />
        </div>
        <div>
          <p className="lesson-edit-section-title">Introduction — Student Actions</p>
          <textarea className="textarea" rows={3} value={draft.introduction.studentActions}
            onChange={e => setPhaseField("introduction", "studentActions", e.target.value)} />
        </div>
        <div>
          <p className="lesson-edit-section-title">Introduction — Student Support</p>
          <textarea className="textarea" rows={2} value={draft.introduction.studentSupport}
            onChange={e => setPhaseField("introduction", "studentSupport", e.target.value)} />
        </div>

        <div>
          <p className="lesson-edit-section-title">Main Learning Activities — Teacher Actions</p>
          <textarea className="textarea" rows={3} value={draft.mainLearningActivities.teacherActions}
            onChange={e => setPhaseField("mainLearningActivities", "teacherActions", e.target.value)} />
        </div>
        <div>
          <p className="lesson-edit-section-title">Main Learning Activities — Student Actions</p>
          <textarea className="textarea" rows={3} value={draft.mainLearningActivities.studentActions}
            onChange={e => setPhaseField("mainLearningActivities", "studentActions", e.target.value)} />
        </div>
        <div>
          <p className="lesson-edit-section-title">Main Learning Activities — Student Support</p>
          <textarea className="textarea" rows={2} value={draft.mainLearningActivities.studentSupport}
            onChange={e => setPhaseField("mainLearningActivities", "studentSupport", e.target.value)} />
        </div>

        <div>
          <p className="lesson-edit-section-title">Closure — Teacher Actions</p>
          <textarea className="textarea" rows={3} value={draft.closure.teacherActions}
            onChange={e => setClosureField("teacherActions", e.target.value)} />
        </div>
        <div>
          <p className="lesson-edit-section-title">Closure — Student Actions</p>
          <textarea className="textarea" rows={3} value={draft.closure.studentActions}
            onChange={e => setClosureField("studentActions", e.target.value)} />
        </div>

        <div>
          <p className="lesson-edit-section-title">Assessment — How Objectives Will Be Assessed</p>
          <textarea className="textarea" rows={3} value={draft.assessment.howObjectivesAssessed}
            onChange={e => setField("assessment", { howObjectivesAssessed: e.target.value })} />
        </div>

        <div className="lesson-edit-actions">
          <button type="button" className="btn-outline-sm" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" style={{ width: "auto", padding: "0 20px", height: 36, fontSize: 13 }} onClick={onSave}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   SIDEBAR
════════════════════════════════════════════════════════════ */

function Sidebar({ page, setPage, userEmail, onLogout }: { page: Page; setPage: (p: Page) => void; userEmail?: string; onLogout: () => void }) {
  const nav = [
    { id: "generator" as Page, label: "Generator", Icon: Icon.Sparkles },
    { id: "evaluator" as Page, label: "Evaluator", Icon: Icon.FileCheck },
    { id: "library"   as Page, label: "Library",   Icon: Icon.Library  },
  ];

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <button className="sidebar-brand" onClick={() => setPage("generator")} type="button">
          <div className="sidebar-icon"><Icon.BookOpen /></div>
          <div className="sidebar-wordmark">
            <div className="sidebar-wordmark-name">LessonAI</div>
            <div className="sidebar-wordmark-sub">Teacher workspace</div>
          </div>
        </button>
      </div>

      <div className="sidebar-nav">
        {nav.map(({ id, label, Icon: NavIcon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-nav-item${page === id ? " active" : ""}`}
            onClick={() => setPage(id)}
          >
            <NavIcon />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">
            {userEmail ? userEmail[0].toUpperCase() : "?"}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="sidebar-user-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {userEmail ?? "Teacher"}
            </div>
          </div>
        </div>
        <button type="button" className="sidebar-logout-btn" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

/* ════════════════════════════════════════════════════════════
   GENERATOR PAGE
════════════════════════════════════════════════════════════ */

const SUBJECTS = ["Science", "Math", "English", "Social Studies"];

const GRADE_BANDS = [
  { value: "K",    label: "K",    hint: "Kindergarten"   },
  { value: "1-2",  label: "1–2",  hint: "1st–2nd grade"  },
  { value: "3-5",  label: "3–5",  hint: "3rd–5th grade"  },
  { value: "6-8",  label: "6–8",  hint: "6th–8th grade"  },
  { value: "9-12", label: "9–12", hint: "9th–12th grade" },
];
const DURATIONS = [30, 45, 60, 90];

const MODELS = [
  { value: "gpt-4",    label: "GPT-4",    hint: "OpenAI"    },
  { value: "claude",   label: "Claude",   hint: "Anthropic" },
  { value: "gemini",   label: "Gemini",   hint: "Google"    },
  { value: "mistral",  label: "Mistral",  hint: "Mistral AI" },
];

const LESSON_FORMATS = [
  { value: "standard",  label: "Standard Lesson Plan" },
  { value: "template1", label: "Template 1"           },
];

const FRAMEWORKS = [
  { value: "ngss", label: "NGSS"         },
  { value: "ccss", label: "Common Core"  },
];

// Specific tools/platforms a lesson might use — a separate concern from
// *how much* the lesson leans on technology overall (TECHNOLOGY_USAGE_LEVELS).
const TECH_TOOLS_OPTIONS = [
  "Chromebooks",
  "iPads / Tablets",
  "Interactive Whiteboard",
  "Google Workspace",
  "Microsoft Office",
  "AI Tools",
  "Simulations / Virtual Labs",
  "LMS / Google Classroom",
  "Video / Multimedia",
  "Educational Apps",
  "Other",
];

// How much the lesson should lean on technology overall. Single-select
// (unlike TECH_TOOLS_OPTIONS, which is multi-select) — sent to the API/prompt
// as "Technology Usage: Low|Medium|High".
type TechnologyUsageLevel = "low" | "medium" | "high";

const TECHNOLOGY_USAGE_LEVELS: { value: TechnologyUsageLevel; label: string }[] = [
  { value: "low",    label: "Low"    },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High"   },
];

const TECHNOLOGY_USAGE_LEVEL_DEFINITIONS: Record<TechnologyUsageLevel, string> = {
  low:    "Technology plays a minimal supporting role in the lesson.",
  medium: "Technology is used regularly to support instruction and learning activities.",
  high:   "Technology is a central component throughout the lesson.",
};

// Who drives the lesson's instruction. Single-select — sent to the API/prompt
// as "Instructional Approach: Teacher-Centered|Balanced|Student-Centered".
type InstructionalApproach = "teacher-centered" | "balanced" | "student-centered";

const INSTRUCTIONAL_APPROACH_OPTIONS: { value: InstructionalApproach; label: string }[] = [
  { value: "teacher-centered", label: "Teacher-Centered" },
  { value: "balanced",         label: "Balanced"         },
  { value: "student-centered", label: "Student-Centered" },
];

const INSTRUCTIONAL_APPROACH_DEFINITIONS: Record<InstructionalApproach, string> = {
  "teacher-centered": "The lesson is primarily led by the teacher through direct instruction, modeling, and guided practice.",
  "balanced":         "The lesson combines teacher instruction with collaborative and independent student activities.",
  "student-centered": "The lesson emphasizes student inquiry, collaboration, discussion, problem-solving, and active learning, with the teacher acting mainly as a facilitator.",
};

/** Renders the Literacy/Numeracy chip picker from whatever TeachingStrategy[]
 *  it's given — it has no knowledge of where that list came from (today, a
 *  local constant via fetchTeachingStrategies(); later, potentially a
 *  Supabase table), so swapping the source doesn't touch this component. */
function TeachingStrategiesPicker({
  strategies,
  selectedIds,
  onToggle,
}: {
  strategies: TeachingStrategy[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const categories = Array.from(new Set(strategies.map((s) => s.category)));
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {categories.map((cat, i) => (
        <AccordionItem
          key={cat}
          title={TEACHING_STRATEGY_CATEGORY_LABELS[cat]}
          defaultOpen
          isLast={i === categories.length - 1}
        >
          <div className="fw-chip-row">
            {strategies.filter((s) => s.category === cat).map((s) => {
              const active = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`fw-chip${active ? " fw-chip-active" : ""}`}
                  onClick={() => onToggle(s.id)}
                  aria-pressed={active}
                  title={s.description}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </AccordionItem>
      ))}
    </div>
  );
}

function GeneratorPage({
  sharedLesson,
  sharedTemplate1Lesson,
  sharedCustomTemplateId,
  onLessonGenerated,
  onTemplate1LessonGenerated,
  onCustomTemplateSelected,
  onLessonSaved,
  onLessonMetaGenerated,
  onEvaluateLesson,
  lessonId,
  userId,
}: {
  sharedLesson: Lesson | null;
  sharedTemplate1Lesson: Template1Lesson | null;
  sharedCustomTemplateId: string | null;
  onLessonGenerated: (l: Lesson) => void;
  onTemplate1LessonGenerated: (l: Template1Lesson) => void;
  onCustomTemplateSelected: (id: string | null) => void;
  onLessonSaved: (id: number) => void;
  onLessonMetaGenerated?: (meta: LessonMeta) => void;
  onEvaluateLesson: () => void;
  lessonId?: number | null;
  userId: string;
}) {
  // Standards: single selected framework id
  const [framework, setFramework]     = useState("ngss");
  const [lessonFormat, setLessonFormat] = useState("standard");
  const [model, setModel]             = useState("claude");
  const [grade, setGrade]             = useState("6-8");
  const [subject, setSubject]         = useState("Science");
  const [code, setCode]               = useState("MS-LS1-6");
  const [topic, setTopic]             = useState("");
  const [goal, setGoal]               = useState("Help students understand how plants produce energy through photosynthesis.");
  const [duration, setDuration]       = useState(60);
  const [technologyUsage, setTechnologyUsage] = useState<TechnologyUsageLevel>("medium");
  const [technologyTools, setTechnologyTools] = useState<string[]>([]);
  const [instructionalApproach, setInstructionalApproach] = useState<InstructionalApproach>("balanced");
  const [teachingStrategyCatalog, setTeachingStrategyCatalog] = useState<TeachingStrategy[]>([]);
  const [selectedStrategyIds, setSelectedStrategyIds]         = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchTeachingStrategies()
      .then((data) => { if (!cancelled) setTeachingStrategyCatalog(data); })
      .catch((err) => console.error("[teaching_strategies] fetch error:", err));
    return () => { cancelled = true; };
  }, []);
  const [loading, setLoading]         = useState(false);
  const [lesson, setLesson]           = useState<Lesson | null>(sharedLesson);
  const [error, setError]             = useState<string | null>(null);
  const [editing, setEditing]         = useState(false);
  const [draft, setDraft]             = useState<Lesson | null>(null);

  // Template 1 (PSU/GTEP-style) has its own data shape entirely — tracked
  // separately from `lesson`/`draft`. `generatedFormat` records which format
  // actually produced the currently-displayed content, independent of the
  // live `lessonFormat` selector (so flipping the selector after generating
  // doesn't change what's displayed until the user regenerates).
  //
  // "custom" (a teacher's own uploaded DOCX template) reuses this exact same
  // Template1Lesson content/state — it's only a different export skin, see
  // api/custom-template-export.js — so it's disambiguated from "template1"
  // by whether a customTemplateId is also selected.
  const [generatedFormat, setGeneratedFormat] = useState<"standard" | "template1" | "custom" | null>(
    sharedTemplate1Lesson ? (sharedCustomTemplateId ? "custom" : "template1") : sharedLesson ? "standard" : null
  );
  const [template1Lesson, setTemplate1Lesson] = useState<Template1Lesson | null>(sharedTemplate1Lesson);
  const [template1Draft, setTemplate1Draft]   = useState<Template1Lesson | null>(null);

  // Teacher's own uploaded DOCX templates. Holds every status (the "Manage
  // Templates" modal needs to show processing/error ones too) — the format
  // selector below only lists the "ready" subset via readyCustomTemplates.
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [selectedCustomTemplateId, setSelectedCustomTemplateId] = useState<string | null>(sharedCustomTemplateId);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCustomTemplates(userId)
      .then((data) => { if (!cancelled) setCustomTemplates(data); })
      .catch((err) => console.error("[custom_templates] fetch error:", err));
    return () => { cancelled = true; };
  }, [userId]);

  const readyCustomTemplates = customTemplates.filter((t) => t.status === "ready");

  // Called by the modal whenever it uploads/renames/deletes a template, so
  // the format-selector chips update immediately without a page refresh.
  function handleCustomTemplatesChange(updated: CustomTemplate[]) {
    setCustomTemplates(updated);
    if (selectedCustomTemplateId && !updated.some((t) => t.id === selectedCustomTemplateId && t.status === "ready")) {
      setSelectedCustomTemplateId(null);
      setLessonFormat((prev) => (prev === "custom" ? "standard" : prev));
    }
  }

  // Custom standards upload (PDF/DOCX)
  const [uploadStatus, setUploadStatus]   = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle");
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUploadFile(file: File) {
    setUploadFileName(file.name);
    setUploadError(null);
    setUploadSummary(null);
    setUploadStatus("uploading");
    try {
      const { path } = await uploadFileToStorage(file);
      setUploadStatus("processing");
      const summary = await processUploadedStandards(path, file.name);
      setUploadSummary(summary);
      setUploadStatus("success");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setUploadStatus("error");
    }
  }

  // ── Edit helpers ──────────────────────────────────────────
  function handleStartEdit() {
    if (!lesson) return;
    setDraft(JSON.parse(JSON.stringify(lesson)));
    setEditing(true);
  }
  function handleCancelEdit() { setEditing(false); setDraft(null); }
  function handleSaveEdit() {
    if (!draft) return;
    const savedDraft     = draft;      // capture before state changes
    const previousLesson = lesson;     // capture before state changes
    setLesson(savedDraft);
    onLessonGenerated(savedDraft);
    setEditing(false);
    setDraft(null);
    // Persist the edited lesson_json to Supabase and log the change (fire-and-forget)
    if (lessonId != null) {
      const lid = lessonId;
      supabase
        .from("lesson_generation")
        .update({ lesson_json: savedDraft })
        .eq("id", lid)
        .then(({ error }) => {
          if (error) { console.error("[lesson_generation] update:", error); return; }
          logGeneratorAction({
            lesson_id:      lid,
            user_id:        userId,
            action_type:    "lesson_edited",
            previous_data:  previousLesson,
            new_data:       savedDraft,
            changed_fields: previousLesson ? diffLessonFields(previousLesson, savedDraft) : [],
          });
        });
    }
  }
  function setDraftField<K extends keyof Lesson>(key: K, value: Lesson[K]) {
    setDraft(prev => prev ? { ...prev, [key]: value } : prev);
  }
  function updateObjective(i: number, v: string) {
    setDraft(prev => { if (!prev) return prev; const a = [...prev.objectives]; a[i] = v; return { ...prev, objectives: a }; });
  }
  function removeObjective(i: number) {
    setDraft(prev => prev ? { ...prev, objectives: prev.objectives.filter((_, j) => j !== i) } : prev);
  }
  function addObjective() {
    setDraft(prev => prev ? { ...prev, objectives: [...prev.objectives, ""] } : prev);
  }
  function updateMaterial(i: number, v: string) {
    setDraft(prev => { if (!prev) return prev; const a = [...prev.materials]; a[i] = v; return { ...prev, materials: a }; });
  }
  function removeMaterial(i: number) {
    setDraft(prev => prev ? { ...prev, materials: prev.materials.filter((_, j) => j !== i) } : prev);
  }
  function addMaterial() {
    setDraft(prev => prev ? { ...prev, materials: [...prev.materials, ""] } : prev);
  }
  function updateActivity(i: number, field: keyof Activity, value: string | number) {
    setDraft(prev => { if (!prev) return prev; const a = [...prev.activities]; a[i] = { ...a[i], [field]: value }; return { ...prev, activities: a }; });
  }
  function removeActivity(i: number) {
    setDraft(prev => prev ? { ...prev, activities: prev.activities.filter((_, j) => j !== i) } : prev);
  }
  function addActivity() {
    setDraft(prev => prev ? { ...prev, activities: [...prev.activities, { name: "", minutes: 10, detail: "" }] } : prev);
  }

  // ── Template 1 edit helpers ────────────────────────────────
  function handleStartTemplate1Edit() {
    if (!template1Lesson) return;
    setTemplate1Draft(JSON.parse(JSON.stringify(template1Lesson)));
    setEditing(true);
  }
  function handleCancelTemplate1Edit() { setEditing(false); setTemplate1Draft(null); }
  function handleSaveTemplate1Edit() {
    if (!template1Draft) return;
    const savedDraft = template1Draft;
    setTemplate1Lesson(savedDraft);
    setEditing(false);
    setTemplate1Draft(null);
    if (lessonId != null) {
      const lid = lessonId;
      supabase
        .from("lesson_generation")
        .update({ lesson_json: savedDraft })
        .eq("id", lid)
        .then(({ error }) => {
          if (error) { console.error("[lesson_generation] update:", error); return; }
          logGeneratorAction({
            lesson_id:      lid,
            user_id:        userId,
            action_type:    "lesson_edited",
            previous_data:  template1Lesson,
            new_data:       savedDraft,
            changed_fields: [],
          });
        });
    }
  }
  function setTemplate1Field<K extends keyof Template1Lesson>(key: K, value: Template1Lesson[K]) {
    setTemplate1Draft(prev => prev ? { ...prev, [key]: value } : prev);
  }
  function setTemplate1PhaseField<P extends "introduction" | "mainLearningActivities">(
    phase: P, field: keyof Template1TeacherStudentPhase, value: string
  ) {
    setTemplate1Draft(prev => prev ? { ...prev, [phase]: { ...prev[phase], [field]: value } } : prev);
  }
  function setTemplate1ClosureField(field: keyof Template1ClosurePhase, value: string) {
    setTemplate1Draft(prev => prev ? { ...prev, closure: { ...prev.closure, [field]: value } } : prev);
  }
  function updateTemplate1Objective(i: number, v: string) {
    setTemplate1Draft(prev => { if (!prev) return prev; const a = [...prev.lessonObjectives]; a[i] = v; return { ...prev, lessonObjectives: a }; });
  }
  function removeTemplate1Objective(i: number) {
    setTemplate1Draft(prev => prev ? { ...prev, lessonObjectives: prev.lessonObjectives.filter((_, j) => j !== i) } : prev);
  }
  function addTemplate1Objective() {
    setTemplate1Draft(prev => prev ? { ...prev, lessonObjectives: [...prev.lessonObjectives, ""] } : prev);
  }
  function updateTemplate1Material(i: number, v: string) {
    setTemplate1Draft(prev => { if (!prev) return prev; const a = [...prev.materials]; a[i] = v; return { ...prev, materials: a }; });
  }
  function removeTemplate1Material(i: number) {
    setTemplate1Draft(prev => prev ? { ...prev, materials: prev.materials.filter((_, j) => j !== i) } : prev);
  }
  function addTemplate1Material() {
    setTemplate1Draft(prev => prev ? { ...prev, materials: [...prev.materials, ""] } : prev);
  }

  const CUSTOM_ID = "custom";
  const hasCustom = framework === CUSTOM_ID;

  /** Resolved label(s) sent to the API and shown in the breadcrumb */
  function resolvedFrameworks(): string[] {
    if (framework === CUSTOM_ID) return ["Custom"];
    return [FRAMEWORKS.find((f) => f.value === framework)?.label ?? framework];
  }

  function toggleTechnologyTool(option: string) {
    setTechnologyTools((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  }

  function toggleTeachingStrategy(id: string) {
    setSelectedStrategyIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleGenerate() {
    // "custom" reuses the identical Template1 generation branch below — a
    // custom template is only a different DOCX export skin over the same
    // Template1Lesson content, never its own generation schema.
    if (lessonFormat === "custom" && !selectedCustomTemplateId) {
      setError("Please select one of your uploaded templates first.");
      return;
    }

    setLoading(true);
    setError(null);
    // The picker tracks selection by id (stable even if a strategy's display
    // name changes); the API/prompt only cares about human-readable names.
    const teachingStrategies = resolveTeachingStrategyNames(selectedStrategyIds);
    try {
      if (lessonFormat === "template1" || lessonFormat === "custom") {
        const isCustom = lessonFormat === "custom";
        const previousTemplate1Lesson = template1Lesson;
        const result = await generateTemplate1Lesson({
          grade, subject, frameworks: resolvedFrameworks(), code, topic, goal, duration, model,
          technologyUsage, technologyTools, instructionalApproach, teachingStrategies,
          subjectLabel: subject,
          gradeLabel: gradeBandLabel.replace(/^Grades\s*/, ""),
        });
        setTemplate1Lesson(result);
        setGeneratedFormat(isCustom ? "custom" : "template1");
        onTemplate1LessonGenerated(result);   // share with the Evaluator
        onCustomTemplateSelected(isCustom ? selectedCustomTemplateId : null);
        onLessonMetaGenerated?.({ model, grade, standards: resolvedFrameworks().join(", "), duration });

        const insertPayload = {
          template_type:       isCustom ? "custom" : "template1",
          custom_template_id:  isCustom ? selectedCustomTemplateId : null,
          lesson_topic:        topic,
          api_model:           model,
          grade_level:         String(grade),
          subject:             subject,
          standards_framework: resolvedFrameworks().join(", "),
          standard_code:       code,
          lesson_goal:         goal,
          duration:            String(duration),
          lesson_json:         result,
          is_demo:             false,
          user_id:             userId,
        };

        const { data: savedLesson, error: saveError } = await supabase
          .from("lesson_generation")
          .insert([insertPayload])
          .select("id")
          .single();

        if (saveError) {
          console.error("[Supabase] lesson_generation insert error:", saveError);
        } else if (!savedLesson?.id) {
          console.warn("[Supabase] lesson_generation insert returned no id. Possible RLS block.");
        } else {
          console.debug("[Supabase] lesson_generation saved, id:", savedLesson.id);
          onLessonSaved(savedLesson.id);
          logGeneratorAction({
            lesson_id:      savedLesson.id,
            user_id:        userId,
            action_type:    previousTemplate1Lesson !== null ? "lesson_regenerated" : "lesson_created",
            previous_data:  previousTemplate1Lesson,
            new_data:       result,
            changed_fields: [], // different shape than Lesson — no field-level diff for Template 1 yet
            api_model:      model,
          });
        }
        return;
      }

      const previousLesson = lesson; // capture before generation (null = first-time creation)
      const result = await generateLesson({
        grade, subject, frameworks: resolvedFrameworks(), code, topic, goal, duration, model,
        technologyUsage, technologyTools, instructionalApproach, teachingStrategies,
      });
      setLesson(result);
      setGeneratedFormat("standard");
      onLessonGenerated(result);   // share with the Evaluator
      onCustomTemplateSelected(null); // clear any stale custom-template linkage
      onLessonMetaGenerated?.({ model, grade, standards: resolvedFrameworks().join(", "), duration });

      // ── Supabase save ──────────────────────────────────────────────────
      const insertPayload = {
        template_type:       "standard",
        lesson_topic:        topic,
        api_model:           model,
        grade_level:         String(grade),
        subject:             subject,
        standards_framework: resolvedFrameworks().join(", "),
        standard_code:       code,
        lesson_goal:         goal,
        duration:            String(duration),
        lesson_json:         result,
        is_demo:             false,
        user_id:             userId,
      };

      // .select("id").single() returns exactly the inserted row's id.
      // If RLS blocks the insert, data will be null and error will be set.
      const { data: savedLesson, error: saveError } = await supabase
        .from("lesson_generation")
        .insert([insertPayload])
        .select("id")
        .single();

      if (saveError) {
        console.error("[Supabase] lesson_generation insert error:", saveError);
      } else if (!savedLesson?.id) {
        console.warn("[Supabase] lesson_generation insert returned no id. Possible RLS block.");
      } else {
        console.debug("[Supabase] lesson_generation saved, id:", savedLesson.id);
        onLessonSaved(savedLesson.id);   // bubble id up to App for the Evaluator
        logGeneratorAction({
          lesson_id:      savedLesson.id,
          user_id:        userId,
          action_type:    previousLesson !== null ? "lesson_regenerated" : "lesson_created",
          previous_data:  previousLesson,
          new_data:       result,
          changed_fields: previousLesson ? diffLessonFields(previousLesson, result) : [],
          api_model:      model,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const modelLabel    = MODELS.find((m) => m.value === model)?.label ?? model;
  const gradeBandLabel = `Grades ${GRADE_BANDS.find((b) => b.value === grade)?.label ?? grade}`;
  const breadcrumb = [modelLabel, subject, ...resolvedFrameworks(), code, gradeBandLabel, `${duration} min`].filter(Boolean).join(" · ");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader
        title="Lesson Generator"
        subtitle="Generate standards-aligned lesson plans in seconds."
      />

      <div
        className="gen-grid"
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.15fr)", gap: 28, alignItems: "start" }}
      >
        {/* ── Form ───────────────────────────────── */}
        <div className="card" style={{ padding: "24px 24px 28px" }}>
          <div className="space-y-6">

            {/* AI Model */}
            <div className="field">
              <FieldLabel>AI Model</FieldLabel>
              <div className="model-pill-group">
                {MODELS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    className={`model-pill${model === m.value ? " model-pill-active" : ""}`}
                    onClick={() => setModel(m.value)}
                    aria-pressed={model === m.value}
                  >
                    <span className="model-pill-label">{m.label}</span>
                    <span className="model-pill-hint">{m.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Grade Band */}
            <div className="field">
              <FieldLabel>Grade Band</FieldLabel>
              <div className="grade-row">
                {GRADE_BANDS.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    className={`grade-btn${grade === b.value ? " active" : ""}`}
                    onClick={() => setGrade(b.value)}
                    title={b.hint}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subject */}
            <div className="field">
              <FieldLabel>Subject</FieldLabel>
              <div className="grade-row">
                {SUBJECTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`grade-btn${subject === s ? " active" : ""}`}
                    onClick={() => setSubject(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Standards */}
            <div className="field">
              <FieldLabel>Standards Framework</FieldLabel>

              <div className="fw-chip-row">
                {FRAMEWORKS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`fw-chip${framework === f.value ? " fw-chip-active" : ""}`}
                    onClick={() => setFramework(f.value)}
                    aria-pressed={framework === f.value}
                  >
                    {f.label}
                  </button>
                ))}

                <button
                  type="button"
                  className={`fw-chip${hasCustom ? " fw-chip-active" : ""}`}
                  onClick={() => setFramework(CUSTOM_ID)}
                  aria-pressed={hasCustom}
                >
                  Custom Upload
                </button>
              </div>

              {/* Upload area — only when Custom Upload is selected */}
              {hasCustom && (() => {
                const busy = uploadStatus === "uploading" || uploadStatus === "processing";
                return (
                  <div
                    className="fw-upload-area"
                    onClick={() => !busy && fileInputRef.current?.click()}
                    style={{ cursor: busy ? "default" : "pointer" }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = ""; // allow re-selecting the same file later
                        if (file) void handleUploadFile(file);
                      }}
                    />
                    <div className="fw-upload-area-icon">↑</div>
                    <p className="fw-upload-area-label">Upload your standards document (PDF or DOCX)</p>

                    <button
                      type="button"
                      className="btn-outline-sm"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Choose PDF/DOCX File
                    </button>

                    {uploadFileName && (
                      <p className="fw-upload-filename">{uploadFileName}</p>
                    )}

                    {uploadStatus === "uploading" && (
                      <p className="fw-upload-status">Uploading…</p>
                    )}
                    {uploadStatus === "processing" && (
                      <p className="fw-upload-status">Processing standards…</p>
                    )}
                    {uploadStatus === "success" && uploadSummary && (
                      <p className="fw-upload-status fw-upload-status-success">
                        Upload complete — {uploadSummary.embedded} embedded
                        {uploadSummary.skipped > 0 ? `, ${uploadSummary.skipped} already added` : ""}
                        {uploadSummary.failed > 0 ? `, ${uploadSummary.failed} failed` : ""}.
                      </p>
                    )}
                    {uploadStatus === "error" && (
                      <p className="fw-upload-status fw-upload-status-error">{uploadError}</p>
                    )}
                  </div>
                );
              })()}

              {/* Standard Code — only for NGSS / Common Core */}
              {!hasCustom && (
                <div style={{ marginTop: 10 }}>
                  <FieldLabel htmlFor="code" hint="Optional">Standard Code</FieldLabel>
                  <input
                    id="code"
                    className="input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. MS-LS1-6"
                  />
                </div>
              )}
            </div>

            {/* Lesson Plan Format */}
            <div className="field">
              <FieldLabel>Lesson Plan Format</FieldLabel>

              <p className="drawer-eyebrow" style={{ marginBottom: 6 }}>Built-in</p>
              <div className="fw-chip-row" style={{ marginBottom: readyCustomTemplates.length > 0 ? 14 : 10 }}>
                {LESSON_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`fw-chip${lessonFormat === f.value ? " fw-chip-active" : ""}`}
                    onClick={() => setLessonFormat(f.value)}
                    aria-pressed={lessonFormat === f.value}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {readyCustomTemplates.length > 0 && (
                <>
                  <p className="drawer-eyebrow" style={{ marginBottom: 6 }}>My Templates</p>
                  <div className="fw-chip-row" style={{ marginBottom: 10 }}>
                    {readyCustomTemplates.map((t) => {
                      const active = lessonFormat === "custom" && selectedCustomTemplateId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`fw-chip${active ? " fw-chip-active" : ""}`}
                          onClick={() => { setLessonFormat("custom"); setSelectedCustomTemplateId(t.id); }}
                          aria-pressed={active}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <button
                type="button"
                className="btn-outline-sm"
                onClick={() => setShowTemplatesModal(true)}
              >
                {readyCustomTemplates.length === 0 ? "+ Upload a Template" : "Manage Templates"}
              </button>
            </div>

            {/* Lesson Topic */}
            <div className="field">
              <FieldLabel htmlFor="topic">Lesson Topic</FieldLabel>
              <input
                id="topic"
                className="input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Photosynthesis, The American Revolution, Fractions…"
              />
            </div>

            {/* Goal */}
            <div className="field">
              <FieldLabel htmlFor="goal">Lesson Goal</FieldLabel>
              <textarea
                id="goal"
                className="textarea"
                rows={4}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe what students should know or be able to do…"
              />
            </div>

            {/* Duration */}
            <div className="field">
              <FieldLabel>Duration</FieldLabel>
              <div className="duration-group">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`duration-btn${duration === d ? " active" : ""}`}
                    onClick={() => setDuration(d)}
                  >
                    {d}<span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 2 }}>m</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Lesson Options — collapsed by default. Extensible: each
                category (Technology Integration today; Teaching Strategies
                and others later) is its own AdvancedOptionGroup added as a
                sibling inside this one panel. */}
            <div className="card" style={{ padding: "4px 20px" }}>
              <AccordionItem title="Advanced Lesson Options" isLast>
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  <AdvancedOptionGroup title="Technology Integration">
                    <div className="field">
                      <FieldLabel>Technology Usage</FieldLabel>
                      <div className="duration-group">
                        {TECHNOLOGY_USAGE_LEVELS.map((lvl) => (
                          <button
                            key={lvl.value}
                            type="button"
                            className={`duration-btn${technologyUsage === lvl.value ? " active" : ""}`}
                            onClick={() => setTechnologyUsage(lvl.value)}
                            aria-pressed={technologyUsage === lvl.value}
                          >
                            {lvl.label}
                          </button>
                        ))}
                      </div>
                      <p style={{ fontSize: 12.5, color: "var(--muted-fg)", marginTop: 8 }}>
                        {TECHNOLOGY_USAGE_LEVEL_DEFINITIONS[technologyUsage]}
                      </p>
                    </div>

                    <div className="field">
                      <FieldLabel>Technology Tools</FieldLabel>
                      <div className="fw-chip-row">
                        {TECH_TOOLS_OPTIONS.map((opt) => {
                          const active = technologyTools.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              className={`fw-chip${active ? " fw-chip-active" : ""}`}
                              onClick={() => toggleTechnologyTool(opt)}
                              aria-pressed={active}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </AdvancedOptionGroup>

                  <AdvancedOptionGroup title="Instructional Approach">
                    <div className="field">
                      <FieldLabel>Instructional Approach</FieldLabel>
                      <div className="duration-group">
                        {INSTRUCTIONAL_APPROACH_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`duration-btn${instructionalApproach === opt.value ? " active" : ""}`}
                            onClick={() => setInstructionalApproach(opt.value)}
                            aria-pressed={instructionalApproach === opt.value}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <p style={{ fontSize: 12.5, color: "var(--muted-fg)", marginTop: 8 }}>
                        {INSTRUCTIONAL_APPROACH_DEFINITIONS[instructionalApproach]}
                      </p>
                    </div>
                  </AdvancedOptionGroup>

                  <AdvancedOptionGroup title="Teaching Strategies">
                    <TeachingStrategiesPicker
                      strategies={teachingStrategyCatalog}
                      selectedIds={selectedStrategyIds}
                      onToggle={toggleTeachingStrategy}
                    />
                  </AdvancedOptionGroup>

                  {/* Future groups go here as additional <AdvancedOptionGroup> siblings */}
                </div>
              </AccordionItem>
            </div>

            {error && <div className="error-box">{error}</div>}

            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={loading}
              style={{ marginTop: 20 }}
            >
              {loading ? <><Icon.Loader /> Generating…</> : <><Icon.Sparkles /> Generate Lesson Plan</>}
            </button>
          </div>
        </div>

        {/* ── Preview ────────────────────────────── */}
        {(generatedFormat === "template1" || generatedFormat === "custom") && template1Lesson ? (
          /* ── Template 1 (PSU/GTEP-style) — its own WYSIWYG preview/edit, not the card/accordion layout ──
             "custom" (a teacher's own uploaded DOCX) reuses this exact same preview/edit UI — only the
             DOCX export target differs (see getDocxOverride below). ── */
          editing && template1Draft ? (
            <Template1EditForm
              draft={template1Draft}
              setField={setTemplate1Field}
              setPhaseField={setTemplate1PhaseField}
              setClosureField={setTemplate1ClosureField}
              updateObjective={updateTemplate1Objective}
              removeObjective={removeTemplate1Objective}
              addObjective={addTemplate1Objective}
              updateMaterial={updateTemplate1Material}
              removeMaterial={removeTemplate1Material}
              addMaterial={addTemplate1Material}
              onCancel={handleCancelTemplate1Edit}
              onSave={handleSaveTemplate1Edit}
            />
          ) : (
            <>
              <TemplateRenderer templateType={generatedFormat} lessonData={template1Lesson} breadcrumb={breadcrumb} onEdit={handleStartTemplate1Edit} />
              <div className="preview-evaluate-strip">
                <ExportDropdown
                  label="Export lesson"
                  filenameBase={slugifyFilename(template1Lesson.lessonTitle, "lesson-plan")}
                  getDocument={() => buildTemplate1ExportDocument(template1Lesson)}
                  getDocxOverride={() =>
                    generatedFormat === "custom" && selectedCustomTemplateId
                      ? exportCustomTemplateLessonDocx(selectedCustomTemplateId, userId, template1Lesson)
                      : buildTemplate1LessonDocx(template1Lesson)
                  }
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onEvaluateLesson()}
                  style={{ width: "auto", padding: "0 22px", height: 38, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Icon.FileCheck /> Evaluate Lesson
                </button>
              </div>
            </>
          )
        ) : generatedFormat === "standard" && lesson ? (
          <div className="card" style={{ overflow: "hidden" }}>
            {editing && draft ? (
              /* ── Edit mode ── */
              <>
                <div className="preview-header">
                  <p className="preview-breadcrumb">{breadcrumb}</p>
                  <input
                    className="input"
                    value={draft.title}
                    onChange={e => setDraftField("title", e.target.value)}
                    style={{ marginTop: 6, fontSize: "1.05rem", fontWeight: 600 }}
                    placeholder="Lesson title"
                  />
                </div>

                <div className="lesson-edit-form">

                  {/* Objectives */}
                  <div>
                    <p className="lesson-edit-section-title">Learning Objectives</p>
                    {draft.objectives.map((o, i) => (
                      <div key={i} className="lesson-edit-item-row">
                        <textarea className="textarea" rows={2} value={o}
                          onChange={e => updateObjective(i, e.target.value)} />
                        <button type="button" className="lesson-edit-remove-btn"
                          onClick={() => removeObjective(i)} aria-label="Remove objective">×</button>
                      </div>
                    ))}
                    <button type="button" className="lesson-edit-add-btn" onClick={addObjective}>
                      + Add objective
                    </button>
                  </div>

                  {/* Standards Alignment */}
                  {draft.standards_alignment !== undefined && (
                    <div>
                      <p className="lesson-edit-section-title">Standards Alignment</p>
                      <textarea className="textarea" rows={3}
                        value={draft.standards_alignment ?? ""}
                        onChange={e => setDraftField("standards_alignment", e.target.value || undefined)} />
                    </div>
                  )}

                  {/* Materials */}
                  <div>
                    <p className="lesson-edit-section-title">Materials</p>
                    {draft.materials.map((m, i) => (
                      <div key={i} className="lesson-edit-item-row">
                        <input className="input" value={m}
                          onChange={e => updateMaterial(i, e.target.value)} />
                        <button type="button" className="lesson-edit-remove-btn"
                          onClick={() => removeMaterial(i)} aria-label="Remove material">×</button>
                      </div>
                    ))}
                    <button type="button" className="lesson-edit-add-btn" onClick={addMaterial}>
                      + Add material
                    </button>
                  </div>

                  {/* Activities */}
                  <div>
                    <p className="lesson-edit-section-title">Activities</p>
                    {draft.activities.map((a, i) => (
                      <div key={i} className="lesson-edit-activity">
                        <div className="lesson-edit-activity-header">
                          <span className="lesson-edit-activity-label">Activity {i + 1}</span>
                          <button type="button" className="lesson-edit-remove-btn"
                            onClick={() => removeActivity(i)} aria-label="Remove activity">×</button>
                        </div>
                        <div className="lesson-edit-dur-row">
                          <input className="input" style={{ flex: 1 }} placeholder="Activity name"
                            value={a.name} onChange={e => updateActivity(i, "name", e.target.value)} />
                          <input className="input" type="number" style={{ width: 68 }} placeholder="0"
                            value={a.minutes} min={1}
                            onChange={e => updateActivity(i, "minutes", parseInt(e.target.value) || 0)} />
                          <span style={{ fontSize: 12, color: "var(--muted-fg)", flexShrink: 0 }}>min</span>
                        </div>
                        <textarea className="textarea" rows={2} placeholder="Description"
                          value={a.detail} onChange={e => updateActivity(i, "detail", e.target.value)} />
                      </div>
                    ))}
                    <button type="button" className="lesson-edit-add-btn" onClick={addActivity}>
                      + Add activity
                    </button>
                  </div>

                  {/* Assessment */}
                  <div>
                    <p className="lesson-edit-section-title">Assessment</p>
                    <textarea className="textarea" rows={3} value={draft.assessment}
                      onChange={e => setDraftField("assessment", e.target.value)} />
                  </div>

                  {/* Differentiation */}
                  <div>
                    <p className="lesson-edit-section-title">
                      Differentiation
                      <span style={{ fontWeight: 400, textTransform: "none", fontSize: 11, marginLeft: 6 }}>
                        (optional)
                      </span>
                    </p>
                    <textarea className="textarea" rows={3}
                      value={draft.differentiation ?? ""}
                      placeholder="Leave blank to omit this section"
                      onChange={e => setDraftField("differentiation", e.target.value || undefined)} />
                  </div>

                  {/* Actions */}
                  <div className="lesson-edit-actions">
                    <button type="button" className="btn-outline-sm" onClick={handleCancelEdit}>
                      Cancel
                    </button>
                    <button type="button" className="btn-primary"
                      style={{ width: "auto", padding: "0 20px", height: 36, fontSize: 13 }}
                      onClick={handleSaveEdit}>
                      Save changes
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* ── Read-only view ── */
              <>
                <div className="preview-header">
                  <p className="preview-breadcrumb">{breadcrumb}</p>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <h2 className="preview-title">{lesson.title}</h2>
                    <button type="button" className="btn-outline-sm"
                      onClick={handleStartEdit}
                      style={{ flexShrink: 0, marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon.Edit /> Edit
                    </button>
                  </div>
                </div>
                <div className="preview-body">
                  <TemplateRenderer templateType="standard" lessonData={lesson} />
                </div>

                {/* Export + Evaluate Lesson CTA */}
                <div className="preview-evaluate-strip">
                  <ExportDropdown
                    label="Export lesson"
                    filenameBase={slugifyFilename(lesson.title, "lesson-plan")}
                    getDocument={() => buildLessonExportDocument(lesson, breadcrumb)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ width: "auto", padding: "0 22px", height: 38, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
                    onClick={() => onEvaluateLesson()}
                  >
                    <Icon.FileCheck /> Evaluate Lesson
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div style={{ textAlign: "center", maxWidth: 280 }}>
              <div className="empty-icon">
                {loading ? <Icon.Loader /> : <Icon.FileText />}
              </div>
              <p className="empty-title">
                {loading ? "Building your lesson…" : "Your lesson will appear here"}
              </p>
              {!loading && (
                <p className="empty-sub">
                  Fill in the form and generate a draft you can review and send to the evaluator.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {showTemplatesModal && (
        <ManageTemplatesModal
          userId={userId}
          templates={customTemplates}
          onTemplatesChange={handleCustomTemplatesChange}
          onClose={() => setShowTemplatesModal(false)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   EVALUATOR PAGE
════════════════════════════════════════════════════════════ */

const LESSON_META = {
  title: "Modeling Photosynthesis with Everyday Materials",
  grade: "7", duration: 60, model: "GPT-4",
  overview: "A 60-minute investigation where students model photosynthesis using elodea sprigs, then translate their observations into a labeled diagram that ties evidence to the photosynthesis equation.",
};


type SectionTemplate = {
  id: string;
  title: string;
  description: string;
  criteria: Record<RubricRating, string>;
  feedback: string;   // default demo feedback; API response overrides this
};

const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: "lesson-title",
    title: "Lesson Title",
    description: "Identifies the topic and focus of the specific instructional unit and lesson.",
    criteria: {
      high:   "Clearly and concisely reflects the specific lesson's topic and focus.",
      medium: "Refers in general to the lesson's topic but lacks specificity regarding its focus.",
      low:    "The title is too general, unspecified, or does not connect to the lesson.",
    },
    feedback: "The title clearly identifies the lesson topic and instructional focus. No changes needed.",
  },
  {
    id: "objectives",
    title: "Learning Objectives",
    description: "Specific statement using action verbs that communicates the 'big idea' students should gain and how they will be evaluated.",
    criteria: {
      high:   "The objective(s) are clearly aligned with the lesson, includes a 'big idea,' and include a measurable assessment strategy.",
      medium: "The objective(s) are mostly aligned with the lesson, includes the gist of a 'big idea,' and the assessment strategy has measurable elements.",
      low:    "The objective(s) are misaligned with the lesson, only partially includes a 'big idea,' and/or the assessment strategy is not measurable.",
    },
    feedback: "Objectives are observable and tied directly to the assessment. Phrasing is student-facing and action-oriented.",
  },
  {
    id: "standards",
    title: "Standards Alignment",
    description: "One or more academic standards are identified that align with the objective, content being taught, and 'big idea' being assessed.",
    criteria: {
      high:   "The academic standards are tightly aligned with the lesson's topic, objective(s), and assessment.",
      medium: "The academic standards are mostly aligned with the lesson's topic, objective(s), and assessment, though there are some gaps in logic.",
      low:    "The academic standards are not clearly aligned with the lesson and/or there are severe gaps in logic.",
    },
    feedback: "MS-LS1-6 is well represented across the modeling task and assessment. Consider tagging the science and engineering practice explicitly.",
  },
  {
    id: "assessment",
    title: "Assessment Strategy",
    description: "A plan to evaluate if students gained the 'big idea(s)' from the lesson, including grading criteria.",
    criteria: {
      high:   "The assessment is aligned with the lesson's 'big idea' and includes clear grading criteria.",
      medium: "The assessment is mostly aligned with the lesson's 'big idea' and includes general grading criteria.",
      low:    "The assessment is misaligned from the lesson's 'big idea' or lacks clear grading criteria.",
    },
    feedback: "Exit ticket aligns with the objectives and produces evidence of learning. Consider providing a sentence stem for students who need a writing scaffold.",
  },
  {
    id: "activities",
    title: "Instructional Activities",
    description: "The sequence of teaching procedures and student tasks that drive the lesson, aligned with objectives and assessments.",
    criteria: {
      high:   "The instructional activities denote clear procedures and tasks aligned with the objective organized in a logical progression that prepares students for the assessment.",
      medium: "The instructional activities include mostly clear procedures and tasks aligned with the objective, though there are gaps in how the procedures prepare students for the assessment.",
      low:    "The instructional activities are limited and disconnected from the objectives and do not prepare students for the assessment.",
    },
    feedback: "The activity sequence is logical and builds effectively toward the exit ticket. The lab investigation is well-positioned after direct instruction.",
  },
  {
    id: "resources",
    title: "Resources & Materials",
    description: "The concrete tools, texts, technology, or objects identified for both teacher and student to facilitate teaching and learning.",
    criteria: {
      high:   "All the resources/materials are listed in detail, with links to digital resources and directions for where physical resources are located.",
      medium: "Most of the resources and materials are listed in detail. A few resources/materials may not be included.",
      low:    "Few of the resources/materials are listed in detail, with multiple resources missing from the list.",
    },
    feedback: "Materials list is thorough. Adding links to the printed diagrams or a supplier note for elodea sprigs would complete the picture.",
  },
  {
    id: "differentiation",
    title: "Differentiation Strategy",
    description: "Plans for addressing the needs of diverse learners, including those from underrepresented populations or those with special needs.",
    criteria: {
      high:   "The lesson includes intentional supports and extensions that address varied learner needs and promote appropriate challenge.",
      medium: "The lesson offers some supports or extensions, but they are limited, inconsistently applied, or only loosely tied to specific learner needs.",
      low:    "The lesson provides few or no meaningful supports or extensions, and learner differences are not clearly considered in the planning.",
    },
    feedback: "Some supports are implied but not explicitly stated. Adding a sentence frame for ELL students and an extension task for advanced learners would strengthen this section.",
  },
  {
    id: "timing",
    title: "Timing & Pacing",
    description: "Estimates for the duration of activities to ensure the lesson fits within the allotted period and maintains a steady flow.",
    criteria: {
      high:   "Time allocations are realistic for each lesson segment and include flexible ranges to adjust based on student needs.",
      medium: "Time allocations are generally reasonable but may lack flexibility or sufficient detail for some lesson segments.",
      low:    "Time allocations are unclear, unrealistic, or missing for key parts of the lesson, risking incomplete activities.",
    },
    feedback: "Timing is realistic for a 60-minute period. Consider adding a 2-minute buffer to the lab segment in case setup takes longer than expected.",
  },
  {
    id: "opening",
    title: "Opening / Introduction",
    description: "The initial phase of a lesson used to preview the upcoming learning experience, activate prior knowledge, and set expectations.",
    criteria: {
      high:   "The opening efficiently previews the lesson, activates prior knowledge, and sets explicit expectations for students.",
      medium: "The opening previews the lesson or activates prior knowledge, but expectations are only partially clear or incomplete.",
      low:    "The opening does not clearly preview the lesson, connect to prior knowledge, or establish expectations for students.",
    },
    feedback: "The wilted vs. healthy plant hook effectively activates prior knowledge. Explicitly stating the lesson goal at the start would set clearer expectations.",
  },
  {
    id: "evaluation",
    title: "Evaluation / Reflection",
    description: "Assessments that provide opportunities for students to look back on their learning and document it.",
    criteria: {
      high:   "Students engage in structured evaluation that prompts them to reflect on their learning and complete a task.",
      medium: "Students engage in a structured evaluation, though it can be completed without reflecting on their learning.",
      low:    "Students are told to complete an evaluation that is unclear and may require little to no reflection on their learning.",
    },
    feedback: "The labeled diagram exit ticket is structured and task-based. Adding a written reflection prompt ('What surprised you?') would deepen metacognitive engagement.",
  },
];


/* ── Rubric readiness calculation ────────────────────────────────────────────
   High = 2 pts · Medium = 1 pt · Low = 0 pts · Max = 20 (10 criteria × 2)

   Classroom Ready              18-20, zero Low ratings
   Classroom Ready w/ Revision  14-17  OR  18-20 with exactly 1 Low
   Needs Revision               8-13
   Not Ready                    0-7
────────────────────────────────────────────────────────────────────────────── */
const RATING_POINTS: Record<RubricRating, number> = { high: 2, medium: 1, low: 0 };
const MAX_SCORE = 20;

type ReadinessResult = {
  status: string;
  totalScore: number;
  maxScore: number;
  lowCount: number;
};

function calcReadiness(ratings: RubricRating[]): ReadinessResult {
  const totalScore = ratings.reduce((sum, r) => sum + RATING_POINTS[r], 0);
  const lowCount   = ratings.filter((r) => r === "low").length;

  let status: string;
  if (totalScore >= 18 && lowCount === 0) {
    status = "Classroom Ready";
  } else if ((totalScore >= 14 && totalScore <= 17) || (totalScore >= 18 && lowCount === 1)) {
    status = "Classroom Ready with Teacher Revision";
  } else if (totalScore >= 8) {
    status = "Needs Revision";
  } else {
    status = "Not Ready";
  }

  return { status, totalScore, maxScore: MAX_SCORE, lowCount };
}


function EvalSection({
  section,
  isLast,
  teacherRating,
  notes,
  onRatingChange,
  onNotesChange,
}: {
  section: EvaluationSection & Partial<SectionTemplate>;
  isLast: boolean;
  teacherRating: RubricRating | null;
  notes: string;
  onRatingChange: (id: string, rating: RubricRating | null) => void;
  onNotesChange: (id: string, value: string) => void;
}) {
  const aiRating     = (section.rating ?? "medium") as RubricRating;
  const activeRating = teacherRating ?? aiRating;
  const isOverridden = teacherRating !== null && teacherRating !== aiRating;
  const hasNotes     = notes.trim().length > 0;

  const activeMeta   = RATING_META[activeRating];
  const template     = SECTION_TEMPLATES.find((t) => t.id === section.id);

  return (
    <AccordionItem
      title={section.title}
      right={
        /* Badge reflects the current active rating (teacher or AI) */
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {(isOverridden || hasNotes) && (
            <span className="override-chip">Edited</span>
          )}
          <span className={`rubric-badge rubric-badge-${activeRating}`}>
            {activeMeta.label}
          </span>
        </div>
      }
      isLast={isLast}
    >
      {/* Rubric description */}
      {template?.description && (
        <p className="rubric-description">{template.description}</p>
      )}

      {/* ── Rating selector ── */}
      <div className="rating-selector">
        <div className="rating-selector-label">
          <span>Your rating</span>
          {/* Show the AI's original when overridden */}
          {isOverridden && (
            <span className="rating-ai-original">
              AI suggested:&nbsp;
              <span className={`rating-ai-dot rating-ai-dot-${aiRating}`} />
              {RATING_META[aiRating].label}
              <button
                type="button"
                className="rating-reset-btn"
                onClick={() => onRatingChange(section.id, null)}
              >
                Reset
              </button>
            </span>
          )}
        </div>

        <div className="rating-btn-group">
          {(["high", "medium", "low"] as RubricRating[]).map((r) => {
            const m          = RATING_META[r];
            const isActive   = activeRating === r;
            const isAiChoice = aiRating === r;
            return (
              <button
                key={r}
                type="button"
                className={[
                  "rating-btn",
                  `rating-btn-${r}`,
                  isActive ? `rating-btn-active rating-btn-active-${r}` : "",
                ].join(" ")}
                onClick={() => onRatingChange(section.id, r === aiRating && teacherRating === null ? null : r)}
                aria-pressed={isActive}
              >
                <span className="rating-btn-label">{m.label}</span>
                {isAiChoice && (
                  <span className="rating-btn-ai-tag">AI</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Highlighted criteria for the active rating */}
      {template?.criteria[activeRating] && (
        <div className={`rubric-criteria rubric-criteria-${activeRating}`}>
          <span className="rubric-criteria-label">{activeMeta.label} — </span>
          {template.criteria[activeRating]}
        </div>
      )}

      {/* AI feedback */}
      {section.feedback && (
        <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6, marginTop: 12 }}>
          {section.feedback}
        </p>
      )}

      {/* Teacher notes */}
      <div className="override-section">
        <div className="override-label">Teacher notes</div>
        <textarea
          className="textarea"
          rows={2}
          value={notes}
          onChange={(e) => onNotesChange(section.id, e.target.value)}
          placeholder="Add context or notes for this section…"
          style={{ background: "var(--background)", fontSize: 13 }}
        />
      </div>
    </AccordionItem>
  );
}

function EvaluatorPage({
  lesson,
  template1Lesson,
  lessonId,
  userId,
  lessonMeta,
  autoEvaluate,
  onAutoEvaluateDone,
}: {
  lesson: Lesson | null;
  template1Lesson: Template1Lesson | null;
  lessonId: number | null;
  userId: string;
  lessonMeta?: LessonMeta | null;
  autoEvaluate?: boolean;
  onAutoEvaluateDone?: () => void;
}) {
  const [evalResult, setEvalResult]   = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating]   = useState(false);
  const [evalError, setEvalError]     = useState<string | null>(null);

  // Lifted teacher overrides keyed by section id — shared across all EvalSections
  const [teacherOverrides, setTeacherOverrides] = useState<Record<string, RubricRating | null>>({});
  const [teacherNotes, setTeacherNotes]         = useState<Record<string, string>>({});

  // Save state — snapshot of what was last explicitly saved
  const [savedOverrides, setSavedOverrides] = useState<Record<string, RubricRating | null>>({});
  const [savedNotes, setSavedNotes]         = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus]         = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveErrorMsg]        = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // hasUnsaved: teacher has made changes since the last save
  const hasUnsaved =
    JSON.stringify(teacherOverrides) !== JSON.stringify(savedOverrides) ||
    JSON.stringify(teacherNotes)     !== JSON.stringify(savedNotes);

  // canSave: button is enabled whenever a real evaluation result exists,
  // regardless of whether the teacher changed anything — they can confirm
  // the AI evaluation as-is without needing to make edits first.
  // Button is enabled whenever the page has evaluation data to save
  // (real API result OR demo preset) and is not currently mid-save.
  // Teachers should be able to confirm without needing to change anything.
  const canSave = saveStatus !== "saving";

  function handleRatingChange(id: string, rating: RubricRating | null) {
    setTeacherOverrides((prev) => ({ ...prev, [id]: rating }));
  }

  function handleNotesChange(id: string, value: string) {
    setTeacherNotes((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSave() {
    setSaveStatus("saving");
    setSaveErrorMsg(null);

    // ── Build rubric_json ───────────────────────────────────────────────────
    // Each section gets its AI rating, teacher override, and resolved final rating.
    const rubricJson: Record<string, {
      title: string;
      ai_rating: RubricRating;
      teacher_rating: RubricRating | null;
      final_rating: RubricRating;
    }> = {};

    displaySections.forEach((s) => {
      const aiRating     = (s.rating ?? "medium") as RubricRating;
      const teacherRating = teacherOverrides[s.id] ?? null;
      const finalRating  = teacherRating ?? aiRating;
      rubricJson[s.id] = {
        title:          s.title,
        ai_rating:      aiRating,
        teacher_rating: teacherRating,
        final_rating:   finalRating,
      };
    });

    // ── Build teacher_notes_json ────────────────────────────────────────────
    // Include every section even if empty so the schema is always complete.
    const teacherNotesJson: Record<string, string> = {};
    displaySections.forEach((s) => {
      teacherNotesJson[s.id] = teacherNotes[s.id] ?? "";
    });

    // ── Insert to Supabase ──────────────────────────────────────────────────
    if (!lessonId) {
      console.warn("[Supabase] lesson_evaluations: lessonId is null. Saving evaluation without a linked lesson_generation row.");
    }

    const payload = {
      lesson_id:          lessonId,
      readiness_status:   readiness.status,
      total_score:        readiness.totalScore,
      low_count:          readiness.lowCount,
      rubric_json:        rubricJson,
      teacher_notes_json: teacherNotesJson,
      is_demo:            false,
      user_id:            userId,
    };

    const { data: savedData, error: supaError } = await supabase
      .from("lesson_evaluations")
      .insert([payload])
      .select();

    if (supaError) {
      console.error("[Supabase] lesson_evaluations insert error:", supaError);
      setSaveErrorMsg("Save failed. Please try again.");
      setSaveStatus("error");
      return;
    }

    if (!savedData || savedData.length === 0) {
      console.warn("[Supabase] lesson_evaluations insert returned no rows. Possible RLS block.");
      setSaveErrorMsg("Save may have been blocked. Check Supabase RLS policies.");
      setSaveStatus("error");
      return;
    }

    console.debug("[Supabase] lesson_evaluations insert succeeded:", savedData);

    // ── Audit log ────────────────────────────────────────────────────────────
    const savedEvalId: number | null = (savedData as Array<{ id: number }>)[0]?.id ?? null;
    // AI-only baseline: ratings before any teacher overrides
    const aiOnlyRatings = displaySections.map(s => s.rating as RubricRating);
    const aiReadiness   = calcReadiness(aiOnlyRatings);
    const previousRubric: Record<string, { title: string; ai_rating: string }> = {};
    displaySections.forEach(s => {
      previousRubric[s.id] = { title: s.title, ai_rating: s.rating as string };
    });
    logEvaluatorAction({
      evaluation_id:        savedEvalId,
      lesson_id:            lessonId,
      user_id:              userId,
      action_type:          "evaluation_confirmed",
      previous_rubric_json: evalResult ? previousRubric : null,
      new_rubric_json:      rubricJson,
      previous_notes_json:  {},
      new_notes_json:       teacherNotesJson,
      previous_status:      evalResult ? aiReadiness.status : null,
      new_status:           payload.readiness_status,
      previous_score:       evalResult ? aiReadiness.totalScore : null,
      new_score:            payload.total_score,
    });

    // Update frontend snapshot so unsaved indicator clears
    setSavedOverrides({ ...teacherOverrides });
    setSavedNotes({ ...teacherNotes });
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
  }

  const displayLesson = lesson ?? LESSON_META;
  // Template 1 wins when present — lessonTitle lives in a different field
  // than the Standard/demo shape's .title, so this can't just fall through
  // the same ?? chain as displayLesson.
  const displayTitle = template1Lesson?.lessonTitle || (displayLesson as typeof LESSON_META).title;

  async function handleEvaluate() {
    setEvaluating(true);
    setEvalError(null);
    try {
      const result = template1Lesson
        ? await evaluateLessonData(template1Lesson, "template1")
        : await evaluateLessonData(displayLesson as Lesson, "standard");
      setEvalResult(result);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Evaluation failed. Please try again.");
    } finally {
      setEvaluating(false);
    }
  }

  const [showLesson, setShowLesson] = useState(false);

  // When arriving via the "Evaluate Lesson" button, start AI evaluation immediately
  useEffect(() => {
    if (autoEvaluate && (lesson || template1Lesson) && !evaluating && !evalResult) {
      handleEvaluate();
      onAutoEvaluateDone?.();
    }
  }, []); // mount-only: EvaluatorPage remounts fresh on each navigation

  // Show real evaluation sections when available; neutral placeholder otherwise
  const displaySections: EvaluationSection[] = evalResult?.sections
    ?? SECTION_TEMPLATES.map((t) => ({ ...t, rating: "medium" as RubricRating }));

  const displaySummary = evalResult?.summary ?? "";

  // Active ratings: teacher override wins over AI/demo rating for each section
  const activeRatings: RubricRating[] = displaySections.map((s) =>
    teacherOverrides[s.id] ?? (s.rating as RubricRating) ?? "medium"
  );
  const readiness = calcReadiness(activeRatings);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader title="Lesson Evaluator" subtitle="AI assessment with teacher review." />

      {/* Overall readiness card */}
      <div className="card" style={{ marginTop: 0, overflow: "hidden" }}>

        {/* ── Top row: status + stats | divider | AI feedback ── */}
        <div style={{ padding: "24px 28px", display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>

          {/* Readiness status + score stats */}
          <div style={{ flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 8 }}>
              Readiness
            </p>
            <span className="eval-band-badge">{readiness.status}</span>
            <div className="readiness-stats">
              <div className="readiness-stat">
                <span className="readiness-stat-value">
                  {readiness.totalScore}<span className="readiness-stat-max">/{readiness.maxScore}</span>
                </span>
                <span className="readiness-stat-label">Total score</span>
              </div>
              <div className="readiness-stat-divider" />
              <div className="readiness-stat">
                <span
                  className="readiness-stat-value"
                  style={readiness.lowCount > 0 ? { color: "var(--score-weak)" } : undefined}
                >
                  {readiness.lowCount}
                </span>
                <span className="readiness-stat-label">Low ratings</span>
              </div>
            </div>
          </div>

          {/* Vertical divider */}
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)", flexShrink: 0 }} />

          {/* AI Feedback */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)" }}>
              "AI Feedback"
            </p>
            <p style={{ marginTop: 8, fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.65 }}>
              {displaySummary}
            </p>
          </div>
        </div>

        {/* ── Scoring rules — full-width footer strip ── */}
        <details className="scoring-rules">
          <summary className="scoring-rules-trigger">How scoring works</summary>
          <div className="scoring-rules-body">
            <div className="scoring-rules-cols">

              {/* Left: point values */}
              <div className="scoring-rules-col">
                <p className="scoring-rules-col-label">Point values</p>
                <div className="scoring-points">
                  <span className="scoring-point scoring-point-high">High = 2 pts</span>
                  <span className="scoring-point scoring-point-medium">Medium = 1 pt</span>
                  <span className="scoring-point scoring-point-low">Low = 0 pts</span>
                </div>
              </div>

              {/* Right: thresholds */}
              <div className="scoring-rules-col">
                <p className="scoring-rules-col-label">Readiness thresholds</p>
                <ol className="scoring-thresholds">
                  <li>
                    <span className="scoring-threshold-badge scoring-threshold-ready">Classroom Ready</span>
                    <span className="scoring-threshold-rule">18–20 pts · no Low ratings</span>
                  </li>
                  <li>
                    <span className="scoring-threshold-badge scoring-threshold-revision">Ready with Revision</span>
                    <span className="scoring-threshold-rule">14–17 pts · or 18–20 pts with 1 Low</span>
                  </li>
                  <li>
                    <span className="scoring-threshold-badge scoring-threshold-needs">Needs Revision</span>
                    <span className="scoring-threshold-rule">8–13 pts</span>
                  </li>
                  <li>
                    <span className="scoring-threshold-badge scoring-threshold-not">Not Ready</span>
                    <span className="scoring-threshold-rule">0–7 pts</span>
                  </li>
                </ol>
              </div>

            </div>
            <p className="scoring-note">
              Readiness is calculated automatically based on rubric ratings and the number of Low ratings. Teacher overrides update the result instantly.
            </p>
          </div>
        </details>

      </div>

      {/* Lesson card */}
      <div className="card" style={{ padding: "24px 28px", marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)" }}>
              Reviewing
            </p>
            <h2 style={{ marginTop: 6, fontSize: "1.2rem", lineHeight: 1.3, maxWidth: 600 }}>
              {displayTitle}
            </h2>
            <div className="meta-row">
              {(lessonMeta?.model ?? (displayLesson as typeof LESSON_META).model) && (
                <>
                  <span>{lessonMeta?.model ?? (displayLesson as typeof LESSON_META).model}</span>
                  <span className="meta-dot">·</span>
                </>
              )}
              <span>{gradeDisplay(String(lessonMeta?.grade ?? (displayLesson as typeof LESSON_META).grade))}</span>
              <span className="meta-dot">·</span>
              <span>{lessonMeta?.duration ?? (displayLesson as typeof LESSON_META).duration} min</span>
              {lessonMeta?.standards && (
                <>
                  <span className="meta-dot">·</span>
                  <span>{lessonMeta.standards}</span>
                </>
              )}
            </div>
            {!lesson && !template1Lesson && (displayLesson as typeof LESSON_META).overview && (
              <p style={{ marginTop: 12, fontSize: 14, color: "rgb(48 44 39 / 0.8)", lineHeight: 1.65, maxWidth: 620 }}>
                {(displayLesson as typeof LESSON_META).overview}
              </p>
            )}
          </div>

          {/* Buttons */}
          <div style={{ flexShrink: 0, paddingTop: 2, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            {/* View lesson plan toggle */}
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => setShowLesson((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Icon.FileText />
              {showLesson ? "Hide lesson plan" : "View lesson plan"}
            </button>

            {/* Export + Evaluate / Re-evaluate */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ExportDropdown
                label="Export evaluation"
                filenameBase={slugifyFilename(displayTitle, "lesson-evaluation")}
                getDocument={() => {
                  const evalMeta = [
                    lessonMeta?.model ?? (displayLesson as typeof LESSON_META).model,
                    gradeDisplay(String(lessonMeta?.grade ?? (displayLesson as typeof LESSON_META).grade)),
                    `${lessonMeta?.duration ?? (displayLesson as typeof LESSON_META).duration} min`,
                    lessonMeta?.standards,
                  ].filter(Boolean).join(" · ");

                  return buildEvaluationExportDocument(
                    displayTitle,
                    evalMeta,
                    readiness,
                    displaySummary,
                    displaySections,
                    activeRatings,
                    teacherNotes
                  );
                }}
              />

              {evalResult ? (
                <button
                  type="button"
                  className="btn-outline-sm"
                  onClick={() => { setEvalResult(null); setEvalError(null); }}
                >
                  Re-evaluate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: "auto", padding: "0 18px", height: 36, fontSize: 13 }}
                  onClick={handleEvaluate}
                  disabled={evaluating}
                >
                  {evaluating
                    ? <><Icon.Loader /> Evaluating…</>
                    : <><Icon.FileCheck /> Evaluate lesson</>}
                </button>
              )}
            </div>
          </div>
        </div>
        {evalError && (
          <p className="error-box" style={{ marginTop: 12 }}>{evalError}</p>
        )}
      </div>

      {/* ── Post-evaluation notice ── */}
      {evalResult && saveStatus !== "saved" && (
        <div className="eval-notice">
          <span className="eval-notice-icon">💡</span>
          <span>
            Evaluation complete. Review the results below and adjust any ratings if needed —
            then click <strong>Confirm Evaluation</strong> to save your assessment.
          </span>
        </div>
      )}

      {/* ── Expandable lesson plan panel ── */}
      {showLesson && (
        template1Lesson ? (
          <TemplateRenderer templateType="template1" lessonData={template1Lesson} />
        ) : (
          <div className="lesson-panel">
            <div className="lesson-panel-header">
              <p className="lesson-panel-label">Lesson Plan</p>
              <h3 className="lesson-panel-title">{displayTitle}</h3>
            </div>
            <TemplateRenderer templateType="standard" lessonData={displayLesson as Lesson} />
          </div>
        )
      )}

      {/* Detailed sections */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", margin: 0 }}>
            "Detailed Evaluation"
          </p>

          {saveStatus === "saved" && (
            <span className="save-confirmation">
              ✓ Teacher changes saved
            </span>
          )}
        </div>

        <div className="card" style={{ padding: "0 24px", overflow: "hidden" }}>
          {displaySections.map((s, i) => (
            <EvalSection
              key={s.id}
              section={s}
              isLast={i === displaySections.length - 1}
              teacherRating={teacherOverrides[s.id] ?? null}
              notes={teacherNotes[s.id] ?? ""}
              onRatingChange={handleRatingChange}
              onNotesChange={handleNotesChange}
            />
          ))}
        </div>

        {/* ── Bottom save bar — primary CTA ── */}
        <div className="eval-save-bar">
          <div className="eval-save-bar-left">
            {saveStatus === "error" ? (
              <span className="eval-unsaved-label" style={{ color: "var(--score-weak)" }}>
                <span className="eval-unsaved-dot" style={{ background: "var(--score-weak)" }} />
                {saveError}
              </span>
            ) : hasUnsaved ? (
              <span className="eval-unsaved-label">
                <span className="eval-unsaved-dot" />
                Unsaved changes
              </span>
            ) : saveStatus === "saved" ? (
              <span className="eval-saved-label">
                ✓ Evaluation confirmed and saved
              </span>
            ) : evalResult ? (
              <span style={{ fontSize: 13, color: "var(--muted-fg)" }}>
                Ready to confirm
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={`btn-primary eval-save-btn${!canSave ? " eval-save-btn-dim" : ""}`}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saveStatus === "saving" ? <><Icon.Loader /> Saving…</> : "Confirm Evaluation"}
          </button>
        </div>

      </div>
    </div>
  );
}



/* ════════════════════════════════════════════════════════════
   LESSON LIBRARY — mock data + UI
════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
   LESSON LIBRARY — Supabase-powered
════════════════════════════════════════════════════════════ */

/* ── Types ── */
type LibraryReadiness =
  | "classroom-ready"
  | "ready-with-revision"
  | "needs-revision"
  | "not-ready"
  | "not-evaluated";

// Raw row from lesson_generation joined with latest lesson_evaluations
type LibraryRow = {
  id: number;
  title: string;            // lesson_json.title / .lessonTitle ?? lesson_topic
  template_type: string | null; // "template1" or "standard"/null
  lesson_topic: string;
  api_model: string;
  grade_level: string;
  subject: string | null;
  standards_framework: string;
  duration: string;
  created_at: string;
  lesson_json: Lesson | Template1Lesson | null;
  // from lesson_evaluations (may be absent)
  eval_id: number | null;
  readiness_status: string | null;
  total_score: number | null;
  low_count: number | null;
  rubric_json: Record<string, {
    title: string;
    ai_rating: RubricRating;
    teacher_rating: RubricRating | null;
    final_rating: RubricRating;
  }> | null;
  teacher_notes_json: Record<string, string> | null;
};

const READINESS_META: Record<LibraryReadiness, { label: string; cls: string }> = {
  "classroom-ready":     { label: "Classroom Ready",     cls: "badge-ready"    },
  "ready-with-revision": { label: "Ready with Revision", cls: "badge-revision" },
  "needs-revision":      { label: "Needs Revision",      cls: "badge-needs"    },
  "not-ready":           { label: "Not Ready",           cls: "badge-not"      },
  "not-evaluated":       { label: "Not Evaluated Yet",   cls: "badge-edited"   },
};

function readinessKey(status: string | null): LibraryReadiness {
  const map: Record<string, LibraryReadiness> = {
    "Classroom Ready":                "classroom-ready",
    "Classroom Ready with Teacher Revision": "ready-with-revision",
    "Needs Revision":                 "needs-revision",
    "Not Ready":                      "not-ready",
  };
  return (status && map[status]) ? map[status] : "not-evaluated";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Fetch helper ── */

// Explicit types for the raw Supabase rows avoid inference issues
type RawLesson = {
  id: number;
  template_type: string | null;
  lesson_topic: string;
  api_model: string;
  grade_level: string;
  subject: string | null;
  standards_framework: string;
  duration: string;
  created_at: string;
  lesson_json: Lesson | Template1Lesson | null;
};

type RawEval = {
  id: number;
  lesson_id: number;
  readiness_status: string | null;
  total_score: number | null;
  low_count: number | null;
  rubric_json: LibraryRow["rubric_json"];
  teacher_notes_json: Record<string, string> | null;
};

async function fetchLibrary(userId: string): Promise<LibraryRow[]> {
  const { data: lessons, error: lessonErr } = await supabase
    .from("lesson_generation")
    .select("id, template_type, lesson_topic, api_model, grade_level, subject, standards_framework, duration, created_at, lesson_json")
    .eq("is_demo", false)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (lessonErr) {
    console.error("[Supabase] lesson_generation fetch error:", lessonErr);
    throw lessonErr;
  }
  if (!lessons || lessons.length === 0) return [];

  const ids: number[] = (lessons as RawLesson[]).map((l) => l.id);
  const { data: evals, error: evalErr } = await supabase
    .from("lesson_evaluations")
    .select("id, lesson_id, readiness_status, total_score, low_count, rubric_json, teacher_notes_json")
    .in("lesson_id", ids);

  if (evalErr) {
    console.error("[Supabase] lesson_evaluations fetch error:", evalErr);
  }

  // Map: lesson_id → latest evaluation (highest id wins)
  const evalMap: Record<number, RawEval> = {};
  ((evals ?? []) as RawEval[]).forEach((e) => {
    if (!evalMap[e.lesson_id] || e.id > evalMap[e.lesson_id].id) {
      evalMap[e.lesson_id] = e;
    }
  });

  return (lessons as RawLesson[]).map((l) => {
    const ev: RawEval | null = evalMap[l.id] ?? null;
    // Template 1's lesson_json has no .title field — its title lives in
    // .lessonTitle instead. Never read a field the other format doesn't have.
    // "custom" lessons share the exact same Template1Lesson shape.
    const lessonTitle = (l.template_type === "template1" || l.template_type === "custom")
      ? (l.lesson_json as Template1Lesson | null)?.lessonTitle || l.lesson_topic
      : (l.lesson_json as Lesson | null)?.title || l.lesson_topic;
    return {
      id:                  l.id,
      title:               lessonTitle,
      template_type:       l.template_type,
      lesson_topic:        l.lesson_topic,
      api_model:           l.api_model,
      grade_level:         l.grade_level,
      subject:             l.subject ?? null,
      standards_framework: l.standards_framework,
      duration:            l.duration,
      created_at:          l.created_at,
      lesson_json:         l.lesson_json,
      eval_id:             ev?.id ?? null,
      readiness_status:    ev?.readiness_status ?? null,
      total_score:         ev?.total_score ?? null,
      low_count:           ev?.low_count ?? null,
      rubric_json:         ev?.rubric_json ?? null,
      teacher_notes_json:  ev?.teacher_notes_json ?? null,
    };
  });
}

/* Maps any grade value to its current band key for filtering */
function gradeToDisplayBand(gradeLevel: string): string {
  if (["K", "1-2", "3-5", "6-8", "9-12"].includes(gradeLevel)) return gradeLevel;
  const map: Record<string, string> = {
    K: "K",
    "1": "1-2", "2": "1-2",
    "3": "3-5", "4": "3-5", "5": "3-5",
    "6": "6-8", "7": "6-8", "8": "6-8",
    "9": "9-12", "10": "9-12", "11": "9-12", "12": "9-12",
  };
  return map[gradeLevel] ?? gradeLevel;
}

/* Produces a human-readable grade string for display in cards and drawers */
function gradeDisplay(gradeLevel: string): string {
  if (gradeLevel === "K") return "K";
  // "K-2" is a legacy band value from before K was split out — display gracefully
  if (["K-2", "1-2", "3-5", "6-8", "9-12"].includes(gradeLevel)) {
    return `Grades ${gradeLevel.replace("-", "–")}`;
  }
  return `Grade ${gradeLevel}`; // legacy individual grade fallback
}

/* ════════════════════════════════════════════════════════════
   MANAGE TEMPLATES MODAL
   Slide-over panel opened from GeneratorPage's "Manage Templates" button
   (Lesson Plan Format section) — templates are a supporting feature of
   lesson generation, not a separate app section, so this is a modal rather
   than its own page/nav item. `templates`/`onTemplatesChange` are owned by
   GeneratorPage so uploads/renames/deletes are reflected in the format
   selector immediately, with no refetch or page refresh needed.
════════════════════════════════════════════════════════════ */

function ManageTemplatesModal({
  userId,
  templates,
  onTemplatesChange,
  onClose,
}: {
  userId: string;
  templates: CustomTemplate[];
  onTemplatesChange: (templates: CustomTemplate[]) => void;
  onClose: () => void;
}) {
  const [templateName, setTemplateName] = useState("");
  const [pendingFile, setPendingFile]   = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle");
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renameBusy, setRenameBusy]   = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy]           = useState(false);
  const [actionError, setActionError]         = useState<string | null>(null);

  async function handleUpload() {
    if (!pendingFile) return;
    setUploadStatus("uploading");
    setUploadError(null);
    try {
      const { path } = await uploadCustomTemplateFile(pendingFile, userId);
      setUploadStatus("processing");
      const saved = await registerCustomTemplate({
        path,
        filename: pendingFile.name,
        name: templateName.trim() || pendingFile.name,
        userId,
      });
      onTemplatesChange([saved, ...templates]);
      setUploadStatus("success");
      setPendingFile(null);
      setTemplateName("");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setUploadStatus("error");
    }
  }

  function startRename(t: CustomTemplate) {
    setEditingId(t.id);
    setEditingName(t.name);
    setActionError(null);
  }
  function cancelRename() {
    setEditingId(null);
    setEditingName("");
  }
  async function saveRename(id: string) {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    setRenameBusy(true);
    setActionError(null);
    try {
      await renameCustomTemplate(id, trimmed, userId);
      onTemplatesChange(templates.map((t) => (t.id === id ? { ...t, name: trimmed } : t)));
      setEditingId(null);
      setEditingName("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not rename template.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function confirmDelete(id: string) {
    setDeleteBusy(true);
    setActionError(null);
    try {
      await deleteCustomTemplate(id, userId);
      onTemplatesChange(templates.filter((t) => t.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete template.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const busy = uploadStatus === "uploading" || uploadStatus === "processing";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="drawer-eyebrow">Lesson Generation</p>
            <h2 className="drawer-title">Manage Templates</h2>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          {/* ── Upload ── */}
          <section className="drawer-section" style={{ paddingTop: 20, borderTop: "none", marginTop: 0 }}>
            <h3 className="drawer-section-title">Upload a New Template</h3>
            <div className="space-y-6" style={{ marginTop: 12 }}>
              <div className="field">
                <FieldLabel htmlFor="template-name" hint="Optional">Template Name</FieldLabel>
                <input
                  id="template-name"
                  className="input"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. District Lesson Plan Format"
                />
              </div>

              <div
                className="fw-upload-area"
                onClick={() => !busy && fileInputRef.current?.click()}
                style={{ cursor: busy ? "default" : "pointer" }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-selecting the same file later
                    if (file) {
                      setPendingFile(file);
                      setUploadStatus("idle");
                      setUploadError(null);
                    }
                  }}
                />
                <div className="fw-upload-area-icon">↑</div>
                <p className="fw-upload-area-label">Upload a .docx template with {"{{PLACEHOLDER}}"} tags</p>

                <button
                  type="button"
                  className="btn-outline-sm"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  Choose .docx File
                </button>

                {pendingFile && <p className="fw-upload-filename">{pendingFile.name}</p>}

                {uploadStatus === "uploading" && <p className="fw-upload-status">Uploading…</p>}
                {uploadStatus === "processing" && <p className="fw-upload-status">Detecting placeholders…</p>}
                {uploadStatus === "success" && (
                  <p className="fw-upload-status fw-upload-status-success">Template uploaded.</p>
                )}
                {uploadStatus === "error" && (
                  <p className="fw-upload-status fw-upload-status-error">{uploadError}</p>
                )}
              </div>

              {pendingFile && !busy && (
                <button type="button" className="btn-primary" onClick={handleUpload} style={{ marginTop: 4 }}>
                  <Icon.Sparkles /> Upload Template
                </button>
              )}
            </div>
          </section>

          {/* ── List ── */}
          <section className="drawer-section">
            <h3 className="drawer-section-title">Your Templates</h3>
            {actionError && <div className="error-box" style={{ marginTop: 10 }}>{actionError}</div>}

            {templates.length === 0 ? (
              <p className="drawer-empty-note">No custom templates uploaded yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
                {templates.map((t) => (
                  <div key={t.id} className="lib-card">
                    <div className="lib-card-top">
                      <span className={"lib-badge " + (t.status === "ready" ? "badge-ready" : t.status === "error" ? "badge-not" : "badge-needs")}>
                        {t.status === "ready" ? "Ready" : t.status === "error" ? "Error" : "Processing"}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted-fg)" }}>{formatDate(t.created_at)}</span>
                    </div>

                    {editingId === t.id ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input
                          className="input"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          style={{ flex: 1 }}
                          autoFocus
                        />
                        <button type="button" className="btn-outline-sm" disabled={renameBusy} onClick={() => saveRename(t.id)}>
                          Save
                        </button>
                        <button type="button" className="btn-outline-sm" disabled={renameBusy} onClick={cancelRename}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="lib-card-title" style={{ marginBottom: 2 }}>{t.name}</p>
                    )}

                    <p style={{ fontSize: 12.5, color: "var(--muted-fg)", marginBottom: 10 }}>{t.original_filename}</p>

                    {t.recognized_placeholders.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: t.unrecognized_placeholders.length > 0 ? 8 : 0 }}>
                        {t.recognized_placeholders.map((p) => (
                          <span key={p} className="lib-badge badge-ready" style={{ fontFamily: "monospace" }}>{`{{${p}}}`}</span>
                        ))}
                      </div>
                    )}

                    {t.unrecognized_placeholders.length > 0 && (
                      <p style={{ fontSize: 12.5, color: "var(--destructive)", marginBottom: 0 }}>
                        ⚠ Unrecognized (left blank on export): {t.unrecognized_placeholders.map((p) => `{{${p}}}`).join(", ")}
                      </p>
                    )}

                    {t.status === "error" && t.error_message && (
                      <p style={{ fontSize: 12.5, color: "var(--destructive)", marginTop: 6 }}>{t.error_message}</p>
                    )}

                    {editingId !== t.id && (
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button type="button" className="btn-outline-sm" onClick={() => startRename(t)}>
                          Rename
                        </button>
                        {confirmDeleteId === t.id ? (
                          <>
                            <button
                              type="button"
                              className="btn-outline-sm"
                              style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}
                              disabled={deleteBusy}
                              onClick={() => confirmDelete(t.id)}
                            >
                              {deleteBusy ? "Deleting…" : "Confirm Delete"}
                            </button>
                            <button type="button" className="btn-outline-sm" disabled={deleteBusy} onClick={() => setConfirmDeleteId(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn-outline-sm" onClick={() => setConfirmDeleteId(t.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/* ── LibraryPage ── */
function LibraryPage({ userId }: { userId: string }) {
  const [rows,      setRows]      = useState<LibraryRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [fetchErr,  setFetchErr]  = useState<string | null>(null);
  const [query,     setQuery]     = useState("");
  const [statusFlt, setStatusFlt] = useState<string>("all");
  const [gradeFlt,  setGradeFlt]  = useState<string>("all");
  const [subjectFlt, setSubjectFlt] = useState<string>("all");
  const [sortBy,    setSortBy]    = useState<"recent" | "score">("recent");
  const [selected,  setSelected]  = useState<LibraryRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchErr(null);
    fetchLibrary(userId)
      .then((data) => { if (!cancelled) { setRows(data); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setFetchErr(err?.message ?? "Failed to load lessons."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [userId]);

  const visible = rows
    .filter((r) => {
      const matchQ = query === "" ||
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.lesson_topic.toLowerCase().includes(query.toLowerCase()) ||
        r.standards_framework?.toLowerCase().includes(query.toLowerCase());
      const rKey = readinessKey(r.readiness_status);
      const matchS = statusFlt === "all" || rKey === statusFlt;
      const matchG = gradeFlt === "all" || gradeToDisplayBand(r.grade_level) === gradeFlt;
      const matchSub = subjectFlt === "all" || (r.subject ?? "") === subjectFlt;
      return matchQ && matchS && matchG && matchSub;
    })
    .sort((a, b) => {
      if (sortBy === "score") {
        return (b.total_score ?? -1) - (a.total_score ?? -1);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader
        title="Lesson Library"
        subtitle="Browse, search, and reopen your previously generated lesson plans."
      />

      {/* ── Toolbar ── */}
      <div className="lib-toolbar">
        <div className="lib-search-wrap">
          <span className="lib-search-icon"><Icon.Search /></span>
          <input
            className="input lib-search-input"
            type="search"
            placeholder="Search lessons or topics…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="lib-select-wrap">
          <select
            className="select lib-select"
            value={gradeFlt}
            onChange={(e) => setGradeFlt(e.target.value)}
          >
            <option value="all">All grade bands</option>
            <option value="1-2">1–2</option>
            <option value="3-5">3–5</option>
            <option value="6-8">6–8</option>
            <option value="9-12">9–12</option>
          </select>
        </div>

        <div className="lib-select-wrap">
          <select
            className="select lib-select"
            value={subjectFlt}
            onChange={(e) => setSubjectFlt(e.target.value)}
          >
            <option value="all">All subjects</option>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="lib-select-wrap">
          <select
            className="select lib-select"
            value={statusFlt}
            onChange={(e) => setStatusFlt(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="classroom-ready">Classroom Ready</option>
            <option value="ready-with-revision">Ready with Revision</option>
            <option value="needs-revision">Needs Revision</option>
            <option value="not-ready">Not Ready</option>
            <option value="not-evaluated">Not Evaluated Yet</option>
          </select>
        </div>

        <div className="lib-sort-group">
          {([["recent", "Recent"], ["score", "Highest score"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={"lib-sort-btn" + (sortBy === v ? " lib-sort-btn-active" : "")}
              onClick={() => setSortBy(v)}
            >{label}</button>
          ))}
        </div>
      </div>

      {/* ── States ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--muted-fg)", fontSize: 14 }}>
          <Icon.Loader /> Loading lessons…
        </div>
      )}

      {fetchErr && !loading && (
        <p className="error-box" style={{ marginTop: 8 }}>{fetchErr}</p>
      )}

      {!loading && !fetchErr && (
        <>
          <p className="lib-count">
            {visible.length} {visible.length === 1 ? "lesson" : "lessons"}
            {statusFlt !== "all" || query ? " matching filters" : ""}
          </p>

          {visible.length === 0 ? (
            <div className="lib-empty">
              <p className="lib-empty-title">No lessons found</p>
              <p className="lib-empty-sub">
                {rows.length === 0
                  ? "You haven't generated any lessons yet. Head to the Generator to create your first one."
                  : "Try adjusting your search or filters."}
              </p>
            </div>
          ) : (
            <div className="lib-grid">
              {visible.map((row) => (
                <LessonCard key={row.id} row={row} onOpen={setSelected} />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Detail drawer ── */}
      {selected && (
        <LessonDetailDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/* ── LessonCard ── */
function LessonCard({ row, onOpen }: { row: LibraryRow; onOpen: (r: LibraryRow) => void }) {
  const rKey = readinessKey(row.readiness_status);
  const meta = READINESS_META[rKey];
  const hasEval = row.eval_id !== null;

  return (
    <div className="lib-card">
      {/* Top row: badge + score */}
      <div className="lib-card-top">
        <span className={"lib-badge " + meta.cls}>{meta.label}</span>
        {hasEval ? (
          <span className="lib-rubric-score">
            {row.total_score}
            <span className="lib-rubric-max">/20</span>
            {(row.low_count ?? 0) > 0 && (
              <span className="lib-rubric-lows">{row.low_count}L</span>
            )}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "var(--muted-fg)" }}>No score</span>
        )}
      </div>

      <h3 className="lib-card-title">{row.title}</h3>

      <div className="lib-card-meta">
        <span>{gradeDisplay(row.grade_level)}</span>
        <span className="lib-meta-dot">·</span>
        <span>{row.duration} min</span>
        <span className="lib-meta-dot">·</span>
        <span>{row.api_model}</span>
      </div>

      <div className="lib-card-meta" style={{ marginTop: 4 }}>
        {row.subject && <><span>{row.subject}</span><span className="lib-meta-dot">·</span></>}
        <span>{row.standards_framework || "No framework"}</span>
      </div>

      <div className="lib-card-footer">
        <span className="lib-card-date">{formatDate(row.created_at)}</span>
        <button type="button" className="lib-open-btn" onClick={() => onOpen(row)}>
          Open <Icon.ArrowUpRight />
        </button>
      </div>
    </div>
  );
}

/* ── LessonDetailDrawer ── */
function LessonDetailDrawer({ row, onClose }: { row: LibraryRow; onClose: () => void }) {
  const rKey    = readinessKey(row.readiness_status);
  const rMeta   = READINESS_META[rKey];
  const lesson  = row.lesson_json;
  const hasEval = row.eval_id !== null;

  // Partition rubric items by final_rating
  const rubricEntries = row.rubric_json ? Object.entries(row.rubric_json) : [];
  const goodItems      = rubricEntries.filter(([, v]) => v.final_rating === "high");
  const attentionItems = rubricEntries.filter(([, v]) => v.final_rating !== "high");

  // Non-empty teacher notes
  const noteEntries = row.teacher_notes_json
    ? Object.entries(row.teacher_notes_json).filter(([, v]) => v.trim() !== "")
    : [];

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer-panel">

        {/* ── Header ── */}
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="drawer-eyebrow">Lesson Detail</p>
            <h2 className="drawer-title">{row.title}</h2>
            <div className="lib-card-meta" style={{ marginTop: 6 }}>
              <span>{gradeDisplay(row.grade_level)}</span>
              <span className="lib-meta-dot">·</span>
              <span>{row.duration} min</span>
              <span className="lib-meta-dot">·</span>
              <span>{row.api_model}</span>
              {row.subject && <><span className="lib-meta-dot">·</span><span>{row.subject}</span></>}
              <span className="lib-meta-dot">·</span>
              <span>{formatDate(row.created_at)}</span>
            </div>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">

          {/* ── 1. Evaluation Summary ── */}
          <section className="drawer-section" style={{ paddingTop: 20, borderTop: "none", marginTop: 0 }}>
            <h3 className="drawer-section-title">Evaluation Summary</h3>
            {hasEval ? (
              <div className="drawer-eval-summary">
                <div className="drawer-eval-badge-wrap">
                  <span className={"lib-badge " + rMeta.cls} style={{ fontSize: 12.5, padding: "4px 14px" }}>
                    {rMeta.label}
                  </span>
                </div>
                <div className="drawer-eval-stats">
                  <div className="drawer-eval-stat">
                    <span className="drawer-eval-stat-value">{row.total_score}<span className="drawer-eval-stat-denom">/20</span></span>
                    <span className="drawer-eval-stat-label">Total score</span>
                  </div>
                  <div className="drawer-eval-stat-div" />
                  <div className="drawer-eval-stat">
                    <span
                      className="drawer-eval-stat-value"
                      style={(row.low_count ?? 0) > 0 ? { color: "var(--score-weak)" } : undefined}
                    >
                      {row.low_count ?? 0}
                    </span>
                    <span className="drawer-eval-stat-label">
                      {(row.low_count ?? 0) === 1 ? "Low rating" : "Low ratings"}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="drawer-no-eval">
                <p>No evaluation has been saved for this lesson yet.</p>
              </div>
            )}
          </section>

          {/* ── 2. What's Good ── */}
          {hasEval && (
            <section className="drawer-section">
              <h3 className="drawer-section-title drawer-section-title-good">
                <span className="drawer-section-icon">✓</span> What’s Good
              </h3>
              {goodItems.length > 0 ? (
                <ul className="drawer-good-list">
                  {goodItems.map(([id, item]) => (
                    <li key={id} className="drawer-good-item">
                      <span className="drawer-good-dot" />
                      <span className="drawer-good-title">{item.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="drawer-empty-note">No criteria rated High.</p>
              )}
            </section>
          )}

          {/* ── 3. Needs Attention ── */}
          {hasEval && (
            <section className="drawer-section">
              <h3 className="drawer-section-title drawer-section-title-attention">
                <span className="drawer-section-icon">⚠</span> Needs Attention
              </h3>
              {attentionItems.length > 0 ? (
                <div className="drawer-rubric-list">
                  {attentionItems.map(([id, item]) => (
                    <div key={id} className="drawer-rubric-item">
                      <div className="drawer-rubric-item-header">
                        <span className="drawer-rubric-item-title">{item.title}</span>
                        <span className={"rubric-badge rubric-badge-" + item.final_rating}>
                          {RATING_META[item.final_rating].label}
                        </span>
                      </div>
                      <div className="drawer-rubric-item-meta">
                        <span>AI rating: <strong>{RATING_META[item.ai_rating].label}</strong></span>
                        {item.teacher_rating && item.teacher_rating !== item.ai_rating && (
                          <span className="drawer-rubric-override">
                            → Teacher: <strong>{RATING_META[item.teacher_rating].label}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="drawer-empty-note">All criteria are rated High.</p>
              )}
            </section>
          )}

          {/* ── 4. Saved Comments ── */}
          {hasEval && (
            <section className="drawer-section">
              <h3 className="drawer-section-title">Saved Comments</h3>
              {noteEntries.length > 0 ? (
                <div className="drawer-notes-list">
                  {noteEntries.map(([id, note]) => {
                    const rubricTitle = row.rubric_json?.[id]?.title ?? id;
                    return (
                      <div key={id} className="drawer-note-item">
                        <span className="drawer-note-label">{rubricTitle}</span>
                        <p className="drawer-note-text">{note}</p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="drawer-empty-note">No teacher comments saved.</p>
              )}
            </section>
          )}

          {/* ── 5. Lesson Plan ── */}
          {lesson && (
            <section className="drawer-section">
              <h3 className="drawer-section-title">Lesson Plan</h3>
              <TemplateRenderer templateType={row.template_type} lessonData={lesson} />
            </section>
          )}

        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   LOGIN PAGE
════════════════════════════════════════════════════════════ */

function LoginPage({ forceRecovery }: { forceRecovery: boolean }) {
  type LoginMode = "signin" | "signup" | "forgotpw" | "resetpw";
  const [mode, setMode]                       = useState<LoginMode>(forceRecovery ? "resetpw" : "signin");
  const [email, setEmail]                     = useState("");
  const [password, setPassword]               = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [success, setSuccess]                 = useState<string | null>(null);

  // When App detects PASSWORD_RECOVERY event, switch directly to the reset form.
  useEffect(() => {
    if (forceRecovery) {
      setMode("resetpw");
      setError(null);
      setSuccess(null);
      setPassword("");
      setConfirmPassword("");
    }
  }, [forceRecovery]);

  function switchMode(next: LoginMode) {
    setMode(next);
    setError(null);
    setSuccess(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
    // On success, browser redirects to Google — App's onAuthStateChange handles return.
  }

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (mode === "signup") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      setError(null);
      setLoading(true);
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      } else if (data.user && data.session) {
        await supabase.from("profiles").insert({
          user_id: data.user.id,
          email:   data.user.email ?? email,
        });
        // onAuthStateChange navigates automatically
      } else {
        setSuccess("Account created! Check your inbox to confirm your email, then sign in here.");
        setLoading(false);
      }
      return;
    }

    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
    // On success, App's onAuthStateChange listener handles navigation.
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setSuccess(`Check your inbox — we sent a password reset link to ${email.trim()}.`);
    }
  }

  async function handleResetPassword() {
    if (!password) {
      setError("Please enter a new password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (authError) {
      setError(authError.message);
    } else {
      setSuccess("Password updated! Signing you in…");
      // App's onAuthStateChange handles USER_UPDATED → navigates to generator.
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    if (mode === "forgotpw") handleForgotPassword();
    else if (mode === "resetpw") handleResetPassword();
    else handleSubmit();
  }

  const showEmailPasswordForm = mode === "signin" || mode === "signup";
  const headings = {
    signin:   { title: "Welcome back",         subtitle: "Sign in to your teacher account" },
    signup:   { title: "Create an account",    subtitle: "Sign up to start building lesson plans." },
    forgotpw: { title: "Reset your password",  subtitle: "Enter your email and we'll send a reset link." },
    resetpw:  { title: "Set new password",     subtitle: "Enter and confirm your new password below." },
  };
  const { title, subtitle } = headings[mode];

  return (
    <div className="login-shell">
      <div className="login-card">

        {/* ── Brand ── */}
        <div className="login-brand">
          <div className="login-brand-icon"><Icon.BookOpen /></div>
          <div>
            <div className="login-brand-name">LessonAI</div>
            <div className="login-brand-sub">Teacher workspace</div>
          </div>
        </div>

        {/* ── Heading ── */}
        <div className="login-heading">
          <h1 className="login-title">{title}</h1>
          <p className="login-subtitle">{subtitle}</p>
        </div>

        {/* ── Form ── */}
        <div className="login-form">
          {error   && <p className="error-box login-feedback-box">{error}</p>}
          {success && <p className="login-success-box">{success}</p>}

          {/* Google button — signin & signup only */}
          {showEmailPasswordForm && (
            <>
              <button
                type="button"
                className="login-google-btn"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <Icon.GoogleG />
                {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
              </button>

              <div className="login-divider">
                <div className="login-divider-line" />
                <span className="login-divider-text">or continue with email</span>
                <div className="login-divider-line" />
              </div>
            </>
          )}

          {/* Email — signin, signup, forgotpw */}
          {mode !== "resetpw" && (
            <div className="field">
              <FieldLabel htmlFor="login-email">Email address</FieldLabel>
              <input
                id="login-email"
                type="email"
                className="input"
                placeholder="you@school.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="email"
                autoFocus
              />
            </div>
          )}

          {/* Password — signin & signup */}
          {showEmailPasswordForm && (
            <div className="field" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                <label htmlFor="login-password" className="field-label">Password</label>
                {mode === "signin" && (
                  <button type="button" className="login-forgot" onClick={() => switchMode("forgotpw")}>
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="login-password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>
          )}

          {/* Confirm password — signup */}
          {mode === "signup" && (
            <div className="field" style={{ marginTop: 14 }}>
              <FieldLabel htmlFor="login-confirm">Confirm password</FieldLabel>
              <input
                id="login-confirm"
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="new-password"
              />
            </div>
          )}

          {/* New password fields — resetpw */}
          {mode === "resetpw" && !success && (
            <>
              <div className="field">
                <FieldLabel htmlFor="login-password">New password</FieldLabel>
                <input
                  id="login-password"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div className="field" style={{ marginTop: 14 }}>
                <FieldLabel htmlFor="login-confirm">Confirm new password</FieldLabel>
                <input
                  id="login-confirm"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoComplete="new-password"
                />
              </div>
            </>
          )}

          {/* Primary CTA — hidden after success on forgotpw / resetpw */}
          {!(success && (mode === "forgotpw" || mode === "resetpw")) && (
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 22 }}
              onClick={
                mode === "forgotpw" ? handleForgotPassword
                : mode === "resetpw" ? handleResetPassword
                : handleSubmit
              }
              disabled={loading}
            >
              {loading ? (
                <>
                  <Icon.Loader />{" "}
                  {mode === "forgotpw" ? "Sending…"
                   : mode === "resetpw" ? "Saving…"
                   : mode === "signup"  ? "Creating account…"
                   : "Signing in…"}
                </>
              ) : (
                mode === "forgotpw" ? "Send reset link"
                : mode === "resetpw" ? "Set new password"
                : mode === "signup"  ? "Create account"
                : "Sign in"
              )}
            </button>
          )}

          {/* Footer links */}
          {(mode === "signin" || mode === "signup") && (
            <p className="login-switch">
              {mode === "signup" ? "Already have an account?" : "Don't have an account?"}
              {" "}
              <button
                type="button"
                className="login-switch-btn"
                onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
              >
                {mode === "signup" ? "Sign in" : "Create account"}
              </button>
            </p>
          )}

          {mode === "forgotpw" && (
            <p className="login-switch">
              <button type="button" className="login-switch-btn" onClick={() => switchMode("signin")}>
                ← Back to sign in
              </button>
            </p>
          )}
        </div>

      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   APP ROOT
════════════════════════════════════════════════════════════ */

type AuthUser = { id: string; email?: string };

export default function App() {
  const [page, setPage] = useState<Page>("login");
  const [sharedLesson, setSharedLesson] = useState<Lesson | null>(null);
  const [sharedTemplate1Lesson, setSharedTemplate1Lesson] = useState<Template1Lesson | null>(null);
  const [sharedCustomTemplateId, setSharedCustomTemplateId] = useState<string | null>(null);
  const [sharedLessonMeta, setSharedLessonMeta] = useState<LessonMeta | null>(null);
  const [generatedLessonId, setGeneratedLessonId] = useState<number | null>(null);
  const [autoEvaluate, setAutoEvaluate] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginMode, setLoginMode] = useState<"default" | "recovery">("default");

  useEffect(() => {
    // Safety net: if getSession() hangs (e.g. token refresh on a slow/paused
    // Supabase project), force the login page after 3 s so the app is never blank.
    const authFallback = setTimeout(() => {
      setPage("login");
      setAuthChecked(true);
    }, 3000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(authFallback);
        const u = session?.user ?? null;
        setUser(u ? { id: u.id, email: u.email } : null);
        setPage(u ? "generator" : "login");
        setAuthChecked(true);
        if (u) {
          loadOrCreateProfile(u.id, u.email ?? "")
            .then(setProfile)
            .catch(() => {}); // profile failure is non-fatal
        }
      })
      .catch(() => {
        clearTimeout(authFallback);
        setPage("login");
        setAuthChecked(true);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u ? { id: u.id, email: u.email } : null);

      if (event === "PASSWORD_RECOVERY") {
        // User clicked the reset link in their email. Stay on the login page
        // and switch LoginPage into password-reset mode.
        setPage("login");
        setLoginMode("recovery");
        return;
      }

      if (event === "USER_UPDATED" && u) {
        // Password (or other profile data) was updated. Navigate to the app.
        setLoginMode("default");
        setPage("generator");
        loadOrCreateProfile(u.id, u.email ?? "")
          .then(setProfile)
          .catch(() => {});
        return;
      }

      if (event === "SIGNED_IN" && u) {
        setLoginMode("default");
        setPage("generator");
        loadOrCreateProfile(u.id, u.email ?? "")
          .then(setProfile)
          .catch(() => {});
      }
      if (event === "SIGNED_OUT") {
        setPage("login");
        setLoginMode("default");
        setProfile(null);
      }
    });

    return () => {
      clearTimeout(authFallback);
      subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    setSharedLesson(null);
    setSharedTemplate1Lesson(null);
    setSharedCustomTemplateId(null);
    setSharedLessonMeta(null);
    setGeneratedLessonId(null);
    setAutoEvaluate(false);
    setProfile(null);
    await supabase.auth.signOut();
  }

  if (!authChecked) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f9f7f4" }}>
      <Icon.Loader />
    </div>
  );

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {page === "login" ? (
        <LoginPage forceRecovery={loginMode === "recovery"} />
      ) : (
        <div className="app-shell">
          <Sidebar page={page} setPage={setPage} userEmail={profile?.email ?? user?.email} onLogout={handleLogout} />
          <main className="main-content">
            {page === "generator"
              ? <GeneratorPage
                  sharedLesson={sharedLesson}
                  sharedTemplate1Lesson={sharedTemplate1Lesson}
                  sharedCustomTemplateId={sharedCustomTemplateId}
                  onLessonGenerated={setSharedLesson}
                  onTemplate1LessonGenerated={setSharedTemplate1Lesson}
                  onCustomTemplateSelected={setSharedCustomTemplateId}
                  onLessonSaved={setGeneratedLessonId}
                  onLessonMetaGenerated={setSharedLessonMeta}
                  onEvaluateLesson={() => { setAutoEvaluate(true); setPage("evaluator"); }}
                  lessonId={generatedLessonId}
                  userId={user!.id}
                />
              : page === "evaluator"
              ? <EvaluatorPage
                  lesson={sharedLesson}
                  template1Lesson={sharedTemplate1Lesson}
                  lessonId={generatedLessonId}
                  userId={user!.id}
                  lessonMeta={sharedLessonMeta}
                  autoEvaluate={autoEvaluate}
                  onAutoEvaluateDone={() => setAutoEvaluate(false)}
                />
              : <LibraryPage userId={user!.id} />}
          </main>
        </div>
      )}
    </>
  );
}
