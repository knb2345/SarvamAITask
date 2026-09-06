import path from 'node:path';
import fs from 'node:fs';

// Load .env without a hard dependency on dotenv at runtime.
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

export const config = {
  dbPath: process.env.KIVI_DB_PATH || path.join(process.cwd(), 'db', 'kivi.db'),
  geminiKey: process.env.GEMINI_API_KEY || '',
  groqKey: (process.env.GROQ_API_KEY || '').trim(),
  groqKeys: [
    process.env.GROQ_API_KEY || '',
    ...(process.env.GROQ_API_KEYS || '').split(',').map((k) => k.trim()),
  ]
    .map((k) => k.trim())
    .filter(Boolean),
  groqModel: (process.env.KIVI_GROQ_MODEL || 'openai/gpt-oss-120b').trim(),
  /**
   * Which backend answers and extracts. "auto" prefers Groq when a key is present —
   * it is faster and its limits are far higher — and falls back to Gemini otherwise.
   * Embeddings are unaffected: Groq has no embedding endpoint.
   */
  llmProvider: (process.env.KIVI_LLM_PROVIDER || 'auto').trim() as 'auto' | 'gemini' | 'groq',
  /**
   * The two workloads have opposite shapes, and the free tiers are limited on opposite
   * axes. Extraction is a hundred large batched calls — cheap on Groq's requests-per-day
   * but far over its 8k tokens-per-minute ceiling. Hey Kivi is many small calls where
   * latency is what the person feels. So each goes where its limit is not the binding
   * one, and either can be pinned explicitly.
   */
  extractProvider: (process.env.KIVI_EXTRACT_PROVIDER || 'gemini').trim() as 'auto' | 'gemini' | 'groq',
  /**
   * Gemini by default for both. Groq is faster per call and its client is kept — the
   * fallback between them is real and has rescued live requests — but the model behind
   * its free tier emits malformed tool calls often enough that it is the wrong default
   * for a product whose whole claim is that it does not speak carelessly.
   */
  chatProvider: (process.env.KIVI_CHAT_PROVIDER || 'gemini').trim() as 'auto' | 'gemini' | 'groq',
  /**
   * Optional extra keys, comma separated. When one key's daily quota is exhausted the
   * client moves to the next rather than retrying a wall it cannot get past. One key is
   * the normal case; this exists because free-tier quotas are small enough to hit during
   * a single 500-record ingest.
   */
  geminiKeys: [
    process.env.GEMINI_API_KEY || '',
    ...(process.env.GEMINI_API_KEYS || '').split(',').map((k) => k.trim()),
  ].filter(Boolean),
  chatModel: process.env.KIVI_CHAT_MODEL || 'gemini-3.5-flash-lite',
  extractModel: process.env.KIVI_EXTRACT_MODEL || 'gemini-3.5-flash-lite',
  embedModel: process.env.KIVI_EMBED_MODEL || 'gemini-embedding-2',
  embedDim: Number(process.env.KIVI_EMBED_DIM || 768),
  // auto: use the API and fall back to the local embedder if it is unavailable.
  // gemini: API only (fail loudly). local: never call the API for embeddings.
  embedProvider: ((process.env.KIVI_EMBED_PROVIDER || 'auto').trim()) as 'auto' | 'gemini' | 'local',
  defaultUserId: process.env.KIVI_USER_ID || 'u_demo',
  // Retrieval floors: below these, Hey Kivi says it does not know.
  minMemoryScore: Number(process.env.KIVI_MIN_MEMORY_SCORE || 0.30),
  concurrency: Number(process.env.KIVI_INGEST_CONCURRENCY || 6),
  // How much the model deliberates before answering. "low" keeps Hey Kivi quick enough
  // to feel like speech; the work here is retrieval, not reasoning from scratch.
  thinkingLevel: (process.env.KIVI_THINKING_LEVEL || 'low').trim(),
};

// USD per 1M tokens. Update here if pricing moves; every number in the eval
// report is derived from this table plus the token counts we log.
export const PRICING: Record<string, { in: number; out: number }> = {
  'gemini-3.5-flash': { in: 0.30, out: 2.50 },
  'gemini-3.5-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-3.1-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-3-flash-preview': { in: 0.30, out: 2.50 },
  'gemini-flash-latest': { in: 0.30, out: 2.50 },
  'gemini-embedding-001': { in: 0.15, out: 0 },
  'gemini-embedding-2': { in: 0.15, out: 0 },
  'openai/gpt-oss-120b': { in: 0.15, out: 0.75 },
  'openai/gpt-oss-20b': { in: 0.075, out: 0.30 },
  'qwen/qwen3.8-27b': { in: 0.15, out: 0.60 },
};

export function priceOf(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] || { in: 0.30, out: 2.5 };
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
}
