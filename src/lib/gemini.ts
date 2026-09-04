import { config, priceOf } from './config';
import { localEmbedBatch } from './localembed';
import { db } from './db';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Key rotation. A free-tier key has a small daily allowance; when it is gone, no amount
 * of backing off will help, but another key will. `{KEY}` in a URL is replaced with the
 * key currently in use.
 */
type Family = 'generate' | 'embed';

// Quotas are per metric, not per key: a key can be out of embedding calls while still
// having generation left. Exhaustion is therefore tracked per (family, key).
const keyIndex: Record<Family, number> = { generate: 0, embed: 0 };

/**
 * When each key was found to be out of daily quota. It is a timestamp rather than a flag
 * because this process may outlive the exhaustion: a dev server left running overnight
 * crosses the quota reset, and a key retired permanently at 6pm would still be retired
 * the next morning. Retired keys are reconsidered after a while.
 */
const retiredAt: Record<Family, Map<number, number>> = { generate: new Map(), embed: new Map() };
const RETIRE_FOR_MS = 15 * 60 * 1000;

function isRetired(family: Family, i: number): boolean {
  const at = retiredAt[family].get(i);
  if (at === undefined) return false;
  if (Date.now() - at > RETIRE_FOR_MS) {
    retiredAt[family].delete(i); // give it another chance; quotas do reset
    return false;
  }
  return true;
}

const exhausted: Record<Family, { has: (i: number) => boolean; add: (i: number) => void; get size(): number }> = {
  generate: {
    has: (i) => isRetired('generate', i),
    add: (i) => retiredAt.generate.set(i, Date.now()),
    get size() { return [...retiredAt.generate.keys()].filter((i) => isRetired('generate', i)).length; },
  },
  embed: {
    has: (i) => isRetired('embed', i),
    add: (i) => retiredAt.embed.set(i, Date.now()),
    get size() { return [...retiredAt.embed.keys()].filter((i) => isRetired('embed', i)).length; },
  },
};

function currentKey(family: Family): string {
  const keys = config.geminiKeys;
  if (keys.length === 0) return '';
  return keys[Math.min(keyIndex[family], keys.length - 1)];
}

/** Returns true if there was another key with quota left for this family. */
function rotateKey(family: Family, reason: string): boolean {
  const spent = keyIndex[family];
  exhausted[family].add(spent);
  for (let i = 0; i < config.geminiKeys.length; i++) {
    if (!exhausted[family].has(i)) {
      keyIndex[family] = i;
      console.warn(`  [gemini] ${family} quota exhausted on key ${spent + 1}; switching to key ${i + 1}`);
      return true;
    }
  }
  console.warn(`  [gemini] ${family} quota exhausted on all ${config.geminiKeys.length} key(s)`);
  return false;
}

function allKeysSpent(family: Family): boolean {
  return exhausted[family].size >= config.geminiKeys.length;
}

/**
 * Round-robin to the next key that has not hit a daily wall. Used for per-minute rate
 * limits, where another key is available immediately.
 */
function nextKey(family: Family): boolean {
  const keys = config.geminiKeys;
  if (keys.length < 2) return false;
  for (let i = 1; i <= keys.length; i++) {
    const candidate = (keyIndex[family] + i) % keys.length;
    if (!exhausted[family].has(candidate)) {
      keyIndex[family] = candidate;
      return true;
    }
  }
  return false;
}

export function keyStatus() {
  return {
    keys: config.geminiKeys.length,
    generate: { inUse: keyIndex.generate + 1, retired: [...retiredAt.generate.keys()].map((i) => i + 1) },
    embed: { inUse: keyIndex.embed + 1, retired: [...retiredAt.embed.keys()].map((i) => i + 1) },
  };
}

export type Usage = { inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number; model: string };

function logCall(purpose: string, u: Usage, ok: boolean, runId?: string) {
  try {
    db().prepare(
      `INSERT INTO model_calls (run_id, purpose, model, input_tokens, output_tokens, latency_ms, cost_usd, ok)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(runId ?? null, purpose, u.model, u.inputTokens, u.outputTokens, u.latencyMs, u.costUsd, ok ? 1 : 0);
  } catch { /* ledger is best-effort; never break the request */ }
}

/**
 * Every request to the model goes through here. Transient failures — rate limits,
 * 5xx, and dropped connections — are retried with back-off; only a genuine 4xx is
 * fatal. A laptop losing wifi mid-ingest must not cost the run.
 */
async function post(
  url: string,
  body: unknown,
  tries = 6,
  family: Family = 'generate',
  budgetMs = 240_000
): Promise<any> {
  let lastErr: unknown;
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < tries; i++) {
    if (Date.now() > deadline) break;
    try {
      const res = await fetch(url.replace('{KEY}', currentKey(family)), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        // A per-DAY quota is terminal for this key; a per-minute rate limit is not.
        // Both mention the free tier, so match the daily quota id specifically —
        // treating a rate limit as exhaustion throws away a perfectly good key.
        const daily = /PerDay|per day|RequestsPerDayPerProject/i.test(text);
        if (res.status === 429 && daily && rotateKey(family, text)) {
          continue;
        }
        // A per-minute limit is per key. With more than one key, moving to the next is
        // instant where waiting costs a minute — so try the others before backing off.
        if (res.status === 429 && !daily && nextKey(family)) {
          continue;
        }
        if (res.status === 429 && daily && allKeysSpent(family)) {
          throw Object.assign(new Error(`daily quota exhausted on every key: ${text.slice(0, 200)}`), { fatal: true });
        }
        // Gemini tells us how long to wait; honour it rather than guessing.
        const m = /retry in ([0-9.]+)s/i.exec(text) || /"retryDelay":\s*"([0-9.]+)s"/.exec(text);
        throw Object.assign(new Error(`http ${res.status}: ${text.slice(0, 300)}`), {
          retryAfterMs: m ? Math.min(120_000, Math.ceil(Number(m[1]) * 1000) + 1500) : undefined,
        });
      }
      if (!res.ok) throw Object.assign(new Error(`http ${res.status}: ${(await res.text()).slice(0, 400)}`), { fatal: true });
      return await res.json();
    } catch (e: any) {
      lastErr = e;
      if (e?.fatal) break;
      const wait = Math.min(
        e?.retryAfterMs ?? Math.min(30_000, 1_000 * 2 ** i) + Math.random() * 500,
        Math.max(0, deadline - Date.now())
      );
      if (wait <= 0) break;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/** Embeddings retry far less: a fallback exists, so waiting is the wrong trade. */
const postEmbed = (url: string, body: unknown) => post(url, body, 2, 'embed', 30_000);

export type GenPart = {
  text?: string;
  functionCall?: { name: string; args: any; id?: string };
  functionResponse?: { name: string; response: any; id?: string };
  thoughtSignature?: string;
};
export type GenContent = { role: 'user' | 'model'; parts: GenPart[] };

export type GenerateOpts = {
  system?: string;
  contents: GenContent[];
  tools?: any[];
  jsonSchema?: any;
  temperature?: number;
  model?: string;
  purpose: string;
  runId?: string;
  /** Require the model to answer through a tool rather than free text. */
  forceToolCall?: boolean;
  thinkingLevel?: string;
};

export async function generate(opts: GenerateOpts): Promise<{ parts: GenPart[]; text: string; usage: Usage }> {
  if (config.geminiKeys.length === 0) throw new Error('GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.');
  const model = opts.model || config.chatModel;
  const body: any = {
    contents: opts.contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      thinkingConfig: { thinkingLevel: opts.thinkingLevel ?? config.thinkingLevel },
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.tools) body.tools = opts.tools;
  // ANY forces the model to call one of the declared functions. Hey Kivi can then say
  // "respond() is the only way to speak" as a fact about the request, not a hope about
  // the prompt — a model that answers in free text carries no outcome and no citations.
  if (opts.forceToolCall) body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
  if (opts.jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = opts.jsonSchema;
  }
  const t0 = Date.now();
  let json: any;
  try {
    json = await post(`${BASE}/models/${model}:generateContent?key={KEY}`, body);
  } catch (e) {
    logCall(opts.purpose, { inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, costUsd: 0, model }, false, opts.runId);
    throw e;
  }
  const latencyMs = Date.now() - t0;
  const um = json.usageMetadata || {};
  const inputTokens = um.promptTokenCount ?? 0;
  const outputTokens = (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0);
  const usage: Usage = { inputTokens, outputTokens, latencyMs, costUsd: priceOf(model, inputTokens, outputTokens), model };
  logCall(opts.purpose, usage, true, opts.runId);
  const parts: GenPart[] = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter(p => p.text).map(p => p.text).join('').trim();
  return { parts, text, usage };
}

export async function generateJson<T>(opts: GenerateOpts): Promise<{ value: T; usage: Usage }> {
  const { text, usage } = await generate({ ...opts, model: opts.model || config.extractModel });
  try {
    return { value: JSON.parse(text) as T, usage };
  } catch {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new Error(`model did not return JSON: ${text.slice(0, 200)}`);
    return { value: JSON.parse(m[0]) as T, usage };
  }
}

export type EmbedResult = { vectors: Float32Array[]; provider: 'gemini' | 'local' };

/**
 * Circuit breaker for embeddings.
 *
 * It trips only on a DAILY quota or a missing key — the conditions no amount of waiting
 * fixes. A per-minute rate limit is not one of those: it is what back-off is for, and
 * tripping on it would throw away good vectors for the rest of the run. (This is the
 * same distinction the key rotation makes, and getting it wrong cost a whole ingest.)
 */
let embeddingApiDown = false;
export function embeddingProviderInUse(): 'gemini' | 'local' {
  return embeddingApiDown || config.embedProvider === 'local' ? 'local' : 'gemini';
}

/**
 * Embeds a batch of texts. Returns the provider that actually produced the vectors:
 * callers must store it, because vectors from different providers cannot be compared.
 */
export async function embedWithProvider(
  texts: string[],
  purpose: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  runId?: string,
  force?: 'gemini' | 'local'
): Promise<EmbedResult> {
  if (texts.length === 0) return { vectors: [], provider: force ?? 'local' };

  const provider = force ?? (embeddingApiDown ? 'local' : config.embedProvider);
  if (provider === 'local') {
    return { vectors: localEmbedBatch(texts, config.embedDim), provider: 'local' };
  }

  try {
    if (config.geminiKeys.length === 0) throw new Error('GEMINI_API_KEY is not set.');
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const chunk = texts.slice(i, i + 64);
      const t0 = Date.now();
      const json = await postEmbed(`${BASE}/models/${config.embedModel}:batchEmbedContents?key={KEY}`, {
        requests: chunk.map(t => ({
          model: `models/${config.embedModel}`,
          content: { parts: [{ text: t.slice(0, 8000) }] },
          taskType: purpose,
          outputDimensionality: config.embedDim,
        })),
      });
      const approxTokens = chunk.reduce((a, t) => a + Math.ceil(t.length / 4), 0);
      logCall('embed', {
        inputTokens: approxTokens, outputTokens: 0, latencyMs: Date.now() - t0,
        costUsd: priceOf(config.embedModel, approxTokens, 0), model: config.embedModel,
      }, true, runId);
      for (const e of json.embeddings ?? []) out.push(normalise(Float32Array.from(e.values)));
    }
    if (out.length !== texts.length) throw new Error('embedding API returned a short batch');
    return { vectors: out, provider: 'gemini' };
  } catch (e) {
    if (force === 'gemini') throw e; // caller demanded the API specifically
    const msg = String((e as Error)?.message ?? e);
    const terminal = /PerDay|per day|API_KEY|not set|API key/i.test(msg);
    if (!terminal) {
      // A transient rate limit: fall back for this batch only, and try the API again on
      // the next one rather than giving up on neural vectors for the whole run.
      return { vectors: localEmbedBatch(texts, config.embedDim), provider: 'local' };
    }
    if (!embeddingApiDown) {
      embeddingApiDown = true;
      console.warn(`  [embeddings] daily quota exhausted (${msg.slice(0, 120)})`);
      console.warn('  [embeddings] falling back to the local embedder for the rest of this run');
    }
    return { vectors: localEmbedBatch(texts, config.embedDim), provider: 'local' };
  }
}

/** Convenience wrapper for callers that do not care which provider was used. */
export async function embed(
  texts: string[],
  purpose: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  runId?: string
): Promise<Float32Array[]> {
  return (await embedWithProvider(texts, purpose, runId)).vectors;
}

export function normalise(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
