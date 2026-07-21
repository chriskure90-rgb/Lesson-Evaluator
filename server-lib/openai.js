import OpenAI from "openai";

// Server-side OpenAI client — shared by every OpenAI use in the app: embedding
// teacher inputs at query time (matched against the pre-embedded `standards`
// rows) and, via server-lib/providers/openai.js, GPT-4 lesson generation.
// One client, one OPENAI_API_KEY read; never imported by frontend code.
const apiKey = process.env.OPENAI_API_KEY;

console.log("[openai:init] OPENAI_API_KEY present:", !!apiKey);
console.log("[openai:init] client will be:", apiKey ? "INITIALISED" : "NULL — vector search will fall back");

export const openai = apiKey ? new OpenAI({ apiKey }) : null;
