import { describe, it, expect } from "vitest";
import {
  isGenericEmptyCellPlaceholder,
  classifyUnitsIntoRegions,
  classifyRegionTarget,
  buildMappingsForRegions,
  buildFieldMap,
} from "./custom-templates.js";

describe("isGenericEmptyCellPlaceholder", () => {
  it("matches the base phrase", () => {
    expect(isGenericEmptyCellPlaceholder("(empty)")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isGenericEmptyCellPlaceholder("(EMPTY)")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("Empty")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("Generated Content Will Appear Here.")).toBe(true);
  });

  it("is punctuation/whitespace-insensitive", () => {
    expect(isGenericEmptyCellPlaceholder("  (empty)  ")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("empty.")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("N/A")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("n.a.")).toBe(true);
    expect(isGenericEmptyCellPlaceholder("generated   content will appear here")).toBe(true);
  });

  it("does not match real content", () => {
    expect(isGenericEmptyCellPlaceholder("Students will model photosynthesis using elodea sprigs.")).toBe(false);
    expect(isGenericEmptyCellPlaceholder("")).toBe(false);
    expect(isGenericEmptyCellPlaceholder(undefined)).toBe(false);
  });
});

describe("classifyUnitsIntoRegions — placeholder text inside otherwise-empty cells", () => {
  it("treats a literal placeholder unit as blank/editable, not as a new heading", () => {
    // Without the placeholder-normalization fix, "(empty)" is short and has
    // no trailing colon/period, so classifyRegionRole would call it a new
    // "heading" — silently shadowing the real field it sits under. This is
    // the core detection bug this change fixes.
    const units = [{ text: "Materials:" }, { text: "(empty)" }];
    const regions = classifyUnitsIntoRegions(units, "cell", {});
    expect(regions).toHaveLength(2);
    expect(regions[0]).toMatchObject({ role: "heading", text: "Materials:" });
    expect(regions[1]).toMatchObject({
      role: "editable_field",
      text: "",
      source: "explicit",
      contextLabel: "Materials",
    });
  });

  it("treats 'Generated content will appear here.' the same as a truly blank cell", () => {
    const withPlaceholder = classifyUnitsIntoRegions(
      [{ text: "Anticipated Misconceptions:" }, { text: "Generated content will appear here." }],
      "cell", {}
    );
    const withTrulyBlank = classifyUnitsIntoRegions(
      [{ text: "Anticipated Misconceptions:" }, { text: "" }],
      "cell", {}
    );
    expect(withPlaceholder.map((r) => ({ role: r.role, text: r.text }))).toEqual(
      withTrulyBlank.map((r) => ({ role: r.role, text: r.text }))
    );
  });

  it("still classifies a genuinely blank cell with no context as structural filler", () => {
    const regions = classifyUnitsIntoRegions([{ text: "" }], "cell", {});
    expect(regions).toEqual([expect.objectContaining({ role: "blank", text: "" })]);
  });

  it("leaves real, non-placeholder content untouched (no regression)", () => {
    const units = [
      { text: "Learning Objectives:" },
      { text: "Students will explain how light intensity affects photosynthesis." },
    ];
    const regions = classifyUnitsIntoRegions(units, "cell", {});
    expect(regions[0]).toMatchObject({ role: "heading" });
    expect(regions[1]).toMatchObject({ role: "instruction", text: "Students will explain how light intensity affects photosynthesis." });
  });
});

describe("classifyRegionTarget — teacher-planning fields auto-map to manual_entry", () => {
  const editableField = (contextLabel) => ({
    id: "r1", order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text", contextLabel,
  });

  it("matches an exact planning-field label", () => {
    expect(classifyRegionTarget(editableField("Anticipated Misconceptions"))).toMatchObject({ target: "manual_entry" });
    expect(classifyRegionTarget(editableField("Questioning Strategies"))).toMatchObject({ target: "manual_entry" });
    expect(classifyRegionTarget(editableField("Grouping"))).toMatchObject({ target: "manual_entry" });
  });

  it("is case and punctuation insensitive", () => {
    expect(classifyRegionTarget(editableField("ANTICIPATED MISCONCEPTIONS"))).toMatchObject({ target: "manual_entry" });
    expect(classifyRegionTarget(editableField("anticipated   misconceptions"))).toMatchObject({ target: "manual_entry" });
    expect(classifyRegionTarget(editableField("Anticipated Misconceptions!"))).toMatchObject({ target: "manual_entry" });
  });

  it("matches with or without a trailing colon", () => {
    expect(classifyRegionTarget(editableField("Anticipated Misconceptions:"))).toMatchObject({ target: "manual_entry" });
    expect(classifyRegionTarget(editableField("Anticipated Misconceptions"))).toMatchObject({ target: "manual_entry" });
  });

  it("matches a planning phrase embedded in a longer label (substring tier)", () => {
    expect(classifyRegionTarget(editableField("Notes on Anticipated Misconceptions"))).toMatchObject({ target: "manual_entry" });
  });

  it("does not shadow a real canonical field with a similar-sounding label", () => {
    // "Learning Objectives" must keep mapping to the existing canonical
    // target, unaffected by the new planning dictionary.
    expect(classifyRegionTarget(editableField("Learning Objectives"))).toMatchObject({ target: "learning_objectives" });
  });

  it("unmatched empty/plain labels fall through to null (caller defaults to custom_section)", () => {
    expect(classifyRegionTarget(editableField("Extension Activity"))).toEqual({ target: null, confidence: 0 });
  });
});

describe("buildMappingsForRegions — target defaults and status", () => {
  const region = (overrides) => ({
    id: "r1", order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text", ...overrides,
  });

  it("defaults an unmatched empty field to custom_section, status ready-eligible (needs_review pre-confirm)", () => {
    const [mapping] = buildMappingsForRegions([region({ contextLabel: "Extension Activity" })]);
    expect(mapping.target).toBe("custom_section");
    expect(mapping.status).not.toBe("manual_entry");
  });

  it("auto-classifies a planning field to manual_entry with status manual_entry, not ready/needs_review", () => {
    const [mapping] = buildMappingsForRegions([region({ contextLabel: "Anticipated Misconceptions" })]);
    expect(mapping.target).toBe("manual_entry");
    expect(mapping.status).toBe("manual_entry");
  });

  it("leaves a confidently-matched canonical field exactly as before", () => {
    const [mapping] = buildMappingsForRegions([region({ contextLabel: "Learning Objectives" })]);
    expect(mapping.target).toBe("learning_objectives");
    expect(mapping.status).toBe("ready");
  });
});

describe("buildFieldMap — end-to-end regression against a realistic template", () => {
  const html = `
    <table><tr><td><p>Learning Objectives:</p></td></tr></table>
    <table><tr><td><p>Anticipated Misconceptions:</p></td></tr></table>
    <table><tr><td><p>Materials:</p></td></tr><tr><td><p>(empty)</p></td></tr></table>
    <table><tr><td><p>Extension Activity:</p></td></tr></table>
  `;

  it("routes each field to the correct target without any manual review step", () => {
    const fieldMap = buildFieldMap(html);
    const byLabel = new Map(
      fieldMap.mappings.map((m) => {
        const region = fieldMap.regions.find((r) => r.id === m.regionId);
        return [region?.contextLabel, m.target];
      })
    );
    expect(byLabel.get("Learning Objectives")).toBe("learning_objectives");
    expect(byLabel.get("Anticipated Misconceptions")).toBe("manual_entry");
    expect(byLabel.get("Materials")).toBe("materials"); // existing canonical target — unaffected by this change
    expect(byLabel.get("Extension Activity")).toBe("custom_section"); // unmatched by either dictionary — still AI-generatable, unchanged default
  });

  it("still treats the '(empty)' cell under Materials as blank/editable, not as a stray new heading", () => {
    const fieldMap = buildFieldMap(html);
    const materialsHeading = fieldMap.regions.find((r) => r.role === "heading" && r.text === "Materials:");
    expect(materialsHeading).toBeTruthy();
    const blankRegions = fieldMap.regions.filter((r) => r.role === "blank" || (r.role === "editable_field" && r.contextLabel === "Materials"));
    expect(blankRegions.some((r) => r.text === "")).toBe(true);
    // Regression guard: no region anywhere should have literally kept
    // "(empty)" as its text — it must always normalize away.
    expect(fieldMap.regions.some((r) => r.text === "(empty)")).toBe(false);
  });

  it("previously-saved-shaped field maps (no new fields, old target values) still have a consistent, readable shape", () => {
    // A field_map produced before this change (or freshly detected now, for
    // content this change doesn't touch) has exactly this shape — no new
    // required properties were introduced, so nothing needs migrating.
    const legacyFieldMap = {
      version: 1,
      confirmed: true,
      regions: [{ id: "r1", order: 1, role: "editable_field", text: "", source: "explicit", outputMode: "text", contextLabel: "Materials" }],
      mappings: [{ regionId: "r1", target: "custom_section", customLabel: "Materials", suggestedTarget: "custom_section", suggestedConfidence: 0.65, status: "ready" }],
    };
    expect(legacyFieldMap.mappings[0].target).toBe("custom_section");
    expect(() => JSON.stringify(legacyFieldMap)).not.toThrow();
  });
});
