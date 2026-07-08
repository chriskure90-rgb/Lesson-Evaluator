import type { Lesson } from "../../App";
import { AccordionItem } from "../../App";

/* ── Standard lesson plan — shared read-only view ─────────────────────────────
   Content only (Objectives/Standards/Materials/Activities/Assessment/
   Differentiation) — no title/header, since each page already has its own
   surrounding header (breadcrumb + title + Edit button on Generate, a
   simple section label on Evaluate/Library). This is the ONE place the
   Standard format's accordion content is defined.
────────────────────────────────────────────────────────────────────────────── */
export function DefaultLessonView({ lessonData }: { lessonData: Lesson }) {
  return (
    <>
      <AccordionItem title="Learning Objectives" defaultOpen>
        <ol className="obj-list">
          {(lessonData.objectives || []).map((o, i) => (
            <li key={i} className="obj-item">
              <span className="obj-num">{String(i + 1).padStart(2, "0")}</span>
              <span style={{ lineHeight: 1.55 }}>{o}</span>
            </li>
          ))}
        </ol>
      </AccordionItem>

      {lessonData.standards_alignment && (
        <AccordionItem title="Standards Alignment">
          <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
            {lessonData.standards_alignment}
          </p>
        </AccordionItem>
      )}

      <AccordionItem title="Materials">
        <ul className="mat-list">
          {(lessonData.materials || []).map((m, i) => (
            <li key={i} className="mat-item">
              <span className="mat-dot" />
              {m}
            </li>
          ))}
        </ul>
      </AccordionItem>

      <AccordionItem title="Activities" defaultOpen>
        <ol className="act-list">
          {(lessonData.activities || []).map((a, i) => (
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

      <AccordionItem title="Assessment" isLast={!lessonData.differentiation}>
        <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
          {lessonData.assessment || "No assessment details provided."}
        </p>
      </AccordionItem>

      {lessonData.differentiation && (
        <AccordionItem title="Differentiation" isLast>
          <p style={{ fontSize: 14, color: "rgb(48 44 39 / 0.85)", lineHeight: 1.6 }}>
            {lessonData.differentiation}
          </p>
        </AccordionItem>
      )}
    </>
  );
}
