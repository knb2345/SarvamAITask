import { db } from './db';

/**
 * The shape every generation backend speaks, and the ledger they all write to.
 *
 * Kept separate from the clients themselves so Gemini and Groq can be swapped without
 * either importing the other, and so cost and latency are recorded identically whichever
 * one served the request.
 */

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number;
  model: string;
};

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
  /** Force a specific backend for this call, overriding the configured default. */
  provider?: 'gemini' | 'groq';
  thinkingLevel?: string;
};

export function logModelCall(purpose: string, u: Usage, ok: boolean, runId?: string) {
  try {
    db()
      .prepare(
        `INSERT INTO model_calls (run_id, purpose, model, input_tokens, output_tokens, latency_ms, cost_usd, ok)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(runId ?? null, purpose, u.model, u.inputTokens, u.outputTokens, u.latencyMs, u.costUsd, ok ? 1 : 0);
  } catch {
    /* the ledger is best-effort; it must never break a request */
  }
}
