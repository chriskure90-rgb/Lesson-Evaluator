import { useState, useRef, useEffect } from "react";
import "./index.css";
import { supabase } from "./lib/supabase";

/* ════════════════════════════════════════════════════════════
   TYPES
════════════════════════════════════════════════════════════ */

type Page = "login" | "generator" | "evaluator" | "library";

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
  topic: string;
  goal: string;
  duration: number;
  model: string;
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
  Library: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18"/><path d="M3 6h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3"/><path d="M13 3l4 18"/><path d="M21 3l-4 18"/>
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  ArrowUpRight: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h10v10"/><path d="M7 17 17 7"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

const MODELS = [
  { value: "gpt-4",    label: "GPT-4",    hint: "OpenAI"    },
  { value: "claude",   label: "Claude",   hint: "Anthropic" },
  { value: "gemini",   label: "Gemini",   hint: "Google"    },
  { value: "mistral",  label: "Mistral",  hint: "Mistral AI" },
];

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
  const [model, setModel]             = useState("claude");
  const [grade, setGrade]             = useState("7");
  const [code, setCode]               = useState("MS-LS1-6");
  const [topic, setTopic]             = useState("");
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
      const result = await generateLesson({ grade, frameworks: resolvedFrameworks(), code, topic, goal, duration, model });
      setLesson(result);
      onLessonGenerated(result);   // share with the Evaluator

      const { error: saveError } = await supabase
  .from("lesson_generation")
  .insert([
    {
      lesson_topic: topic,
      api_model: model,
      grade_level: String(grade),
      standards_framework: resolvedFrameworks().join(", "),
      standard_code: code,
      lesson_goal: goal,
      duration: String(duration),
      lesson_json: result,
      is_demo: false,
    },
  ]);
      if (saveError) {
        console.error("Supabase insert error:", saveError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const modelLabel = MODELS.find((m) => m.value === model)?.label ?? model;
  const breadcrumb = [modelLabel, ...resolvedFrameworks(), code, `Grade ${grade}`, `${duration} min`].filter(Boolean).join(" · ");

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
  label: string;
  band: string;
  summary: string;
  sectionRatings: Record<string, RubricRating>;
};

const DEMO_PRESETS: DemoPreset[] = [
  {
    // Score: 19/20 · 0 Low ratings → Classroom Ready
    label: "Classroom Ready",
    band: "Classroom Ready",
    summary:
      "This lesson plan is well-constructed across all dimensions. Objectives are clearly measurable, activities build logically toward the assessment, standards are tightly aligned, and differentiation is intentional. One minor refinement to the resources list would make this plan complete.",
    sectionRatings: {
      "lesson-title":    "high",
      "objectives":      "high",
      "standards":       "high",
      "assessment":      "high",
      "activities":      "high",
      "resources":       "medium",
      "differentiation": "high",
      "timing":          "high",
      "opening":         "high",
      "evaluation":      "high",
    },
  },
  {
    // Score: 17/20 · 0 Low ratings → Classroom Ready with Teacher Revision
    label: "Ready with Revision",
    band: "Classroom Ready with Teacher Revision",
    summary:
      "The lesson has strong foundations in title, objectives, and opening, but differentiation, resources, and evaluation reflection need attention before classroom use. With targeted revisions to those three areas this plan will be ready.",
    sectionRatings: {
      "lesson-title":    "high",
      "objectives":      "high",
      "standards":       "high",
      "assessment":      "high",
      "activities":      "high",
      "resources":       "medium",
      "differentiation": "medium",
      "timing":          "high",
      "opening":         "high",
      "evaluation":      "medium",
    },
  },
  {
    // Score: 9/20 · 3 Low ratings → Needs Revision
    label: "Needs Revision",
    band: "Needs Revision",
    summary:
      "The lesson has identifiable strengths in its title and opening, but objectives lack measurable language, the assessment criteria are unclear, and differentiation strategy is largely absent. A structured revision across at least five criteria is needed before this plan is ready.",
    sectionRatings: {
      "lesson-title":    "high",
      "objectives":      "high",
      "standards":       "medium",
      "assessment":      "medium",
      "activities":      "medium",
      "resources":       "low",
      "differentiation": "low",
      "timing":          "medium",
      "opening":         "medium",
      "evaluation":      "low",
    },
  },
  {
    // Score: 2/20 · 8 Low ratings → Not Ready
    label: "Not Ready",
    band: "Not Ready",
    summary:
      "Significant gaps exist across nearly every dimension. Objectives are unmeasurable, activities are disconnected from the assessment, standards alignment is missing, and there is no differentiation or structured reflection. This plan requires a full rewrite before it can be used in a classroom.",
    sectionRatings: {
      "lesson-title":    "medium",
      "objectives":      "low",
      "standards":       "low",
      "assessment":      "low",
      "activities":      "low",
      "resources":       "low",
      "differentiation": "low",
      "timing":          "low",
      "opening":         "medium",
      "evaluation":      "low",
    },
  },
];

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

/* ── LessonPanel ─────────────────────────────────────────────────────────────
   Compact read-only view of the generated lesson plan.
   Toggled by "View lesson plan" in the Evaluator lesson card.
   Reuses AccordionItem for consistent look; no editing here.
────────────────────────────────────────────────────────────────────────────── */
function LessonPanel({ lesson }: { lesson: Lesson }) {
  return (
    <div className="lesson-panel">
      <div className="lesson-panel-header">
        <p className="lesson-panel-label">Lesson Plan</p>
        <h3 className="lesson-panel-title">{lesson.title}</h3>
      </div>

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

      <AccordionItem title="Activities">
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
  );
}

function EvaluatorPage({ lesson }: { lesson: Lesson | null }) {
  const [evalResult, setEvalResult]   = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating]   = useState(false);
  const [evalError, setEvalError]     = useState<string | null>(null);
  const [presetIdx, setPresetIdx]     = useState(0);

  // Lifted teacher overrides keyed by section id — shared across all EvalSections
  const [teacherOverrides, setTeacherOverrides] = useState<Record<string, RubricRating | null>>({});
  const [teacherNotes, setTeacherNotes]         = useState<Record<string, string>>({});

  // Save state — snapshot of what was last explicitly saved
  const [savedOverrides, setSavedOverrides] = useState<Record<string, RubricRating | null>>({});
  const [savedNotes, setSavedNotes]         = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus]         = useState<"idle" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unsaved = current state differs from last save snapshot
  const hasUnsaved =
    JSON.stringify(teacherOverrides) !== JSON.stringify(savedOverrides) ||
    JSON.stringify(teacherNotes)     !== JSON.stringify(savedNotes);

  function handleRatingChange(id: string, rating: RubricRating | null) {
    setTeacherOverrides((prev) => ({ ...prev, [id]: rating }));
  }

  function handleNotesChange(id: string, value: string) {
    setTeacherNotes((prev) => ({ ...prev, [id]: value }));
  }

  function handleSave() {
    setSavedOverrides({ ...teacherOverrides });
    setSavedNotes({ ...teacherNotes });
    setSaveStatus("saved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
  }

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

  const [showLesson, setShowLesson] = useState(false);

  const activePreset = DEMO_PRESETS[presetIdx];

  const displaySections: EvaluationSection[] = evalResult?.sections
    ?? SECTION_TEMPLATES.map((t) => {
        const rating = activePreset.sectionRatings[t.id] ?? "medium";
        return { ...t, rating };
      });

  const displaySummary = evalResult?.summary ?? activePreset.summary;

  // Active ratings: teacher override wins over AI/demo rating for each section
  const activeRatings: RubricRating[] = displaySections.map((s) =>
    teacherOverrides[s.id] ?? (s.rating as RubricRating) ?? "medium"
  );
  const readiness = calcReadiness(activeRatings);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader title="Lesson Evaluator" subtitle="AI assessment with teacher review." />

      {/* ── Demo switcher — hidden once real results arrive ── */}
      {!evalResult && (
        <DemoControl presetIdx={presetIdx} onSelect={setPresetIdx} />
      )}

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
              {evalResult ? "AI Feedback" : "AI Feedback · demo"}
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

            {/* Evaluate / Re-evaluate */}
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

      {/* ── Expandable lesson plan panel ── */}
      {showLesson && (
        <LessonPanel lesson={displayLesson as Lesson} />
      )}

      {/* Detailed sections */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", margin: 0 }}>
            {evalResult ? "Detailed Evaluation" : "Detailed Evaluation · demo"}
          </p>

          {/* Save controls — only shown when there is something to save */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {saveStatus === "saved" && (
              <span className="save-confirmation">
                ✓ Teacher changes saved
              </span>
            )}
            <button
              type="button"
              className="btn-outline-sm"
              onClick={handleSave}
              disabled={!hasUnsaved}
              style={{ opacity: hasUnsaved ? 1 : 0.4, cursor: hasUnsaved ? "pointer" : "default" }}
            >
              Save evaluation changes
            </button>
          </div>
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
            {hasUnsaved ? (
              <span className="eval-unsaved-label">
                <span className="eval-unsaved-dot" />
                Unsaved changes
              </span>
            ) : saveStatus === "saved" ? (
              <span className="eval-saved-label">
                ✓ Evaluation changes saved
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={`btn-primary eval-save-btn${!hasUnsaved ? " eval-save-btn-dim" : ""}`}
            onClick={handleSave}
            disabled={!hasUnsaved}
          >
            Save Evaluation Changes
          </button>
        </div>

      </div>
    </div>
  );
}

/* ── Demo switcher ─────────────────────────────────────────────────────────── */
function presetCat(p: DemoPreset): "strong" | "amber" | "weak" {
  const ratings = Object.values(p.sectionRatings);
  const counts = { high: 0, medium: 0, low: 0 };
  ratings.forEach((r) => counts[r]++);
  if (counts.low > counts.high && counts.low > counts.medium) return "weak";
  if (counts.medium >= counts.high) return "amber";
  return "strong";
}

function DemoControl({
  presetIdx,
  onSelect,
}: {
  presetIdx: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="demo-strip">
      <div className="demo-strip-label">
        <span className="demo-strip-tag">Demo</span>
        <span className="demo-strip-hint">Preview rating states</span>
      </div>

      <div className="demo-strip-btns">
        {DEMO_PRESETS.map((p, i) => {
          const cat = presetCat(p);
          const isActive = presetIdx === i;
          return (
            <button
              key={i}
              type="button"
              className={`demo-state-btn demo-state-btn-${cat}${isActive ? " demo-state-btn-active" : ""}`}
              onClick={() => onSelect(i)}
            >
              <span
                className="demo-state-dot"
                style={{ background: isActive ? `var(--score-${cat}-dot)` : undefined }}
              />
              <span className="demo-state-name">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   LESSON LIBRARY — mock data + UI
════════════════════════════════════════════════════════════ */

/* Readiness status values match calcReadiness() on the Evaluator page */
type LibraryReadiness =
  | "classroom-ready"
  | "ready-with-revision"
  | "needs-revision"
  | "not-ready";

type LibraryLesson = {
  id: string;
  title: string;
  subject: string;
  grade: string;
  model: string;
  totalScore: number;   // rubric score 0-20 (High=2, Medium=1, Low=0)
  lowCount: number;     // number of Low ratings
  readiness: LibraryReadiness;
  created: string;
  frameworks: string[];
  duration: number;
};

const READINESS_META: Record<LibraryReadiness, { label: string; cls: string }> = {
  "classroom-ready":     { label: "Classroom Ready",          cls: "badge-ready"    },
  "ready-with-revision": { label: "Ready with Revision",      cls: "badge-revision" },
  "needs-revision":      { label: "Needs Revision",           cls: "badge-needs"    },
  "not-ready":           { label: "Not Ready",                cls: "badge-not"      },
};

const LIBRARY_MOCK: LibraryLesson[] = [
  {
    id: "1",
    title: "Modeling Photosynthesis with Everyday Materials",
    subject: "Science", grade: "7", model: "Claude",
    totalScore: 19, lowCount: 0, readiness: "classroom-ready",
    created: "2025-05-18", frameworks: ["NGSS"], duration: 60,
  },
  {
    id: "2",
    title: "Introduction to Fractions Using Pattern Blocks",
    subject: "Mathematics", grade: "4", model: "GPT-4",
    totalScore: 11, lowCount: 3, readiness: "needs-revision",
    created: "2025-05-15", frameworks: ["Common Core"], duration: 45,
  },
  {
    id: "3",
    title: "The Water Cycle: Evaporation & Condensation",
    subject: "Science", grade: "5", model: "Gemini",
    totalScore: 19, lowCount: 0, readiness: "classroom-ready",
    created: "2025-05-12", frameworks: ["NGSS"], duration: 60,
  },
  {
    id: "4",
    title: "Writing Persuasive Paragraphs with Evidence",
    subject: "English", grade: "6", model: "Claude",
    totalScore: 17, lowCount: 0, readiness: "ready-with-revision",
    created: "2025-05-10", frameworks: ["Common Core"], duration: 45,
  },
  {
    id: "5",
    title: "Understanding Supply & Demand with Role-Play",
    subject: "Social Studies", grade: "9", model: "Mistral",
    totalScore: 6, lowCount: 6, readiness: "not-ready",
    created: "2025-05-08", frameworks: ["State-specific"], duration: 90,
  },
  {
    id: "6",
    title: "Cell Division: Mitosis vs. Meiosis Comparison",
    subject: "Biology", grade: "10", model: "GPT-4",
    totalScore: 20, lowCount: 0, readiness: "classroom-ready",
    created: "2025-05-05", frameworks: ["NGSS", "Common Core"], duration: 60,
  },
  {
    id: "7",
    title: "Colonial America: Primary Source Analysis",
    subject: "History", grade: "8", model: "Claude",
    totalScore: 15, lowCount: 0, readiness: "ready-with-revision",
    created: "2025-04-30", frameworks: ["Common Core"], duration: 45,
  },
  {
    id: "8",
    title: "Graphing Linear Equations on the Coordinate Plane",
    subject: "Mathematics", grade: "8", model: "Gemini",
    totalScore: 13, lowCount: 2, readiness: "needs-revision",
    created: "2025-04-25", frameworks: ["Common Core"], duration: 60,
  },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function LibraryPage() {
  const [query,     setQuery]     = useState("");
  const [statusFlt, setStatusFlt] = useState<string>("all");
  const [sortBy,    setSortBy]    = useState<"recent" | "score">("recent");

  const visible = LIBRARY_MOCK
    .filter((l) => {
      const matchQ = query === "" ||
        l.title.toLowerCase().includes(query.toLowerCase()) ||
        l.subject.toLowerCase().includes(query.toLowerCase());
      const matchS = statusFlt === "all" || l.readiness === statusFlt;
      return matchQ && matchS;
    })
    .sort((a, b) =>
      sortBy === "score"
        ? b.totalScore - a.totalScore
        : new Date(b.created).getTime() - new Date(a.created).getTime()
    );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 40px 60px" }}>
      <PageHeader
        title="Lesson Library"
        subtitle="Browse, search, and reopen your previously generated lesson plans."
      />

      {/* ── Toolbar ── */}
      <div className="lib-toolbar">
        {/* Search */}
        <div className="lib-search-wrap">
          <span className="lib-search-icon"><Icon.Search /></span>
          <input
            className="input lib-search-input"
            type="search"
            placeholder="Search lessons or subjects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Filter by status */}
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
          </select>
        </div>

        {/* Sort */}
        <div className="lib-sort-group">
          {([["recent", "Recent"], ["score", "Highest score"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`lib-sort-btn${sortBy === v ? " lib-sort-btn-active" : ""}`}
              onClick={() => setSortBy(v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Results count ── */}
      <p className="lib-count">
        {visible.length} {visible.length === 1 ? "lesson" : "lessons"}
        {statusFlt !== "all" || query ? " matching filters" : ""}
      </p>

      {/* ── Cards grid ── */}
      {visible.length === 0 ? (
        <div className="lib-empty">
          <p className="lib-empty-title">No lessons found</p>
          <p className="lib-empty-sub">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="lib-grid">
          {visible.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonCard({ lesson }: { lesson: LibraryLesson }) {
  const meta = READINESS_META[lesson.readiness];

  return (
    <div className="lib-card">
      {/* Top row: readiness badge + rubric score */}
      <div className="lib-card-top">
        <span className={`lib-badge ${meta.cls}`}>{meta.label}</span>
        <span className="lib-rubric-score">
          {lesson.totalScore}
          <span className="lib-rubric-max">/20</span>
          {lesson.lowCount > 0 && (
            <span className="lib-rubric-lows">{lesson.lowCount}L</span>
          )}
        </span>
      </div>

      {/* Title */}
      <h3 className="lib-card-title">{lesson.title}</h3>

      {/* Meta row */}
      <div className="lib-card-meta">
        <span>{lesson.subject}</span>
        <span className="lib-meta-dot">·</span>
        <span>Grade {lesson.grade}</span>
        <span className="lib-meta-dot">·</span>
        <span>{lesson.duration} min</span>
      </div>

      {/* Secondary meta */}
      <div className="lib-card-meta" style={{ marginTop: 4 }}>
        <span>{lesson.frameworks.join(", ")}</span>
        <span className="lib-meta-dot">·</span>
        <span>{lesson.model}</span>
      </div>

      {/* Footer: date + open button */}
      <div className="lib-card-footer">
        <span className="lib-card-date">{formatDate(lesson.created)}</span>
        <button type="button" className="lib-open-btn">
          Open <Icon.ArrowUpRight />
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   LOGIN PAGE
════════════════════════════════════════════════════════════ */

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  function handleSubmit() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setError(null);
    setLoading(true);
    // Mock auth delay — replace with real call when ready
    setTimeout(() => {
      setLoading(false);
      onLogin();
    }, 900);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSubmit();
  }

  return (
    <div className="login-shell">
      <div className="login-card">

        {/* ── Brand ── */}
        <div className="login-brand">
          <div className="login-brand-icon">
            <Icon.BookOpen />
          </div>
          <div>
            <div className="login-brand-name">LessonAI</div>
            <div className="login-brand-sub">Teacher workspace</div>
          </div>
        </div>

        {/* ── Heading ── */}
        <div className="login-heading">
          <h1 className="login-title">Welcome back</h1>
          <p className="login-subtitle">Sign in to your teacher account</p>
        </div>

        {/* ── Form ── */}
        <div className="login-form">
          {error && <p className="error-box" style={{ marginBottom: 16 }}>{error}</p>}

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

          <div className="field" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
              <label htmlFor="login-password" className="field-label">Password</label>
              <button type="button" className="login-forgot" onClick={() => {}}>
                Forgot password?
              </button>
            </div>
            <input
              id="login-password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="current-password"
            />
          </div>

          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 22 }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <><Icon.Loader /> Signing in…</> : "Sign in"}
          </button>

          {/* Divider */}
          <div className="login-divider">
            <span className="login-divider-line" />
            <span className="login-divider-text">or</span>
            <span className="login-divider-line" />
          </div>

          <button
            type="button"
            className="btn-outline-sm login-demo-btn"
            onClick={onLogin}
          >
            Continue as demo
          </button>
        </div>

      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   APP ROOT
════════════════════════════════════════════════════════════ */

export default function App() {
  const [page, setPage] = useState<Page>("login");
  const [sharedLesson, setSharedLesson] = useState<Lesson | null>(null);

  function handleLogin() {
    setPage("generator");
  }

  return (
    <>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {page === "login" ? (
        <LoginPage onLogin={handleLogin} />
      ) : (
        <div className="app-shell">
          <Sidebar page={page} setPage={setPage} />
          <main className="main-content">
            {page === "generator"
              ? <GeneratorPage sharedLesson={sharedLesson} onLessonGenerated={setSharedLesson} />
              : page === "evaluator"
              ? <EvaluatorPage lesson={sharedLesson} />
              : <LibraryPage />}
          </main>
        </div>
      )}
    </>
  );
}
