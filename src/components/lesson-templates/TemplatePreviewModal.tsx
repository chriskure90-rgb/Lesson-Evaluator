import type { ComponentType } from "react";
import { StandardTemplatePreview } from "./StandardTemplatePreview";
import { Template1Preview } from "./Template1Preview";

/* ── Template Preview Modal ────────────────────────────────────────────────────
   Shows a scaled mockup of a built-in template (layout, section order/
   titles, tables/columns/borders, approximate spacing) filled with a fixed,
   illustrative sample lesson — so it reads like a completed document
   rather than a loading skeleton — never real generated lesson content or
   live template data (see StandardTemplatePreview/Template1Preview).

   Only built-in templates are supported for now (custom uploaded templates
   keep their current, unchanged behavior). Adding a future built-in template
   is just a new entry in BUILT_IN_TEMPLATE_PREVIEWS below plus its own
   Preview component — nothing else here needs to change.
────────────────────────────────────────────────────────────────────────────── */

export type BuiltInTemplateId = "standard" | "template1";

const BUILT_IN_TEMPLATE_PREVIEWS: Record<BuiltInTemplateId, { name: string; Preview: ComponentType }> = {
  standard:  { name: "Standard Lesson Plan", Preview: StandardTemplatePreview },
  template1: { name: "Template 1",           Preview: Template1Preview },
};

export function TemplatePreviewModal({
  templateId,
  isSelected,
  onClose,
  onUseTemplate,
}: {
  templateId: BuiltInTemplateId;
  isSelected: boolean;
  onClose: () => void;
  onUseTemplate: () => void;
}) {
  const { name, Preview } = BUILT_IN_TEMPLATE_PREVIEWS[templateId];

  return (
    <div className="template-preview-backdrop" onClick={onClose}>
      <div className="template-preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="template-preview-header">
          <div style={{ minWidth: 0 }}>
            <p className="drawer-eyebrow" style={{ marginBottom: 4 }}>Template Preview</p>
            <h2 className="drawer-title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {name}
              {isSelected && <span className="lib-badge badge-ready">Currently Selected</span>}
            </h2>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="template-preview-body">
          <div className="template-preview-doc">
            <Preview />
          </div>
        </div>

        <div className="template-preview-footer">
          <button type="button" className="btn-outline-sm" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={onUseTemplate}>
            Use This Template
          </button>
        </div>
      </div>
    </div>
  );
}
