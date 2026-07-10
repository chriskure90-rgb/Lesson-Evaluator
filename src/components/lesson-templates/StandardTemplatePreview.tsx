import type { ReactNode } from "react";
import { PlaceholderBar, PlaceholderParagraph } from "./PreviewPlaceholders";

/* ── Standard lesson plan template — structure-only preview ───────────────────
   Mirrors DefaultLessonView's real section list, order, and CSS classes
   exactly (Learning Objectives, Standards Alignment, Materials, Activities,
   Assessment, Differentiation) so the preview modal shows the actual
   accordion layout, spacing, and hierarchy a generated lesson would use —
   with gray placeholder bars standing in for real content. Sections are
   rendered statically open (not collapsible) since the point is to see the
   whole structure at a glance.
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

export function StandardTemplatePreview() {
  return (
    <div>
      <PreviewSection title="Learning Objectives">
        <ol className="obj-list">
          {[90, 84, 70].map((w, i) => (
            <li key={i} className="obj-item">
              <span className="obj-num">{String(i + 1).padStart(2, "0")}</span>
              <PlaceholderBar width={`${w}%`} />
            </li>
          ))}
        </ol>
      </PreviewSection>

      <PreviewSection title="Standards Alignment">
        <PlaceholderParagraph lines={2} />
      </PreviewSection>

      <PreviewSection title="Materials">
        <ul className="mat-list">
          {[68, 54, 60].map((w, i) => (
            <li key={i} className="mat-item">
              <span className="mat-dot" />
              <PlaceholderBar width={`${w}%`} />
            </li>
          ))}
        </ul>
      </PreviewSection>

      <PreviewSection title="Activities">
        <ol className="act-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="act-item">
              <span className="act-time"><PlaceholderBar width={24} height={12} /></span>
              <div>
                <div style={{ marginBottom: 6 }}><PlaceholderBar width="45%" height={13} /></div>
                <PlaceholderParagraph lines={2} />
              </div>
            </li>
          ))}
        </ol>
      </PreviewSection>

      <PreviewSection title="Assessment">
        <PlaceholderParagraph lines={2} />
      </PreviewSection>

      <PreviewSection title="Differentiation" isLast>
        <PlaceholderParagraph lines={2} />
      </PreviewSection>
    </div>
  );
}
