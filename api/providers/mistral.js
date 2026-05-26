import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export async function generateLessonWithMistral({
  grade,
  standard,
  standardCode,
  lessonGoal,
  duration,
}) {
  const prompt = `
Create a ${duration}-minute lesson plan for ${grade}.

Standard framework: ${standard}
Standard code: ${standardCode}
Lesson goal: ${lessonGoal}

Return VALID JSON only. Do not use markdown.

The JSON must follow this exact structure:
{
  "title": "string",
  "grade": "Grade ${grade}",
  "duration": "${duration} min",
  "objectives": ["string", "string"],
  "materials": ["string", "string"],
  "activities": [
    {
      "time": "10m",
      "title": "string",
      "description": "string"
    }
  ],
  "assessment": ["string", "string"],
  "differentiation": ["string", "string"]
}
`;

  const result = await mistral.chat.complete({
    model: "mistral-small-latest",
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.choices[0].message.content.trim();

  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");

  return JSON.parse(text);
}