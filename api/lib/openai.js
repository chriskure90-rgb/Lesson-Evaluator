import OpenAI from "openai";

// Server-side OpenAI client, used for embedding teacher inputs at query time
// so they can be matched against the pre-embedded `standards` rows.
const apiKey = process.env.OPENAI_API_KEY;

console.log("[openai:init] OPENAI_API_KEY present:", !!apiKey);
console.log("[openai:init] client will be:", apiKey ? "INITIALISED" : "NULL — vector search will fall back");

export const openai = apiKey ? new OpenAI({ apiKey }) : null;
