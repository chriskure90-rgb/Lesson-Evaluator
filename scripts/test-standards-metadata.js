/**
 * Regression tests for server-lib/standards-metadata.js
 *
 * Plain Node assertions — no test framework needed.
 * Run with:  node scripts/test-standards-metadata.js
 *
 * Exit 0 = all pass.  Exit 1 = first failure (with message).
 */

import {
  gradeToBand,
  extractStandardCode,
  extractMetadataFromCode,
  scanTextForGradeAndSubject,
  extractChunkMetadata,
} from "../server-lib/standards-metadata.js";

let passed = 0;
let failed = 0;

function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function notNull(label, actual) {
  const ok = actual != null;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else     { console.error(`  ✗ ${label} — expected non-null, got ${actual}`); failed++; }
}

function isNull(label, actual) {
  const ok = actual == null;
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else     { console.error(`  ✗ ${label} — expected null, got ${JSON.stringify(actual)}`); failed++; }
}

// ── gradeToBand ───────────────────────────────────────────────────────────────
console.log("\ngradeToBand");
eq("K → K",           gradeToBand("K"),   "K");
eq("1 → 1-2",         gradeToBand("1"),   "1-2");
eq("2 → 1-2",         gradeToBand("2"),   "1-2");
eq("3 → 3-5",         gradeToBand("3"),   "3-5");
eq("4 → 3-5",         gradeToBand("4"),   "3-5");
eq("5 → 3-5",         gradeToBand("5"),   "3-5");
eq("6 → 6-8",         gradeToBand("6"),   "6-8");
eq("7 → 6-8",         gradeToBand("7"),   "6-8");
eq("8 → 6-8",         gradeToBand("8"),   "6-8");
eq("9 → 9-12",        gradeToBand("9"),   "9-12");
eq("10 → 9-12",       gradeToBand("10"),  "9-12");
eq("11 → 9-12",       gradeToBand("11"),  "9-12");
eq("12 → 9-12",       gradeToBand("12"),  "9-12");
eq("MS → 6-8",        gradeToBand("MS"),  "6-8");
eq("HS → 9-12",       gradeToBand("HS"),  "9-12");
eq("K-2 → null",      gradeToBand("K-2"), null);
eq("3-5 → 3-5",       gradeToBand("3-5"), "3-5");
isNull("null → null", gradeToBand(null));

// ── extractStandardCode ───────────────────────────────────────────────────────
console.log("\nextractStandardCode");
eq("NC.6.RP.1",             extractStandardCode("NC.6.RP.1 Understand the concept of a ratio"),  "NC.6.RP.1");
eq("NC.6.RP.2",             extractStandardCode("NC.6.RP.2 Students will..."),                   "NC.6.RP.2");
eq("NC.3.NF.A.1",           extractStandardCode("NC.3.NF.A.1 Some description"),                 "NC.3.NF.A.1");
eq("NC.K.NBT.1",            extractStandardCode("NC.K.NBT.1 Numbers and operations"),            "NC.K.NBT.1");
eq("CA.5.NF.B.3",           extractStandardCode("CA.5.NF.B.3 Interpret a fraction"),             "CA.5.NF.B.3");
eq("CCSS.MATH.CONTENT.6.RP.A.1", extractStandardCode("CCSS.MATH.CONTENT.6.RP.A.1 Understand the concept"), "CCSS.MATH.CONTENT.6.RP.A.1");
eq("CCSS.ELA-LITERACY.RI.5.1",   extractStandardCode("CCSS.ELA-LITERACY.RI.5.1 Quote accurately"),         "CCSS.ELA-LITERACY.RI.5.1");
eq("MS-LS1-6",              extractStandardCode("MS-LS1-6 Construct a scientific explanation"),   "MS-LS1-6");
eq("HS-PS1-2",              extractStandardCode("HS-PS1-2 Construct and revise"),                "HS-PS1-2");
eq("K-PS2-1",               extractStandardCode("K-PS2-1 Students will observe"),                "K-PS2-1");
eq("3-5-ETS1-1",            extractStandardCode("3-5-ETS1-1 Define a simple problem"),           "3-5-ETS1-1");
eq("K-2-ETS1-1",            extractStandardCode("K-2-ETS1-1 Ask questions to define a problem"), "K-2-ETS1-1");
isNull("plain prose returns null", extractStandardCode("This section describes skills for all students."));
isNull("too short (no domain)",    extractStandardCode("NC.6 brief"));

// ── extractMetadataFromCode ───────────────────────────────────────────────────
console.log("\nextractMetadataFromCode");

// State standards
eq("NC.6.RP.1 → grade 6, band 6-8",
  extractMetadataFromCode("NC.6.RP.1"),
  { grade_level: "6", grade_band: "6-8", subject: null });

eq("NC.7.RP.1 → grade 7, band 6-8",
  extractMetadataFromCode("NC.7.RP.1"),
  { grade_level: "7", grade_band: "6-8", subject: null });

eq("NC.3.NF.A.1 → grade 3, band 3-5",
  extractMetadataFromCode("NC.3.NF.A.1"),
  { grade_level: "3", grade_band: "3-5", subject: null });

eq("NC.K.NBT.1 → grade K, band K",
  extractMetadataFromCode("NC.K.NBT.1"),
  { grade_level: "K", grade_band: "K", subject: null });

eq("CA.5.NF.B.3 → grade 5, band 3-5",
  extractMetadataFromCode("CA.5.NF.B.3"),
  { grade_level: "5", grade_band: "3-5", subject: null });

// CCSS Math
eq("CCSS.MATH.CONTENT.6.RP.A.1 → grade 6, band 6-8, Math",
  extractMetadataFromCode("CCSS.MATH.CONTENT.6.RP.A.1"),
  { grade_level: "6", grade_band: "6-8", subject: "Mathematics" });

eq("CCSS.MATH.CONTENT.3.OA.A.1 → grade 3, band 3-5, Math",
  extractMetadataFromCode("CCSS.MATH.CONTENT.3.OA.A.1"),
  { grade_level: "3", grade_band: "3-5", subject: "Mathematics" });

eq("CCSS.MATH.CONTENT.K.CC.A.1 → grade K, band K, Math",
  extractMetadataFromCode("CCSS.MATH.CONTENT.K.CC.A.1"),
  { grade_level: "K", grade_band: "K", subject: "Mathematics" });

// CCSS ELA
eq("CCSS.ELA-LITERACY.RI.5.1 → grade 5, band 3-5, ELA",
  extractMetadataFromCode("CCSS.ELA-LITERACY.RI.5.1"),
  { grade_level: "5", grade_band: "3-5", subject: "English Language Arts" });

eq("CCSS.ELA-LITERACY.RI.6.1 → grade 6, band 6-8, ELA",
  extractMetadataFromCode("CCSS.ELA-LITERACY.RI.6.1"),
  { grade_level: "6", grade_band: "6-8", subject: "English Language Arts" });

// NGSS
eq("MS-LS1-6 → grade MS, band 6-8, Science",
  extractMetadataFromCode("MS-LS1-6"),
  { grade_level: "MS", grade_band: "6-8", subject: "Science" });

eq("HS-PS1-2 → grade HS, band 9-12, Science",
  extractMetadataFromCode("HS-PS1-2"),
  { grade_level: "HS", grade_band: "9-12", subject: "Science" });

eq("K-PS2-1 → grade K, band K, Science",
  extractMetadataFromCode("K-PS2-1"),
  { grade_level: "K", grade_band: "K", subject: "Science" });

eq("3-5-ETS1-1 → grade 3-5, band 3-5, Science",
  extractMetadataFromCode("3-5-ETS1-1"),
  { grade_level: "3-5", grade_band: "3-5", subject: "Science" });

eq("K-2-ETS1-1 → grade K-2, band null, Science",
  extractMetadataFromCode("K-2-ETS1-1"),
  { grade_level: "K-2", grade_band: null, subject: "Science" });

isNull("plain prose has no code", extractMetadataFromCode(null));

// ── extractChunkMetadata — grade retrieval regression tests ───────────────────
// These are the core tests the feature requires:
// Grade 3-5 + Ratio must NOT retrieve NC.6.* or NC.7.*
// Grade 1-2 + Ratio must NOT retrieve NC.6.* or NC.7.*
// Grade 6-8 + Ratio MAY retrieve NC.6.RP.*

console.log("\nextractChunkMetadata — grade enforcement");

// NC.6.RP.1 must be identified as grade 6 (band 6-8), not 3-5 or 1-2
{
  const meta = extractChunkMetadata("NC.6.RP.1 Understand the concept of a ratio and use ratio language to describe a ratio relationship between two quantities.");
  eq("NC.6.RP.1 → grade 6",    meta.grade_level,      "6");
  eq("NC.6.RP.1 → band 6-8",   meta.grade_band,       "6-8");
  eq("NC.6.RP.1 → code_pattern", meta.extraction_source, "code_pattern");
  eq("NC.6.RP.1 → code stored", meta.standard_code,   "NC.6.RP.1");
}

// NC.7.RP.1 must be identified as grade 7 (band 6-8)
{
  const meta = extractChunkMetadata("NC.7.RP.1 Compute unit rates associated with ratios of fractions.");
  eq("NC.7.RP.1 → grade 7",    meta.grade_level,      "7");
  eq("NC.7.RP.1 → band 6-8",   meta.grade_band,       "6-8");
}

// NC.3.NF.A.1 must be identified as grade 3 (band 3-5)
{
  const meta = extractChunkMetadata("NC.3.NF.A.1 Understand a fraction 1/b as the quantity formed by 1 part when a whole is partitioned into b equal parts.");
  eq("NC.3.NF.A.1 → grade 3",  meta.grade_level,      "3");
  eq("NC.3.NF.A.1 → band 3-5", meta.grade_band,       "3-5");
}

// NC.K.NBT.1 must map to grade K band K
{
  const meta = extractChunkMetadata("NC.K.NBT.1 Count to 100 by ones and by tens.");
  eq("NC.K.NBT.1 → grade K",   meta.grade_level,      "K");
  eq("NC.K.NBT.1 → band K",    meta.grade_band,       "K");
}

// CCSS.MATH.CONTENT.6.RP.A.1 — identified as grade 6 band 6-8, Math
{
  const meta = extractChunkMetadata("CCSS.MATH.CONTENT.6.RP.A.1 Understand the concept of a ratio.");
  eq("CCSS.MATH.CONTENT.6 → band 6-8",       meta.grade_band, "6-8");
  eq("CCSS.MATH.CONTENT.6 → Math",           meta.subject,    "Mathematics");
}

// NGSS MS-LS1-6 — grade MS, band 6-8, Science
{
  const meta = extractChunkMetadata("MS-LS1-6 Construct a scientific explanation based on evidence for the role of photosynthesis.");
  eq("MS-LS1-6 → band 6-8",   meta.grade_band, "6-8");
  eq("MS-LS1-6 → Science",    meta.subject,    "Science");
}

// Genuine prose (no code, no heading) → unknown
{
  const meta = extractChunkMetadata("This alignment document describes connections between standards frameworks and instructional materials.");
  eq("prose → unknown grade_band", meta.grade_band,        null);
  eq("prose → unknown source",     meta.extraction_source, "unknown");
}

// Document context inheritance — chunk with no code inherits from doc header
{
  const meta = extractChunkMetadata(
    "Students will understand multiplication and division strategies.",
    { documentContext: { grade_level: "4", grade_band: "3-5", subject: "Mathematics" } }
  );
  eq("doc context → band 3-5",         meta.grade_band,        "3-5");
  eq("doc context → explicit_heading",  meta.extraction_source, "explicit_heading");
  eq("doc context → Math",             meta.subject,           "Mathematics");
}

// Nearby text — previous chunk says "Grade 5", current chunk has no code
{
  const meta = extractChunkMetadata(
    "Students will multiply multi-digit numbers.",
    { prevContent: "Grade 5 Mathematics Standards — Number Operations" }
  );
  eq("nearby heading → band 3-5",          meta.grade_band,        "3-5");
  eq("nearby heading → explicit_heading",  meta.extraction_source, "explicit_heading");
}

// Code takes priority over document context even if doc says different grade
{
  const meta = extractChunkMetadata(
    "NC.6.RP.1 Understand the concept of a ratio.",
    { documentContext: { grade_level: "3", grade_band: "3-5", subject: "Mathematics" } }
  );
  eq("code overrides doc context → band 6-8",       meta.grade_band,        "6-8");
  eq("code overrides doc context → code_pattern",   meta.extraction_source, "code_pattern");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n── Results ──`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n  All tests passed.");
}
