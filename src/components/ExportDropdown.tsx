import { useEffect, useRef, useState } from "react";
import { exportAndDownload, type ExportDocument, type ExportFormat } from "../lib/export";

const FORMAT_OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "docx", label: "Word (.docx)" },
  { format: "pdf",  label: "PDF (.pdf)"   },
  { format: "txt",  label: "Text (.txt)"  },
];

/**
 * Secondary/outline button that opens a small menu of export formats.
 * `getDocument` is called lazily (only once the user picks a format) so the
 * caller can always hand back the latest lesson/evaluation content.
 */
export function ExportDropdown({
  label,
  filenameBase,
  getDocument,
}: {
  label: string;
  filenameBase: string;
  getDocument: () => ExportDocument;
}) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<ExportFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleSelect(format: ExportFormat) {
    setOpen(false);
    setBusyFormat(format);
    try {
      await exportAndDownload(getDocument(), format, filenameBase);
    } catch (err) {
      console.error("[ExportDropdown] export failed:", err);
    } finally {
      setBusyFormat(null);
    }
  }

  const busy = busyFormat !== null;

  return (
    <div className="export-dropdown" ref={rootRef}>
      <button
        type="button"
        className="btn-outline-sm"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? `Exporting ${busyFormat.toUpperCase()}…` : <>{label} <span className="export-dropdown-caret">▾</span></>}
      </button>

      {open && (
        <div className="export-dropdown-menu" role="menu">
          {FORMAT_OPTIONS.map((opt) => (
            <button
              key={opt.format}
              type="button"
              role="menuitem"
              className="export-dropdown-item"
              onClick={() => handleSelect(opt.format)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
