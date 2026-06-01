import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export async function generateLessonWithMistral({
  // Fix 1: use the exact field names the frontend sends
  grade,
  frameworks,   // was: standard   (frontend sends frameworks array)
  code,         // was: standardCode
  topic,        // was: missing entirely
  goal,         // was: lessonGoal
  duration,
}) {
  // Fix 2: include topic as the primary lesson subject
  const frameworkLine = Array.isArray(frameworks) && frameworks.length > 0
    ? `Standards framework: ${frameworks.join(", ")}${code ? ` (${code})` : ""}`
    : code ? `Standard code: ${code}` : "No specific framework provided.";

  const prompt = `
You are an expert K-12 curriculum designer.
Create a ${duration}-minute lesson plan for Grade ${grade}.

Lesson topic: ${topic || "(not specified)"}
Lesson goal: ${goal || "(not specified)"}
${frameworkLine}

Return VALID JSON only. No markdown, no code fences, no extra text.

The JSON must follow this exact structure:
{
  "title": "string — specific lesson title that reflects the topic",
  "objectives": ["string", "string"],
  "materials": ["string", "string"],
  "activities": [
    {
      "name": "string — activity name",
      "minutes": 10,
      "detail": "string — what teacher and students do"
    }
  ],
  "assessment": "string — describe the assessment strategy",
  "differentiation": "string — describe supports and extensions for diverse learners"
}

Important:
- activities[].name is a string (the activity name)
- activities[].minutes is a number (integer, not a string like "10m")
- activities[].detail is a string
- assessment is a plain string, not an array
- differentiation is a plain string, not an array
- All activity minutes must sum to exactly ${duration}
`.trim();

  // Fix 2 (cont.): log the full prompt so you can verify all inputs appear
  console.debug("[Mistral] prompt sent:\n", prompt);

  const result = await mistral.chat.complete({
    model: "mistral-small-latest",
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.choices[0].message.content.trim();

  // Strip any accidental markdown fences
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(text);
  console.debug("[Mistral] raw response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
