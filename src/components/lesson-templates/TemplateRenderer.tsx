import type { Lesson, Template1Lesson } from "../../App";
import { Template1LessonView } from "./Template1LessonView";
import { DefaultLessonView } from "./DefaultLessonView";

/* ── TemplateRenderer ─────────────────────────────────────────────────────────
   Single dispatch point used by GeneratePage, EvaluatePage, and LibraryPage's
   lesson detail view: reads template_type and renders the matching view.
   lesson_data (Supabase's `lesson_json` column) is never converted into the
   other format's shape — it's passed straight through as the source of truth.
────────────────────────────────────────────────────────────────────────────── */
export function TemplateRenderer({
  templateType,
  lessonData,
  breadcrumb,
  onEdit,
}: {
  templateType: string | null | undefined;
  lessonData: unknown;
  // Only meaningful for the Template 1 view (rendered inside its bordered
  // box). DefaultLessonView has no header of its own — see its file comment.
  breadcrumb?: string;
  onEdit?: () => void;
}) {
  if (templateType === "template1") {
    return <Template1LessonView lessonData={lessonData as Template1Lesson} breadcrumb={breadcrumb} onEdit={onEdit} />;
  }
  return <DefaultLessonView lessonData={lessonData as Lesson} />;
}
