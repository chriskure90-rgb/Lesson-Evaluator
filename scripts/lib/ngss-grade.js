// Infers NGSS grade metadata from a standard code (e.g. "3-PS2-1", "MS-LS1-6")
// or, failing that, from a section title (e.g. "3.Weather and Climate").
// Shared by the NGSS ingestion scripts and the one-off grade-metadata backfill
// so the code/title -> grade_level/grade_band mapping lives in exactly one place.

const GRADE_BAND_BY_LEVEL = {
  K: "K",
  "1": "1-2",
  "2": "1-2",
  "3": "3-5",
  "4": "3-5",
  "5": "3-5",
  "3-5": "3-5", // multi-grade engineering design codes, e.g. 3-5-ETS1-1
  MS: "6-8",
  HS: "9-12",
  // "K-2-ETS1-*" (elementary engineering design) genuinely spans the K band
  // and the 1-2 band, which don't collapse into any single band in the
  // required vocabulary. Record the grade_level for transparency but leave
  // grade_band unset (null) so this content stays visible to both a K
  // search and a 1-2 search instead of being wrongly excluded from one.
  "K-2": null,
};

// Matches the grade-band prefix at the start of a standard code or heading,
// e.g. "K-PS2-1", "K-2-ETS1-1", "3-5-ETS1-1", "MS-LS1-6", "HS.Earth's Systems".
// Multi-grade prefixes ("K-2", "3-5") must be tried before the single-token
// alternatives, or e.g. "K-2-ETS1-1" would match just "K" (regex alternation
// takes the first match, not the longest).
const GRADE_PREFIX_RE = /^(K-2|K|3-5|[1-9]|MS|HS)[-.]/;

export function inferNgssGrade(standardCode, title) {
  for (const candidate of [standardCode, title]) {
    const trimmed = (candidate || "").trim();
    if (!trimmed) continue;

    const match = trimmed.match(GRADE_PREFIX_RE);
    if (!match) continue;

    const gradeLevel = match[1];
    if (!(gradeLevel in GRADE_BAND_BY_LEVEL)) continue;
    return { grade_level: gradeLevel, grade_band: GRADE_BAND_BY_LEVEL[gradeLevel] };
  }

  return { grade_level: null, grade_band: null };
}
