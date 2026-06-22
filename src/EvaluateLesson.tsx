import { useLocation, useNavigate } from "react-router-dom";

/* ── Types (mirrors App.tsx) ────────────────────────────────── */
type Activity = { name: string; minutes: number; detail: string };
type Lesson = {
  title: string;
  objectives: string[];
  materials: string[];
  activities: Activity[];
  assessment: string;
  differentiation?: string;
};

/* ── Small inline icons ─────────────────────────────────────── */
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5"/><path d="m12 5-7 7 7 7"/>
  </svg>
);

/* ── Section card ───────────────────────────────────────────── */
function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "20px 24px", marginBottom: 16 }}>
      <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 12 }}>
        {title}
      </p>
      {children}
    </div>
  );
}

/* ── EvaluateLesson page ────────────────────────────────────── */
export default function EvaluateLesson() {
  const location = useLocation();
  const navigate = useNavigate();
  const lesson = (location.state as { lesson?: Lesson } | null)?.lesson ?? null;

  /* No lesson state — user landed here directly or refreshed */
  if (!lesson) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--background, #f9f7f4)" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: "var(--muted-fg)", marginBottom: 20 }}>
            No lesson data found. Please generate a lesson first.
          </p>
          <button type="button" className="btn-outline-sm" onClick={() => navigate("/")}>
            ← Back to Generator
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--background, #f9f7f4)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 40px 60px" }}>

        {/* ── Page header ── */}
        <div style={{ marginBottom: 32 }}>
          <button
            type="button"
            className="btn-outline-sm"
            onClick={() => navigate("/")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 20 }}
          >
            <BackIcon /> Back to Generator
          </button>

          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted-fg)", marginBottom: 6 }}>
            Evaluate Lesson
          </p>
          <h1 style={{ margin: 0, fontSize: "1.45rem", fontWeight: 600, lineHeight: 1.25, letterSpacing: "-0.02em" }}>
            {lesson.title}
          </h1>
        </div>

        {/* ── Learning Objectives ── */}
        <SectionCard title="Learning Objectives">
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            {lesson.objectives.map((o, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: "rgb(48 44 39 / 0.85)" }}>
                {o}
              </li>
            ))}
          </ol>
        </SectionCard>

        {/* ── Materials ── */}
        <SectionCard title="Materials">
          <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {lesson.materials.map((m, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: "rgb(48 44 39 / 0.85)" }}>
                {m}
              </li>
            ))}
          </ul>
        </SectionCard>

        {/* ── Activities ── */}
        <SectionCard title="Activities">
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 14 }}>
            {lesson.activities.map((a, i) => (
              <li key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: "var(--muted-fg)",
                  background: "var(--border, #e8e4dc)", padding: "3px 8px",
                  borderRadius: 4, flexShrink: 0, marginTop: 2,
                }}>
                  {a.minutes}m
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{a.name}</div>
                  <div style={{ fontSize: 13, color: "rgb(48 44 39 / 0.72)", lineHeight: 1.55 }}>{a.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>

        {/* ── Assessment ── */}
        <SectionCard title="Assessment">
          <p style={{ margin: 0, fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
            {lesson.assessment || "No assessment details provided."}
          </p>
        </SectionCard>

        {/* ── Differentiation (optional) ── */}
        {lesson.differentiation && (
          <SectionCard title="Differentiation">
            <p style={{ margin: 0, fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
              {lesson.differentiation}
            </p>
          </SectionCard>
        )}

      </div>
    </div>
  );
}
