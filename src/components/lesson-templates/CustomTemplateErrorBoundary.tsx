import { Component, type ReactNode } from "react";

/* ── CustomTemplateErrorBoundary ───────────────────────────────────────────────
   Defense-in-depth around CustomTemplateLessonView: that component already
   normalizes every array it reads from a CustomTemplate row (see its own
   Array.isArray guards), but a custom_templates row is externally-sourced
   data (Supabase, possibly mid-migration or hand-edited) — this catches
   anything those guards don't anticipate so a single malformed template
   renders a friendly message instead of white-screening the whole page.
   Error boundaries must be class components; there's no hook equivalent.
────────────────────────────────────────────────────────────────────────────── */
export class CustomTemplateErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[CustomTemplateErrorBoundary] render crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="t1-page">
          <p className="t1-body">
            This template couldn't be displayed ({this.state.error.message || "unknown error"}). The lesson content itself is unaffected — try reopening it, or contact support if this keeps happening.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
