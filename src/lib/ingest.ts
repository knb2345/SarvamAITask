import { config } from './config';
import { db, dbSizeBytes, ensureUser, newId } from './db';
import { embedWithProvider, generateJson, toBlob } from './gemini';
import { embeddingTextFor } from './memory';
import { RECONCILE_SCHEMA, RECONCILE_SYSTEM, extractBatch, prefilter, type ExtractionResult } from './extract';
import {
  createMemory,
  indexMemoryText,
  reinforceMemory,
  supersedeMemory,
} from './memory';
import { findSimilarMemories } from './retrieve';
import type { Candidate, Dictation } from './types';

export type RawRecord = {
  id?: string;
  spoken_at?: string;
  timestamp?: string;
  app?: string;
  context_label?: string;
  style?: string;
  duration_ms?: number;
  raw_asr?: string;
  asr?: string;
  formatted?: string;
  formatted_output?: string;
  text?: string;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
};

/**
 * Import format tolerance: the corpus we ship uses the canonical field names, but an
 * external corpus is allowed to use the common aliases below. Anything we do not
 * recognise is preserved verbatim in metadata_json.
 */
export function normaliseRecord(r: RawRecord, userId: string, index: number): Dictation {
  const raw = (r.raw_asr ?? r.asr ?? r.text ?? '') as string;
  const formatted = (r.formatted ?? r.formatted_output ?? r.text ?? raw) as string;
  const spokenAt = new Date((r.spoken_at ?? r.timestamp ?? new Date().toISOString()) as string).toISOString();
  const known = new Set([
    'id', 'spoken_at', 'timestamp', 'app', 'context_label', 'style', 'duration_ms',
    'raw_asr', 'asr', 'formatted', 'formatted_output', 'text', 'metadata',
  ]);
  const extra: Record<string, unknown> = { ...(r.metadata ?? {}) };
  for (const [k, v] of Object.entries(r)) if (!known.has(k)) extra[k] = v;

  return {
    id: (r.id as string) || `d_${String(index).padStart(5, '0')}`,
    user_id: userId,
    spoken_at: spokenAt,
    app: (r.app as string) ?? null,
    context_label: (r.context_label as string) ?? null,
    style: (r.style as string) ?? null,
    duration_ms: (r.duration_ms as number) ?? null,
    raw_asr: raw,
    formatted,
    metadata_json: JSON.stringify(extra),
  };
}

/**
 * Upsert, never INSERT OR REPLACE.
 *
 * REPLACE deletes the existing row before inserting the new one, and every table that
 * references a dictation cascades on delete — so re-running the importer over a corpus
 * it had already read silently destroyed the provenance of every memory learned from it,
 * along with the record of what had been refused. A memory that cannot show the sentence
 * behind it is exactly what this product promises never to keep.
 */
export function insertDictation(d: Dictation) {
  db()
    .prepare(
      `INSERT INTO dictations
        (id, user_id, spoken_at, app, context_label, style, duration_ms, raw_asr, formatted, metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         spoken_at = excluded.spoken_at,
         app = excluded.app,
         context_label = excluded.context_label,
         style = excluded.style,
         duration_ms = excluded.duration_ms,
         raw_asr = excluded.raw_asr,
         formatted = excluded.formatted,
         metadata_json = excluded.metadata_json`
    )
    .run(d.id, d.user_id, d.spoken_at, d.app, d.context_label, d.style, d.duration_ms, d.raw_asr, d.formatted, d.metadata_json);
  db().prepare('DELETE FROM dictations_fts WHERE dictation_id = ?').run(d.id);
  db()
    .prepare('INSERT INTO dictations_fts (dictation_id, formatted, raw_asr, context_label) VALUES (?,?,?,?)')
    .run(d.id, d.formatted, d.raw_asr, d.context_label ?? '');
}

function decision(runId: string, dictationId: string, candidate: unknown, kind: string, reason: string, memoryId?: string) {
  db()
    .prepare(
      `INSERT INTO extraction_decisions (run_id, dictation_id, candidate_json, decision, memory_id, reason)
       VALUES (?,?,?,?,?,?)`
    )
    .run(runId, dictationId, JSON.stringify(candidate), kind, memoryId ?? null, reason);
}

export type IngestProgress = (done: number, total: number, note: string) => void;

export type IngestStats = {
  runId: string;
  dictations: number;
  skipped: number;
  created: number;
  reinforced: number;
  superseded: number;
  rejected: number;
  episodes: number;
  personal: number;
  resumedSkipped: number;
  errors: number;
  extractionMs: number;
  reconcileMs: number;
  totalMs: number;
  dbBytesBefore: number;
  dbBytesAfter: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

export type IngestOptions = {
  /**
   * Slides every timestamp forward so the newest dictation lands yesterday evening.
   * The committed corpus has fixed dates for reproducibility; this keeps phrases like
   * "the message I sent yesterday" meaningful whenever the demo is actually run.
   * The shift is uniform, so every interval in the history is preserved exactly.
   */
  shiftToToday?: boolean;
};

export async function ingest(
  records: RawRecord[],
  userId: string,
  onProgress?: IngestProgress,
  options: IngestOptions = {}
): Promise<IngestStats> {
  ensureUser(userId);
  const runId = newId('run');
  const t0 = Date.now();
  const dbBefore = dbSizeBytes();
  db()
    .prepare('INSERT INTO ingest_runs (id, user_id, started_at, dictation_count) VALUES (?,?,?,?)')
    .run(runId, userId, new Date().toISOString(), records.length);

  // Resumability: a run that died half way (a quota wall, a dropped connection) can be
  // restarted with the same command. Anything already decided is left alone.
  // A record only counts as processed if something was actually decided about it.
  // Records whose extraction failed (quota, network) must be retried, not skipped
  // forever, so failures are excluded here.
  const alreadyProcessed = new Set(
    (db()
      .prepare(
        `SELECT DISTINCT dictation_id FROM extraction_decisions
         WHERE reason NOT LIKE 'extraction failed%' AND reason NOT LIKE 'reconciliation failed%'`
      )
      .all() as any[]).map((r) => r.dictation_id)
  );
  // Clear the old failure rows so a retried record starts from a clean slate.
  db()
    .prepare(`DELETE FROM extraction_decisions WHERE reason LIKE 'extraction failed%' OR reason LIKE 'reconciliation failed%'`)
    .run();

  const dictations = records.map((r, i) => normaliseRecord(r, userId, i));
  dictations.sort((a, b) => a.spoken_at.localeCompare(b.spoken_at)); // memory is built in time order

  if (options.shiftToToday && dictations.length) {
    const newest = Date.parse(dictations[dictations.length - 1].spoken_at);
    const target = new Date();
    target.setUTCDate(target.getUTCDate() - 1);
    target.setUTCHours(18, 0, 0, 0);
    const delta = target.getTime() - newest;
    if (delta > 0) {
      for (const d of dictations) d.spoken_at = new Date(Date.parse(d.spoken_at) + delta).toISOString();
    }
  }

  const insertAll = db().transaction((ds: Dictation[]) => {
    for (const d of ds) insertDictation(d);
  });
  insertAll(dictations);

  const stats: IngestStats = {
    runId, dictations: dictations.length, skipped: 0, created: 0, reinforced: 0, superseded: 0,
    rejected: 0, episodes: 0, personal: 0, resumedSkipped: 0, errors: 0, extractionMs: 0, reconcileMs: 0, totalMs: 0,
    dbBytesBefore: dbBefore, dbBytesAfter: 0, costUsd: 0, inputTokens: 0, outputTokens: 0,
  };

  // Dictation vectors, batched.
  onProgress?.(0, dictations.length, 'embedding dictations');
  for (let i = 0; i < dictations.length; i += 64) {
    const chunk = dictations.slice(i, i + 64);
    let vecs: Float32Array[] = [];
    let vecProvider = 'local';
    try {
      const r = await embedWithProvider(
        chunk.map((d) => `${d.app ?? ''} ${d.context_label ?? ''}\n${d.formatted}`),
        'RETRIEVAL_DOCUMENT',
        runId
      );
      vecs = r.vectors;
      vecProvider = r.provider;
    } catch {
      // Dense retrieval degrades to lexical rather than failing the whole import.
      // `npm run reindex` backfills the missing vectors afterwards.
      stats.errors++;
    }
    const put = db().transaction(() => {
      chunk.forEach((d, j) => {
        const v = vecs[j];
        if (v) {
          db()
            .prepare('INSERT OR REPLACE INTO dictation_embeddings (dictation_id, dim, vec, provider) VALUES (?,?,?,?)')
            .run(d.id, v.length, toBlob(v), vecProvider);
        }
      });
    });
    put();
    onProgress?.(Math.min(i + 64, dictations.length), dictations.length, 'embedding dictations');
  }

  // Phase 1 — extraction. Independent per dictation, so it runs concurrently.
  const extracted = new Map<string, ExtractionResult>();
  const tExtract = Date.now();

  // The prefilter is free; run it first so we never spend a model call on "ok thanks".
  const worthReading: Dictation[] = [];
  for (const d of dictations) {
    if (alreadyProcessed.has(d.id)) {
      stats.resumedSkipped++;
      continue;
    }
    const skip = prefilter(d);
    if (skip) {
      decision(runId, d.id, { text: d.formatted.slice(0, 200) }, 'skipped', skip);
      stats.skipped++;
    } else {
      worthReading.push(d);
    }
  }

  const batches: Dictation[][] = [];
  for (let i = 0; i < worthReading.length; i += EXTRACT_BATCH) {
    batches.push(worthReading.slice(i, i + EXTRACT_BATCH));
  }

  let done = 0;
  const queue = [...batches];
  const workers = Array.from({ length: Math.max(1, config.concurrency) }, async () => {
    for (;;) {
      const batch = queue.shift();
      if (!batch) return;
      try {
        const results = await extractBatch(batch, runId);
        for (const [id, r] of results) extracted.set(id, r);
        for (const d of batch) {
          if (!results.has(d.id)) {
            decision(runId, d.id, { text: d.formatted.slice(0, 200) }, 'skipped', 'the model returned no result for this record in its batch');
            stats.skipped++;
          }
        }
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 200);
        for (const d of batch) {
          decision(runId, d.id, { error: msg }, 'skipped', `extraction failed: ${msg}`);
          stats.skipped++;
        }
      }
      done += batch.length;
      onProgress?.(done, worthReading.length, 'reading dictations');
    }
  });
  await Promise.all(workers);
  stats.extractionMs = Date.now() - tExtract;

  // Phase 2a — every vector phase 2 will need, computed in batches of 64 rather than
  // one HTTP round trip per memory. This is the difference between ~15 embedding calls
  // and ~900 for a 500-record corpus.
  const tRec = Date.now();
  const vectorKeys: string[] = [];
  const vectorTexts: string[] = [];
  for (const d of dictations) {
    const res = extracted.get(d.id);
    if (!res) continue;
    if (res.episode?.summary) {
      vectorKeys.push(`ep:${d.id}`);
      vectorTexts.push(embeddingTextFor({ kind: 'episode', statement: res.episode.summary, subject: res.episode.subject ?? d.app }));
    }
    res.memories.forEach((c, i) => {
      vectorKeys.push(`c:${d.id}:${i}`);
      vectorTexts.push(embeddingTextFor({ kind: c.kind, statement: c.statement, subject: c.subject }));
    });
  }

  const vectors = new Map<string, { vec: Float32Array; provider: string }>();
  for (let i = 0; i < vectorTexts.length; i += 64) {
    onProgress?.(i, vectorTexts.length, 'embedding memories');
    try {
      const r = await embedWithProvider(vectorTexts.slice(i, i + 64), 'RETRIEVAL_DOCUMENT', runId);
      r.vectors.forEach((v, j) => vectors.set(vectorKeys[i + j], { vec: v, provider: r.provider }));
    } catch {
      // Cannot happen with the local fallback in play, but if it does the memories are
      // still written and stay lexically searchable; `npm run reindex` backfills.
      stats.errors++;
    }
  }

  // Phase 2b — reconciliation, strictly in chronological order so that later
  // dictations can supersede earlier ones and the audit trail reads like a history.
  let recDone = 0;
  for (const d of dictations) {
    const res = extracted.get(d.id);
    recDone++;
    onProgress?.(recDone, dictations.length, 'updating memory');
    if (!res) continue;

    // Episodes: exactly one per dictation, never merged. This is the index over "what happened".
    try {
    if (res.sensitivity === 'personal') {
      db()
        .prepare(`UPDATE dictations SET sensitivity = 'personal', sensitivity_reason = ? WHERE id = ?`)
        .run(res.sensitivity_reason ?? 'recognised as personal rather than working material', d.id);
      decision(
        runId, d.id, { sensitivity: 'personal' }, 'rejected',
        `personal, not working material: ${res.sensitivity_reason ?? 'no memory written and Hey Kivi will not retrieve it'}`
      );
      stats.personal++;
      continue;
    }
    db().prepare(`UPDATE dictations SET sensitivity = 'work' WHERE id = ?`).run(d.id);

    if (res.episode?.summary) {
      const ep = await createMemory(
        {
          userId,
          kind: 'episode',
          statement: res.episode.summary,
          subject: res.episode.subject ?? d.app ?? null,
          topics: res.episode.topics ?? [],
          confidence: 0.95,
          seenAt: d.spoken_at,
          validFrom: d.spoken_at,
        },
        [{ dictationId: d.id, quote: d.formatted.slice(0, 400) }],
        'one episode is recorded for every dictation that passes the prefilter',
        'system',
        vectors.get(`ep:${d.id}`)
      );
      decision(runId, d.id, res.episode, 'created', 'episode index entry', ep.id);
      stats.episodes++;
    }

    for (let i = 0; i < res.memories.length; i++) {
      await reconcileCandidate(res.memories[i], d, userId, runId, stats, vectors.get(`c:${d.id}:${i}`));
    }
    for (const ig of res.ignored ?? []) {
      decision(runId, d.id, ig, 'rejected', ig.reason);
      stats.rejected++;
    }
    } catch (e: any) {
      // One bad record must not cost the whole run.
      const msg = String(e?.message ?? e).slice(0, 200);
      decision(runId, d.id, { error: msg }, 'skipped', `reconciliation failed: ${msg}`);
      stats.errors++;
    }
  }
  stats.reconcileMs = Date.now() - tRec;
  stats.totalMs = Date.now() - t0;
  stats.dbBytesAfter = dbSizeBytes();

  const usage = db()
    .prepare(`SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(cost_usd),0) c
              FROM model_calls WHERE run_id = ?`)
    .get(runId) as any;
  stats.inputTokens = usage.i;
  stats.outputTokens = usage.o;
  stats.costUsd = usage.c;

  db()
    .prepare(`UPDATE ingest_runs SET finished_at = ?, stats_json = ? WHERE id = ?`)
    .run(new Date().toISOString(), JSON.stringify(stats), runId);
  return stats;
}

const EXTRACT_BATCH = Number(process.env.KIVI_EXTRACT_BATCH || 5);

/**
 * Duplicate-detection thresholds, per embedding provider.
 *
 * Neural embeddings put paraphrases very close together, so the bar is high. The local
 * hashing embedder scores lexical overlap rather than meaning, so the same pair of
 * sentences lands much lower; using the neural thresholds with it would mean never
 * merging anything. Both are set to prefer "create" over a wrong merge: an extra memory
 * is visible and deletable, a wrongly merged one is a silent error.
 */
const THRESHOLDS: Record<string, { same: number; near: number }> = {
  gemini: { same: 0.93, near: 0.78 },
  local: { same: 0.78, near: 0.45 },
};

async function reconcileCandidate(c: Candidate, d: Dictation, userId: string, runId: string, stats: IngestStats, vec?: { vec: Float32Array; provider: string }) {
  let cvec = vec;
  if (!cvec) {
    try {
      const r = await embedWithProvider(
        [embeddingTextFor({ kind: c.kind, statement: c.statement, subject: c.subject })],
        'RETRIEVAL_DOCUMENT',
        runId
      );
      cvec = { vec: r.vectors[0], provider: r.provider };
    } catch {
      cvec = undefined; // no vector: we cannot dedup, so we record that and keep going
    }
  }
  const similar = await findSimilarMemories(
    userId,
    c.kind,
    cvec?.vec,
    3,
    embeddingTextFor({ kind: c.kind, statement: c.statement, subject: c.subject }),
    cvec?.provider
  );
  const { same: SAME_THRESHOLD, near: NEAR_THRESHOLD } =
    THRESHOLDS[cvec?.provider ?? 'local'] ?? THRESHOLDS.local;

  const top = similar[0];
  if (top && top.similarity >= SAME_THRESHOLD) {
    reinforceMemory(top.memory, d.id, c.quote, d.spoken_at, `restated in ${d.id} (similarity ${top.similarity.toFixed(3)})`);
    decision(runId, d.id, c, 'merged', `identical to an existing memory (cosine ${top.similarity.toFixed(3)}); evidence added, confidence raised`, top.memory.id);
    stats.reinforced++;
    return;
  }

  /*
   * Adjudicate the closest few candidates, not just the single closest.
   *
   * "The V2 launch date is locked for November 14th" and "the V2 launch date is
   * December 5th" cannot both be true, but the older one came back third in the
   * lexical ranking behind two episodes about the same subject. Judging only the top
   * candidate left both facts active — the exact failure this step exists to prevent.
   * So every candidate with real signal gets compared, cheapest first, stopping as soon
   * as one is decided.
   */
  const worthAdjudicating = similar
    .slice(0, 3)
    .filter((s) => s.similarity >= NEAR_THRESHOLD || s.lexical >= 0.2);

  for (const cand of worthAdjudicating) {
    let relation = 'distinct';
    let reason = 'model adjudication unavailable; kept both';
    let merged: string | undefined;
    try {
      const { value } = await generateJson<{ relation: string; reason: string; merged_statement?: string }>({
        system: RECONCILE_SYSTEM,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `EXISTING (${cand.memory.kind}, first seen ${cand.memory.first_seen_at}, last seen ${cand.memory.last_seen_at}):
${cand.memory.statement}

NEW CANDIDATE (from a dictation on ${d.spoken_at}):
${c.statement}
Supporting quote: "${c.quote}"`,
              },
            ],
          },
        ],
        jsonSchema: RECONCILE_SCHEMA as any,
        temperature: 0,
        purpose: 'reconcile',
        runId,
      });
      relation = value.relation;
      reason = value.reason;
      merged = value.merged_statement;
    } catch {
      break; // cannot adjudicate right now; fall through and record it as new
    }

    const scores = `cosine ${cand.similarity.toFixed(3)}, lexical ${cand.lexical.toFixed(2)}`;

    if (relation === 'same') {
      reinforceMemory(cand.memory, d.id, c.quote, d.spoken_at, reason);
      if (merged && merged !== cand.memory.statement) {
        db().prepare(`UPDATE memories SET statement = ? WHERE id = ?`).run(merged, cand.memory.id);
        indexMemoryText({ ...cand.memory, statement: merged } as any);
      }
      decision(runId, d.id, c, 'merged', `${reason} (${scores})`, cand.memory.id);
      stats.reinforced++;
      return;
    }

    if (relation === 'update') {
      const replacement = await supersedeMemory(
        cand.memory,
        {
          userId, kind: c.kind, statement: c.statement, subject: c.subject ?? null,
          topics: c.topics ?? [], confidence: c.confidence, seenAt: d.spoken_at,
          validFrom: c.valid_from ?? d.spoken_at,
        },
        [{ dictationId: d.id, quote: c.quote }],
        reason,
        cvec
      );
      decision(runId, d.id, c, 'superseded', `${reason} (${scores}; replaces ${cand.memory.id})`, replacement.id);
      stats.superseded++;
      return;
    }
  }

  const created = await createMemory(
    {
      userId, kind: c.kind, statement: c.statement, subject: c.subject ?? null,
      topics: c.topics ?? [], confidence: c.confidence, seenAt: d.spoken_at,
      validFrom: c.valid_from ?? d.spoken_at,
    },
    [{ dictationId: d.id, quote: c.quote }],
    top
      ? `${worthAdjudicating.length} candidate(s) compared and judged distinct (best cosine ${top.similarity.toFixed(3)}, lexical ${top.lexical.toFixed(2)})`
      : cvec
        ? 'no existing memory of this kind to compare against'
        : 'stored without a vector (embeddings unavailable); duplicate check was skipped',
    'system',
    cvec
  );
  decision(runId, d.id, c, 'created', `new ${c.kind} recorded from ${d.id}`, created.id);
  stats.created++;
}
