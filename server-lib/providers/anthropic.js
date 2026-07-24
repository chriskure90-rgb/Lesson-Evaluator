import Anthropic from "@anthropic-ai/sdk";

// Server-side Anthropic client, built from ANTHROPIC_API_KEY — this file is
// only ever imported by api/ serverless functions, so the key never reaches
// the browser. No other feature in this app uses Anthropic yet, so (unlike
// server-lib/openai.js, shared with standards-embedding queries) there's no
// reason to split the client into its own shared module — same pattern as
// server-lib/providers/mistral.js's inline client.
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ── Lesson generation ─────────────────────────────────────────────────────────
// Receives a fully-built prompt string from generate.js — the exact same
// prompt generateLessonWithOpenAI/generateLessonWithMistral/
// generateLessonWithGemini receive, built by buildLessonPrompt/
// buildTemplate1Prompt/buildDynamicLessonPromptFromFieldMap. Responsible only
// for calling the API and returning parsed JSON — same robust
// parse/validate/throw shape as generateLessonWithOpenAI (never returns
// placeholder/mock content on failure).
export async function generateLessonWithClaude(prompt) {
  if (!anthropic) {
    throw new Error("Claude is not configured on the server (ANTHROPIC_API_KEY missing).");
  }

  const result = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = result.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new Error("Claude returned an empty response.");
  }

  // Strip any accidental markdown fences the model may add — same defensive
  // handling every other provider already does. Claude has no built-in
  // "force JSON object" response mode the way OpenAI does, so this matters
  // slightly more here — the shared prompts already say "return valid JSON
  // only, no markdown fences," but this is kept as a safety net regardless.
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Claude's response was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude's response was valid JSON but not the expected object shape.");
  }

  console.debug("[Claude] lesson response parsed:", JSON.stringify(parsed, null, 2));
  return parsed;
}
