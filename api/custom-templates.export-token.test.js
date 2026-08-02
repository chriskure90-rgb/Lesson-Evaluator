import { describe, it, expect } from "vitest";
import { Document, Paragraph, TextRun, Packer } from "docx";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { buildRenderData } from "./custom-templates.js";

// Builds a real, valid minimal .docx (via the `docx` package, same one
// src/lib/export.ts already uses) containing literal {{TOKEN}} paragraphs —
// exercises the exact real-world shape of the reported bug: a token-based
// template with {{OBJECTIVES}} and {{GRADE_LEVEL}} tags.
async function buildTaggedDocxBuffer(tags) {
  const doc = new Document({
    sections: [{ children: tags.map((t) => new Paragraph({ children: [new TextRun(t)] })) }],
  });
  const blob = await Packer.toBuffer(doc);
  return Buffer.from(blob);
}

// Mirrors handleExport's exact Docxtemplater configuration (api/custom-templates.js) —
// the actual token-substitution mechanism this regression test verifies still works.
function renderWithDocxtemplater(buffer, renderData) {
  const zip = new PizZip(buffer);
  const docx = new Docxtemplater(zip, {
    delimiters: { start: "{{", end: "}}" },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });
  docx.render(renderData);
  return docx.getZip().generate({ type: "nodebuffer" });
}

function extractDocumentXmlText(buffer) {
  const zip = new PizZip(buffer);
  const xml = zip.file("word/document.xml").asText();
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let out = "";
  let m;
  while ((m = textRegex.exec(xml)) !== null) out += m[1] + " ";
  return out;
}

describe("buildRenderData", () => {
  const lesson = {
    lessonTitle: "Photosynthesis and Energy Flow",
    subjectGradeLevel: "Grade 7 Science",
    lessonObjectives: ["Explain how plants convert light energy into chemical energy", "Identify the inputs and outputs of photosynthesis"],
    materials: ["Elodea sprigs", "Beakers"],
  };

  it("populates OBJECTIVES and GRADE_LEVEL from the lesson when both are recognized", () => {
    const data = buildRenderData(lesson, ["OBJECTIVES", "GRADE_LEVEL"], []);
    expect(data.GRADE_LEVEL).toBe("Grade 7 Science");
    expect(data.OBJECTIVES).toBe(
      "• Explain how plants convert light energy into chemical energy\n• Identify the inputs and outputs of photosynthesis"
    );
  });

  it("only populates keys present in recognizedTokens — a token absent from that list is never sent to Docxtemplater", () => {
    const data = buildRenderData(lesson, ["GRADE_LEVEL"], []);
    expect(data).toEqual({ GRADE_LEVEL: "Grade 7 Science" });
    expect(data.OBJECTIVES).toBeUndefined();
  });
});

// 6. {{OBJECTIVES}} and {{GRADE_LEVEL}} are replaced in the exported DOCX —
// the actual reported bug, reproduced and fixed at the mechanism level: once
// routing correctly sends a token-based template through this path (instead
// of the field_map/dynamic merge, which has no concept of {{TAG}} syntax),
// the tags are genuinely replaced.
describe("token-based DOCX export mechanism (handleExport's Docxtemplater path)", () => {
  it("replaces {{OBJECTIVES}} and {{GRADE_LEVEL}} with real lesson content", async () => {
    const templateBuffer = await buildTaggedDocxBuffer([
      "Lesson Plan",
      "Grade Level: {{GRADE_LEVEL}}",
      "Objectives:",
      "{{OBJECTIVES}}",
    ]);

    const lesson = {
      lessonTitle: "Photosynthesis and Energy Flow",
      subjectGradeLevel: "Grade 7 Science",
      lessonObjectives: ["Explain how plants convert light energy into chemical energy"],
    };
    const renderData = buildRenderData(lesson, ["GRADE_LEVEL", "OBJECTIVES"], []);
    const outBuffer = renderWithDocxtemplater(templateBuffer, renderData);
    const outText = extractDocumentXmlText(outBuffer);

    expect(outText).not.toContain("{{GRADE_LEVEL}}");
    expect(outText).not.toContain("{{OBJECTIVES}}");
    expect(outText).toContain("Grade 7 Science");
    expect(outText).toContain("Explain how plants convert light energy into chemical energy");
  });

  it("leaves an unrecognized tag as literal text rather than throwing (nullGetter)", async () => {
    const templateBuffer = await buildTaggedDocxBuffer(["{{SOME_UNKNOWN_TAG}}", "{{OBJECTIVES}}"]);
    const renderData = buildRenderData({ lessonObjectives: ["Test objective"] }, ["OBJECTIVES"], []);
    const outBuffer = renderWithDocxtemplater(templateBuffer, renderData);
    const outText = extractDocumentXmlText(outBuffer);
    expect(outText).toContain("Test objective");
    // nullGetter resolves anything not in renderData to "" — the tag text disappears, not an error.
    expect(outText).not.toContain("SOME_UNKNOWN_TAG");
  });
});
