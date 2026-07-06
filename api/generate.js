import { generateLessonWithMistral } from "./providers/mistral.js";
import { generateLessonWithGemini  } from "./providers/gemini.js";
import { supabase }                  from "./lib/supabase.js";
import { openai }                    from "./lib/openai.js";

const EMBEDDING_MODEL      = "text-embedding-3-small";
const VECTOR_MATCH_COUNT   = 5;

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

async function vectorSearchStandards({ framework, queryText, matchCount = VECTOR_MATCH_COUNT }) {
  if (!supabase) throw new Error("Supabase client not initialised");
  if (!framework) throw new Error("No framework selected for vector search");

  const queryEmbedding = await embedQuery(queryText);

  const { data, error } = await supabase.rpc("match_standards", {
    query_embedding: queryEmbedding,
    match_framework: framework,
    match_count: matchCount,
  });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Combines the exact standard_code lookup (priority, when the teacher entered
// a code) with pgvector semantic search results from the teacher's topic,
// goal, subject, and grade — de-duplicated and capped at VECTOR_MATCH_COUNT.
// Returns [] (never throws) so callers can fall back to the existing mock
// behaviour when both Supabase and the vector search are unavailable.
async function retrieveRelevantStandards({ framework, code, topic, goal, subject, grade }) {
  const chunks = [];

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

    const matches = await vectorSearchStandards({ framework, queryText });
    console.log("[standards:vector] retrieved", matches.length, "vector matches for framework:", framework);

    for (const match of matches) {
      const isDuplicate = chunks.some((c) => c.content === match.content);
      if (!isDuplicate) chunks.push(match);
    }
  } catch (err) {
    console.warn("[standards:vector] search failed, continuing with exact-match/mock fallback:", err.message);
  }

  return chunks.slice(0, VECTOR_MATCH_COUNT);
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

// ── Prompt builder ───────────────────────────────────────────────────────────
// Builds the full structured lesson-generation prompt from user inputs.
// standardDescription is resolved by the handler (Supabase first, mock fallback).
function buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription }) {
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
    "CONSTRAINTS:",
    `- Do not exceed ${duration} minutes total across all activities.`,
    "- Use vocabulary appropriate for the grade level.",
    "- Keep each section concise and readable.",
    "- All activities must align with the lesson topic and lesson goal.",
    `- All content must be appropriate for the subject area: ${subject || "general"}.`,
    "- The assessment must measure the lesson goal.",
    "- Include realistic classroom activities.",
    "- Ensure the lesson aligns with the provided standard when available.",
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

// ── Route handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  console.log("=== STANDARDS DIAGNOSTICS ENABLED ===");
  console.log("[standards:diag] /api/generate handler entered");
  try {
    const { grade, subject, frameworks, code, topic, goal, duration, model } = req.body;

    // Resolve the standards section: exact code match (priority) + pgvector
    // semantic search over the teacher's inputs, falling back to the mock
    // standards map when neither is available.
    const primaryFramework = Array.isArray(frameworks) ? frameworks[0] : frameworks;
    const relevantChunks = await retrieveRelevantStandards({ framework: primaryFramework, code, topic, goal, subject, grade });
    const standardDescription = relevantChunks.length > 0
      ? formatStandardsBlock(relevantChunks)
      : lookupStandard(frameworks, code);
    console.log("[standards:diag] final source:", relevantChunks.length > 0 ? `RETRIEVED (${relevantChunks.length} chunks)` : "MOCK");
    console.log("[standards:diag] standardDescription (first 120 chars):", standardDescription?.slice(0, 120));

    // Build the prompt here — providers receive the finished prompt string,
    // not the raw inputs. They are only responsible for calling the LLM.
    const prompt = buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration, standardDescription });

    console.debug("[Generate] inputs:", { grade, subject, frameworks, code, topic, goal, duration, model });
    console.debug("[Generate] prompt:", prompt);

    if (model === "mistral" || model === "Mistral") {
      const lesson = await generateLessonWithMistral(prompt);
      return res.status(200).json(lesson);
    }

    if (model === "gemini" || model === "Gemini") {
      const lesson = await generateLessonWithGemini(prompt);
      return res.status(200).json(lesson);
    }

    // Placeholder for providers not yet implemented
    return res.status(200).json({
      title: `${model} Provider Not Implemented Yet`,
      objectives: ["Only the Mistral provider is currently connected."],
      materials: [],
      activities: [],
      assessment: "Provider not implemented yet.",
      differentiation: "Provider not implemented yet.",
    });

  } catch (error) {
    console.error("[Generate] error:", error);
    return res.status(500).json({
      title: "Generation Failed",
      objectives: [],
      materials: [],
      activities: [],
      assessment: "An error occurred during generation.",
      differentiation: "",
    });
  }
}
