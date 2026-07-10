import type { CSSProperties } from "react";

/* ── Placeholder building blocks for template structure previews ─────────────
   Gray skeleton bars standing in for real lesson content. Used by
   StandardTemplatePreview and Template1Preview (via TemplatePreviewModal) to
   show a template's layout/section structure without ever displaying real
   generated lesson text — reusable so future built-in templates can build
   their previews out of the same pieces.
────────────────────────────────────────────────────────────────────────────── */

export function PlaceholderBar({
  width = "100%",
  height = 10,
  style,
}: {
  width?: string | number;
  height?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        background: "rgb(48 44 39 / 0.12)",
        ...style,
      }}
    />
  );
}

const LINE_WIDTHS = ["96%", "88%", "72%", "60%"];

export function PlaceholderParagraph({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <PlaceholderBar key={i} width={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}
