/**
 * Upload-time metadata extraction for standards chunks.
 * Applied once per chunk at insert time so retrieval can enforce grade-band
 * filtering without re-parsing content on every query.
 *
 * Extraction priority per chunk:
 *   1. standard_code pattern (grade embedded in the code itself)
 *   2. explicit heading  (short heading line before/near the chunk names a grade)
 *   3. nearby text       (inline prose mentions "Grade 5", "Middle School", etc.)
 *   4. unknown           (grade_band left null; treated as fallback in retrieval)
 */

// ── Grade normalization ────────────────────────────────────────────────────────

const GRADE_TO_BAND = {
  K:    "K",
  "1":  "1-2",
  "2":  "1-2",
  "3":  "3-5",
  "4":  "3-5",
  "5":  "3-5",
  "6":  "6-8",
  "7":  "6-8",
  "8":  "6-8",
  "9":  "9-12",
  "10": "9-12",
  "11": "9-12",
  "12": "9-12",
  MS:   "6-8",
  HS:   "9-12",
  // K-2 spans two bands — leave grade_band null so the content stays visible
  // to both K and 1-2 searches (same decision as NGSS backfill script).
  "K-2": null,
  // 3-5-ETS1-* engineering design codes collapse cleanly into 3-5.
  "3-5": "3-5",
};

export function gradeToBand(gradeLevel) {
  if (gradeLevel == null) return null;
  return GRADE_TO_BAND[String(gradeLevel)] ?? null;
}

// ── Standard code extraction ───────────────────────────────────────────────────
// Scans only the first 150 characters so we're reading the code at the
// start of the chunk, not codes that appear in descriptive prose mid-chunk.

export function extractStandardCode(text) {
  const head = (text ?? "").slice(0, 150);

  // CCSS: CCSS.MATH.CONTENT.6.RP.A.1 | CCSS.ELA-LITERACY.RI.5.1
  let m = head.match(/\bCCSS\.[A-Z]+(?:[.-][A-Z]+)*\.[K\d]+(?:\.[A-Z0-9]+)*/);
  if (m) return m[0];

  // NGSS: MS-LS1-6 | K-PS2-1 | 3-5-ETS1-1 | HS-ETS1-2 | K-2-ETS1-1
  // Multi-grade prefix must be tried before single-digit so K-2-ETS1-1
  // doesn't match as K only (same approach as scripts/lib/ngss-grade.js).
  m = head.match(/\b(?:K-2|3-5|MS|HS|K|[1-9])-[A-Z]+\d?-\d+/);
  if (m) return m[0];

  // State standards: NC.6.RP.1 | CA.3.NF.A.1 | MA.K.OA.2
  // Requires 2-3 uppercase letters (state abbrev), a grade (K or digit),
  // and at least one more dotted segment so bare abbreviations don't match.
  m = head.match(/\b[A-Z]{2,3}\.(?:[K\d]+)(?:\.[A-Z0-9]+)+/);
  if (m) return m[0];

  return null;
}

// Derives { grade_level, grade_band, subject } from a recognized standard code.
// Returns null when the code format is unrecognized.
export function extractMetadataFromCode(code) {
  if (!code) return null;
  let m;

  // CCSS Math
  m = code.match(/^CCSS\.MATH\.CONTENT\.([K\d]+)\./);
  if (m) {
    const g = m[1];
    return { grade_level: g, grade_band: gradeToBand(g), subject: "Mathematics" };
  }

  // CCSS ELA
  m = code.match(/^CCSS\.ELA-LITERACY\.[A-Z-]+\.([K\d]+)\./);
  if (m) {
    const g = m[1];
    return { grade_level: g, grade_band: gradeToBand(g), subject: "English Language Arts" };
  }

  // NGSS (multi-grade prefix first, then single)
  m = code.match(/^(K-2|3-5|MS|HS|K|[1-9])-[A-Z]/);
  if (m) {
    const prefix = m[1];
    return { grade_level: prefix, grade_band: gradeToBand(prefix), subject: "Science" };
  }

  // State standard — grade in second segment: NC.6.RP.1, CA.3.NF.A.1
  m = code.match(/^[A-Z]{2,3}\.([K\d]+)\./);
  if (m) {
    const g = m[1];
    return { grade_level: g, grade_band: gradeToBand(g), subject: null };
  }

  return null;
}

// ── Text scanning for grade / subject indicators ───────────────────────────────

// Short isolated lines like "Grade 5 Mathematics" or "Middle School Science"
// are section headings that set the context for the standards that follow them.
const HEADING_PATTERNS = [
  // "Kindergarten" on its own
  { re: /\bKindergarten\b/i,             grade_level: "K",  source: "explicit_heading" },
  // "Middle School" on its own
  { re: /\bMiddle\s+School\b/i,          grade_level: "MS", source: "explicit_heading" },
  // "High School" on its own
  { re: /\bHigh\s+School\b/i,            grade_level: "HS", source: "explicit_heading" },
  // "Grade 5" | "Grade 10" | "Grade K"
  { re: /\bGrade\s+(K|\d{1,2})\b/i,     gradeGroup: 1,     source: "explicit_heading" },
  // "Grades 3-5" | "Grades 3 to 5" | "Grades 3–5"
  { re: /\bGrades?\s+(\d)[–\-]\s*(\d)\b/i, gradeRange: [1, 2], source: "explicit_heading" },
];

// Prose phrases that mention a grade without being headings.
const NEARBY_PATTERNS = [
  { re: /\bfor\s+[Gg]rade\s+(K|\d{1,2})\b/,              gradeGroup: 1, source: "nearby_text" },
  { re: /\bstandards?\s+(?:for|at)\s+[Gg]rade\s+(K|\d{1,2})\b/, gradeGroup: 1, source: "nearby_text" },
  { re: /\b[Gg]rade\s+(K|\d{1,2})\s+students?\b/,        gradeGroup: 1, source: "nearby_text" },
];

const SUBJECT_PATTERNS = [
  { re: /\bMathematics\b/i,                       subject: "Mathematics" },
  { re: /\bMath\b/i,                              subject: "Mathematics" },
  { re: /\bScience\b/i,                           subject: "Science" },
  { re: /\bEnglish\s+Language\s+Arts\b/i,         subject: "English Language Arts" },
  { re: /\b(?:ELA|Literacy)\b/i,                  subject: "English Language Arts" },
  { re: /\b(?:Reading|Writing)\b/i,               subject: "English Language Arts" },
  { re: /\bSocial\s+Studies\b/i,                  subject: "Social Studies" },
  { re: /\bHistory\b/i,                           subject: "Social Studies" },
];

// Collapses a grade-range string like "3"-"5" into a normalized band or null.
function rangeToGradeBand(g1Str, g2Str) {
  const a = parseInt(g1Str, 10);
  const b = parseInt(g2Str, 10);
  if (a === 1 && b === 2)  return "1-2";
  if (a === 3 && b === 5)  return "3-5";
  if (a === 6 && b === 8)  return "6-8";
  if (a === 9 && b === 12) return "9-12";
  return null; // non-standard range — don't guess
}

// Scans a text window for grade and subject mentions.
// Returns { grade_level, grade_band, subject, extraction_source } (all nullable).
export function scanTextForGradeAndSubject(text) {
  let grade_level = null;
  let grade_band  = null;
  let extraction_source = null;

  // Heading patterns (higher priority)
  for (const pat of HEADING_PATTERNS) {
    const m = text.match(pat.re);
    if (!m) continue;

    if (pat.gradeRange) {
      const band = rangeToGradeBand(m[pat.gradeRange[0]], m[pat.gradeRange[1]]);
      if (band) { grade_band = band; extraction_source = pat.source; break; }
    } else if (pat.gradeGroup) {
      const g = m[pat.gradeGroup];
      grade_level = g;
      grade_band  = gradeToBand(g);
      extraction_source = pat.source;
      break;
    } else {
      grade_level = pat.grade_level;
      grade_band  = gradeToBand(pat.grade_level);
      extraction_source = pat.source;
      break;
    }
  }

  // Nearby prose patterns (lower priority — only if heading patterns found nothing)
  if (!grade_level && !grade_band) {
    for (const pat of NEARBY_PATTERNS) {
      const m = text.match(pat.re);
      if (!m) continue;
      const g = m[pat.gradeGroup];
      grade_level = g;
      grade_band  = gradeToBand(g);
      extraction_source = pat.source;
      break;
    }
  }

  // Subject detection (independent of grade)
  let subject = null;
  for (const pat of SUBJECT_PATTERNS) {
    if (pat.re.test(text)) { subject = pat.subject; break; }
  }

  return { grade_level, grade_band, subject, extraction_source };
}

// ── Document-level context scan ───────────────────────────────────────────────
// Reads the first part of an extracted document to establish defaults that
// individual chunks inherit when their own metadata cannot be determined.
// A document titled "Grade 5 Mathematics Standards" sets grade + subject for
// all chunks that lack an explicit code.

export function scanDocumentContext(text) {
  const head = (text ?? "").slice(0, 3000);
  const { grade_level, grade_band, subject } = scanTextForGradeAndSubject(head);
  return { grade_level, grade_band, subject };
}

// ── Per-chunk metadata extraction ─────────────────────────────────────────────
// Returns { standard_code, grade_level, grade_band, subject, extraction_source }.
// extraction_source is one of: "code_pattern" | "explicit_heading" |
//                               "nearby_text"  | "unknown"
//
// prevContent: the text of the preceding chunk (provides "nearby" context for
//              segments that don't carry their own heading or code).
// documentContext: { grade_level, grade_band, subject } from scanDocumentContext().

export function extractChunkMetadata(content, { prevContent = "", documentContext = {} } = {}) {
  // ── Priority 1: standard code in this chunk ───────────────────────────────
  const code = extractStandardCode(content);
  if (code) {
    const fromCode = extractMetadataFromCode(code);
    if (fromCode) {
      return {
        standard_code:    code,
        grade_level:      fromCode.grade_level,
        grade_band:       fromCode.grade_band,
        subject:          fromCode.subject ?? documentContext.subject ?? null,
        extraction_source: "code_pattern",
      };
    }
    // Code was found but format unrecognized — keep the code, fall through
    // to text scanning for grade/subject.
  }

  // ── Priority 2 & 3: scan this chunk + previous chunk for grade indicators ──
  const window = [prevContent.slice(-200), content.slice(0, 300)].join(" ");
  const fromText = scanTextForGradeAndSubject(window);
  if (fromText.grade_band || fromText.grade_level) {
    return {
      standard_code:    code ?? null,
      grade_level:      fromText.grade_level ?? null,
      grade_band:       fromText.grade_band  ?? null,
      subject:          fromText.subject ?? documentContext.subject ?? null,
      extraction_source: fromText.extraction_source,
    };
  }

  // ── Priority 4: inherit document-level context ────────────────────────────
  // The document header named a grade (e.g. "Grade 5 Mathematics Standards")
  // but this specific chunk has no code and no local grade mention.
  if (documentContext.grade_band || documentContext.grade_level) {
    return {
      standard_code:    code ?? null,
      grade_level:      documentContext.grade_level ?? null,
      grade_band:       documentContext.grade_band  ?? null,
      subject:          documentContext.subject ?? null,
      extraction_source: "explicit_heading",
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return {
    standard_code:    code ?? null,
    grade_level:      null,
    grade_band:       null,
    subject:          documentContext.subject ?? null,
    extraction_source: "unknown",
  };
}
