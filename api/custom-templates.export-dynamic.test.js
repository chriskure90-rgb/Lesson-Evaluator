import { describe, it, expect } from "vitest";
import { planDynamicContainerEdits, mergeDynamicLessonIntoDocumentXml } from "./custom-templates.js";

// Minimal-but-realistic OOXML paragraph builder — a <w:pPr>/<w:rPr> pair is
// enough to exercise "formatting preserved" assertions without needing a
// full real Word document.
function p(text, { bold = false } = {}) {
  const rPr = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p><w:pPr>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}</w:pPr><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}
function emptyP() {
  return `<w:p><w:pPr/><w:r><w:t xml:space="preserve"></w:t></w:r></w:p>`;
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

function region(overrides) {
  return { id: "r", order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text", ...overrides };
}

// A fake "real paragraph" whose extracted plain text is exactly `text` —
// matches what extractParagraphPlainText would read from a real <w:p>'s inner
// XML, so heading/instruction validation against region.text passes.
function realPara(text) {
  return { inner: `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` };
}

describe("planDynamicContainerEdits", () => {
  it("queues a replacement for an explicit editable_field region with content", () => {
    const regions = [region({ id: "r1", role: "heading", text: "Materials", order: 1 }), region({ id: "r2", role: "editable_field", order: 2 })];
    const paragraphs = [realPara("Materials"), realPara("")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["r2", "Beakers, elodea sprigs"]]));
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.get(1)).toBe("Beakers, elodea sprigs");
    expect(result.replaceByIndex.has(0)).toBe(false); // heading never replaced
  });

  it("never replaces a heading/instruction region even if content is present for it", () => {
    const regions = [region({ id: "r1", role: "heading", text: "Materials", order: 1 })];
    const paragraphs = [realPara("Materials")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["r1", "should never be used"]]));
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.size).toBe(0);
  });

  it("queues an insert-after for an implicit region, anchored to the last consumed paragraph", () => {
    const regions = [
      region({ id: "r1", role: "heading", text: "Objectives", order: 1 }),
      region({ id: "r2", role: "editable_field", order: 2, source: "implicit" }),
    ];
    const paragraphs = [realPara("Objectives")]; // implicit region consumes nothing
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["r2", "Students will..."]]));
    expect(result.ok).toBe(true);
    expect(result.insertsAfterIndex.get(0)).toEqual(["Students will..."]);
  });

  it("chains multiple consecutive implicit regions after the same anchor in order", () => {
    const regions = [
      region({ id: "r1", role: "heading", text: "Objectives", order: 1 }),
      region({ id: "r2", role: "editable_field", order: 2, source: "implicit" }),
      region({ id: "r3", role: "editable_field", order: 3, source: "implicit" }),
    ];
    const paragraphs = [realPara("Objectives")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["r2", "first"], ["r3", "second"]]));
    expect(result.ok).toBe(true);
    expect(result.insertsAfterIndex.get(0)).toEqual(["first", "second"]);
  });

  it("two explicit editable_field regions in the same cell get independent, correctly-ordered replacements (real-template scenario)", () => {
    // Mirrors table_1_row_5_cell_2 from the real template: an explicit blank
    // paragraph (manual_entry), then a heading-like "1 / 1" paragraph.
    const regions = [
      region({ id: "manual", role: "editable_field", order: 1, source: "explicit" }),
      region({ id: "score-heading", role: "heading", text: "1 / 1", order: 2 }),
    ];
    const paragraphs = [realPara(""), realPara("1 / 1")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["manual", "Watch for the misconception..."]]));
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.get(0)).toBe("Watch for the misconception...");
    expect(result.replaceByIndex.has(1)).toBe(false); // "1 / 1" label untouched
  });

  it("does not queue anything for a region with no content (leave_blank / unfilled manual_entry / fixed_original_text)", () => {
    const regions = [region({ id: "r1", role: "editable_field", order: 1 })];
    const paragraphs = [{ inner: "" }];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map()); // empty map — nothing to write
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.size).toBe(0);
    expect(result.insertsAfterIndex.size).toBe(0);
  });

  it("fails safely (ok:false) when a heading's real text doesn't match what was detected", () => {
    const regions = [region({ id: "r1", role: "heading", text: "Standards", order: 1 })];
    const paragraphs = [{ inner: "<w:r><w:t>Something Completely Different</w:t></w:r>" }];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map());
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expected text/);
  });

  it("fails safely (ok:false) when there are fewer real paragraphs than regions expect to consume", () => {
    const regions = [
      region({ id: "r1", role: "heading", text: "Materials", order: 1 }),
      region({ id: "r2", role: "editable_field", order: 2 }),
    ];
    const paragraphs = [{ inner: "<w:r><w:t>Materials</w:t></w:r>" }]; // only one real paragraph, two consuming regions
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["r2", "content"]]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/none remain|only has/i);
  });

  it("tolerates minor text differences (case/punctuation/whitespace) from mammoth's own text transforms", () => {
    const regions = [region({ id: "r1", role: "heading", text: "Standards Addressed", order: 1 })];
    const paragraphs = [{ inner: "<w:r><w:t xml:space=\"preserve\">  Standards Addressed:  </w:t></w:r>" }];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map());
    expect(result.ok).toBe(true);
  });

  // "blank" (a genuinely empty top-level paragraph with no context) is now
  // writable the exact same way as an explicit editable_field — see
  // toDynamicLessonPlanFromFieldMap (src/lib/custom-templates.ts), which
  // seeds a manual-entry-style section for every such region.
  it("writes content into a 'blank' region exactly like an explicit editable_field", () => {
    const regions = [region({ id: "b1", role: "blank", order: 1 })];
    const paragraphs = [realPara("")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map([["b1", "Remind students to bring calculators."]]));
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.get(0)).toBe("Remind students to bring calculators.");
  });

  it("leaves a 'blank' region untouched when no content was ever entered for it", () => {
    const regions = [region({ id: "b1", role: "blank", order: 1 })];
    const paragraphs = [realPara("")];
    const result = planDynamicContainerEdits(regions, paragraphs, new Map()); // nothing to write
    expect(result.ok).toBe(true);
    expect(result.replaceByIndex.size).toBe(0);
  });
});

describe("mergeDynamicLessonIntoDocumentXml — structural preservation", () => {
  it("replaces only the targeted cell's content, leaving the table/row/cell structure and other cells untouched", () => {
    const cellA = tc([p("Materials", { bold: true }), emptyP()]);
    const cellB = tc([p("A list of resources", { bold: true })]);
    const xml = doc(tbl([tr([cellA, cellB])]));

    const fieldMap = {
      regions: [
        { id: "heading1", order: 1, role: "heading", text: "Materials", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "field1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "instr1", order: 3, role: "instruction", text: "A list of resources", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_2" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(xml, fieldMap, new Map([["field1", "Beakers, elodea sprigs, lamps"]]));

    expect(skipped).toEqual([]);
    expect(outXml).toContain("Beakers, elodea sprigs, lamps");
    expect(outXml).toContain("Materials"); // heading label preserved
    expect(outXml).toContain("A list of resources"); // untouched instruction cell preserved verbatim
    // Structure counts unchanged
    expect((outXml.match(/<w:tbl>/g) || []).length).toBe(1);
    expect((outXml.match(/<w:tr>/g) || []).length).toBe(1);
    expect((outXml.match(/<w:tc>/g) || []).length).toBe(2);
  });

  it("preserves a merged cell's gridSpan/vMerge properties untouched when a sibling cell is edited", () => {
    const mergedCell = `<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p("Lesson Plan Details", { bold: true })}</w:tc>`;
    const xml = doc(tbl([tr([mergedCell])]));
    const fieldMap = { regions: [{ id: "h1", order: 1, role: "heading", text: "Lesson Plan Details", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" }] };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(xml, fieldMap, new Map());
    expect(skipped).toEqual([]);
    expect(outXml).toContain('<w:gridSpan w:val="2"/>');
  });

  it("leaves an unedited manual_entry paragraph exactly as it was (still blank)", () => {
    const cell = tc([p("Anticipated Misconceptions", { bold: true }), emptyP()]);
    const xml = doc(tbl([tr([cell])]));
    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Anticipated Misconceptions", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "manual1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
      ],
    };
    const { xml: outXml } = mergeDynamicLessonIntoDocumentXml(xml, fieldMap, new Map()); // nothing filled in
    expect(outXml).toBe(xml); // byte-for-byte unchanged — nothing to write anywhere
  });

  it("skips (leaves fully untouched) a container whose alignment can't be verified, without touching any other container", () => {
    const goodCell = tc([p("Materials", { bold: true }), emptyP()]);
    const driftedCell = tc([p("Standards", { bold: true })]); // real paragraph text won't match field_map's stale expectation below
    const xml = doc(tbl([tr([goodCell, driftedCell])]));
    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Materials", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "field1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        // Field map thinks this cell has a DIFFERENT heading than it actually does — simulates template drift.
        { id: "h2", order: 3, role: "heading", text: "Learning Objectives", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_2" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      xml, fieldMap, new Map([["field1", "Beakers"]])
    );
    expect(outXml).toContain("Beakers"); // the well-aligned cell still gets filled
    expect(outXml).toContain("Standards"); // the drifted cell's original content survives untouched
    expect(skipped).toHaveLength(1);
    expect(skipped[0].location).toBe("table_1|table_1_row_1|table_1_row_1_cell_2");
  });

  it("inserts implicit-region content immediately after its heading, never touching what follows", () => {
    const topLevel = p("Lesson Objectives", { bold: true }) + p("Materials", { bold: true });
    const xml = doc(topLevel);
    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Lesson Objectives" },
        { id: "obj", order: 2, role: "editable_field", text: "", source: "implicit" },
        { id: "h2", order: 3, role: "heading", text: "Materials" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(xml, fieldMap, new Map([["obj", "Students will explain photosynthesis."]]));
    expect(skipped).toEqual([]);
    const objIndex = outXml.indexOf("Students will explain photosynthesis.");
    const objectivesHeadingIndex = outXml.indexOf("Lesson Objectives");
    const materialsHeadingIndex = outXml.indexOf("Materials", objIndex);
    expect(objIndex).toBeGreaterThan(objectivesHeadingIndex);
    expect(objIndex).toBeLessThan(materialsHeadingIndex);
  });

  it("all non-document.xml-relevant structure (paragraph count) stays balanced except for genuine insertions", () => {
    const cell = tc([p("Heading", { bold: true }), emptyP()]);
    const xml = doc(tbl([tr([cell])]));
    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Heading", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "f1", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "implicit1", order: 3, role: "editable_field", text: "", source: "implicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
      ],
    };
    const before = (xml.match(/<w:p>/g) || []).length;
    const { xml: outXml } = mergeDynamicLessonIntoDocumentXml(xml, fieldMap, new Map([["f1", "filled"], ["implicit1", "extra inserted paragraph"]]));
    const after = (outXml.match(/<w:p>/g) || []).length;
    expect(after).toBe(before + 1); // exactly one new paragraph inserted for the implicit region
  });

  it("writes independent content into multiple top-level 'blank' regions without cross-contamination", () => {
    const xml = doc(p("Lesson Plan", { bold: true }) + emptyP() + p("Materials", { bold: true }) + emptyP());
    const fieldMap = {
      regions: [
        { id: "h1", order: 1, role: "heading", text: "Lesson Plan" },
        { id: "b1", order: 2, role: "blank" },
        { id: "h2", order: 3, role: "heading", text: "Materials" },
        { id: "b2", order: 4, role: "blank" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      xml, fieldMap, new Map([["b1", "First note."], ["b2", "Second, unrelated note."]])
    );
    expect(skipped).toEqual([]);
    expect(outXml).toContain("First note.");
    expect(outXml).toContain("Second, unrelated note.");
    // Neither blank region's content leaked into the other's paragraph.
    expect(outXml.indexOf("First note.")).toBeLessThan(outXml.indexOf("Materials"));
    expect(outXml.indexOf("Second, unrelated note.")).toBeGreaterThan(outXml.indexOf("Materials"));
  });

  it("writes independent manual content into multiple empty cells across different cells, rows, and tables", () => {
    const rowA = tr([tc([emptyP()]), tc([emptyP()])]); // two empty cells, same row
    const rowB = tr([tc([emptyP()])]);                 // a third empty cell, different row, same table
    const tableOne = tbl([rowA, rowB]);
    const tableTwo = tbl([tr([tc([emptyP()])])]);       // a fourth empty cell, a completely different table
    const xml = doc(tableOne + tableTwo);
    const fieldMap = {
      regions: [
        { id: "cellA1", order: 1, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_1" },
        { id: "cellA2", order: 2, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_1", cellId: "table_1_row_1_cell_2" },
        { id: "cellB1", order: 3, role: "editable_field", text: "", source: "explicit", tableId: "table_1", rowId: "table_1_row_2", cellId: "table_1_row_2_cell_1" },
        { id: "cellC1", order: 4, role: "editable_field", text: "", source: "explicit", tableId: "table_2", rowId: "table_2_row_1", cellId: "table_2_row_1_cell_1" },
      ],
    };
    const { xml: outXml, skipped } = mergeDynamicLessonIntoDocumentXml(
      xml, fieldMap, new Map([
        ["cellA1", "Row 1, Cell 1 note"],
        ["cellA2", "Row 1, Cell 2 note"],
        ["cellB1", "Row 2, Cell 1 note"],
        ["cellC1", "Table 2 note"],
      ])
    );
    expect(skipped).toEqual([]);
    for (const text of ["Row 1, Cell 1 note", "Row 1, Cell 2 note", "Row 2, Cell 1 note", "Table 2 note"]) {
      expect(outXml).toContain(text);
    }
    // Structure preserved: 2 tables, 3 rows total, 4 cells total.
    expect((outXml.match(/<w:tbl>/g) || []).length).toBe(2);
    expect((outXml.match(/<w:tr>/g) || []).length).toBe(3);
    expect((outXml.match(/<w:tc>/g) || []).length).toBe(4);
  });
});
