import { useState, useRef, useEffect } from "react";
import "./index.css";

/* ════════════════════════════════════════════════════════════
   TYPES
════════════════════════════════════════════════════════════ */

type Page = "generator" | "evaluator";

type Activity = { name: string; minutes: number; detail: string };

type Lesson = {
  title: string;
  objectives: string[];
  materials: string[];
  activities: Activity[];
  assessment: string;
  differentiation?: string;   // optional — API may include this
};

/**
 * Coerce a raw API response into a safe Lesson.
 * Guarantees every array field is actually an array, and every string field
 * is a string, so .map() calls in JSX can never throw.
 */
function normaliseLesson(raw: unknown): Lesson {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ensureArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const ensureStr = (v: unknown): string  => (typeof v === "string" ? v : "");

  const rawActivities = ensureArr(r.activities);
  const activities: Activity[] = rawActivities.map((a) => {
    const act = (a ?? {}) as Record<string, unknown>;
    return {
      name:    ensureStr(act.name),
      minutes: typeof act.minutes === "number" ? act.minutes : 0,
      detail:  ensureStr(act.detail),
    };
  });

  return {
    title:           ensureStr(r.title),
    objectives:      ensureArr(r.objectives).map(ensureStr),
    materials:       ensureArr(r.materials).map(ensureStr),
    activities,
    assessment:      ensureStr(r.assessment),
    differentiation: r.differentiation !== undefined ? ensureStr(r.differentiation) : undefined,
  };
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
  frameworks: string[];
  code: string;
  goal: string;
  duration: number;
}): Promise<Lesson> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  const raw = await res.json();
  return normaliseLesson(raw);
}

// Shape returned by /api/evaluate
type EvaluationSection = {
  id: string;
  title: string;
  score: number;
  feedback: string;
};

type EvaluationResult = {
  score: number;          // overall 0-100
  band: string;           // e.g. "Classroom-ready"
  summary: string;        // AI feedback paragraph
  sections: EvaluationSection[];
};

async function evaluateLesson(lesson: Lesson): Promise<EvaluationResult> {
  const res = await fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lesson }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(msg || `Server error ${res.status}`);
  }
  return res.json() as Promise<EvaluationResult>;
}

/* ════════════════════════════════════════════════════════════
   ICONS (inline SVG, no lucide dependency)
════════════════════════════════════════════════════════════ */

const Icon = {
  BookOpen: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
  Sparkles: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  ),
  FileCheck: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>
    </svg>
  ),
  FileText: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>
    </svg>
  ),
  Loader: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  ),
  Chevron: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
};

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

/** Animated accordion item */
function AccordionItem({
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
   SIDEBAR
════════════════════════════════════════════════════════════ */

function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const nav = [
    { id: "generator" as Page, label: "Generator", Icon: Icon.Sparkles },
    { id: "evaluator" as Page, label: "Evaluator", Icon: Icon.FileCheck },
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
          <div className="sidebar-avatar">MR</div>
          <div>
            <div className="sidebar-user-name">Ms. Rivera</div>
            <div className="sidebar-user-sub">7th Grade · Science</div>
          </div>
        </div>
      </div>
    </nav>
  );
}

/* ════════════════════════════════════════════════════════════
   GENERATOR PAGE
════════════════════════════════════════════════════════════ */

const GRADES = ["K","1","2","3","4","5","6","7","8","9","10","11","12"];
const DURATIONS = [30, 45, 60, 90];

const FRAMEWORKS = [
  { value: "ngss",  label: "NGSS" },
  { value: "ccss",  label: "Common Core" },
  { value: "teks",  label: "TEKS (Texas)" },
  { value: "state", label: "State-specific" },
];

function GeneratorPage({
  sharedLesson,
  onLessonGenerated,
}: {
  sharedLesson: Lesson | null;
  onLessonGenerated: (l: Lesson) => void;
}) {
  // Standards: multi-select list of framework ids + optional custom text
  const [selectedFws, setSelectedFws] = useState<string[]>(["ngss"]);
  const [customFw, setCustomFw]       = useState("");
  const [grade, setGrade]             = useState("7");
  const [code, setCode]               = useState("MS-LS1-6");
  const [goal, setGoal]               = useState("Help students understand how plants produce energy through photosynthesis.");
  const [duration, setDuration]       = useState(60);
  const [loading, setLoading]         = useState(false);
  const [lesson, setLesson]           = useState<Lesson | null>(sharedLesson);
  const [error, setError]             = useState<string | null>(null);

  const CUSTOM_ID = "custom";
  const hasCustom = selectedFws.includes(CUSTOM_ID);

  function toggleFramework(id: string) {
    setSelectedFws((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }

  /** Resolved labels sent to the API and shown in the breadcrumb */
  function resolvedFrameworks(): string[] {
    return selectedFws.map((id) => {
      if (id === CUSTOM_ID) return customFw.trim() || "Custom";
      return FRAMEWORKS.find((f) => f.value === id)?.label ?? id;
    });
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateLesson({ grade, frameworks: resolvedFrameworks(), code, goal, duration });
      setLesson(result);
      onLessonGenerated(result);   // share with the Evaluator
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const breadcrumb = [...resolvedFrameworks(), code, `Grade ${grade}`, `${duration} min`].filter(Boolean).join(" · ");

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

            {/* Grade */}
            <div className="field">
              <FieldLabel>Grade Level</FieldLabel>
              <div className="grade-row">
                {/* Kindergarten — visually separated */}
                <button
                  type="button"
                  className={`grade-btn grade-k${grade === "K" ? " active-k" : ""}`}
                  onClick={() => setGrade("K")}
                  title="Kindergarten"
                >
                  K
                </button>

                {/* Thin separator */}
                <span className="grade-sep" aria-hidden="true" />

                {/* Numeric grades 1–12 */}
                {GRADES.slice(1).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`grade-btn${grade === g ? " active" : ""}`}
                    onClick={() => setGrade(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Standards — multi-select chips + optional custom */}
            <div className="field">
              <FieldLabel>Standards Framework</FieldLabel>

              {/* Chip row: preset frameworks + Custom toggle */}
              <div className="fw-chip-row">
                {FRAMEWORKS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    className={`fw-chip${selectedFws.includes(f.value) ? " fw-chip-active" : ""}`}
                    onClick={() => toggleFramework(f.value)}
                    aria-pressed={selectedFws.includes(f.value)}
                  >
                    {f.label}
                  </button>
                ))}

                {/* Separator */}
                <span className="grade-sep" aria-hidden="true" />

                {/* Custom toggle */}
                <button
                  type="button"
                  className={`fw-chip fw-chip-custom${hasCustom ? " fw-chip-custom-active" : ""}`}
                  onClick={() => toggleFramework(CUSTOM_ID)}
                  aria-pressed={hasCustom}
                >
                  {hasCustom ? "Custom ✓" : "+ Custom"}
                </button>
              </div>

              {/* Custom framework text input — shown only when Custom is selected */}
              {hasCustom && (
                <div className="fw-custom-input-wrap">
                  <input
                    className="input"
                    autoFocus
                    value={customFw}
                    onChange={(e) => setCustomFw(e.target.value)}
                    placeholder="e.g. My District Framework, IB MYP, AP Science…"
                    aria-label="Custom framework name"
                  />
                </div>
              )}

              {/* Standard code — always visible below */}
              <div style={{ marginTop: 10 }}>
                <FieldLabel htmlFor="code" hint="Optional">
                  Standard Code{selectedFws.length > 1 ? "s" : ""}
                </FieldLabel>
                <input
                  id="code"
                  className="input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={selectedFws.length > 1 ? "e.g. MS-LS1-6, CCSS.ELA-LITERACY.RST.6-8.3" : "e.g. MS-LS1-6"}
                />
              </div>
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
        {lesson ? (
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="preview-header">
              <p className="preview-breadcrumb">{breadcrumb}</p>
              <h2 className="preview-title">{lesson.title}</h2>
            </div>
            <div className="preview-body">
              <AccordionItem title="Learning Objectives" defaultOpen>
                <ol className="obj-list">
                  {(lesson.objectives || []).map((o, i) => (
                    <li key={i} className="obj-item">
                      <span className="obj-num">{String(i + 1).padStart(2, "0")}</span>
                      <span style={{ lineHeight: 1.55 }}>{o}</span>
                    </li>
                  ))}
                </ol>
              </AccordionItem>

              <AccordionItem title="Materials">
                <ul className="mat-list">
                  {(lesson.materials || []).map((m, i) => (
                    <li key={i} className="mat-item">
                      <span className="mat-dot" />
                      {m}
                    </li>
                  ))}
                </ul>
              </AccordionItem>

              <AccordionItem title="Activities" defaultOpen>
                <ol className="act-list">
                  {(lesson.activities || []).map((a, i) => (
                    <li key={i} className="act-item">
                      <span className="act-time">{a.minutes}m</span>
                      <div>
                        <div className="act-name">{a.name}</div>
                        <div className="act-detail">{a.detail}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </AccordionItem>

              <AccordionItem title="Assessment" isLast={!lesson.differentiation}>
                <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
                  {lesson.assessment || "No assessment details provided."}
                </p>
              </AccordionItem>

              {lesson.differentiation && (
                <AccordionItem title="Differentiation" isLast>
                  <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
                    {lesson.differentiation}
                  </p>
                </AccordionItem>
              )}
            </div>
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

/* ── Demo presets ─────────────────────────────────────────────────────────────
   Three canned scenarios that let you preview all three score-color states
   before the real API is wired up. Each preset overrides the overall score,
   badge label, feedback summary, and every section score.
────────────────────────────────────────────────────────────────────────────── */
type DemoPreset = {
  label: string;        // button label
  score: number;        // overall score
  band: string;         // badge text
  summary: string;      // AI feedback paragraph
  sectionScores: Record<string, number>;
};

const DEMO_PRESETS: DemoPreset[] = [
  {
    label: "Strong Example",
    score: 88,   // avg of section scores (90+92+84+86)/4
    band: "Classroom-ready",
    summary:
      "Clear objectives, well-paced activities, and a defensible assessment. Minor refinements to standards citation and differentiation would strengthen the plan further.",
    sectionScores: { standards: 90, objectives: 92, instruction: 84, assessment: 86 },
  },
  {
    label: "Needs Revision",
    score: 72,   // avg of section scores (74+71+68+73)/4
    band: "Needs revision",
    summary:
      "The lesson has a solid foundation but requires revision before classroom use. Learning objectives need sharper measurable language and the assessment evidence is thin.",
    sectionScores: { standards: 74, objectives: 71, instruction: 68, assessment: 73 },
  },
  {
    label: "Not Ready",
    score: 54,   // avg of section scores (55+58+49+52)/4
    band: "Not ready",
    summary:
      "Significant gaps in standards alignment and instructional design. The plan needs a full rewrite of objectives, a clearer activity sequence, and a real assessment strategy.",
    sectionScores: { standards: 55, objectives: 58, instruction: 49, assessment: 52 },
  },
];

const SECTION_TEMPLATES = [
  {
    id: "standards", title: "Standards Alignment",
    feedback: "MS-LS1-6 is well represented across the modeling task and assessment. Consider explicitly tagging the science and engineering practice (developing and using models) in the rubric.",
  },
  {
    id: "objectives", title: "Learning Objectives",
    feedback: "Objectives are observable and tied directly to the assessment. Phrasing is student-facing and action-oriented. No changes needed.",
  },
  {
    id: "instruction", title: "Instructional Design",
    feedback: "Pacing is appropriate and the lab anchors the conceptual content. Add a 2-minute checkpoint after the direct instruction segment to surface misconceptions earlier.",
  },
  {
    id: "assessment", title: "Assessment Strategy",
    feedback: "Exit ticket aligns with the objectives and produces evidence of learning. Consider providing a sentence stem for students who need a writing scaffold.",
  },
];

type ScoreCat = "strong" | "amber" | "weak";

function scoreCategory(s: number): ScoreCat {
  if (s >= 80) return "strong";
  if (s >= 60) return "amber";
  return "weak";
}

/** CSS variable name for a score's text color */
function scoreColorVar(cat: ScoreCat): string {
  return `var(--score-${cat})`;
}

function EvalSection({
  section,
  isLast,
}: {
  section: typeof SECTION_TEMPLATES[0] & { score: number };
  isLast: boolean;
}) {
  const [override, setOverride] = useState("");
  const cat = scoreCategory(section.score);

  const scoreEl = (
    <span style={{ fontFamily: "Space Grotesk, sans-serif", fontSize: 15, fontWeight: 400, color: scoreColorVar(cat) }}>
      {section.score}
    </span>
  );

  return (
    <AccordionItem
      key={section.id}
      title={section.title}
      right={
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          {scoreEl}
          <div className="score-bar-track" style={{ width: 120 }}>
            <div
              className={`score-bar-fill ${cat}`}
              style={{ width: `${section.score}%` }}
            />
          </div>
        </div>
      }
      isLast={isLast}
    >
      <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
        {section.feedback}
      </p>
      <div className="override-section">
        <div className="override-label">Teacher notes &amp; override</div>
        <textarea
          className="textarea"
          rows={2}
          value={override}
          onChange={(e) => setOverride(e.target.value)}
          placeholder="Add context, adjust the score, or refine the feedback…"
          style={{ background: "var(--background)", fontSize: 13 }}
        />
      </div>
    </AccordionItem>
  );
}

function EvaluatorPage({ lesson }: { lesson: Lesson | null }) {
  // Real API result — null until a successful /api/evaluate call
  const [evalResult, setEvalResult]   = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating]   = useState(false);
  const [evalError, setEvalError]     = useState<string | null>(null);

  // Demo fallback — visible only when no real result exists yet
  const [presetIdx, setPresetIdx]     = useState(0);

  // The lesson displayed in the "Reviewing" card
  const displayLesson = lesson ?? LESSON_META;

  async function handleEvaluate() {
    setEvaluating(true);
    setEvalError(null);
    try {
      const result = await evaluateLesson(displayLesson as Lesson);
      setEvalResult(result);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Evaluation failed. Please try again.");
    } finally {
      setEvaluating(false);
    }
  }

  // Derive what to show: real API result takes priority over demo preset
  const activePreset = DEMO_PRESETS[presetIdx];
  const displayScore   = evalResult?.score   ?? activePreset.score;
  const displayBand    = evalResult?.band    ?? activePreset.band;
  const displaySummary = evalResult?.summary ?? activePreset.summary;
  const displaySections: EvaluationSection[] = evalResult?.sections
    ?? SECTION_TEMPLATES.map((t) => ({
        ...t,
        score: activePreset.sectionScores[t.id] ?? 0,
      }));

  const cat = scoreCategory(displayScore);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader title="Lesson Evaluator" subtitle="AI assessment with teacher review." />

      {/* ── Demo switcher — hidden once real results arrive ── */}
      {!evalResult && (
        <DemoControl presetIdx={presetIdx} onSelect={setPresetIdx} />
      )}

      {/* Lesson card */}
      <div className="card" style={{ padding: "24px 28px", marginTop: evalResult ? 0 : 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)" }}>
              Reviewing
            </p>
            <h2 style={{ marginTop: 6, fontSize: "1.2rem", lineHeight: 1.3, maxWidth: 600 }}>
              {(displayLesson as typeof LESSON_META).title}
            </h2>
            <div className="meta-row">
              <span>Grade {(displayLesson as typeof LESSON_META).grade}</span>
              <span className="meta-dot">·</span>
              <span>{(displayLesson as typeof LESSON_META).duration} min</span>
            </div>
            {(displayLesson as typeof LESSON_META).overview && (
              <p style={{ marginTop: 12, fontSize: 14, color: "rgb(48 44 39 / 0.8)", lineHeight: 1.65, maxWidth: 620 }}>
                {(displayLesson as typeof LESSON_META).overview}
              </p>
            )}
          </div>

          {/* Evaluate button */}
          <div style={{ flexShrink: 0, paddingTop: 2 }}>
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
        {evalError && (
          <p className="error-box" style={{ marginTop: 12 }}>{evalError}</p>
        )}
      </div>

      {/* Overall score card */}
      <div className="card" style={{ padding: "24px 28px", marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 32, flexWrap: "wrap" }}>
          {/* Score number + badge */}
          <div style={{ flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)" }}>
              Overall
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 }}>
              <span className="score-number" style={{ color: scoreColorVar(cat) }}>
                {displayScore}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted-fg)" }}>/100</span>
            </div>
            <div className={`score-band ${cat}`}>
              <span className="score-band-dot" style={{ background: `var(--score-${cat}-dot)` }} />
              {displayBand}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />

          {/* Feedback */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)" }}>
              {evalResult ? "AI Feedback" : "AI Feedback · demo"}
            </p>
            <p style={{ marginTop: 8, fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.65 }}>
              {displaySummary}
            </p>
          </div>
        </div>
      </div>

      {/* Detailed sections */}
      <div style={{ marginTop: 32 }}>
        <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 12 }}>
          {evalResult ? "Detailed Evaluation" : "Detailed Evaluation · demo"}
        </p>
        <div className="card" style={{ padding: "0 24px", overflow: "hidden" }}>
          {displaySections.map((s, i) => (
            <EvalSection key={s.id} section={s} isLast={i === displaySections.length - 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Demo switcher ────────────────────────────────────────────────────────────
   Visible strip placed directly in the page body (not tucked into the header).
   Three large toggle buttons — one per score state — with clear label, score,
   and a coloured indicator dot. Active button gets a tinted background so the
   current selection is immediately obvious.
────────────────────────────────────────────────────────────────────────────── */
function DemoControl({
  presetIdx,
  onSelect,
}: {
  presetIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="demo-strip">
      {/* Left label */}
      <div className="demo-strip-label">
        <span className="demo-strip-tag">Demo</span>
        <span className="demo-strip-hint">Preview score states</span>
      </div>

      {/* Three state buttons */}
      <div className="demo-strip-btns">
        {DEMO_PRESETS.map((p, i) => {
          const cat = scoreCategory(p.score);
          const isActive = presetIdx === i;
          return (
            <button
              key={i}
              type="button"
              className={`demo-state-btn demo-state-btn-${cat}${isActive ? " demo-state-btn-active" : ""}`}
              onClick={() => onSelect(i)}
            >
              {/* Colour indicator */}
              <span
                className="demo-state-dot"
                style={{ background: isActive ? `var(--score-${cat}-dot)` : undefined }}
              />
              <span className="demo-state-name">{p.label}</span>
              <span className="demo-state-score">{p.score}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   APP ROOT
════════════════════════════════════════════════════════════ */

export default function App() {
  const [page, setPage] = useState<Page>("generator");
  // Lesson lives here so the Evaluator can access what the Generator produced
  const [sharedLesson, setSharedLesson] = useState<Lesson | null>(null);

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div className="app-shell">
        <Sidebar page={page} setPage={setPage} />
        <main className="main-content">
          {page === "generator"
            ? <GeneratorPage sharedLesson={sharedLesson} onLessonGenerated={setSharedLesson} />
            : <EvaluatorPage lesson={sharedLesson} />}
        </main>
      </div>
    </>
  );
}
