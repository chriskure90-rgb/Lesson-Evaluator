import { Mistral } from "@mistralai/mistralai";

const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

// Receives a fully-built prompt string from generate.js.
// Responsible only for calling the Mistral API and returning parsed JSON.
export async function generateLessonWithMistral(prompt) {
  const result = await mistral.chat.complete({
    model: "mistral-small-latest",
    messages: [{ role: "user", content: prompt }],
  });

  let text = result.choices[0].message.content.trim();

  // Strip any accidental markdown fences the model may add despite instructions
  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const parsed = JSON.parse(text);
  console.debug("[Mistral] raw response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
