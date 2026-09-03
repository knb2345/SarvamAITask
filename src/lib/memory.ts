import { db, newId } from './db';
import { embedWithProvider, toBlob } from './gemini';
import type { Memory, MemoryKind } from './types';

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'was', 'it', 'that', 'this',
  'with', 'my', 'me', 'i', 'do', 'did', 'what', 'when', 'who', 'how', 'about', 'you', 'kivi', 'hey',
  'can', 'please', 'tell', 'were', 'be', 'been', 'at', 'by', 'from', 'as', 'if', 'then', 'so', 'we',
  'they', 'he', 'she', 'his', 'her', 'their', 'our', 'not', 'no', 'yes', 'all', 'any', 'some', 'get',
  'got', 'have', 'has', 'had', 'am', 'are', 'again', 'there', 'here',
]);

/** FTS5 MATCH is a query language, not a string. Reduce free text to safe OR-ed terms. */
export function ftsEscape(q: string): string {
  const terms = q.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const kept = terms.filter((t) => t.length > 1 && !STOP.has(t)).slice(0, 24);
  if (kept.length === 0) return '';
  return kept.map((t) => `"${t}"`).join(' OR ');
}

export function indexMemoryText(m: Memory) {
  const topics = (JSON.parse(m.topics_json) as string[]).join(' ');
  db().prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(m.id);
  db()
    .prepare('INSERT INTO memories_fts (memory_id, statement, subject, topics) VALUES (?,?,?,?)')
    .run(m.id, m.statement, m.subject ?? '', topics);
}

export function embeddingTextFor(m: { kind: string; statement: string; subject?: string | null }): string {
  return `${m.kind}: ${m.statement}${m.subject ? ` (about ${m.subject})` : ''}`;
}

/**
 * Vectors are an optimisation, not the source of truth: if the embedding service is
 * unavailable or out of quota, the memory is still written and still retrievable
 * lexically. `npm run reindex` fills in whatever is missing later.
 */
export async function indexMemoryVector(
  m: Memory,
  precomputed?: { vec: Float32Array; provider: string }
) {
  let v = precomputed?.vec;
  let provider = precomputed?.provider;
  if (!v) {
    try {
      const r = await embedWithProvider([embeddingTextFor(m)], 'RETRIEVAL_DOCUMENT');
      v = r.vectors[0];
      provider = r.provider;
    } catch {
      return;
    }
  }
  if (!v || !provider) return;
  db()
    .prepare('INSERT OR REPLACE INTO memory_embeddings (memory_id, dim, vec, provider) VALUES (?,?,?,?)')
    .run(m.id, v.length, toBlob(v), provider);
}

export function getMemory(id: string): Memory | undefined {
  return db().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | undefined;
}

export function evidenceFor(memoryId: string) {
  return db()
    .prepare(
      `SELECT e.dictation_id, e.quote, d.spoken_at, d.app, d.context_label
       FROM memory_evidence e JOIN dictations d ON d.id = e.dictation_id
       WHERE e.memory_id = ? ORDER BY d.spoken_at DESC`
    )
    .all(memoryId) as any[];
}

export function revisionsFor(memoryId: string) {
  return db()
    .prepare('SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY created_at, id')
    .all(memoryId) as any[];
}

export function recordRevision(
  memoryId: string,
  action: string,
  actor: 'system' | 'user',
  reason: string,
  before?: any,
  after?: any,
  dictationId?: string
) {
  db()
    .prepare(
      `INSERT INTO memory_revisions (memory_id, action, actor, before_json, after_json, reason, dictation_id)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      memoryId,
      action,
      actor,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      reason,
      dictationId ?? null
    );
}

export function addEvidence(memoryId: string, dictationId: string, quote: string) {
  db()
    .prepare('INSERT OR IGNORE INTO memory_evidence (memory_id, dictation_id, quote) VALUES (?,?,?)')
    .run(memoryId, dictationId, quote.slice(0, 600));
}

export type CreateMemoryInput = {
  userId: string;
  kind: MemoryKind;
  statement: string;
  subject?: string | null;
  topics?: string[];
  confidence: number;
  source?: Memory['source'];
  status?: Memory['status'];
  seenAt: string;
  validFrom?: string | null;
  supersedesId?: string | null;
};

export async function createMemory(
  input: CreateMemoryInput,
  evidence: { dictationId: string; quote: string }[],
  reason: string,
  actor: 'system' | 'user' = 'system',
  precomputedVec?: { vec: Float32Array; provider: string }
): Promise<Memory> {
  const id = newId('m');
  db()
    .prepare(
      `INSERT INTO memories (id, user_id, kind, statement, subject, topics_json, confidence, support_count,
          status, source, supersedes_id, valid_from, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id,
      input.userId,
      input.kind,
      input.statement,
      input.subject ?? null,
      JSON.stringify(input.topics ?? []),
      input.confidence,
      Math.max(1, evidence.length),
      input.status ?? 'active',
      input.source ?? 'inferred',
      input.supersedesId ?? null,
      input.validFrom ?? null,
      input.seenAt,
      input.seenAt
    );
  for (const e of evidence) addEvidence(id, e.dictationId, e.quote);
  const m = getMemory(id)!;
  indexMemoryText(m);
  await indexMemoryVector(m, precomputedVec);
  recordRevision(id, 'created', actor, reason, null, m, evidence[0]?.dictationId);
  return m;
}

export function reinforceMemory(
  m: Memory,
  dictationId: string,
  quote: string,
  seenAt: string,
  reason: string
): Memory {
  addEvidence(m.id, dictationId, quote);
  const support = db()
    .prepare('SELECT COUNT(*) c FROM memory_evidence WHERE memory_id = ?')
    .get(m.id) as any;
  const conf = Math.min(0.99, m.confidence + (1 - m.confidence) * 0.35);
  db()
    .prepare(
      `UPDATE memories SET support_count = ?, confidence = ?,
        last_seen_at = MAX(last_seen_at, ?), updated_at = datetime('now') WHERE id = ?`
    )
    .run(support.c, conf, seenAt, m.id);
  const after = getMemory(m.id)!;
  recordRevision(m.id, 'reinforced', 'system', reason, m, after, dictationId);
  return after;
}

export async function supersedeMemory(
  old: Memory,
  next: CreateMemoryInput,
  evidence: { dictationId: string; quote: string }[],
  reason: string,
  precomputedVec?: { vec: Float32Array; provider: string }
): Promise<Memory> {
  const created = await createMemory({ ...next, supersedesId: old.id }, evidence, reason, 'system', precomputedVec);
  db().prepare(`UPDATE memories SET status='superseded', updated_at=datetime('now') WHERE id = ?`).run(old.id);
  db().prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(old.id);
  recordRevision(
    old.id,
    'superseded',
    'system',
    `${reason} (replaced by ${created.id})`,
    old,
    getMemory(old.id),
    evidence[0]?.dictationId
  );
  return created;
}

export function forgetMemory(id: string, actor: 'system' | 'user', reason: string) {
  const before = getMemory(id);
  if (!before) return;
  db().prepare(`UPDATE memories SET status='forgotten', updated_at=datetime('now') WHERE id = ?`).run(id);
  db().prepare('DELETE FROM memories_fts WHERE memory_id = ?').run(id);
  db().prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(id);
  recordRevision(id, 'forgotten', actor, reason, before, getMemory(id));
}

export async function amendMemory(id: string, statement: string, actor: 'system' | 'user', reason: string) {
  const before = getMemory(id);
  if (!before) return;
  db()
    .prepare(
      `UPDATE memories SET statement=?, source='user_edited', confidence=MAX(confidence, 0.95),
         updated_at=datetime('now'), status='active' WHERE id=?`
    )
    .run(statement, id);
  const after = getMemory(id)!;
  indexMemoryText(after);
  await indexMemoryVector(after);
  recordRevision(id, 'amended', actor, reason, before, after);
}

export function confirmMemory(id: string, reason: string) {
  const before = getMemory(id);
  if (!before) return;
  db()
    .prepare(
      `UPDATE memories SET status='active', source='user_stated', confidence=0.98, updated_at=datetime('now') WHERE id=?`
    )
    .run(id);
  recordRevision(id, 'confirmed', 'user', reason, before, getMemory(id));
}
