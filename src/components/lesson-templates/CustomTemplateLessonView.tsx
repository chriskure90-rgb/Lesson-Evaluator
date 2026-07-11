import type { Template1Lesson } from "../../App";
import type { CustomTemplate } from "../../lib/custom-templates";
import { PLACEHOLDER_CATALOG } from "../../lib/custom-template-placeholders";
import { Icon } from "../Icon";

/* ── Custom template lesson preview ────────────────────────────────────────────
   Unlike Template1LessonView (one fixed table layout), a custom template's
   section order is per-template — it comes from CustomTemplate.recognized_
   placeholders, which preserves the order sections were detected in the
   teacher's uploaded file (see detectPdfSections/detectPlaceholders in
   api/custom-templates.js). This renders exactly that order, so the web
   preview reflects the same structure the DOCX export produces (the actual
   uploaded/synthesized template merged via docxtemplater), rather than the
   generic Template 1 table.
────────────────────────────────────────────────────────────────────────────── */

function splitSentences(text: string): string[] {
  return (text ?? "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function CustomTemplateLessonView({
  template,
  lessonData,
  breadcrumb,
  onEdit,
}: {
  template: CustomTemplate;
  lessonData: Template1Lesson;
  breadcrumb?: string;
  onEdit?: () => void;
}) {
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
    </div>
  );
}
