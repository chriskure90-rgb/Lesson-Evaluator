import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── Lesson generation ─────────────────────────────────────────────────────────
// Receives a fully-built prompt string from generate.js.
// Responsible only for calling the Gemini API and returning parsed JSON.
export async function generateLessonWithGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Strip any accidental markdown fences the model may add
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(text);
  console.debug("[Gemini] lesson response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
