import { openai } from "../openai.js";

// ── Lesson generation ─────────────────────────────────────────────────────────
// Receives a fully-built prompt string from generate.js — this file is only
// ever imported by api/ serverless functions, so OPENAI_API_KEY never reaches
// the browser. Reuses the SAME server-side client server-lib/openai.js
// already constructs from OPENAI_API_KEY for standards-embedding queries
// (one client, one env var read), rather than instantiating a second one.
export async function generateLessonWithOpenAI(prompt) {
  if (!openai) {
    throw new Error("OpenAI is not configured on the server (OPENAI_API_KEY missing).");
  }

  const result = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    // Forces a JSON object response — reduces (but doesn't eliminate) the
    // chance of markdown fences/prose wrapping the JSON, same intent as the
    // defensive fence-stripping below.
    response_format: { type: "json_object" },
  });

  const text = result.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  // Strip any accidental markdown fences the model may add — same defensive
  // handling generateLessonWithMistral/generateLessonWithGemini already do.
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("OpenAI's response was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenAI's response was valid JSON but not the expected object shape.");
  }

  console.debug("[OpenAI] lesson response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
