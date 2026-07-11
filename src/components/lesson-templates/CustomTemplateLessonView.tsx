import type { Template1Lesson } from "../../App";
import type { CustomTemplate } from "../../lib/custom-templates";
import { PLACEHOLDER_CATALOG } from "../../lib/custom-template-placeholders";
import { getLayoutForTemplate, extractDiscoverFieldContent, type GridFieldContent } from "../../lib/custom-template-layouts";
import { Icon } from "../Icon";

/* ── Custom template lesson preview ────────────────────────────────────────────
   Two render paths:
   1. Grid — for templates recognized by getLayoutForTemplate (name/filename
      match against a hand-built layout; PDF text extraction has no bounding
      boxes to derive real positions from — see custom-template-layouts.ts).
      Mirrors the source document's actual row/column layout.
   2. Vertical fallback — for every other custom template. Section order
      comes from CustomTemplate.recognized_placeholders, which preserves the
      order sections were detected in the teacher's uploaded file (see
      detectPdfSections/detectPlaceholders in api/custom-templates.js).

   Neither path affects DOCX export — that always merges lessonData into the
   real uploaded/synthesized template via docxtemplater, independent of
   what's rendered here.
────────────────────────────────────────────────────────────────────────────── */

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function GridFieldValue({ content }: { content: GridFieldContent }) {
  if (content.kind === "list") {
    if (content.value.length === 0) return null;
    return (
      <ul className="t1-list-dash" style={{ margin: "4px 0 0" }}>
        {content.value.map((v, i) => <li key={i}>{v}</li>)}
      </ul>
    );
  }
  if (content.kind === "teacherStudent") {
    return (
      <>
        {content.teacher && (
          <>
            <p className="t1-label" style={{ marginTop: 0 }}>Teacher:</p>
            <ol className="t1-list">
              {splitSentences(content.teacher).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </>
        )}
        {content.student && (
          <>
            <p className="t1-label">Students:</p>
            <ol className="t1-list">
              {splitSentences(content.student).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </>
        )}
      </>
    );
  }
  return <p className="t1-body" style={{ margin: "4px 0 0" }}>{content.value || "—"}</p>;
}

export function CustomTemplateLessonView({
  template,
  lessonData,
  date,
  breadcrumb,
  onEdit,
}: {
  template: CustomTemplate;
  lessonData: Template1Lesson;
  // Only meaningful for a recognized grid layout's Date box (e.g. Discover) —
  // Template1Lesson itself has no date field. Pass the lesson's saved/created
  // date where available (LibraryPage); omit to leave it blank.
  date?: string | null;
  breadcrumb?: string;
  onEdit?: () => void;
}) {
  const layout = getLayoutForTemplate(template);
  const tokens = template.recognized_placeholders.filter((t) => PLACEHOLDER_CATALOG[t]);

  return (
    <div className="t1-page">
      {(breadcrumb || onEdit) && (
        <div className="t1-header-row">
          <p className="preview-breadcrumb">{breadcrumb}</p>
          {onEdit && (
            <button type="button" className="btn-outline-sm" onClick={onEdit} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Icon.Edit /> Edit
            </button>
          )}
        </div>
      )}

      <h2 className="t1-title">{template.name}</h2>

      {layout ? (
        <div className="custom-tpl-grid" style={{ gridTemplateColumns: `repeat(${layout.columns}, 1fr)` }}>
          {layout.sections.map((section) => (
            <div
              key={section.key}
              className={
                "custom-tpl-grid-cell" +
                (section.compact ? " custom-tpl-grid-cell-compact" : "") +
                (section.tall ? " custom-tpl-grid-cell-tall" : "")
              }
              style={{ gridColumn: `${section.colStart} / span ${section.colSpan}`, gridRow: section.row }}
            >
              <p className="custom-tpl-grid-label">{section.label}</p>
              <GridFieldValue content={extractDiscoverFieldContent(section.key, lessonData, date ?? null)} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="t1-instructions-italic" style={{ margin: "0 0 14px" }}>
            Layout follows the sections detected in your uploaded template.
          </p>
          {tokens.length === 0 ? (
            <p className="t1-body">No recognized sections were found for this template.</p>
          ) : (
            tokens.map((token) => {
              const entry = PLACEHOLDER_CATALOG[token];
              const value = entry.extract(lessonData);
              return (
                <div key={token} className="custom-tpl-section">
                  <p className="t1-section-label">{entry.label}</p>
                  {entry.kind === "list" && Array.isArray(value) ? (
                    <ul className="t1-list-dash">
                      {value.map((v, i) => <li key={i}>{v}</li>)}
                    </ul>
                  ) : (
                    <ol className="t1-list">
                      {splitSentences(String(value ?? "")).map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
