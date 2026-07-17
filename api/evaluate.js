import { evaluateLessonWithMistral } from "../server-lib/providers/mistral.js";

// ── The 10 rubric criteria ────────────────────────────────────────────────────
// Defined here so the prompt builder can inject titles and descriptions
// without duplicating them.
const RUBRIC_CRITERIA = [
  {
    id: "lesson-title",
    title: "Lesson Title",
    description:
      "Identifies the topic and focus of the specific instructional unit and lesson.",
    high: "Clearly and concisely reflects the specific lesson's topic and focus.",
    medium: "Refers in general to the lesson's topic but lacks specificity.",
    low: "The title is too general, unspecified, or does not connect to the lesson.",
  },
  {
    id: "objectives",
    title: "Learning Objectives",
    description:
      "Specific statement using action verbs that communicates the 'big idea' students should gain and how they will be evaluated.",
    high: "Clearly aligned with the lesson, includes a 'big idea,' and includes a measurable assessment strategy.",
    medium: "Mostly aligned with the lesson; assessment strategy has some measurable elements.",
    low: "Misaligned with the lesson, only partially includes a 'big idea,' and/or the assessment is not measurable.",
  },
  {
    id: "standards",
    title: "Standards Alignment",
    description:
      "Academic standards are identified that align with the objective, content, and 'big idea' being assessed.",
    high: "Standards are tightly aligned with the lesson's topic, objectives, and assessment.",
    medium: "Standards are mostly aligned but there are some gaps in logic.",
    low: "Standards are not clearly aligned or there are severe gaps in logic.",
  },
  {
    id: "assessment",
    title: "Assessment Strategy",
    description:
      "A plan to evaluate if students gained the 'big idea(s)' from the lesson, including grading criteria.",
    high: "Aligned with the lesson's 'big idea' and includes clear grading criteria.",
    medium: "Mostly aligned; includes general grading criteria.",
    low: "Misaligned from the 'big idea' or lacks clear grading criteria.",
  },
  {
    id: "activities",
    title: "Instructional Activities",
    description:
      "The sequence of teaching procedures and student tasks that drive the lesson, aligned with objectives and assessments.",
    high: "Clear procedures and tasks aligned with the objective in a logical progression that prepares students for the assessment.",
    medium: "Mostly clear procedures but gaps exist in how they prepare students for the assessment.",
    low: "Limited and disconnected from objectives; do not prepare students for the assessment.",
  },
  {
    id: "resources",
    title: "Resources & Materials",
    description:
      "Concrete tools, texts, technology, or objects identified for both teacher and student.",
    high: "All resources/materials are listed in detail.",
    medium: "Most resources and materials are listed; a few may be missing.",
    low: "Few resources/materials are listed; multiple are missing.",
  },
  {
    id: "differentiation",
    title: "Differentiation Strategy",
    description:
      "Plans for addressing the needs of diverse learners, including those with special needs or from underrepresented populations.",
    high: "Intentional supports and extensions that address varied learner needs.",
    medium: "Some supports or extensions, but limited or loosely tied to specific learner needs.",
    low: "Few or no meaningful supports; learner differences are not clearly considered.",
  },
  {
    id: "timing",
    title: "Timing & Pacing",
    description:
      "Estimates for the duration of activities to ensure the lesson fits within the allotted period.",
    high: "Time allocations are realistic and include flexible ranges.",
    medium: "Generally reasonable but may lack flexibility or detail for some segments.",
    low: "Unclear, unrealistic, or missing for key parts of the lesson.",
  },
  {
    id: "opening",
    title: "Opening / Introduction",
    description:
      "The initial phase used to preview the lesson, activate prior knowledge, and set expectations.",
    high: "Efficiently previews the lesson, activates prior knowledge, and sets explicit expectations.",
    medium: "Previews the lesson or activates prior knowledge, but expectations are only partially clear.",
    low: "Does not clearly preview the lesson, connect to prior knowledge, or establish expectations.",
  },
  {
    id: "evaluation",
    title: "Evaluation / Reflection",
    description:
      "Assessments that provide opportunities for students to look back on their learning.",
    high: "Students engage in structured evaluation that prompts reflection and completes a task.",
    medium: "Students engage in structured evaluation but it can be completed without reflecting.",
    low: "Unclear evaluation that may require little to no reflection on learning.",
  },
];

// Template 1 (PSU/GTEP) lessons use a different JSON shape than the Standard
// format, so the model needs to be told explicitly which fields carry which
// rubric-relevant content before it reads the raw JSON.
const TEMPLATE1_FIELD_GUIDE = [
  "FIELD GUIDE (Template 1 / PSU-GTEP lesson format):",
  "This lesson plan uses the Template 1 JSON shape, not the standard shape. Map its fields as follows when evaluating:",
  "- centralFocus -> the lesson's overall topic/purpose (relevant to Lesson Title and Opening/Introduction).",
  "- standardsAddressed -> academic standards (relevant to Standards Alignment).",
  "- lessonObjectives -> the learning objectives (relevant to Learning Objectives).",
  "- materials -> resources/materials (relevant to Resources & Materials).",
  "- introduction.teacherActions / introduction.studentActions -> the opening/introduction phase (relevant to Opening/Introduction, Timing & Pacing).",
  "- mainLearningActivities.teacherActions / mainLearningActivities.studentActions -> the main instructional activities (relevant to Instructional Activities, Timing & Pacing, Differentiation Strategy).",
  "- closure.teacherActions / closure.studentActions -> the closing phase (relevant to Evaluation/Reflection).",
  "- assessment.howObjectivesAssessed -> how objectives are assessed (relevant to Assessment Strategy).",
  "- lessonTitle -> the lesson's title (relevant to Lesson Title).",
  "",
].join("\n");

// Dynamic (field_map-based) lessons have no fixed schema — the teacher's own
// uploaded template determines what regions exist, so content is a flat
// sections[] array keyed by regionId rather than named fields.
const DYNAMIC_FIELD_GUIDE = [
  "FIELD GUIDE (dynamic/field-map lesson format):",
  "This lesson plan uses the teacher's own uploaded template structure, not a fixed schema.",
  '- sections is an array of { id, originalLabel, content }.',
  "- originalLabel is the human-readable name of that field as the teacher's template labeled it (e.g. \"Learning Objectives\", \"Materials\").",
  "- content is the generated text for that field.",
  "- Evaluate holistically against originalLabel/content pairs the same way you would the named fields of any other lesson format — a section whose originalLabel maps to a rubric criterion (e.g. an objectives-like label) should inform that criterion's rating.",
  "",
].join("\n");

// ── Prompt builder ────────────────────────────────────────────────────────────
// Builds the full rubric evaluation prompt from the lesson JSON. templateType
// is "standard", "template1", or "dynamic" — it only changes the field-guide
// preamble injected before the raw JSON; the rubric criteria are identical
// across all three.
function buildEvaluationPrompt(lesson, templateType) {
  // Serialize the lesson plan so Mistral can read every section
  const lessonText = JSON.stringify(lesson, null, 2);
  const fieldGuide = templateType === "template1" ? TEMPLATE1_FIELD_GUIDE
    : templateType === "dynamic" ? DYNAMIC_FIELD_GUIDE
    : "";

  // Build one criteria block per rubric item
  const criteriaBlocks = RUBRIC_CRITERIA.map((c) =>
    [
      `Criterion id: "${c.id}"`,
      `Title: ${c.title}`,
      `Description: ${c.description}`,
      `  High:   ${c.high}`,
      `  Medium: ${c.medium}`,
      `  Low:    ${c.low}`,
    ].join("\n")
  ).join("\n\n");

  // Build the sections array template so the model knows the exact shape
  const sectionsTemplate = RUBRIC_CRITERIA.map((c) =>
    [
      "  {",
      `    "id": "${c.id}",`,
      `    "title": "${c.title}",`,
      '    "rating": "high | medium | low | na",',
      '    "feedback": "1-2 sentence explanation referencing the lesson content, or reason why N/A"',
      "  }",
    ].join("\n")
  ).join(",\n");

  return [
    "ROLE:",
    "You are an expert K-12 curriculum evaluator. Your task is to evaluate a teacher-submitted lesson plan against a structured rubric.",
    "",
    "CONTEXT:",
    "You will be given a lesson plan as JSON and a set of rubric criteria. For each criterion, assign a rating of high, medium, low, or na based on the evidence in the lesson plan. Write brief, specific feedback that references the actual lesson content.",
    "",
    "LESSON PLAN:",
    fieldGuide,
    lessonText,
    "",
    "RUBRIC CRITERIA:",
    criteriaBlocks,
    "",
    "RATING GUIDANCE:",
    "- high: The lesson clearly and strongly meets this criterion.",
    "- medium: The lesson partially meets this criterion.",
    "- low: The criterion applies to this lesson but the lesson does not meet it, or the relevant section is empty or missing.",
    "- na: The criterion genuinely does not apply to this lesson or template. Use N/A ONLY when the template or lesson format structurally cannot include this criterion — for example, a template with no technology-integration section when evaluating technology usage, or a lesson format that explicitly has no homework. Do NOT use N/A simply because content is weak — use low for that.",
    "",
    "CONSTRAINTS:",
    "- Evaluate only what is present in the lesson plan. Do not assume missing content exists.",
    "- Use only the ratings: high, medium, low, or na.",
    "- For na: always provide a brief reason explaining why the criterion does not apply.",
    "- Keep each feedback string to 1-2 sentences.",
    "- Feedback must reference specific elements from the lesson plan, not generic advice.",
    "- Do not calculate a total score.",
    "- Do not include a readiness status.",
    "- Return valid JSON only.",
    "- Do not include markdown formatting or code fences.",
    "- Do not include explanations outside the JSON.",
    "",
    "OUTPUT FORMAT:",
    "{",
    '  "summary": "2-3 sentence overall evaluation of the lesson plan",',
    '  "sections": [',
    sectionsTemplate,
    "  ]",
    "}",
    "",
    "OUTPUT RULES:",
    "- summary must be a plain string.",
    `- sections must contain exactly ${RUBRIC_CRITERIA.length} items — one per rubric criterion.`,
    "- Each section must have: id (string), title (string), rating (high|medium|low|na), feedback (string).",
    "- rating must be exactly one of: high, medium, low, na — no other values.",
    "- Do not add extra fields.",
  ].join("\n");
}

// ── Route handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const { lesson, templateType } = req.body;

    if (!lesson) {
      return res.status(400).json({ error: "No lesson provided for evaluation." });
    }

    const prompt = buildEvaluationPrompt(lesson, templateType);

    console.debug("[Evaluate] template type:", templateType);
    console.debug("[Evaluate] lesson title:", templateType === "template1" ? lesson.lessonTitle : lesson.title);
    console.debug("[Evaluate] prompt:", prompt);

    // Mistral is the evaluation provider for this prototype
    const evaluation = await evaluateLessonWithMistral(prompt);
    return res.status(200).json(evaluation);

  } catch (error) {
    console.error("[Evaluate] error:", error);
    return res.status(500).json({
      summary: "Evaluation failed. Please try again.",
      sections: [],
    });
  }
}
