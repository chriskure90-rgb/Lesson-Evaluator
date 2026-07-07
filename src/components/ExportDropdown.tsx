import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { exportAndDownload, type ExportDocument, type ExportFormat } from "../lib/export";

const FORMAT_OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: "docx", label: "Word (.docx)" },
  { format: "pdf",  label: "PDF (.pdf)"   },
  { format: "txt",  label: "Text (.txt)"  },
];

const MENU_GAP        = 6; // px between the button and the menu
const VIEWPORT_MARGIN = 8; // px kept clear from the viewport edge

// Hidden (but still laid out, so it can be measured) until positioned.
const HIDDEN_STYLE: CSSProperties = { visibility: "hidden", position: "fixed", top: 0, left: 0 };

/**
 * Secondary/outline button that opens a small menu of export formats.
 * `getDocument` is called lazily (only once the user picks a format) so the
 * caller can always hand back the latest lesson/evaluation content.
 *
 * The menu is rendered in a portal (document.body) with position: fixed,
 * computed from the trigger button's getBoundingClientRect() — this keeps
 * it from being clipped by any ancestor card/container, and it flips above
 * the button when there isn't enough room below (e.g. near the bottom of
 * the page, next to the Evaluate Lesson button).
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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(HIDDEN_STYLE);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  // Position (and flip above if needed) once the menu is open and rendered,
  // so we can measure its real height/width before showing it.
  useLayoutEffect(() => {
    if (!open) return;
    const buttonEl = buttonRef.current;
    const menuEl   = menuRef.current;
    if (!buttonEl || !menuEl) return;

    const buttonRect = buttonEl.getBoundingClientRect();
    const menuRect   = menuEl.getBoundingClientRect();

    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    const openUpward = spaceBelow < menuRect.height + MENU_GAP + VIEWPORT_MARGIN
      && spaceAbove > spaceBelow;

    const top = openUpward
      ? buttonRect.top - menuRect.height - MENU_GAP
      : buttonRect.bottom + MENU_GAP;

    const left = Math.min(
      Math.max(buttonRect.left, VIEWPORT_MARGIN),
      window.innerWidth - menuRect.width - VIEWPORT_MARGIN
    );

    setMenuStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [open]);

  // Close on outside click, Escape, or scroll/resize (a fixed-position menu
  // can't track the button across a scroll, so just close it instead).
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  function toggleOpen() {
    if (open) {
      setOpen(false);
    } else {
      setMenuStyle(HIDDEN_STYLE); // reset so it doesn't flash at a stale position
      setOpen(true);
    }
  }

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
    <div className="export-dropdown">
      <button
        ref={buttonRef}
        type="button"
        className="btn-outline-sm"
        onClick={toggleOpen}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {busy ? `Exporting ${busyFormat.toUpperCase()}…` : <>{label} <span className="export-dropdown-caret">▾</span></>}
      </button>

      {open && createPortal(
        <div ref={menuRef} className="export-dropdown-menu" role="menu" style={menuStyle}>
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
        </div>,
        document.body
      )}
    </div>
  );
}
