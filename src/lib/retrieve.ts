import { db } from './db';
import { config } from './config';
import { cosine, embedWithProvider, fromBlob } from './gemini';
import { evidenceFor, ftsEscape } from './memory';
import type { Memory, ScoredDictation, ScoredMemory } from './types';

/**
 * Hybrid retrieval: dense (Gemini embeddings, cosine) fused with lexical (SQLite FTS5, bm25)
 * by reciprocal rank fusion, then nudged by memory strength and recency.
 *
 * Everything here returns its own component scores so the trace can show an engineer
 * exactly why a memory was or was not in the model's context.
 */

const RRF_K = 60;

/**
 * Which embedders built this database.
 *
 * A database can legitimately hold vectors from more than one provider: a run that meets
 * a rate limit falls back for a batch and returns to the API afterwards. Cosine scores
 * from two providers are not comparable - but ranks are, and fusion here is by rank. So
 * each space is searched on its own and the rankings are fused, rather than pretending
 * one number means the same thing in both.
 */
/**
 * The rarest terms in a query, by document frequency in the memory index.
 *
 * A whole question carries its own noise: "when does merchant onboarding V2 launch"
 * contains two terms that appear in hundreds of memories and two that appear in a
 * handful. Ranked on every term at once, the common ones win and the precise memory is
 * buried. So the distinctive terms are also searched on their own, and the two rankings
 * are fused — which makes a long spoken question behave like the keyword query a person
 * would have typed.
 */
function rareTerms(query: string, keep = 5): string[] {
  const terms = [...new Set((ftsEscape(query).match(/"([a-z0-9]+)"/g) ?? []).map((t) => t.replace(/"/g, '')))];
  if (terms.length <= 1) return [];
  const total = (db().prepare('SELECT COUNT(*) c FROM memories_fts').get() as any).c || 1;
  const count = db().prepare('SELECT COUNT(*) c FROM memories_fts WHERE memories_fts MATCH ?');
  const scored = terms.map((t) => {
    try {
      return { term: t, df: (count.get(`"${t}"`) as any).c };
    } catch {
      return { term: t, df: total };
    }
  });
  // Keep only terms that actually discriminate: present, but in a small share of the
  // index. A term in a third of all memories tells you nothing about which one is meant.
  const ceiling = Math.max(10, Math.round(total * 0.05));
  const distinctive = scored.filter((x) => x.df > 0 && x.df <= ceiling);
  if (distinctive.length === 0 || distinctive.length === terms.length) return [];
  return distinctive.sort((a, b) => a.df - b.df).slice(0, keep).map((x) => x.term);
}

export function storedProviders(table: 'memory_embeddings' | 'dictation_embeddings'): ('gemini' | 'local')[] {
  return (db()
    .prepare(`SELECT provider, COUNT(*) c FROM ${table} GROUP BY provider ORDER BY c DESC`)
    .all() as any[]).map((r) => r.provider);
}

export function storedProvider(table: 'memory_embeddings' | 'dictation_embeddings'): 'gemini' | 'local' | null {
  return storedProviders(table)[0] ?? null;
}

function rrf(rank: number): number {
  return 1 / (RRF_K + rank);
}

export type MemorySearchOpts = {
  userId: string;
  query: string;
  kinds?: string[];
  limit?: number;
  since?: string | null;
  until?: string | null;
  includeInactive?: boolean;
};

export async function searchMemories(opts: MemorySearchOpts): Promise<ScoredMemory[]> {
  const limit = opts.limit ?? 12;
  const statusClause = opts.includeInactive ? '' : `AND m.status = 'active'`;
  const kinds = opts.kinds?.length ? opts.kinds : null;

  const params: any[] = [opts.userId];
  let where = `m.user_id = ? ${statusClause}`;
  if (kinds) {
    where += ` AND m.kind IN (${kinds.map(() => '?').join(',')})`;
    params.push(...kinds);
  }
  if (opts.since) {
    where += ' AND m.last_seen_at >= ?';
    params.push(opts.since);
  }
  if (opts.until) {
    where += ' AND m.first_seen_at <= ?';
    params.push(opts.until);
  }

  const pool = db().prepare(`SELECT m.* FROM memories m WHERE ${where}`).all(...params) as Memory[];
  if (pool.length === 0) return [];
  const allowed = new Set(pool.map((m) => m.id));

  // Dense - one ranking per embedding space present, fused below by rank.
  const vecRankings: { id: string; score: number }[][] = [];
  for (const provider of storedProviders('memory_embeddings')) {
    try {
      const [qv] = (await embedWithProvider([opts.query], 'RETRIEVAL_QUERY', undefined, provider)).vectors;
      if (!qv) continue;
      const rows = db()
        .prepare('SELECT memory_id, vec FROM memory_embeddings WHERE provider = ?')
        .all(provider) as any[];
      vecRankings.push(
        rows
          .filter((r) => allowed.has(r.memory_id))
          .map((r) => ({ id: r.memory_id, score: cosine(qv, fromBlob(r.vec)) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 60)
      );
    } catch {
      // Dense retrieval is best-effort; lexical still answers.
    }
  }

  // Lexical — the whole query, and again on just its most distinctive terms.
  const lexRankings: { id: string; score: number }[][] = [];
  const runFts = (match: string) => {
    if (!match) return;
    const rows = db()
      .prepare(
        `SELECT memory_id, bm25(memories_fts, 0.0, 1.0, 0.6, 0.4) AS b
         FROM memories_fts WHERE memories_fts MATCH ? ORDER BY b LIMIT 60`
      )
      .all(match) as any[];
    lexRankings.push(rows.filter((r) => allowed.has(r.memory_id)).map((r) => ({ id: r.memory_id, score: -r.b })));
  };
  // A spoken question carries filler the person would never type. Where it contains
  // terms that actually discriminate, search on those; a term appearing in a third of
  // all memories cannot tell you which memory is meant, and including it lets the
  // commonplace outrank the exact answer.
  const rare = rareTerms(opts.query);
  runFts(rare.length ? rare.map((t) => `"${t}"`).join(' OR ') : ftsEscape(opts.query));
  const bmRanked = lexRankings[0] ?? [];

  // Best rank a memory reached in any embedding space, with its score there.
  const vecRank = new Map<string, number>();
  const vecScore = new Map<string, number>();
  for (const ranking of vecRankings) {
    ranking.forEach((r, i) => {
      if (!vecRank.has(r.id) || i + 1 < vecRank.get(r.id)!) {
        vecRank.set(r.id, i + 1);
        vecScore.set(r.id, r.score);
      }
    });
  }
  const bmRank = new Map<string, number>();
  const bmScore = new Map<string, number>();
  for (const ranking of lexRankings) {
    ranking.forEach((r, i) => {
      if (!bmRank.has(r.id) || i + 1 < bmRank.get(r.id)!) {
        bmRank.set(r.id, i + 1);
        bmScore.set(r.id, r.score);
      }
    });
  }

  const now = Date.now();
  const scored = pool
    .filter((m) => vecRank.has(m.id) || bmRank.has(m.id))
    .map((m) => {
      const base = (vecRank.has(m.id) ? rrf(vecRank.get(m.id)!) : 0) + (bmRank.has(m.id) ? rrf(bmRank.get(m.id)!) : 0);
      // Normalise RRF into a friendlier 0..1-ish band, then apply strength and recency.
      const fused = base / (2 * rrf(1));
      const strength = 0.85 + 0.15 * Math.min(1, m.support_count / 4);
      const ageDays = Math.max(0, (now - Date.parse(m.last_seen_at)) / 86_400_000);
      const recency = m.kind === 'episode' ? 0.75 + 0.25 * Math.exp(-ageDays / 45) : 1;
      const conf = 0.7 + 0.3 * m.confidence;
      // A fact or a stated preference is a claim about what is true; an episode is an
      // index entry saying something happened. At equal relevance, prefer the claim.
      const kindWeight = m.kind === 'episode' ? 0.85 : 1.0;
      return {
        ...m,
        score: fused * strength * recency * conf * kindWeight,
        vec_score: vecScore.get(m.id) ?? 0,
        bm25_score: bmScore.get(m.id) ?? 0,
        evidence: [] as any[],
      };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = opts.kinds?.length ? scored.slice(0, limit) : quotaByKind(scored, limit);
  for (const m of chosen) m.evidence = evidenceFor(m.id).slice(0, 3);
  return chosen;
}

/**
 * Guarantee each kind of memory a place in the result.
 *
 * There is one episode per dictation and only a few hundred facts, so a flat ranking is
 * won by whichever kind is most numerous: ask "when does V2 launch" and you get twenty
 * episodes that mention merchant onboarding, while the one fact carrying the date never
 * surfaces. The kinds answer different questions — a fact states what is true, an episode
 * says what happened — so each is given its own share of the context and they compete
 * within their kind, not against each other.
 */
function quotaByKind(scored: ScoredMemory[], limit: number): ScoredMemory[] {
  const quotas: Record<string, number> = {
    fact: Math.max(3, Math.round(limit * 0.45)),
    preference: Math.max(2, Math.round(limit * 0.2)),
    episode: Math.max(3, Math.round(limit * 0.35)),
  };
  const taken: ScoredMemory[] = [];
  const used = new Set<string>();
  for (const kind of ['fact', 'preference', 'episode']) {
    for (const m of scored.filter((x) => x.kind === kind).slice(0, quotas[kind])) {
      taken.push(m);
      used.add(m.id);
    }
  }
  // Any unused room goes to whatever scored highest overall.
  for (const m of scored) {
    if (taken.length >= limit) break;
    if (!used.has(m.id)) {
      taken.push(m);
      used.add(m.id);
    }
  }
  return taken.sort((a, b) => b.score - a.score).slice(0, limit);
}

export type DictationSearchOpts = {
  userId: string;
  query?: string;
  app?: string | null;
  since?: string | null;
  until?: string | null;
  limit?: number;
};

export async function searchDictations(opts: DictationSearchOpts): Promise<ScoredDictation[]> {
  const limit = opts.limit ?? 10;
  const params: any[] = [opts.userId];
  // Personal dictations are excluded from every Hey Kivi lookup. The person can still
  // read them in their own history; Kivi just does not use them.
  let where = `user_id = ? AND (sensitivity IS NULL OR sensitivity != 'personal')`;
  if (opts.app) {
    where += ' AND lower(app) = lower(?)';
    params.push(opts.app);
  }
  if (opts.since) {
    where += ' AND spoken_at >= ?';
    params.push(opts.since);
  }
  if (opts.until) {
    where += ' AND spoken_at <= ?';
    params.push(opts.until);
  }
  const pool = db().prepare(`SELECT * FROM dictations WHERE ${where}`).all(...params) as any[];
  if (pool.length === 0) return [];

  // No query text: this is a pure time/app lookup ("what did I dictate yesterday in Slack").
  if (!opts.query || !opts.query.trim()) {
    return pool
      .sort((a, b) => b.spoken_at.localeCompare(a.spoken_at))
      .slice(0, limit)
      .map((d) => ({ ...d, score: 1, vec_score: 0, bm25_score: 0 }));
  }

  const allowed = new Set(pool.map((d) => d.id));
  const vecRankings: { id: string; score: number }[][] = [];
  for (const provider of storedProviders('dictation_embeddings')) {
    try {
      const [qv] = (await embedWithProvider([opts.query], 'RETRIEVAL_QUERY', undefined, provider)).vectors;
      if (!qv) continue;
      const rows = db()
        .prepare('SELECT dictation_id, vec FROM dictation_embeddings WHERE provider = ?')
        .all(provider) as any[];
      vecRankings.push(
        rows
          .filter((r) => allowed.has(r.dictation_id))
          .map((r) => ({ id: r.dictation_id, score: cosine(qv, fromBlob(r.vec)) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 60)
      );
    } catch {
      /* lexical fallback */
    }
  }

  const match = ftsEscape(opts.query);
  let bmRanked: { id: string; score: number }[] = [];
  if (match) {
    const rows = db()
      .prepare(
        `SELECT dictation_id, bm25(dictations_fts, 0.0, 1.0, 0.5, 0.7) AS b
         FROM dictations_fts WHERE dictations_fts MATCH ? ORDER BY b LIMIT 80`
      )
      .all(match) as any[];
    bmRanked = rows.filter((r) => allowed.has(r.dictation_id)).map((r) => ({ id: r.dictation_id, score: -r.b }));
  }

  const vecRank = new Map<string, number>();
  const vecScore = new Map<string, number>();
  for (const ranking of vecRankings) {
    ranking.forEach((r, i) => {
      if (!vecRank.has(r.id) || i + 1 < vecRank.get(r.id)!) {
        vecRank.set(r.id, i + 1);
        vecScore.set(r.id, r.score);
      }
    });
  }
  const bmRank = new Map(bmRanked.map((r, i) => [r.id, i + 1]));
  const bmScore = new Map(bmRanked.map((r) => [r.id, r.score]));

  const byId = new Map(pool.map((d) => [d.id, d]));
  const ids = new Set([...vecRank.keys(), ...bmRank.keys()]);
  return [...ids]
    .map((id) => {
      const d = byId.get(id)!;
      const fused =
        ((vecRank.has(id) ? rrf(vecRank.get(id)!) : 0) + (bmRank.has(id) ? rrf(bmRank.get(id)!) : 0)) / (2 * rrf(1));
      return { ...d, score: fused, vec_score: vecScore.get(id) ?? 0, bm25_score: bmScore.get(id) ?? 0 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Near-duplicate lookup used by the writer, not the reader.
 *
 * This is hybrid for the same reason reading is: a dense-only writer misses contradictions
 * whenever the embedder is weak on paraphrase, and a missed contradiction means two
 * memories that cannot both be true stay active at once — the worst failure this product
 * has. So candidates come from the vector neighbourhood UNION the lexical neighbourhood,
 * and a strong lexical match is enough to earn an adjudication even when cosine is low.
 */
export async function findSimilarMemories(
  userId: string,
  kind: string,
  vec: Float32Array | undefined,
  topK = 5,
  statement?: string,
  provider?: string
): Promise<{ memory: Memory; similarity: number; lexical: number }[]> {
  const pool = db()
    .prepare(`SELECT * FROM memories WHERE user_id = ? AND kind = ? AND status = 'active'`)
    .all(userId, kind) as Memory[];
  if (pool.length === 0) return [];
  const byId = new Map(pool.map((m) => [m.id, m]));

  const similarity = new Map<string, number>();
  if (vec) {
    // A candidate is only ever compared inside its own embedding space.
    const vecs = db()
      .prepare('SELECT memory_id, vec FROM memory_embeddings WHERE provider = ?')
      .all(provider ?? storedProvider('memory_embeddings') ?? 'local') as any[];
    for (const r of vecs) {
      if (byId.has(r.memory_id)) similarity.set(r.memory_id, cosine(vec, fromBlob(r.vec)));
    }
  }

  const lexical = new Map<string, number>();
  if (statement) {
    const match = ftsEscape(statement);
    if (match) {
      const rows = db()
        .prepare(
          `SELECT memory_id, bm25(memories_fts, 0.0, 1.0, 0.6, 0.4) AS b
           FROM memories_fts WHERE memories_fts MATCH ? ORDER BY b LIMIT 10`
        )
        .all(match) as any[];
      // Rank-normalised: 1.0 for the best lexical match, decaying down the list.
      rows.forEach((r, i) => {
        if (byId.has(r.memory_id)) lexical.set(r.memory_id, 1 / (1 + i));
      });
    }
  }

  const ids = new Set([...similarity.keys(), ...lexical.keys()]);
  return [...ids]
    .map((id) => ({
      memory: byId.get(id)!,
      similarity: similarity.get(id) ?? 0,
      lexical: lexical.get(id) ?? 0,
    }))
    .sort((a, b) => Math.max(b.similarity, b.lexical) - Math.max(a.similarity, a.lexical))
    .slice(0, topK);
}

export const RETRIEVAL_FLOOR = config.minMemoryScore;
