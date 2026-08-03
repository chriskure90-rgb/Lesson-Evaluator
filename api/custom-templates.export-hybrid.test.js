import { describe, it, expect } from "vitest";
import { Document, Paragraph, TextRun, Table, TableRow, TableCell, Packer } from "docx";
import PizZip from "pizzip";
import { mergeTokensIntoDocxBuffer, mergeDynamicLessonIntoDocumentXml } from "./custom-templates.js";

// Same minimal OOXML builders as custom-templates.export-dynamic.test.js —
// used here for the fast, isolated structural/precedence unit tests below
// (the full end-to-end test further down uses a real .docx via the `docx`
// package + the real Docxtemplater merge instead).
function p(text, { bold = false } = {}) {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p><w:pPr>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}</w:pPr><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}
function tc(innerParas, tcPr = "") {
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${innerParas.join("")}</w:tc>`;
}
function tr(cells) {
  return `<w:tr>${cells.join("")}</w:tr>`;
}
function tbl(rows) {
  return `<w:tbl>${rows.join("")}</w:tbl>`;
}
function doc(bodyContent) {
  return `<?xml version="1.0"?><w:document><w:body>${bodyContent}<w:sectPr/></w:body></w:document>`;
}

// ── Isolated precedence/structural unit tests (raw OOXML) ───────────────────
describe("mergeDynamicLessonIntoDocumentXml — hybrid token-overlap safeguard", () => {
  it("does not overwrite a paragraph whose ORIGINAL text already contains a recognized {{TOKEN}}, and logs it as skipped", () => {
    // Simulates the hybrid pipeline: `original` is the pre-token-merge
    // document (the field-map-detected paragraph still literally reads
    // "{{OBJECTIVES}}"); `tokenMerged` is what handleExportHybrid's first
    // step (mergeTokensIntoDocxBuffer) already produced from it.
    const originalCell = tc([p("{{OBJECTIVES}}")]);
    const tokenMergedCell = tc([p("Explain photosynthesis")]);
    const originalXml = doc(tbl([tr([originalCell])]));
    const tokenMergedXml = doc(tbl([tr([tokenMergedCell])]));

    const fieldMap = {
      regions: [
        { id: "field1", order: 1, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      tokenMergedXml, fieldMap, new Map([["field1", "DYNAMIC CONTENT THAT MUST NOT APPEAR"]]), originalXml
    );

    expect(outXml).toContain("Explain photosynthesis"); // token-rendered content preserved, untouched
    expect(outXml).not.toContain("DYNAMIC CONTENT THAT MUST NOT APPEAR");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/token/i);
  });

  it("still fills an untagged region normally when originalDocumentXml is provided but that specific paragraph never had a token", () => {
    const originalCell = tc([p("Materials", { bold: true }), p("")]);
    const tokenMergedCell = tc([p("Materials", { bold: true }), p("")]); // no tokens anywhere in this template — token merge was a no-op here
    const originalXml = doc(tbl([tr([originalCell])]));
    const tokenMergedXml = doc(tbl([tr([tokenMergedCell])]));

    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Materials", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "field1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      tokenMergedXml, fieldMap, new Map([["field1", "Beakers, elodea sprigs"]]), originalXml
    );

    expect(outXml).toContain("Beakers, elodea sprigs");
    expect(skipped).toEqual([]);
  });

  it("includes manual-entry content when it maps to a safe (non-token-overlapping) positional region", () => {
    const originalCell = tc([p("Anticipated Misconceptions", { bold: true }), p("")]);
    const tokenMergedCell = tc([p("Anticipated Misconceptions", { bold: true }), p("")]);
    const originalXml = doc(tbl([tr([originalCell])]));
    const tokenMergedXml = doc(tbl([tr([tokenMergedCell])]));

    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Anticipated Misconceptions", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "manual1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
      ],
    };
    const { xml: outXml } = mergeDynamicLessonIntoDocumentXml(
      tokenMergedXml, fieldMap, new Map([["manual1", "Watch for the photosynthesis/respiration mix-up."]]), originalXml
    );

    expect(outXml).toContain("Watch for the photosynthesis/respiration mix-up.");
  });
});

// ── Full pipeline test: real .docx, real Docxtemplater, real dynamic merge ──
// Builds a real hybrid template via the `docx` package: a top-level
// {{GRADE_LEVEL}} paragraph (recognized token) plus a table with one cell
// that has no token at all (a genuine field-map-only region) and one cell
// whose entire paragraph IS a recognized token (the overlap case). Runs the
// exact two-step sequence handleExportHybrid performs.
async function buildHybridDocxBuffer() {
  const document = new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun("Lesson Plan")] }),
        new Paragraph({ children: [new TextRun("Grade Level: {{GRADE_LEVEL}}")] }),
        new Table({
          rows: [
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Materials", bold: true })] }), new Paragraph("")] }),
                new TableCell({ children: [new Paragraph("{{OBJECTIVES}}")] }),
              ],
            }),
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Anticipated Misconceptions", bold: true })] }), new Paragraph("")] }),
              ],
            }),
          ],
        }),
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

describe("hybrid DOCX export — full sequential token-then-dynamic pipeline", () => {
  it("populates token fields, dynamic field-map cells, and manual-entry content in the same exported document, preserving table structure", async () => {
    const originalBuffer = await buildHybridDocxBuffer();
    const originalZip = new PizZip(originalBuffer);
    const originalXml = originalZip.file("word/document.xml").asText();

    const template = { recognized_placeholders: ["GRADE_LEVEL", "OBJECTIVES"], structured_fields: [] };
    const lessonData = {
      subjectGradeLevel: "Grade 7 Science",
      lessonObjectives: ["Explain how plants convert light energy into chemical energy"],
    };

    // Step 1: token merge (same mechanism as the pure token-based export).
    const tokenMergedBuffer = mergeTokensIntoDocxBuffer(originalBuffer, lessonData, template);
    const tokenMergedZip = new PizZip(tokenMergedBuffer);
    const tokenMergedXmlBefore = tokenMergedZip.file("word/document.xml").asText();
    expect(tokenMergedXmlBefore).toContain("Grade 7 Science");
    expect(tokenMergedXmlBefore).toContain("Explain how plants convert light energy into chemical energy");
    expect(tokenMergedXmlBefore).not.toContain("{{GRADE_LEVEL}}");
    expect(tokenMergedXmlBefore).not.toContain("{{OBJECTIVES}}");

    // Field map: one genuine untagged field-map region (Materials cell), one
    // region whose original paragraph was a bare {{OBJECTIVES}} token (must
    // be left alone), one manual-entry region (Anticipated Misconceptions).
    const fieldMap = {
      regions: [
        { id: "materials-heading", order: 1, role: "heading", text: "Materials", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "materials-field", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "objectives-token-overlap", order: 3, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_2" },
        { id: "misconceptions-heading", order: 4, role: "heading", text: "Anticipated Misconceptions", source: "explicit", tableId: "table_1", rowId: "table_1_row_2", cellId: "table_1_row_2_cell_1" },
        { id: "misconceptions-manual", order: 5, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_2", cellId: "table_1_row_2_cell_1" },
      ],
    };
    const contentByRegionId = new Map([
      ["materials-field", "Beakers, elodea sprigs, lamps"],
      ["objectives-token-overlap", "DYNAMIC CONTENT THAT MUST NOT APPEAR"],
      ["misconceptions-manual", "Watch for the photosynthesis/respiration mix-up."],
    ]);

    // Step 2: dynamic merge on top of the already token-merged document.
    const { xml: finalXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      tokenMergedXmlBefore, fieldMap, contentByRegionId, originalXml
    );

    // Token content and dynamic content both present in the SAME document.
    expect(finalXml).toContain("Grade 7 Science");
    expect(finalXml).toContain("Explain how plants convert light energy into chemical energy");
    expect(finalXml).toContain("Beakers, elodea sprigs, lamps");
    expect(finalXml).toContain("Watch for the photosynthesis/respiration mix-up.");

    // Token replacement took precedence over the dynamic merge for the
    // overlapping paragraph — the dynamic content never lands there.
    expect(finalXml).not.toContain("DYNAMIC CONTENT THAT MUST NOT APPEAR");
    expect(skipped.some((s) => /token/i.test(s.reason))).toBe(true);

    // Table/row/cell structure identical before and after the hybrid export.
    const countTag = (xml, tag) => (xml.match(new RegExp(`<${tag}[ >]`, "g")) || []).length;
    for (const tag of ["w:tbl", "w:tr", "w:tc"]) {
      expect(countTag(finalXml, tag)).toBe(countTag(originalXml, tag));
    }
  });
});
