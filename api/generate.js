import { generateLessonWithMistral } from "../server-lib/providers/mistral.js";
import { generateLessonWithGemini  } from "../server-lib/providers/gemini.js";
import { supabase }                  from "../server-lib/supabase.js";
import { openai }                    from "../server-lib/openai.js";
import { Mistral }                   from "@mistralai/mistralai";
import { GoogleGenerativeAI }        from "@google/generative-ai";

const EMBEDDING_MODEL       = "text-embedding-3-small";
const VECTOR_MATCH_COUNT    = 5;
const VECTOR_CANDIDATE_POOL = 15; // fetched before the coded-first rerank below

// Fires once at cold-start — confirms this exact module was loaded by Vercel.
console.log("[standards:diag] diagnostics enabled — api/generate.js loaded");

// ── Mock standards lookup ─────────────────────────────────────────────────────
// Returns a human-readable description for a known standard code.
// Replace with real retrieval (RAG / Supabase) when ready.
const MOCK_STANDARDS = {
  // NGSS – Life Science
  "MS-LS1-6": "Construct a scientific explanation based on evidence for the role of photosynthesis in the cycling of matter and flow of energy into and out of organisms.",
  "MS-LS1-1": "Conduct an investigation to provide evidence that living things are made of cells; either one cell or many different numbers and types of cells.",
  "MS-LS1-3": "Use argument supported by evidence for how the body is a system of interacting subsystems composed of groups of cells.",
  "MS-LS2-3": "Develop a model to describe the cycling of matter and flow of energy among living and nonliving parts of an ecosystem.",
  "HS-LS1-5": "Use a model to illustrate how photosynthesis transforms light energy into stored chemical energy.",
  "HS-LS2-4": "Use mathematical representations to support claims for the cycling of matter and flow of energy among organisms in an ecosystem.",
  // NGSS – Physical Science
  "MS-PS1-1": "Develop models to describe the atomic composition of simple molecules and extended structures.",
  "MS-PS1-2": "Analyze and interpret data on the properties of substances before and after the substances interact to determine if a chemical reaction has occurred.",
  "MS-PS3-1": "Construct and interpret graphical displays of data to describe the relationships of kinetic energy to the mass of an object and to the speed of an object.",
  // NGSS – Earth Science
  "MS-ESS2-1": "Develop a model to describe the cycling of Earth's materials and the flow of energy that drives this process.",
  "MS-ESS3-1": "Construct a scientific explanation based on evidence for how the uneven distributions of Earth's mineral, energy, and groundwater resources are the result of past and current geoscience processes.",
  // Common Core ELA
  "CCSS.ELA-LITERACY.RST.6-8.1": "Cite specific textual evidence to support analysis of science and technical texts.",
  "CCSS.ELA-LITERACY.RST.6-8.3": "Follow precisely a multistep procedure when carrying out experiments, taking measurements, or performing technical tasks.",
  "CCSS.ELA-LITERACY.WHST.6-8.2": "Write informative/explanatory texts, including the narration of historical events, scientific procedures/experiments, or technical processes.",
  "CCSS.ELA-LITERACY.RI.6.1": "Cite textual evidence to support analysis of what the text says explicitly as well as inferences drawn from the text.",
  // Common Core Math
  "CCSS.MATH.CONTENT.6.RP.A.1": "Understand the concept of a ratio and use ratio language to describe a ratio relationship between two quantities.",
  "CCSS.MATH.CONTENT.7.RP.A.2": "Recognize and represent proportional relationships between quantities.",
  "CCSS.MATH.CONTENT.8.EE.A.1": "Know and apply the properties of integer exponents to generate equivalent numerical expressions.",
  "CCSS.MATH.CONTENT.HSA.REI.B.3": "Solve linear equations and inequalities in one variable, including equations with coefficients represented by letters.",
};

function lookupStandard(frameworks, code) {
  const trimmed = (code || "").trim();
  if (trimmed && MOCK_STANDARDS[trimmed]) return MOCK_STANDARDS[trimmed];

  // Framework-level fallback when code is unknown or absent
  const fw = (Array.isArray(frameworks) ? frameworks.join(" ") : "").toLowerCase();
  if (trimmed) {
    if (fw.includes("ngss"))         return `NGSS ${trimmed}: Align student learning with science and engineering practices, disciplinary core ideas, and crosscutting concepts as defined in the Next Generation Science Standards.`;
    if (fw.includes("common core"))  return `Common Core ${trimmed}: Develop student proficiency in the knowledge and skills outlined by the Common Core State Standards for this domain.`;
  }
  return "Use the selected standards framework to align objectives, activities, and assessments.";
}

// Queries the Supabase `standards` table by framework label and standard code.
// Returns the content string on a match, or null on miss / error / no client.
async function lookupStandardFromSupabase(framework, code) {
  const trimmed = (code || "").trim();

  // ── Diagnostic logging ───────────────────────────────────────────────────
  // Re-check env vars per-request so these appear in the same Vercel log
  // stream as the request (cold-start logs may be in a separate stream).
  console.log("[standards:diag] --- standards lookup ---");
  console.log("[standards:diag] SUPABASE_URL present:", !!process.env.SUPABASE_URL);
  console.log("[standards:diag] VITE_SUPABASE_URL present:", !!process.env.VITE_SUPABASE_URL);
  console.log("[standards:diag] SUPABASE_SERVICE_ROLE_KEY present:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("[standards:diag] SUPABASE_ANON_KEY present:", !!process.env.SUPABASE_ANON_KEY);
  console.log("[standards:diag] VITE_SUPABASE_ANON_KEY present:", !!process.env.VITE_SUPABASE_ANON_KEY);
  console.log("[standards:diag] supabase client initialised:", supabase !== null);
  console.log("[standards:diag] querying framework:", JSON.stringify(framework));
  console.log("[standards:diag] querying standard_code:", JSON.stringify(trimmed));

  if (!trimmed || !framework || !supabase) {
    console.log("[standards:diag] early-exit reason — trimmed empty:", !trimmed, "| framework empty:", !framework, "| client null:", !supabase);
    console.log("[standards:diag] => MOCK FALLBACK (early exit)");
    return null;
  }

  const { data, error } = await supabase
    .from("standards")
    .select("content")
    .eq("framework", framework)
    .eq("standard_code", trimmed)
    .maybeSingle();

  console.log("[standards:diag] raw Supabase response — data:", JSON.stringify(data), "| error:", error ? JSON.stringify({ code: error.code, message: error.message, details: error.details }) : null);

  if (error) {
    console.warn("[standards:diag] Supabase lookup error — falling back to mock:", error.message);
    return null;
  }

  if (data?.content) {
    console.log("[standards:diag] HIT — returning Supabase content");
    return data.content;
  }

  console.log("[standards:diag] => MISS — no row matched framework:", JSON.stringify(framework), "standard_code:", JSON.stringify(trimmed), "— falling back to mock");
  return null;
}

// ── Grade-band enforcement helpers ────────────────────────────────────────────
// The SQL match_standards() filter is a soft guard: rows with grade_band = null
// (Custom uploads, un-coded chunks) pass through regardless of what grade band
// the teacher selected. These helpers apply a hard application-layer filter
// after SQL retrieval by inferring the grade from the standard code text
// embedded in the content field.

// Maps the grade-band strings used by the Generator form to the set of
// individual grade tokens that fall within that band.
const GRADE_BAND_GRADES = {
  "K":    ["K"],
  "1-2":  ["1", "2"],
  "3-5":  ["3", "4", "5"],
  "6-8":  ["6", "7", "8"],
  "9-12": ["9", "10", "11", "12"],
};

// Attempts to extract a grade token ("6", "K", "3", etc.) from the beginning
// of a content chunk where standard codes appear.
// Covers:
//   State patterns: NC.6.RP.1 · CA.3.NF.A.1 · MA.K.OA.1
//   CCSS:           CCSS.MATH.CONTENT.6.RP.A.1 · CCSS.ELA-LITERACY.RI.6.1
// Returns null when no recognizable grade code is found (genuinely untagged
// prose, front matter, "Connections to..." callouts — these should pass through).
function inferGradeFromContent(content) {
  if (!content) return null;
  const head = content.slice(0, 120);
  // State standard: 2-4 uppercase letters · grade (digit or K) · uppercase letter
  const stateMatch = head.match(/\b[A-Z]{2,4}\.([K\d]+)\.[A-Z]/);
  if (stateMatch) return stateMatch[1];
  // CCSS: CCSS.DOMAIN.SUBDOMAIN.grade.  e.g. CCSS.MATH.CONTENT.6 | CCSS.ELA-LITERACY.RI.6
  const ccssMatch = head.match(/\bCCSS\.[A-Z.+-]+\.([K\d]+)\./);
  if (ccssMatch) return ccssMatch[1];
  return null;
}

// Returns true when a grade token (e.g. "6", "K") falls within a grade band
// (e.g. "3-5"). Returns true for unknown bands so the filter is never more
// restrictive than intended.
function isGradeInBand(gradeToken, gradeBand) {
  const allowed = GRADE_BAND_GRADES[gradeBand];
  if (!allowed) return true;
  return allowed.includes(gradeToken === "K" ? "K" : String(parseInt(gradeToken, 10)));
}

// ── Vector (pgvector) standards retrieval ─────────────────────────────────────
// Embeds the teacher's inputs and finds the most semantically relevant
// standards chunks for the selected framework via the `match_standards`
// Supabase RPC (see scripts/sql/match_standards.sql).
async function embedQuery(text) {
  if (!openai) throw new Error("OpenAI client not initialised (missing OPENAI_API_KEY)");
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

async function vectorSearchStandards({ framework, queryText, matchCount = VECTOR_MATCH_COUNT, gradeBand = null }) {
  if (!supabase) throw new Error("Supabase client not initialised");
  if (!framework) throw new Error("No framework selected for vector search");

  const queryEmbedding = await embedQuery(queryText);

  const { data, error } = await supabase.rpc("match_standards", {
    query_embedding: queryEmbedding,
    match_framework: framework,
    match_count: matchCount,
    match_grade_band: gradeBand,
  });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Combines the exact standard_code lookup (priority, when the teacher entered
// a code — an explicit user selection, so it is never grade-band filtered)
// with pgvector semantic search results from the teacher's topic, goal,
// subject, and grade — de-duplicated and capped at VECTOR_MATCH_COUNT.
//
// Returns { chunks, totalCandidates, filteredByGrade } so callers can tell
// whether grade enforcement actively removed results (vs. Supabase being
// unavailable) and surface an appropriate "no in-band standard" message.
async function retrieveRelevantStandards({ framework, code, topic, goal, subject, grade }) {
  const chunks = [];
  let totalCandidates = 0;
  let filteredByGrade = 0;

  // Exact code lookup is treated as an explicit user selection — it is never
  // grade-band filtered even if the code appears to be from another band.
  const trimmedCode = (code || "").trim();
  if (trimmedCode) {
    const exactContent = await lookupStandardFromSupabase(framework, trimmedCode);
    if (exactContent) {
      chunks.push({ standard_code: trimmedCode, title: null, content: exactContent });
    }
  }

  try {
    const queryText = [topic, goal, subject, grade].filter(Boolean).join(" | ");
    if (!queryText) throw new Error("No teacher inputs available to embed");

    // We over-fetch (VECTOR_CANDIDATE_POOL) so the application-layer grade
    // filter and coded-first rerank below have a wide enough pool to work with
    // even after removing out-of-band results.
    let matches = await vectorSearchStandards({
      framework,
      queryText,
      gradeBand: grade || null,
      matchCount: VECTOR_CANDIDATE_POOL,
    });
    totalCandidates = matches.length;

    // Diagnostic: log every candidate before any application filtering.
    console.log(`[standards:grade-filter] grade_band="${grade || "none"}" framework="${framework}" — ${totalCandidates} SQL candidates`);
    for (const m of matches) {
      console.log(
        `[standards:grade-filter]  candidate: code=${m.standard_code ?? "(none)"}`
        + ` db_grade_band=${m.grade_band ?? "(untagged)"}`
        + ` similarity=${m.similarity != null ? m.similarity.toFixed(4) : "?"}`
        + ` | ${(m.content ?? "").slice(0, 70)}`
      );
    }

    // Hard application-layer grade-band enforcement for untagged rows.
    //
    // The SQL match_standards() filter excludes rows tagged with a *different*
    // band, but rows with grade_band = null pass through regardless (by design,
    // to keep genuinely un-graded content like Common Core prose visible). For
    // custom-uploaded state standards (NC.6.RP.1, CA.3.NF.A.1, etc.) that were
    // stored without grade_band metadata, the standard code embedded in the
    // content text lets us enforce the hard filter here instead.
    if (grade && GRADE_BAND_GRADES[grade]) {
      const before = matches.length;
      matches = matches.filter((m) => {
        // SQL already verified this row's grade_band matches — keep it.
        if (m.grade_band) return true;
        // Try to infer grade from the content text.
        const inferred = inferGradeFromContent(m.content);
        // No recognizable grade code → genuinely untagged prose — keep it.
        if (inferred === null) return true;
        const keep = isGradeInBand(inferred, grade);
        if (!keep) {
          console.log(
            `[standards:grade-filter]  EXCLUDED inferred_grade="${inferred}" outside band="${grade}"`
            + ` (allowed: ${GRADE_BAND_GRADES[grade].join(",")})`
            + ` | ${(m.content ?? "").slice(0, 70)}`
          );
        }
        return keep;
      });
      filteredByGrade = before - matches.length;
      console.log(
        `[standards:grade-filter] after enforcement: ${before} → ${matches.length}`
        + ` (${filteredByGrade} out-of-band removed, band="${grade}")`
      );
    }

    // Rerank: coded rows first within their existing similarity ordering so a
    // real standard code is cited over generic descriptive filler when both are
    // relevant and similarly scored.
    const coded   = matches.filter((m) => m.standard_code);
    const uncoded = matches.filter((m) => !m.standard_code);

    for (const match of [...coded, ...uncoded]) {
      const isDuplicate = chunks.some((c) => c.content === match.content);
      if (!isDuplicate) chunks.push(match);
    }
  } catch (err) {
    console.warn("[standards:vector] search failed, continuing with exact-match/mock fallback:", err.message);
  }

  return { chunks: chunks.slice(0, VECTOR_MATCH_COUNT), totalCandidates, filteredByGrade };
}

// Formats retrieved standards chunks for the RELEVANT STANDARDS prompt section.
function formatStandardsBlock(chunks) {
  return chunks
    .map((c, i) => {
      const header = [c.standard_code, c.title].filter(Boolean).join(" — ");
      return header ? `${i + 1}. ${header}\n${c.content}` : `${i + 1}. ${c.content}`;
    })
    .join("\n\n");
}

// technologyUsage is a single Low/Medium/High level (how central technology
// is to the lesson); studentTechnology is a separate free-text field naming
// the specific devices/platforms/software actually available to students —
// distinct settings, not read from one another. Shared by both prompt
// builders (Standard and Template 1) — technology integration is a
// cross-cutting input, not a format-specific one.
const TECHNOLOGY_USAGE_LEVEL_LABELS = { low: "Low", medium: "Medium", high: "High" };
const TECHNOLOGY_USAGE_LEVEL_DEFINITIONS = {
  low:    "Technology plays a minimal supporting role in the lesson.",
  medium: "Technology is used regularly to support instruction and learning activities.",
  high:   "Technology is a central component throughout the lesson.",
};

function buildTechnologyIntegrationBlock(technologyUsage, studentTechnology) {
  const level = TECHNOLOGY_USAGE_LEVEL_LABELS[technologyUsage] ? technologyUsage : "medium";
  const trimmedTech = (studentTechnology || "").trim();
  const studentTechLine = trimmedTech
    ? `Student Technology: ${trimmedTech}`
    : "Student Technology: None specified — do not invent or require any specific technology.";

  return [
    "TECHNOLOGY INTEGRATION:",
    `Technology Usage: ${TECHNOLOGY_USAGE_LEVEL_LABELS[level]}`,
    TECHNOLOGY_USAGE_LEVEL_DEFINITIONS[level],
    studentTechLine,
    "Technology should support the learning objectives and should not be added unnecessarily.",
  ].join("\n");
}

// instructionalApproach is a single Teacher-Centered/Balanced/Student-Centered
// value describing who drives the lesson's instruction. Shared by both
// prompt builders — cross-cutting, not a format-specific input.
const INSTRUCTIONAL_APPROACH_LABELS = {
  "teacher-centered": "Teacher-Centered",
  "balanced":         "Balanced",
  "student-centered": "Student-Centered",
};
const INSTRUCTIONAL_APPROACH_DEFINITIONS = {
  "teacher-centered": "The lesson is primarily led by the teacher through direct instruction, modeling, and guided practice.",
  "balanced":         "The lesson combines teacher instruction with collaborative and independent student activities.",
  "student-centered": "The lesson emphasizes student inquiry, collaboration, discussion, problem-solving, and active learning, with the teacher acting mainly as a facilitator.",
};

function buildInstructionalApproachBlock(instructionalApproach) {
  const approach = INSTRUCTIONAL_APPROACH_LABELS[instructionalApproach] ? instructionalApproach : "balanced";

  return [
    "INSTRUCTIONAL APPROACH:",
    `Instructional Approach: ${INSTRUCTIONAL_APPROACH_LABELS[approach]}`,
    INSTRUCTIONAL_APPROACH_DEFINITIONS[approach],
    "Shape the teacher/student actions throughout the lesson to reflect this approach.",
  ].join("\n");
}

// Shared by both prompt builders — teaching strategies (from the Advanced
// Lesson Options panel's Literacy/Numeracy chip picker) are a cross-cutting
// input, not a format-specific one. Marzano strategy selections are NOT
// included here — they carry their own instructional descriptions and are
// sent to the prompt via buildMarzanoStrategiesBlock() below instead, so a
// strategy is never represented twice in the same prompt.
function buildTeachingStrategiesBlock(teachingStrategies) {
  if (!Array.isArray(teachingStrategies) || teachingStrategies.length === 0) {
    return [
      "TEACHING STRATEGIES:",
      "No specific teaching strategies were selected — use your instructional judgment for the best pedagogical approach.",
    ].join("\n");
  }

  return [
    "TEACHING STRATEGIES:",
    `Meaningfully incorporate the following teaching strategies throughout the lesson: ${teachingStrategies.join(", ")}.`,
    "Reflect each selected strategy in whichever part of the lesson it naturally fits (introduction, activities, or closure) — do not just mention them superficially or list them without integrating them into the actual instructional steps.",
  ].join("\n");
}

// marzanoStrategies is an array of { name, promptDescription } pairs resolved
// client-side from src/data/teachingStrategies.ts (via resolveMarzanoStrategies) —
// the actual instructional descriptions live in that one config module, never
// duplicated here, so this function only ever formats whatever it's given.
function buildMarzanoStrategiesBlock(marzanoStrategies) {
  if (!Array.isArray(marzanoStrategies) || marzanoStrategies.length === 0) {
    return [
      "MARZANO INSTRUCTIONAL STRATEGIES:",
      "No Marzano strategies were selected for this lesson.",
    ].join("\n");
  }

  const strategyLines = marzanoStrategies
    .map((s) => `- ${s.name}:\n${s.promptDescription}`)
    .join("\n\n");

  return [
    "MARZANO INSTRUCTIONAL STRATEGIES:",
    strategyLines,
    "",
    "The generated lesson should naturally incorporate these strategies into the instructional activities — do not simply mention the strategy names.",
  ].join("\n");
}

// ── Prompt builder (Standard format) ─────────────────────────────────────────
// Builds the full structured lesson-generation prompt from user inputs.
// standardDescription is resolved by the handler (Supabase first, mock fallback).
function buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies }) {
  const standardsLine =
    Array.isArray(frameworks) && frameworks.length > 0
      ? `${frameworks.join(", ")}${code ? ` — ${code}` : ""}`
      : code || "Not specified";

  return [
    "ROLE:",
    "You are an experienced K-12 instructional designer. Your task is to create a classroom-ready lesson plan for teachers.",
    "",
    "CONTEXT:",
    "Teachers will provide key information about the class, subject area, learning standards, lesson topic, lesson goal, and duration. Use this information to create a clear, practical, standards-aligned lesson plan that can be realistically delivered in a classroom.",
    "",
    "INPUTS:",
    "Teachers will provide:",
    `- Grade level: ${grade}`,
    `- Subject: ${subject || "Not specified"}`,
    `- Standards framework: ${standardsLine}`,
    `- Lesson topic: ${topic || "(not specified)"}`,
    `- Lesson goal: ${goal || "(not specified)"}`,
    `- Duration: ${duration} minutes`,
    "",
    "RELEVANT STANDARDS:",
    standardDescription,
    "",
    buildTechnologyIntegrationBlock(technologyUsage, studentTechnology),
    "",
    buildInstructionalApproachBlock(instructionalApproach),
    "",
    buildTeachingStrategiesBlock(teachingStrategies),
    "",
    buildMarzanoStrategiesBlock(marzanoStrategies),
    "",
    "CONSTRAINTS:",
    `- Do not exceed ${duration} minutes total across all activities.`,
    "- Use vocabulary appropriate for the grade level.",
    "- Keep each section concise and readable.",
    "- All activities must align with the lesson topic and lesson goal.",
    `- All content must be appropriate for the subject area: ${subject || "general"}.`,
    "- The assessment must measure the lesson goal.",
    "- Include realistic classroom activities.",
    "- Ensure the lesson aligns with the provided standard when available.",
    "- Only reference standards from the selected grade band and retrieved standards context. Do not mention standards from other grade bands unless explicitly selected by the user.",
    "- Do not invent unrelated topics.",
    "- Generate content that is practical for teachers to use immediately.",
    "- Return valid JSON only.",
    "- Do not include markdown formatting.",
    "- Do not include explanations outside the JSON.",
    "",
    "OUTPUT FORMAT:",
    "{",
    '  "title": "string",',
    '  "objectives": [',
    '    "string",',
    '    "string"',
    "  ],",
    '  "standards_alignment": "string",',
    '  "materials": [',
    '    "string",',
    '    "string"',
    "  ],",
    '  "activities": [',
    "    {",
    '      "name": "string",',
    '      "minutes": 10,',
    '      "detail": "string"',
    "    }",
    "  ],",
    '  "assessment": "string",',
    '  "differentiation": "string"',
    "}",
    "",
    "OUTPUT RULES:",
    "- The title should clearly reflect the lesson topic.",
    "- Include 2-4 measurable learning objectives.",
    `- standards_alignment: Write 2–4 sentences explaining how the lesson objectives, activities, and assessment connect to the standard cited in RELEVANT STANDARDS. Reference the standard code (e.g. ${code || "the standard code"}). Do not copy the standard text verbatim.`,
    "- Include realistic materials needed for the lesson.",
    "- Activities should be ordered chronologically.",
    `- The total activity minutes should approximately match ${duration} minutes.`,
    "- The assessment should directly evaluate the lesson goal.",
    "- The differentiation section should provide practical support strategies for diverse learners.",
    "- Ensure all generated content is internally consistent and aligned with the topic, goal, grade level, standards, and duration.",
    "- activities[].minutes must be a plain integer (not a string like '10m').",
    "- assessment must be a plain string (not an array).",
    "- differentiation must be a plain string (not an array).",
  ].join("\n");
}

// ── Prompt builder (Template 1 / PSU-GTEP format) ────────────────────────────
// A completely separate output schema from the Standard format — Template 1
// is not "Standard content re-styled", it asks the model directly for the
// structured teacher/student fields the Template 1 web preview and DOCX
// export both read. subjectGradeLevel/lessonDuration/teacherName are NOT
// requested here; the client fills those in from known form values so the
// model never has to (and can't) hallucinate them.
// The selected custom template's detected checklist/option-list fields
// (see detectStructuredFields in api/custom-templates.js) — e.g. a
// "Teaching Strategy" heading followed by "□ Direct instruction / □ Group
// work / □ Stations" — are fixed option sets, not narrative text. Rather
// than have the model write prose for them, this asks it to pick the
// option(s) that fit this specific lesson from the exact list detected in
// the template, returned as a separate customFieldSelections object so
// buildRenderData (api/custom-templates.js) can mark the corresponding
// boxes ☑/☐ at export time instead of leaving them all blank.
function buildStructuredFieldsPrompt(structuredFields) {
  if (!Array.isArray(structuredFields) || structuredFields.length === 0) return "";
  const fieldLines = structuredFields.map(
    (f) => `- "${f.field}" (${f.label}): choose from [${f.options.map((o) => `"${o}"`).join(", ")}].`
  );
  return [
    "TEMPLATE OPTION FIELDS:",
    "The teacher's uploaded template includes the following checklist/option fields. For each, select the option(s) that best fit this specific lesson from the exact list given — do not invent new options, reword the given ones, or select an option that isn't listed.",
    ...fieldLines,
    'Return your selections in a top-level "customFieldSelections" object, keyed by field name, each value an array containing only the selected option strings copied exactly as given (use an empty array if none apply).',
  ].join("\n");
}

function buildTemplate1Prompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies, structuredFields = [] }) {
  const standardsLine =
    Array.isArray(frameworks) && frameworks.length > 0
      ? `${frameworks.join(", ")}${code ? ` — ${code}` : ""}`
      : code || "Not specified";

  const hasStructuredFields = Array.isArray(structuredFields) && structuredFields.length > 0;

  return [
    "ROLE:",
    "You are an experienced K-12 instructional designer creating a lesson plan using a structured template with these phases: Lesson Goals (central focus + standards addressed), Lesson Objectives, Materials, Introduction, Main Learning Activities, Closure, and Assessment. Each phase describes what the teacher does and what students do; Introduction and Main Learning Activities also describe how that phase differentiates instruction for a variety of learners.",
    "",
    "CONTEXT:",
    "Teachers will provide key information about the class, subject area, learning standards, lesson topic, lesson goal, and duration. Use this information to create a clear, practical, standards-aligned lesson plan that can be realistically delivered in a classroom.",
    "",
    "INPUTS:",
    "Teachers will provide:",
    `- Grade level: ${grade}`,
    `- Subject: ${subject || "Not specified"}`,
    `- Standards framework: ${standardsLine}`,
    `- Lesson topic: ${topic || "(not specified)"}`,
    `- Lesson goal: ${goal || "(not specified)"}`,
    `- Duration: ${duration} minutes`,
    "",
    "RELEVANT STANDARDS:",
    standardDescription,
    "",
    buildTechnologyIntegrationBlock(technologyUsage, studentTechnology),
    "",
    buildInstructionalApproachBlock(instructionalApproach),
    "",
    buildTeachingStrategiesBlock(teachingStrategies),
    "",
    buildMarzanoStrategiesBlock(marzanoStrategies),
    "",
    buildStructuredFieldsPrompt(structuredFields),
    "",
    "CONSTRAINTS:",
    `- The teacherActions/studentActions across introduction, mainLearningActivities, and closure combined should fit within ${duration} minutes.`,
    "- Use vocabulary appropriate for the grade level.",
    "- Keep each field concise and readable.",
    "- All content must align with the lesson topic and lesson goal.",
    `- All content must be appropriate for the subject area: ${subject || "general"}.`,
    "- Ensure the lesson aligns with the provided standard when available.",
    "- Only reference standards from the selected grade band and retrieved standards context. Do not mention standards from other grade bands unless explicitly selected by the user.",
    "- Do not invent unrelated topics.",
    "- Generate content that is practical for teachers to use immediately.",
    "- Return valid JSON only.",
    "- Do not include markdown formatting.",
    "- Do not include explanations outside the JSON.",
    "",
    "OUTPUT FORMAT:",
    "{",
    '  "lessonTitle": "string",',
    '  "centralFocus": "string",',
    '  "standardsAddressed": "string",',
    '  "lessonObjectives": ["string", "string"],',
    '  "materials": ["string", "string"],',
    '  "introduction": { "teacherActions": "string", "studentActions": "string", "studentSupport": "string" },',
    '  "mainLearningActivities": { "teacherActions": "string", "studentActions": "string", "studentSupport": "string" },',
    '  "closure": { "teacherActions": "string", "studentActions": "string" },',
    '  "assessment": { "howObjectivesAssessed": "string" }' + (hasStructuredFields ? "," : ""),
    ...(hasStructuredFields ? ['  "customFieldSelections": { "<fieldName>": ["string"] }'] : []),
    "}",
    "",
    "OUTPUT RULES:",
    "- lessonTitle should clearly reflect the lesson topic.",
    "- centralFocus: 2-4 sentences describing what is being taught, why, and how it connects to the standard(s).",
    `- standardsAddressed: state the standard code (e.g. ${code || "the standard code"}) and briefly restate what it requires. Do not copy the standard text verbatim.`,
    "- lessonObjectives: 2-4 measurable \"Students will be able to...\" statements.",
    "- materials: realistic materials/resources needed for the lesson.",
    "- introduction.teacherActions/studentActions and mainLearningActivities.teacherActions/studentActions: 2-4 sentences of concrete, realistic classroom actions each.",
    "- introduction.studentSupport and mainLearningActivities.studentSupport: describe how that phase differentiates instruction for a variety of learners. These fields are required, not optional.",
    "- closure.teacherActions/studentActions: how the lesson concludes. closure has no studentSupport field — do not add one.",
    "- assessment.howObjectivesAssessed: describe how the lesson goal/objectives will be assessed.",
    "- Every field must be a plain string; lessonObjectives and materials must be arrays of plain strings.",
    "- Do not include lessonTitle-unrelated fields such as teacherName, subjectGradeLevel, or lessonDuration — those are filled in separately.",
    ...(hasStructuredFields
      ? ["- customFieldSelections: include this key exactly as instructed in TEMPLATE OPTION FIELDS above, with one entry per listed field."]
      : []),
  ].join("\n");
}

// Phase 5: canonical target -> human-readable label, mirroring
// CANONICAL_FIELD_TARGET_LABELS in src/lib/custom-templates.ts. Duplicated
// rather than shared — api/ has no TypeScript build step and can't import
// from src/, same reason PLACEHOLDER_CATALOG is hand-mirrored in
// api/custom-templates.js instead of imported.
const CANONICAL_FIELD_TARGET_LABELS = {
  lesson_title: "Lesson Title",
  date: "Date",
  grade_level: "Grade Level",
  subject: "Subject",
  learning_objectives: "Learning Objectives",
  standards: "Standards",
  learner_background: "Learner Background / Knowledge of Students",
  materials: "Materials",
  introduction: "Introduction",
  instruction: "Instruction",
  student_activities: "Student Activities",
  assessment: "Assessment",
  accommodations: "Accommodations",
  culturally_responsive_education: "Culturally Responsive Education",
  closure: "Closure",
  reflection: "Reflection",
};

// These 4 canonical targets are metadata the Generator page already
// collects as its own inputs (grade/subject) or that no input exists for
// yet (date/lesson_title) — mirrors the original Phase 2 rule ("Metadata
// fields such as Teacher, Grade, Subject, Topic, and Date should use the
// existing Generator inputs where available"). Either way, the AI is never
// asked to generate them; ReproducedTemplatePreview fills grade_level/
// subject from Generator state directly and shows "no value yet" for the
// rest (see the matching METADATA_SOURCED_TARGETS list in App.tsx).
const METADATA_SOURCED_TARGETS = new Set(["lesson_title", "date", "grade_level", "subject"]);

// Phase 5: dynamic generation keyed by the teacher's CONFIRMED field
// mapping (see buildFieldMap in api/custom-templates.js), not raw detected
// labels — the whole point of field mapping is that content only ever
// targets the region the teacher actually mapped, never a heading or
// instruction. Output is keyed by REGION ID (not by target/label text),
// since duplicate canonical targets are explicitly allowed (requirement:
// "duplicate canonical targets are allowed, but should display a warning")
// and label text alone couldn't disambiguate two regions mapped to the
// same target. Checkbox-group regions are excluded from this text-
// generation prompt entirely — they display selected options, not
// AI-generated prose (not yet wired to an actual selection mechanism this
// phase; they render as unselected in the preview, a known limitation).
// manual_entry/leave_blank/fixed_original_text mappings are also excluded —
// nothing should be generated for them at all.
function buildDynamicLessonPromptFromFieldMap({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies, fieldMap }) {
  const standardsLine =
    Array.isArray(frameworks) && frameworks.length > 0
      ? `${frameworks.join(", ")}${code ? ` — ${code}` : ""}`
      : code || "Not specified";

  const regionById = new Map(fieldMap.regions.map((r) => [r.id, r]));
  const generatableMappings = fieldMap.mappings.filter((m) => {
    if (m.target === "leave_blank" || m.target === "manual_entry" || m.target === "fixed_original_text") return false;
    if (METADATA_SOURCED_TARGETS.has(m.target)) return false;
    const region = regionById.get(m.regionId);
    return region && region.role === "editable_field";
  });

  const fieldLines = generatableMappings.map((m) => {
    const region = regionById.get(m.regionId);
    const label = m.target === "custom_section"
      ? (m.customLabel || region?.contextLabel || "Custom section")
      : (CANONICAL_FIELD_TARGET_LABELS[m.target] || m.target);
    const guidance = region?.contextInstruction ? ` Guidance from the template: ${region.contextInstruction}` : "";
    return `- key ${JSON.stringify(m.regionId)}: ${label}.${guidance}`;
  });
  const outputKeyLines = generatableMappings
    .map((m) => `  ${JSON.stringify(m.regionId)}: "string"`)
    .join(",\n");

  return [
    "ROLE:",
    "You are an experienced K-12 instructional designer filling in content for a teacher's own uploaded lesson plan template. The template's fields (given below) were reviewed and confirmed by the teacher — use exactly those fields.",
    "",
    "CONTEXT:",
    "Teachers will provide key information about the class, subject area, learning standards, lesson topic, lesson goal, and duration. Use this information to create a clear, practical, standards-aligned lesson plan that can be realistically delivered in a classroom.",
    "",
    "INPUTS:",
    "Teachers will provide:",
    `- Grade level: ${grade}`,
    `- Subject: ${subject || "Not specified"}`,
    `- Standards framework: ${standardsLine}`,
    `- Lesson topic: ${topic || "(not specified)"}`,
    `- Lesson goal: ${goal || "(not specified)"}`,
    `- Duration: ${duration} minutes`,
    "",
    "RELEVANT STANDARDS:",
    standardDescription,
    "",
    buildTechnologyIntegrationBlock(technologyUsage, studentTechnology),
    "",
    buildInstructionalApproachBlock(instructionalApproach),
    "",
    buildTeachingStrategiesBlock(teachingStrategies),
    "",
    buildMarzanoStrategiesBlock(marzanoStrategies),
    "",
    "TEMPLATE FIELDS:",
    "The uploaded template defines exactly these fields. Generate appropriate content for every one of them, using its exact key (an opaque id, not a display label) in your JSON response:",
    ...fieldLines,
    "",
    "CONSTRAINTS:",
    `- Combined, the fields should describe a lesson that realistically fits within ${duration} minutes.`,
    "- Use vocabulary appropriate for the grade level.",
    "- Keep each field concise and readable.",
    "- All content must align with the lesson topic and lesson goal.",
    `- All content must be appropriate for the subject area: ${subject || "general"}.`,
    "- Ensure the lesson aligns with the provided standard when available.",
    "- Do not invent unrelated topics.",
    "- Generate content that is practical for teachers to use immediately.",
    "- Return valid JSON only.",
    "- Do not include markdown formatting.",
    "- Do not include explanations outside the JSON.",
    "- The JSON must have exactly one key per field listed above, using the EXACT key given (character-for-character).",
    "- Do not add, remove, rename, merge, or reorder keys.",
    "",
    "OUTPUT FORMAT:",
    "{",
    outputKeyLines,
    "}",
  ].join("\n");
}

// ── Dynamic generation: isolated LLM call + error handling ───────────────────
// Deliberately does NOT reuse generateLessonWithMistral/generateLessonWithGemini
// (server-lib/providers/*.js) even though the call shape is nearly identical —
// those are shared by Standard/Template1/evaluation, and this path needs to
// (a) log the raw response before JSON.parse and (b) tag every failure with
// which stage it happened in, without risking any change to the shared
// providers' behavior. dynamicMistral/dynamicGemini are separate client
// instances from the ones in server-lib/providers, constructed from the same
// env vars.
const dynamicMistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const dynamicGemini  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function dynamicStageError(stage, message, extra = {}) {
  const err = new Error(message);
  err.isDynamicStageError = true;
  err.stage = stage;
  Object.assign(err, extra);
  return err;
}

// Returns the flat, region-id-keyed JSON object for a dynamic request, or
// throws a dynamicStageError tagged "llm-call" | "json-parse" | "response-mapping".
async function generateDynamicLessonContent(model, prompt, regionIds) {
  if (model !== "mistral" && model !== "Mistral" && model !== "gemini" && model !== "Gemini") {
    console.log("[Generate][dynamic] stage=llm-call — provider not implemented, returning placeholder:", model);
    return Object.fromEntries(regionIds.map((id) => [id, `${model} provider not implemented yet.`]));
  }

  console.log("[Generate][dynamic] stage=llm-call model:", model);
  let rawText;
  try {
    if (model === "mistral" || model === "Mistral") {
      const result = await dynamicMistral.chat.complete({
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
      });
      rawText = result.choices[0].message.content.trim();
    } else {
      const genModel = dynamicGemini.getGenerativeModel({ model: "gemini-3.5-flash" });
      const result = await genModel.generateContent(prompt);
      rawText = result.response.text().trim();
    }
  } catch (err) {
    console.error("[Generate][dynamic] stage=llm-call error:", err);
    throw dynamicStageError("llm-call", err instanceof Error ? err.message : String(err));
  }

  console.log("[Generate][dynamic] stage=llm-call raw response:", rawText);

  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[Generate][dynamic] stage=json-parse error:", err);
    throw dynamicStageError("json-parse", "The model's response was not valid JSON.", { rawResponse: cleaned });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("[Generate][dynamic] stage=response-mapping error — parsed value is not a flat object:", parsed);
    throw dynamicStageError("response-mapping", "The model's response was valid JSON but not a flat section-content object.", { rawResponse: cleaned });
  }

  // Every regionId the confirmed field mapping asked for must come back —
  // silently defaulting a missing one to empty content would look identical
  // to "the AI generated nothing for this field" instead of "the response
  // didn't match what was requested," so this must fail loudly instead.
  const returnedRegionIds = Object.keys(parsed);
  const missingRegionIds = regionIds.filter((id) => !returnedRegionIds.includes(id));
  const unexpectedRegionIds = returnedRegionIds.filter((id) => !regionIds.includes(id));
  console.log("[custom-generation-response]", {
    returnedRegionIds,
    returnedRegionCount: returnedRegionIds.length,
    missingRegionIds,
    unexpectedRegionIds,
  });
  if (missingRegionIds.length > 0) {
    throw dynamicStageError(
      "response-mapping",
      "Custom template generation failed because the response did not match the confirmed field mapping.",
      { missingRegionIds, unexpectedRegionIds, rawResponse: cleaned }
    );
  }

  console.log("[Generate][dynamic] stage=response-mapping success — keys:", Object.keys(parsed));
  return parsed;
}

// ── Route handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  console.log("=== STANDARDS DIAGNOSTICS ENABLED ===");
  console.log("[standards:diag] /api/generate handler entered");
  try {
    const { grade, subject, frameworks, code, topic, goal, duration, model, lessonFormat, customTemplateId, customTemplateName, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies } = req.body;

    // Unrecognized/missing values fall back to "standard" so existing
    // clients (and the Standard Lesson Plan option) behave exactly as before.
    // "dynamic" is a third, independent schema — see
    // buildDynamicLessonPromptFromFieldMap — driven entirely by the selected
    // template's CONFIRMED field_map (Phase 5) rather than either fixed
    // schema below, or raw detected_sections.
    const normalizedLessonFormat =
      lessonFormat === "template1" ? "template1" : lessonFormat === "dynamic" ? "dynamic" : "standard";

    if (normalizedLessonFormat === "dynamic") {
      console.log("[Generate][dynamic] stage=validation lessonFormat:", lessonFormat, "customTemplateId:", customTemplateId || null);
      if (!customTemplateId) {
        throw dynamicStageError("validation", "Dynamic generation requires a selected custom template.");
      }
    }

    // customTemplateId/customTemplateName are still just metadata for the
    // FIXED Template1Lesson content — a custom template is a different DOCX
    // *skin* applied at export time (see api/custom-templates.js's
    // handleExport), never a different generation schema for that part.
    // structured_fields is the one exception: when the selected template has
    // detected checklist/option-list sections (see detectStructuredFields),
    // buildStructuredFieldsPrompt below asks the model to choose applicable
    // option(s) per field instead of leaving them blank, and the selections
    // are returned as an additional customFieldSelections key alongside the
    // normal lesson content (rendered into the exported docx at export time
    // — see buildRenderData). The template row is always logged when
    // present, to confirm the id the client sent actually resolves to a
    // real, ready template rather than a stale/deleted one.
    let customTemplateStructuredFields = [];
    let customTemplateFieldMap = null;
    if (customTemplateId) {
      console.log("[Generate] custom template selected:", { customTemplateId, customTemplateName });
      if (supabase) {
        // Selected per-format: a Postgres "column does not exist" error fails
        // the entire select, so the dynamic path (which only needs
        // field_map) must not be coupled to structured_fields — that column
        // has its own independent migration/rollout and dynamic generation
        // shouldn't fail just because it hasn't been applied.
        const selectColumns =
          normalizedLessonFormat === "dynamic"
            ? "id, name, status, field_map"
            : "id, name, status, recognized_placeholders, structured_fields";
        if (normalizedLessonFormat === "dynamic") {
          console.log("[Generate][dynamic] stage=template-fetch customTemplateId:", customTemplateId);
        }
        const { data: templateRow, error: templateLookupError } = await supabase
          .from("custom_templates")
          .select(selectColumns)
          .eq("id", customTemplateId)
          .single();
        if (templateLookupError) {
          console.warn("[Generate] custom template lookup failed:", templateLookupError.message);
          if (normalizedLessonFormat === "dynamic") {
            throw dynamicStageError("template-fetch", `Could not load the selected template: ${templateLookupError.message}`);
          }
        } else {
          console.log("[Generate] custom template data loaded by backend:", templateRow);
          customTemplateStructuredFields = templateRow?.structured_fields || [];
          customTemplateFieldMap = templateRow?.field_map || null;
          if (normalizedLessonFormat === "dynamic") {
            console.log(
              "[Generate][dynamic] stage=template-fetch confirmed:", !!customTemplateFieldMap?.confirmed,
              "regionCount:", customTemplateFieldMap?.regions?.length ?? 0,
              "mappingCount:", customTemplateFieldMap?.mappings?.length ?? 0
            );
          }
        }
      } else if (normalizedLessonFormat === "dynamic") {
        throw dynamicStageError("template-fetch", "Supabase is not configured on the server.");
      }
    }

    // Generation is gated on the template having at least one generatable
    // field_map region — not on field_map.confirmed. "Confirm Field Mapping"
    // (see FieldMappingPanel) is still tracked and shown to the teacher, but
    // it's no longer a hard requirement for Generate Lesson to use this
    // region-based pipeline (see hasFieldMapRegions in src/App.tsx).
    if (normalizedLessonFormat === "dynamic") {
      const regionById = new Map((customTemplateFieldMap?.regions || []).map((r) => [r.id, r]));
      const generatableCount = (customTemplateFieldMap?.mappings || []).filter((m) => {
        if (m.target === "leave_blank" || m.target === "manual_entry" || m.target === "fixed_original_text") return false;
        if (METADATA_SOURCED_TARGETS.has(m.target)) return false;
        const region = regionById.get(m.regionId);
        return region && region.role === "editable_field";
      }).length;
      if (generatableCount === 0) {
        console.log("[Generate][dynamic] stage=validation failed — no generatable fields in field mapping");
        throw dynamicStageError(
          "validation",
          "This template's field mapping has no fields for the AI to generate (every field is set to leave blank, manual entry, or fixed text)."
        );
      }
    }

    // Resolve the standards section: exact code match (priority) + pgvector
    // semantic search over the teacher's inputs, falling back to the mock
    // standards map when neither is available.
    const primaryFramework = Array.isArray(frameworks) ? frameworks[0] : frameworks;
    const { chunks: relevantChunks, totalCandidates, filteredByGrade } =
      await retrieveRelevantStandards({ framework: primaryFramework, code, topic, goal, subject, grade });

    let standardDescription;
    if (relevantChunks.length > 0) {
      standardDescription = formatStandardsBlock(relevantChunks);
      console.log(
        "[standards:grade-filter] FINAL retrieved:",
        relevantChunks.map((c) =>
          `${c.standard_code ?? "(no-code)"} sim=${c.similarity != null ? c.similarity.toFixed(3) : "?"}`
        ).join(" | ")
      );
    } else if (filteredByGrade > 0) {
      // Had vector candidates but every one was outside the selected grade band.
      // Return a clear message rather than silently using a wrong-grade standard.
      const bandLabel = grade ? `grade band ${grade}` : "the selected grade";
      standardDescription =
        `No ${primaryFramework || "custom"} standards matching ${bandLabel} were found for this topic. `
        + `Design the lesson using grade-appropriate content and skills for ${grade || "this grade"} without citing a specific standard code.`;
      console.log(`[standards:grade-filter] all ${filteredByGrade} candidate(s) excluded by grade enforcement — returning no-in-band-standard message`);
    } else {
      standardDescription = lookupStandard(frameworks, code);
    }

    console.log(
      "[standards:diag] final source:",
      relevantChunks.length > 0
        ? `RETRIEVED (${relevantChunks.length} chunks, ${totalCandidates} candidates, ${filteredByGrade} filtered)`
        : filteredByGrade > 0
        ? `GRADE-FILTERED (${filteredByGrade}/${totalCandidates} out-of-band — no in-band match)`
        : "MOCK"
    );
    console.log("[standards:diag] standardDescription (first 120 chars):", standardDescription?.slice(0, 120));

    // Build the prompt here — providers receive the finished prompt string,
    // not the raw inputs. They are only responsible for calling the LLM.
    // Template 1 has its own prompt + output schema entirely (not the
    // Standard schema with different phrasing) — see buildTemplate1Prompt.
    const isTemplate1 = normalizedLessonFormat === "template1";
    const isDynamic = normalizedLessonFormat === "dynamic";
    const prompt = isTemplate1
      ? buildTemplate1Prompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies, structuredFields: customTemplateStructuredFields })
      : isDynamic
      ? buildDynamicLessonPromptFromFieldMap({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies, fieldMap: customTemplateFieldMap })
      : buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies });

    console.debug("[Generate] inputs:", { grade, subject, frameworks, code, topic, goal, duration, model, lessonFormat: normalizedLessonFormat, technologyUsage, studentTechnology, instructionalApproach, teachingStrategies, marzanoStrategies });
    console.debug("[Generate] prompt:", prompt);

    // Dynamic has its own isolated call/parse path (see
    // generateDynamicLessonContent above) so its errors can be tagged by
    // stage without touching the shared Standard/Template1 provider calls
    // below.
    if (isDynamic) {
      const regionById = new Map(customTemplateFieldMap.regions.map((r) => [r.id, r]));
      const generatableRegionIds = customTemplateFieldMap.mappings
        .filter((m) => {
          if (m.target === "leave_blank" || m.target === "manual_entry" || m.target === "fixed_original_text") return false;
          if (METADATA_SOURCED_TARGETS.has(m.target)) return false;
          const region = regionById.get(m.regionId);
          return region && region.role === "editable_field";
        })
        .map((m) => m.regionId);
      const targetByRegionId = new Map(customTemplateFieldMap.mappings.map((m) => [m.regionId, m.target]));
      console.log("[custom-generation-prompt]", {
        requestedRegionIds: generatableRegionIds,
        targets: generatableRegionIds.map((id) => targetByRegionId.get(id)),
      });
      const content = await generateDynamicLessonContent(model, prompt, generatableRegionIds);
      return res.status(200).json(content);
    }

    if (model === "mistral" || model === "Mistral") {
      const lesson = await generateLessonWithMistral(prompt);
      return res.status(200).json(lesson);
    }

    if (model === "gemini" || model === "Gemini") {
      const lesson = await generateLessonWithGemini(prompt);
      return res.status(200).json(lesson);
    }

    // Placeholder for providers not yet implemented
    return res.status(200).json(
      isTemplate1
        ? {
            lessonTitle: `${model} Provider Not Implemented Yet`,
            centralFocus: "Only the Mistral provider is currently connected.",
            standardsAddressed: "",
            lessonObjectives: [],
            materials: [],
            introduction: { teacherActions: "", studentActions: "", studentSupport: "" },
            mainLearningActivities: { teacherActions: "", studentActions: "", studentSupport: "" },
            closure: { teacherActions: "", studentActions: "" },
            assessment: { howObjectivesAssessed: "" },
          }
        : {
            title: `${model} Provider Not Implemented Yet`,
            objectives: ["Only the Mistral provider is currently connected."],
            materials: [],
            activities: [],
            assessment: "Provider not implemented yet.",
            differentiation: "Provider not implemented yet.",
          }
    );

  } catch (error) {
    console.error("[Generate] error:", error);
    const isTemplate1 = req.body?.lessonFormat === "template1";
    const isDynamic = req.body?.lessonFormat === "dynamic";

    if (isDynamic) {
      const stage = error?.stage || "llm-call";
      console.error(`[Generate][dynamic] request failed at stage=${stage}:`, error?.message);
      return res.status(500).json({
        error: "Dynamic lesson generation failed",
        details: error instanceof Error ? error.message : String(error),
        stage,
      });
    }

    return res.status(500).json(
      isTemplate1
        ? {
            lessonTitle: "Generation Failed",
            centralFocus: "An error occurred during generation.",
            standardsAddressed: "",
            lessonObjectives: [],
            materials: [],
            introduction: { teacherActions: "", studentActions: "", studentSupport: "" },
            mainLearningActivities: { teacherActions: "", studentActions: "", studentSupport: "" },
            closure: { teacherActions: "", studentActions: "" },
            assessment: { howObjectivesAssessed: "" },
          }
        : {
            title: "Generation Failed",
            objectives: [],
            materials: [],
            activities: [],
            assessment: "An error occurred during generation.",
            differentiation: "",
          }
    );
  }
}
