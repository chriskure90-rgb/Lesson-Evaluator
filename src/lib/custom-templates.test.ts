import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toDynamicLessonPlanFromFieldMap,
  buildDynamicLessonExportDocument,
  getCustomTemplateFormat,
  hasFieldMapRegions,
  exportCustomTemplateLessonDocx,
  exportDynamicLessonDocx,
  DEFAULT_DETECTED_SECTIONS,
  DEFAULT_DETECTED_LAYOUT,
  type TemplateFieldMap,
  type DynamicLessonPlan,
  type CustomTemplate,
} from "./custom-templates";

function template(overrides: Partial<CustomTemplate>): CustomTemplate {
  return {
    id: "template-1",
    user_id: "user-1",
    name: "Test Template",
    original_filename: "test.docx",
    storage_path: "user-1/test.docx",
    placeholders: [],
    recognized_placeholders: [],
    unrecognized_placeholders: [],
    structured_fields: [],
    detected_sections: DEFAULT_DETECTED_SECTIONS,
    section_detection_status: "ready",
    section_detection_error: null,
    detected_layout: DEFAULT_DETECTED_LAYOUT,
    layout_detection_status: "ready",
    layout_detection_error: null,
    field_map: { version: 1, regions: [], mappings: [], confirmed: false },
    field_map_status: "ready",
    field_map_error: null,
    status: "ready",
    error_message: null,
    created_at: new Date(0).toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

function regionWithMapping(id: string): TemplateFieldMap["regions"][number] {
  return { id, order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text" };
}

function region(overrides: Partial<TemplateFieldMap["regions"][number]> & { id: string }): TemplateFieldMap["regions"][number] {
  return { order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text", ...overrides };
}

describe("toDynamicLessonPlanFromFieldMap — manual_entry sections", () => {
  it("seeds a manual_entry region as its own section with empty content, origin: 'manual'", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [region({ id: "r1", contextLabel: "Anticipated Misconceptions" })],
      mappings: [
        { regionId: "r1", target: "manual_entry", suggestedTarget: "manual_entry", suggestedConfidence: 0.9, status: "manual_entry" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap({}, fieldMap);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]).toEqual({
      id: "r1",
      originalLabel: "Anticipated Misconceptions",
      content: "",
      origin: "manual",
    });
  });

  it("ignores any stray rawResponse value for a manual_entry region — content always starts empty", () => {
    // The LLM is never asked about manual_entry regions (see
    // buildDynamicLessonPromptFromFieldMap), so even if a stray key showed
    // up in the response, it must not leak into a "teacher-authored" field.
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [region({ id: "r1", contextLabel: "Grouping" })],
      mappings: [
        { regionId: "r1", target: "manual_entry", suggestedTarget: "manual_entry", suggestedConfidence: 0.9, status: "manual_entry" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap({ r1: "unexpected AI text" }, fieldMap);
    expect(plan.sections[0].content).toBe("");
  });

  it("does not create a section for a manual_entry-targeted checkbox_group region", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [region({ id: "r1", role: "checkbox_group", contextLabel: "Grouping", checkboxOptions: ["Individual", "Pairs", "Whole Class"] })],
      mappings: [
        { regionId: "r1", target: "manual_entry", suggestedTarget: "manual_entry", suggestedConfidence: 0.65, status: "manual_entry" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap({}, fieldMap);
    expect(plan.sections).toHaveLength(0);
  });
});

describe("toDynamicLessonPlanFromFieldMap — existing generated sections unaffected", () => {
  it("still produces a normal AI-generated section for a canonical target, unchanged", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [region({ id: "r1", contextLabel: "Learning Objectives" })],
      mappings: [
        { regionId: "r1", target: "learning_objectives", suggestedTarget: "learning_objectives", suggestedConfidence: 0.9, status: "ready" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap({ r1: "Students will explain photosynthesis." }, fieldMap);
    expect(plan.sections).toEqual([
      { id: "r1", originalLabel: "Learning Objectives", content: "Students will explain photosynthesis." },
    ]);
    expect(plan.sections[0].origin).toBeUndefined();
  });

  it("mixes generated and manual sections correctly in one plan", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [
        region({ id: "r1", contextLabel: "Learning Objectives" }),
        region({ id: "r2", contextLabel: "Anticipated Misconceptions" }),
        region({ id: "r3", contextLabel: "Extension Activity" }), // custom_section, still AI-generatable
      ],
      mappings: [
        { regionId: "r1", target: "learning_objectives", suggestedTarget: "learning_objectives", suggestedConfidence: 0.9, status: "ready" },
        { regionId: "r2", target: "manual_entry", suggestedTarget: "manual_entry", suggestedConfidence: 0.9, status: "manual_entry" },
        { regionId: "r3", target: "custom_section", customLabel: "Extension Activity", suggestedTarget: null, suggestedConfidence: 0, status: "ready" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap(
      { r1: "Objective text.", r3: "Extension text." },
      fieldMap
    );
    expect(plan.sections).toHaveLength(3);
    expect(plan.sections.find((s) => s.id === "r1")).toMatchObject({ content: "Objective text." });
    expect(plan.sections.find((s) => s.id === "r1")?.origin).toBeUndefined();
    expect(plan.sections.find((s) => s.id === "r2")).toMatchObject({ content: "", origin: "manual" });
    expect(plan.sections.find((s) => s.id === "r3")).toMatchObject({ content: "Extension text." });
    expect(plan.sections.find((s) => s.id === "r3")?.origin).toBeUndefined();
  });

  it("still excludes leave_blank/fixed_original_text/metadata targets exactly as before", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1,
      confirmed: true,
      regions: [
        region({ id: "r1" }), region({ id: "r2" }), region({ id: "r3" }),
      ],
      mappings: [
        { regionId: "r1", target: "leave_blank", suggestedTarget: null, suggestedConfidence: 0, status: "leave_blank" },
        { regionId: "r2", target: "fixed_original_text", suggestedTarget: null, suggestedConfidence: 0, status: "ready" },
        { regionId: "r3", target: "grade_level", suggestedTarget: "grade_level", suggestedConfidence: 0.9, status: "ready" },
      ],
    };
    const plan = toDynamicLessonPlanFromFieldMap({}, fieldMap);
    expect(plan.sections).toHaveLength(0);
  });
});

describe("previously-saved plans continue to work without migration", () => {
  it("a legacy DynamicLessonPlan (no origin field on any section) is still structurally valid", () => {
    // Exactly the shape every dynamic lesson saved before this change has in
    // Supabase's lesson_generation.lesson_json — no `origin` property at all.
    const legacyPlan: DynamicLessonPlan = {
      sections: [
        { id: "r1", originalLabel: "Learning Objectives", content: "Students will explain photosynthesis." },
        { id: "r2", originalLabel: "Materials", content: "Elodea sprigs, beakers." },
      ],
    };
    // The type accepts it with no cast/migration, and the "is this a manual
    // field" check used by the preview (section.origin === "manual") is
    // false for every section here, same as before this change existed.
    expect(legacyPlan.sections.every((s) => s.origin === undefined)).toBe(true);
    expect(legacyPlan.sections.map((s) => s.origin === "manual" ? "(empty)" : s.content)).toEqual([
      "Students will explain photosynthesis.",
      "Elodea sprigs, beakers.",
    ]);
  });
});

// region() helper (defined above) always sets contextLabel undefined unless
// overridden — mirrors a region whose label lives in a separate cell/row
// (see api/custom-templates.js's classifyUnitsIntoRegions), the exact shape
// that produces a manual_entry mapping with no usable label.
function manualMapping(regionId: string): TemplateFieldMap["mappings"][number] {
  return { regionId, target: "manual_entry", suggestedTarget: "manual_entry", suggestedConfidence: 0.9, status: "manual_entry" };
}

// Mirrors setDynamicSectionContent in src/App.tsx exactly (prev.map(s =>
// s.id === regionId ? {...s, content: value} : s)) — the real update-by-id
// logic teacher edits go through, replicated here so this test exercises
// the actual identity contract instead of asserting against itself.
function editSectionContent(sections: DynamicLessonPlan["sections"], regionId: string, value: string) {
  return sections.map((s) => (s.id === regionId ? { ...s, content: value } : s));
}

describe("editing manual-entry cells: identity, isolation, and persistence", () => {
  const fiveEmptyCellsFieldMap: TemplateFieldMap = {
    version: 1,
    confirmed: true,
    regions: ["r1", "r2", "r3", "r4", "r5"].map((id) => region({ id })),
    mappings: ["r1", "r2", "r3", "r4", "r5"].map(manualMapping),
  };

  it("1. one manual (empty) cell can be edited and saved", () => {
    const fieldMap: TemplateFieldMap = {
      version: 1, confirmed: true,
      regions: [region({ id: "r1", contextLabel: undefined })],
      mappings: [manualMapping("r1")],
    };
    const plan = toDynamicLessonPlanFromFieldMap({}, fieldMap);
    expect(plan.sections[0].content).toBe("");
    const saved = editSectionContent(plan.sections, "r1", "Watch for the misconception that heavier objects fall faster.");
    expect(saved[0].content).toBe("Watch for the misconception that heavier objects fall faster.");
    expect(saved[0].origin).toBe("manual");
  });

  it("2. five repeated (empty) cells remain five independent editable cells", () => {
    const plan = toDynamicLessonPlanFromFieldMap({}, fiveEmptyCellsFieldMap);
    expect(plan.sections).toHaveLength(5);
    expect(new Set(plan.sections.map((s) => s.id)).size).toBe(5);
    expect(plan.sections.every((s) => s.content === "" && s.origin === "manual")).toBe(true);
  });

  it("3. editing one cell does not update the other empty cells", () => {
    const plan = toDynamicLessonPlanFromFieldMap({}, fiveEmptyCellsFieldMap);
    const edited = editSectionContent(plan.sections, "r3", "Some students may not group by shared properties.");
    expect(edited.find((s) => s.id === "r3")?.content).toBe("Some students may not group by shared properties.");
    for (const id of ["r1", "r2", "r4", "r5"]) {
      expect(edited.find((s) => s.id === id)?.content).toBe("");
    }
  });

  it("4. saved manual content replaces the (empty) placeholder", () => {
    // Mirrors valueForRegion's resolution rule exactly (src/App.tsx):
    // text = generated?.content?.trim() || undefined; placeholder = "(empty)".
    const resolve = (content: string) => ({ text: content.trim() || undefined, placeholder: "(empty)" });
    const displayed = (r: ReturnType<typeof resolve>) => r.text ?? r.placeholder;
    expect(displayed(resolve("Group by lab role, not friend groups."))).toBe("Group by lab role, not friend groups.");
  });

  it("5. unedited cells continue to display (empty)", () => {
    const resolve = (content: string) => ({ text: content.trim() || undefined, placeholder: "(empty)" });
    const displayed = (r: ReturnType<typeof resolve>) => r.text ?? r.placeholder;
    expect(displayed(resolve(""))).toBe("(empty)");
  });

  it("6. manual content survives a Library save/reload round-trip (JSON serialization)", () => {
    const plan = toDynamicLessonPlanFromFieldMap({}, fiveEmptyCellsFieldMap);
    const edited = editSectionContent(plan.sections, "r2", "Pairs, mixed-ability.");
    const savedJson = JSON.stringify({ sections: edited }); // what handleSaveDynamicEdit persists as lesson_json
    const reloaded: DynamicLessonPlan = JSON.parse(savedJson);
    expect(reloaded.sections.find((s) => s.id === "r2")).toEqual({
      id: "r2", originalLabel: "Notes", content: "Pairs, mixed-ability.", origin: "manual",
    });
    // Every other cell round-trips too, still empty and still manual.
    for (const id of ["r1", "r3", "r4", "r5"]) {
      const section = reloaded.sections.find((s) => s.id === id);
      expect(section?.content).toBe("");
      expect(section?.origin).toBe("manual");
    }
  });

  it("7. distinguishes AI-generated, manual-entry, repeated manual-entry, and legacy (no origin) sections", () => {
    const generated: DynamicLessonPlan["sections"][number] = { id: "g1", originalLabel: "Learning Objectives", content: "Students will..." };
    const manualA: DynamicLessonPlan["sections"][number] = { id: "m1", originalLabel: "Notes", content: "", origin: "manual" };
    const manualB: DynamicLessonPlan["sections"][number] = { id: "m2", originalLabel: "Notes", content: "Filled in.", origin: "manual" };
    const legacy: DynamicLessonPlan["sections"][number] = { id: "l1", originalLabel: "Materials", content: "Beakers." };

    const isManual = (s: typeof generated) => s.origin === "manual";
    expect(isManual(generated)).toBe(false);
    expect(isManual(manualA)).toBe(true);
    expect(isManual(manualB)).toBe(true);
    expect(isManual(legacy)).toBe(false); // legacy (pre-existing) section, no origin field — treated as AI-generated, same as before
    // manualA and manualB are both "manual_entry" but remain independently
    // identified/updatable by id, never merged just because they share the
    // same fallback label ("Notes") or empty starting content.
    expect(manualA.id).not.toBe(manualB.id);
  });
});

// 8. Manual content must also appear in exports (Word/PDF/TXT all build
// from this same ExportDocument — see src/lib/export.ts's
// documentToDocxBlob/documentToPdfBlob/documentToText).
describe("buildDynamicLessonExportDocument — manual-entry sections in export", () => {
  const plan: DynamicLessonPlan = {
    sections: [
      { id: "g1", originalLabel: "Learning Objectives", content: "Students will explain photosynthesis." },
      { id: "m1", originalLabel: "Notes", content: "Watch for the heavier-falls-faster misconception.", origin: "manual" },
      { id: "m2", originalLabel: "Notes", content: "", origin: "manual" }, // left unedited
    ],
  };

  it("includes every section — generated and manual alike", () => {
    const doc = buildDynamicLessonExportDocument(plan, "Photosynthesis Lesson");
    expect(doc.sections).toHaveLength(3);
  });

  it("exports the teacher's actual saved content for a filled-in manual field", () => {
    const doc = buildDynamicLessonExportDocument(plan, "Photosynthesis Lesson");
    const m1 = doc.sections.find((s) => s.heading === "Notes" && s.paragraphs?.[0]?.startsWith("Watch"));
    expect(m1?.paragraphs).toEqual(["Watch for the heavier-falls-faster misconception."]);
  });

  it("exports '(empty)' — not '(no content generated)' — for an unedited manual field", () => {
    const doc = buildDynamicLessonExportDocument(plan, "Photosynthesis Lesson");
    const manualSections = doc.sections.filter((s) => s.heading === "Notes");
    const unedited = manualSections.find((s) => s.paragraphs?.[0] !== plan.sections[1].content);
    expect(unedited?.paragraphs).toEqual(["(empty)"]);
  });

  it("still exports '(no content generated)' for an AI-generated section with no content (unaffected)", () => {
    const emptyGeneratedPlan: DynamicLessonPlan = { sections: [{ id: "g1", originalLabel: "Assessment", content: "" }] };
    const doc = buildDynamicLessonExportDocument(emptyGeneratedPlan, "Lesson");
    expect(doc.sections[0].paragraphs).toEqual(["(no content generated)"]);
  });
});

// Root-cause regression suite: a template with recognized {{TOKEN}}
// placeholders was being routed into the dynamic (field_map) pipeline
// whenever field_map ALSO detected regions — which it does for virtually
// any real document, since Phase 5 detection runs unconditionally and
// independently of {{TOKEN}} presence. getCustomTemplateFormat is the
// single source of truth fixing this; every case here mirrors one of the
// call sites in src/App.tsx (selectCustomTemplate, handleCustomTemplatesChange,
// handleGenerate's dynamic-branch guard) that used to re-derive this decision
// from hasFieldMapRegions() alone.
describe("getCustomTemplateFormat", () => {
  it("1. routes to custom when recognized {{TOKEN}} placeholders exist, even with field-map regions also present", () => {
    const t = template({
      recognized_placeholders: ["OBJECTIVES", "GRADE_LEVEL"],
      field_map: { version: 1, regions: [regionWithMapping("doc_unit_1")], mappings: [], confirmed: false },
    });
    expect(getCustomTemplateFormat(t)).toBe("custom");
  });

  it("2. routes to dynamic when there are no recognized placeholders but field-map regions exist", () => {
    const t = template({
      recognized_placeholders: [],
      field_map: { version: 1, regions: [regionWithMapping("doc_unit_1")], mappings: [], confirmed: false },
    });
    expect(getCustomTemplateFormat(t)).toBe("dynamic");
  });

  it("3. falls back to custom (existing behavior) when neither recognized placeholders nor field-map regions exist", () => {
    const t = template({ recognized_placeholders: [], field_map: { version: 1, regions: [], mappings: [], confirmed: false } });
    expect(getCustomTemplateFormat(t)).toBe("custom");
  });

  it("recognized tokens win even when field_map has zero regions (the simple, unambiguous case)", () => {
    const t = template({
      recognized_placeholders: ["OBJECTIVES"],
      field_map: { version: 1, regions: [], mappings: [], confirmed: false },
    });
    expect(getCustomTemplateFormat(t)).toBe("custom");
  });

  it("hasFieldMapRegions remains a plain region-count check, independent of recognized_placeholders", () => {
    const withTokensAndRegions = template({
      recognized_placeholders: ["OBJECTIVES"],
      field_map: { version: 1, regions: [regionWithMapping("r1")], mappings: [], confirmed: false },
    });
    // Still true — hasFieldMapRegions answers a different question (does
    // field_map have data) than getCustomTemplateFormat (which pipeline to use).
    expect(hasFieldMapRegions(withTokensAndRegions)).toBe(true);
    expect(getCustomTemplateFormat(withTokensAndRegions)).toBe("custom");
  });
});

// 4/5: exported through the correct server action — the actual mechanism
// that ultimately determines whether handleExport (Docxtemplater/{{TAG}})
// or handleExportDynamic (field_map position-based merge) runs.
describe("export routing — correct server action per format", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("4. exportCustomTemplateLessonDocx sends action: 'export' (token-based path -> handleExport)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["docx bytes"])) });
    vi.stubGlobal("fetch", fetchMock);

    await exportCustomTemplateLessonDocx("template-1", "user-1", {
      lessonTitle: "Photosynthesis",
      teacherName: "",
      subjectGradeLevel: "Grade 7 Science",
      lessonDuration: "60",
      centralFocus: "",
      standardsAddressed: "",
      lessonObjectives: ["Objective A"],
      materials: [],
      introduction: { teacherActions: "", studentActions: "", studentSupport: "" },
      mainLearningActivities: { teacherActions: "", studentActions: "", studentSupport: "" },
      closure: { teacherActions: "", studentActions: "" },
      assessment: { howObjectivesAssessed: "" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/custom-templates");
    const body = JSON.parse(options.body);
    expect(body.action).toBe("export");
    expect(body.customTemplateId).toBe("template-1");
  });

  it("5. exportDynamicLessonDocx sends action: 'export-dynamic' (field_map path -> handleExportDynamic)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["docx bytes"])) });
    vi.stubGlobal("fetch", fetchMock);

    await exportDynamicLessonDocx("template-1", "user-1", { sections: [{ id: "r1", originalLabel: "Objectives", content: "Objective A" }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/custom-templates");
    const body = JSON.parse(options.body);
    expect(body.action).toBe("export-dynamic");
    expect(body.customTemplateId).toBe("template-1");
  });
});
