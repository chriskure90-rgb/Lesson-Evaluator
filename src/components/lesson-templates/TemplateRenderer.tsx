import type { Lesson, Template1Lesson } from "../../App";
import type { CustomTemplate } from "../../lib/custom-templates";
import { Template1LessonView } from "./Template1LessonView";
import { CustomTemplateLessonView } from "./CustomTemplateLessonView";
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
  customTemplate,
  breadcrumb,
  onEdit,
}: {
  templateType: string | null | undefined;
  lessonData: unknown;
  // Only available where the caller already has the CustomTemplate row in
  // hand (currently GeneratorPage's live preview, right after generating).
  // When templateType is "custom" but this is null (template not loaded /
  // deleted / caller hasn't been wired up yet), falls back to the generic
  // Template 1 view rather than crashing — same content, just not laid out
  // per the uploaded template's own section order.
  customTemplate?: CustomTemplate | null;
  // Only meaningful for the Template 1 view (rendered inside its bordered
  // box). DefaultLessonView has no header of its own — see its file comment.
  breadcrumb?: string;
  onEdit?: () => void;
}) {
  if (templateType === "custom" && customTemplate) {
    console.log("[TemplateRenderer] preview component selected: CustomTemplateLessonView", {
      customTemplateId: customTemplate.id,
      customTemplateName: customTemplate.name,
      recognizedPlaceholders: customTemplate.recognized_placeholders,
    });
    return <CustomTemplateLessonView template={customTemplate} lessonData={lessonData as Template1Lesson} breadcrumb={breadcrumb} onEdit={onEdit} />;
  }
  if (templateType === "template1" || templateType === "custom") {
    console.log("[TemplateRenderer] preview component selected: Template1LessonView", { templateType, hadCustomTemplate: !!customTemplate });
    return <Template1LessonView lessonData={lessonData as Template1Lesson} breadcrumb={breadcrumb} onEdit={onEdit} />;
  }
  console.log("[TemplateRenderer] preview component selected: DefaultLessonView", { templateType });
  return <DefaultLessonView lessonData={lessonData as Lesson} />;
}
