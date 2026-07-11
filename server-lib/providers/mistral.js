import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

// ── Shared helper ─────────────────────────────────────────────────────────────
// Sends a completed prompt string to Mistral and returns parsed JSON.
// Used by both generation and evaluation routes.
async function callMistral(prompt) {
  const result = await mistral.chat.complete({
    model: "mistral-small-latest",
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.choices[0].message.content.trim();

  // Strip any accidental markdown fences the model may add
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(text);
}

// ── Lesson generation ─────────────────────────────────────────────────────────
// Receives the fully-built generation prompt from generate.js.
export async function generateLessonWithMistral(prompt) {
  const parsed = await callMistral(prompt);
  console.debug("[Mistral] lesson response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}

// ── Lesson evaluation ─────────────────────────────────────────────────────────
// Receives the fully-built evaluation prompt from evaluate.js.
export async function evaluateLessonWithMistral(prompt) {
  const parsed = await callMistral(prompt);
  console.debug("[Mistral] evaluation response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
