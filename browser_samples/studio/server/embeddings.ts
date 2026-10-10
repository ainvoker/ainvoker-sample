/**
 * Retrieval vectors for the handbook.
 *
 * The SDK has no embeddings call yet, so this file hashes words into a fixed-size
 * vector locally. It is good enough to rank passages for a demo and keeps the
 * rest of the retrieval path (chunk, embed, store, cosine) identical to the real
 * thing. When `ai.embeddings` ships, replace the body of `embed` with:
 *
 *   const result = await createClient().embeddings.create({ model, input: texts })
 *   return result.embeddings.map((item) => item.vector)
 *
 * and set EMBEDDING_SOURCE to the model name. Stored vectors are rebuilt on the
 * next start because the source is saved with each chunk.
 */

export const EMBEDDING_SOURCE = "local-hash-256"

const DIMENSIONS = 256

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
  "one", "our", "out", "has", "have", "this", "that", "with", "from", "they", "will", "what",
  "when", "where", "which", "who", "how", "does", "did", "its", "into", "than", "then", "them",
  "there", "their", "about", "should", "would", "could", "your",
])

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word))
}

function hash(word: string): number {
  let value = 2166136261
  for (let index = 0; index < word.length; index++) {
    value ^= word.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

function vectorFor(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0)
  for (const word of tokenize(text)) {
    const bucket = hash(word)
    vector[bucket % DIMENSIONS] += bucket & 0x100 ? 1 : -1
  }
  const length = Math.hypot(...vector)
  return length === 0 ? vector : vector.map((value) => value / length)
}

export async function embed(texts: string[]): Promise<number[][]> {
  return texts.map(vectorFor)
}

export function cosine(a: number[], b: number[]): number {
  let sum = 0
  for (let index = 0; index < Math.min(a.length, b.length); index++) sum += a[index] * b[index]
  return sum
}
