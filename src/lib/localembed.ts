/**
 * A deterministic local embedder, used when the embedding API is unavailable or out of
 * quota.
 *
 * It is a hashing vectoriser: words and character 4-grams are hashed into a fixed number
 * of dimensions with signed weights, sub-linear term frequency, and L2 normalisation.
 * Character n-grams are what give it a useful property for this product — "Truvia" and
 * "truvia's", or an ASR mis-recognition like "true via", still land near each other.
 *
 * It is weaker than a neural embedding at paraphrase ("who runs the ledger work?" vs
 * "Rahul owns the ledger migration"), which is exactly why retrieval fuses it with BM25
 * rather than relying on either alone. What it buys is that the system never stops
 * working, and never silently mixes two vector spaces: every stored vector records the
 * provider that produced it, and a query is only compared against vectors from the same
 * provider.
 */

const DIM_DEFAULT = 768;

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'was', 'it', 'that',
  'this', 'with', 'at', 'by', 'from', 'as', 'be', 'been', 'are', 'were', 'am',
]);

function hash32(s: string, seed: number): number {
  // FNV-1a, seeded.
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function tokens(text: string): string[] {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);
  const out: string[] = [];
  for (const w of words) {
    if (!STOP.has(w)) out.push(`w:${w}`);
    // Character 4-grams give robustness to ASR spelling drift and morphology.
    if (w.length > 4) {
      for (let i = 0; i + 4 <= w.length; i++) out.push(`g:${w.slice(i, i + 4)}`);
    }
  }
  // Adjacent word pairs carry a little word order.
  for (let i = 0; i + 1 < words.length; i++) out.push(`b:${words[i]}_${words[i + 1]}`);
  return out;
}

export function localEmbed(text: string, dim = DIM_DEFAULT): Float32Array {
  const counts = new Map<string, number>();
  for (const t of tokens(text)) counts.set(t, (counts.get(t) ?? 0) + 1);

  const v = new Float32Array(dim);
  for (const [term, count] of counts) {
    const tf = 1 + Math.log(count); // sub-linear: repetition should not dominate
    // Two hashes per term reduces collision damage at this dimensionality.
    for (let k = 0; k < 2; k++) {
      const h = hash32(term, k);
      const idx = h % dim;
      const sign = (h >>> 31) & 1 ? -1 : 1;
      v[idx] += sign * tf;
    }
  }

  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

export function localEmbedBatch(texts: string[], dim = DIM_DEFAULT): Float32Array[] {
  return texts.map((t) => localEmbed(t, dim));
}
