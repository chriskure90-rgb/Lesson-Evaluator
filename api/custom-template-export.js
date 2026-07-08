import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { supabase } from "./lib/supabase.js";
import { buildRenderData } from "./lib/custom-template-placeholders.js";

const BUCKET = "custom-templates";

// Loads the teacher's uploaded .docx template, fills in its recognized
// {{PLACEHOLDER}} tokens from the (Template1Lesson-shaped) lessonData, and
// streams the merged .docx back. The built-in Template1 DOCX builder
// (src/lib/template1-docx.ts) is never used for custom templates — this is
// the only export path for template_type "custom".
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: "Supabase is not configured." });
    }

    const { customTemplateId, userId, lessonData } = req.body ?? {};
    if (!customTemplateId) return res.status(400).json({ error: "Missing customTemplateId." });
    if (!userId)           return res.status(400).json({ error: "Missing userId." });
    if (!lessonData)       return res.status(400).json({ error: "Missing lessonData." });

    const { data: template, error: fetchError } = await supabase
      .from("custom_templates")
      .select("*")
      .eq("id", customTemplateId)
      .single();

    if (fetchError || !template) {
      return res.status(404).json({ error: "Template not found." });
    }
    if (template.user_id !== userId) {
      return res.status(403).json({ error: "You do not have access to this template." });
    }
    if (template.status !== "ready") {
      return res.status(400).json({ error: "This template is not ready for export." });
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(template.storage_path);

    if (downloadError) {
      console.error("[custom-template-export] download error:", downloadError.message);
      return res.status(500).json({ error: "Could not load the template file." });
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, {
      delimiters: { start: "{{", end: "}}" },
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "", // any tag not in recognized_placeholders resolves to blank rather than throwing
    });

    const renderData = buildRenderData(lessonData, template.recognized_placeholders || []);
    doc.render(renderData);

    const outBuffer = doc.getZip().generate({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="lesson-plan.docx"');
    return res.status(200).send(outBuffer);
  } catch (error) {
    console.error("[custom-template-export] error:", error);
    return res.status(500).json({ error: error.message || "Export failed." });
  }
}
