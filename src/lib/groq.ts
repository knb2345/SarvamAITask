import { config, priceOf } from './config';
import { logModelCall, type GenContent, type GenPart, type GenerateOpts, type Usage } from './llm-types';

/**
 * Groq as a generation backend.
 *
 * Kivi's memory design does not depend on any one model vendor, and relying on a single
 * free tier turned out to be the least reliable part of the whole system — a day's quota
 * would run out mid-ingest and leave the corpus half read. Groq speaks the OpenAI chat
 * shape, supports forced tool calls and JSON-schema output (the two things Hey Kivi and
 * the memory writer actually require), and answers in a fraction of the time.
 *
 * It has no embedding endpoint, so retrieval vectors still come from Gemini or the local
 * embedder. That split is deliberate and recorded in the model_calls ledger.
 */

const BASE = 'https://api.groq.com/openai/v1';

/** Same rotation as the Gemini client: a key that is out of quota gives way to another. */
let keyIndex = 0;
const retiredAt = new Map<number, number>();
const RETIRE_FOR_MS = 15 * 60 * 1000;

function currentKey(): string {
  const keys = config.groqKeys;
  return keys.length ? keys[Math.min(keyIndex, keys.length - 1)] : config.groqKey;
}

function rotate(): boolean {
  const keys = config.groqKeys;
  if (keys.length < 2) return false;
  retiredAt.set(keyIndex, Date.now());
  for (let i = 1; i <= keys.length; i++) {
    const candidate = (keyIndex + i) % keys.length;
    const at = retiredAt.get(candidate);
    if (at === undefined || Date.now() - at > RETIRE_FOR_MS) {
      retiredAt.delete(candidate);
      keyIndex = candidate;
      return true;
    }
  }
  return false;
}

/** Gemini's content shape is the internal one; this converts to and from OpenAI's. */
function toOpenAiMessages(system: string | undefined, contents: GenContent[]): any[] {
  const messages: any[] = [];
  if (system) messages.push({ role: 'system', content: system });

  for (const c of contents) {
    const calls = c.parts.filter((p) => p.functionCall);
    const responses = c.parts.filter((p) => p.functionResponse);
    const text = c.parts.filter((p) => p.text).map((p) => p.text).join('');

    if (responses.length) {
      for (const r of responses) {
        messages.push({
          role: 'tool',
          tool_call_id: r.functionResponse!.id || r.functionResponse!.name,
          content: JSON.stringify(r.functionResponse!.response).slice(0, 60_000),
        });
      }
      continue;
    }

    if (calls.length) {
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((p) => ({
          id: p.functionCall!.id || p.functionCall!.name,
          type: 'function',
          function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
        })),
      });
      continue;
    }

    messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content: text });
  }
  return messages;
}

function toOpenAiTools(tools: any[] | undefined): any[] | undefined {
  if (!tools) return undefined;
  const out: any[] = [];
  for (const group of tools) {
    for (const fn of group.functionDeclarations ?? []) {
      out.push({ type: 'function', function: { name: fn.name, description: fn.description, parameters: fn.parameters } });
    }
  }
  return out.length ? out : undefined;
}

async function post(url: string, body: unknown, tries = 5, budgetMs = 180_000): Promise<any> {
  let lastErr: unknown;
  const deadline = Date.now() + budgetMs;
  for (let i = 0; i < tries; i++) {
    if (Date.now() > deadline) break;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${currentKey()}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        // Another key is instant where waiting is not.
        if (res.status === 429 && rotate()) continue;
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        throw Object.assign(new Error(`http ${res.status}: ${text.slice(0, 300)}`), {
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60_000, retryAfter) : undefined,
        });
      }
      if (!res.ok) {
        const text = await res.text();
        // A malformed tool call is the model's output being wrong, not the request being
        // wrong: the same prompt usually succeeds on the next attempt. Retry those, and
        // only those, among the 4xx family.
        const modelMisbehaved = /parse tool call|tool call validation|json_validate|failed_generation/i.test(text);
        throw Object.assign(new Error(`http ${res.status}: ${text.slice(0, 300)}`), { fatal: !modelMisbehaved });
      }
      return await res.json();
    } catch (e: any) {
      lastErr = e;
      if (e?.fatal) break;
      const wait = Math.min(
        e?.retryAfterMs ?? Math.min(20_000, 800 * 2 ** i) + Math.random() * 400,
        Math.max(0, deadline - Date.now())
      );
      if (wait <= 0) break;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export async function groqGenerate(opts: GenerateOpts): Promise<{ parts: GenPart[]; text: string; usage: Usage }> {
  if (config.groqKeys.length === 0) throw new Error('GROQ_API_KEY is not set.');
  const model = opts.model || config.groqModel;

  const body: any = {
    model,
    messages: toOpenAiMessages(opts.system, opts.contents),
    temperature: opts.temperature ?? 0.2,
  };
  const tools = toOpenAiTools(opts.tools);
  if (tools) {
    body.tools = tools;
    // "required" is the same guarantee as Gemini's ANY: the model must answer through a
    // tool, so Hey Kivi cannot speak except by calling respond().
    if (opts.forceToolCall) body.tool_choice = 'required';
  }
  if (opts.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'result', schema: withoutUnsupportedKeywords(opts.jsonSchema) },
    };
  }

  const t0 = Date.now();
  let json: any;
  try {
    json = await post(`${BASE}/chat/completions`, body);
  } catch (e) {
    logModelCall(opts.purpose, { inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - t0, costUsd: 0, model }, false, opts.runId);
    throw e;
  }

  const latencyMs = Date.now() - t0;
  const u = json.usage ?? {};
  const inputTokens = u.prompt_tokens ?? 0;
  const outputTokens = u.completion_tokens ?? 0;
  const usage: Usage = { inputTokens, outputTokens, latencyMs, costUsd: priceOf(model, inputTokens, outputTokens), model };
  logModelCall(opts.purpose, usage, true, opts.runId);

  const message = json.choices?.[0]?.message ?? {};
  const parts: GenPart[] = [];
  if (message.content) parts.push({ text: message.content });
  for (const call of message.tool_calls ?? []) {
    let args: any = {};
    try {
      args = JSON.parse(call.function?.arguments || '{}');
    } catch {
      /* a malformed argument list is treated as an empty one */
    }
    parts.push({ functionCall: { name: call.function?.name, args, id: call.id } });
  }
  return { parts, text: message.content ?? '', usage };
}

/**
 * Groq's schema validator rejects a few JSON Schema keywords that Gemini accepts, and
 * requires objects to declare additionalProperties. Normalise rather than maintain two
 * copies of every schema.
 */
function withoutUnsupportedKeywords(schema: any): any {
  if (Array.isArray(schema)) return schema.map(withoutUnsupportedKeywords);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'propertyOrdering' || k === 'nullable') continue;
    out[k] = withoutUnsupportedKeywords(v);
  }
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  if (out.type === 'object' && out.properties && !out.required) out.required = Object.keys(out.properties);
  return out;
}
