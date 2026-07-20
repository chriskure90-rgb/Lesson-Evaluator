import { describe, it, expect } from "vitest";
import { toDynamicLessonPlanFromFieldMap, type TemplateFieldMap, type DynamicLessonPlan } from "./custom-templates";

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
    expect(legacyPlan.sections.map((s) => s.origin === "manual" ? "Add your notes here." : s.content)).toEqual([
      "Students will explain photosynthesis.",
      "Elodea sprigs, beakers.",
    ]);
  });
});
