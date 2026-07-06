import { openai } from "./openai.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_RETRIES     = 3;
const RETRY_BASE_MS   = 500;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Embeds a batch of strings with retry/backoff on transient failures
// (e.g. rate limits). Returns embedding vectors in the same order as `texts`.
export async function embedBatch(texts) {
  if (!openai) throw new Error("OpenAI client not initialised (missing OPENAI_API_KEY)");

  let attempt = 0;
  while (true) {
    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
      });
      return response.data.map((d) => d.embedding);
    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) throw err;
      await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
}
