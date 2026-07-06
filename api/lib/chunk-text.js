// Splits arbitrary text into ~500-1000 character chunks, breaking on
// sentence boundaries where possible. Shared by the standards import
// scripts and the teacher-upload endpoint.
const MIN_CHUNK_SIZE = 500;
const MAX_CHUNK_SIZE = 1000;

export function splitIntoChunks(text, { min = MIN_CHUNK_SIZE, max = MAX_CHUNK_SIZE } = {}) {
  const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (buffer.length >= min && buffer.length + sentence.length + 1 > max) {
      chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  // Hard-split any chunk that still exceeds the max (e.g. one very long sentence).
  return chunks.flatMap((chunk) => {
    if (chunk.length <= max) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += max) parts.push(chunk.slice(i, i + max));
    return parts;
  });
}
