import type { ReactNode } from "react";

/* ── Standard lesson plan template — structure preview with sample content ────
   Mirrors DefaultLessonView's real section list, order, and CSS classes
   exactly (Learning Objectives, Standards Alignment, Materials, Activities,
   Assessment, Differentiation) so the preview modal shows the actual
   accordion layout, spacing, and hierarchy a generated lesson would use.

   Content below is a fixed, illustrative sample lesson (never real generated
   data, never connected to actual lesson generation) — it exists so the
   preview reads like a completed document rather than a loading skeleton.
   Sections are rendered statically open (not collapsible) since the point
   is to see the whole structure at a glance.
────────────────────────────────────────────────────────────────────────────── */

function PreviewSection({
  title,
  children,
  isLast,
}: {
  title: string;
  children: ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="accordion-item" style={isLast ? { borderBottom: "none" } : undefined}>
      <div className="accordion-trigger" style={{ cursor: "default" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>{title}</span>
        </div>
        <span className="accordion-chevron open">▾</span>
      </div>
      <div className="accordion-body" style={{ height: "auto", overflow: "visible" }}>
        <div className="accordion-content">{children}</div>
      </div>
    </div>
  );
}

const SAMPLE_OBJECTIVES = [
  "Explain how force affects the motion of an object.",
  "Collect and interpret observations from a simple investigation.",
  "Communicate findings using evidence from collected data.",
];

const SAMPLE_MATERIALS = ["Chromebook", "Toy cars", "Ramp", "Measuring tape"];

const SAMPLE_ACTIVITIES = [
  { minutes: 10, name: "Force Demonstration", detail: "Teacher introduces the concept of force through a short demonstration using a ball and a ramp, asking students to predict what will happen." },
  { minutes: 25, name: "Group Investigation", detail: "Students work in small groups to roll toy cars down ramps of varying heights, measuring and recording the distance each car travels." },
  { minutes: 10, name: "Class Discussion", detail: "Groups share their observations and discuss how force affected the motion of their objects, connecting results back to the lesson goal." },
];

export function StandardTemplatePreview() {
  return (
    <div>
      <PreviewSection title="Learning Objectives">
        <ol className="obj-list">
          {SAMPLE_OBJECTIVES.map((o, i) => (
            <li key={i} className="obj-item">
              <span className="obj-num">{String(i + 1).padStart(2, "0")}</span>
              <span style={{ lineHeight: 1.55 }}>{o}</span>
            </li>
          ))}
        </ol>
      </PreviewSection>

      <PreviewSection title="Standards Alignment">
        <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
          This lesson supports NGSS 5-PS2-1, asking students to support an argument that gravity pulls objects toward Earth. Students build this understanding through direct observation and evidence-based reasoning during the ramp investigation.
        </p>
      </PreviewSection>

      <PreviewSection title="Materials">
        <ul className="mat-list">
          {SAMPLE_MATERIALS.map((m, i) => (
            <li key={i} className="mat-item">
              <span className="mat-dot" />
              {m}
            </li>
          ))}
        </ul>
      </PreviewSection>

      <PreviewSection title="Activities">
        <ol className="act-list">
          {SAMPLE_ACTIVITIES.map((a, i) => (
            <li key={i} className="act-item">
              <span className="act-time">{a.minutes}m</span>
              <div>
                <div className="act-name">{a.name}</div>
                <div className="act-detail">{a.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </PreviewSection>

      <PreviewSection title="Assessment">
        <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
          Students complete an exit ticket explaining how force influenced the motion of their object, using evidence from the investigation.
        </p>
      </PreviewSection>

      <PreviewSection title="Differentiation" isLast>
        <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
          Provide sentence starters and visual supports for students who need additional guidance. Offer an extension activity for advanced learners to explore how surface friction affects motion.
        </p>
      </PreviewSection>
    </div>
  );
}
