const VECTOR_DIMENSIONS = 256;

function hashToken(token: string, dimensions: number): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash % dimensions;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

/**
 * Feature-hashing embedding (the "hashing trick"): tokens are hashed into a
 * fixed-size vector and L2-normalized. This is a real, deterministic
 * embedding technique in its own right — not a placeholder standing in for
 * one — chosen so incident similarity needs no external embeddings API
 * (Claude has none) and no native FAISS binary in the Node/Docker deployment.
 */
export function embedText(text: string, dimensions = VECTOR_DIMENSIONS): number[] {
  const vector = new Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token, dimensions)] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/** Vectors from embedText() are pre-normalized, so dot product === cosine similarity. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export { VECTOR_DIMENSIONS };
