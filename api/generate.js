import { generateLessonWithMistral } from "./providers/mistral.js";
import { generateLessonWithGemini  } from "./providers/gemini.js";

// ── Prompt builder ───────────────────────────────────────────────────────────
// Builds the full structured lesson-generation prompt from user inputs.
// Lives here so all prompt logic is in one place, independent of provider.
function buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration }) {
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
  try {
    const { grade, subject, frameworks, code, topic, goal, duration, model } = req.body;

    // Build the prompt here — providers receive the finished prompt string,
    // not the raw inputs. They are only responsible for calling the LLM.
    const prompt = buildLessonPrompt({ grade, subject, frameworks, code, topic, goal, duration });

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
