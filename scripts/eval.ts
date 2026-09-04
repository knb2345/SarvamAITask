/**
 * The candidate evaluation.
 *
 * Runs the complete pipeline — retrieval, tools, model, grounding checks — against the
 * corpus already in the database, and writes a result file where every case can be
 * inspected: the question, what was retrieved and at what score, what Kivi answered,
 * which memories and dictations it cited, and why the case passed or failed.
 *
 *   npx tsx scripts/eval.ts [--only=group-or-id] [--out=eval/results]
 */
import fs from 'node:fs';
import path from 'node:path';
import { askHeyKivi } from '../src/lib/agent';
import { config } from '../src/lib/config';
import { db, dbSizeBytes, migrate } from '../src/lib/db';

migrate();

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const outDir = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? path.join('eval', 'results');
const userId = args.find((a) => a.startsWith('--user='))?.split('=')[1] ?? config.defaultUserId;

const spec = JSON.parse(fs.readFileSync(path.join('eval', 'questions.json'), 'utf8'));
const cases = spec.cases.filter((c: any) => !only || c.id === only || c.group === only);

const dictationCount = (db().prepare('SELECT COUNT(*) c FROM dictations WHERE user_id = ?').get(userId) as any).c;
if (dictationCount === 0) {
  console.error('No dictations in the database. Run: npm run db:reset && npm run seed');
  process.exit(1);
}

/** planted tag -> dictation ids, read straight from what was ingested. */
const planted = new Map<string, Set<string>>();
for (const row of db().prepare('SELECT id, metadata_json FROM dictations WHERE user_id = ?').all(userId) as any[]) {
  const tag = JSON.parse(row.metadata_json || '{}').planted;
  if (!tag) continue;
  if (!planted.has(tag)) planted.set(tag, new Set());
  planted.get(tag)!.add(row.id);
}

const evidenceOf = db().prepare('SELECT dictation_id FROM memory_evidence WHERE memory_id = ?');

function norm(s: string) {
  return (s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
}

const t0 = Date.now();
const bytesBefore = dbSizeBytes();
const callsBefore = (db().prepare('SELECT COUNT(*) c FROM model_calls').get() as any).c;
const results: any[] = [];

for (const c of cases) {
  process.stdout.write(`  ${c.id} … `);
  const started = Date.now();
  let result: any;
  let error: string | null = null;
  try {
    // A run of thirty cases must not be lost to one request that never settles.
    result = await Promise.race([
      askHeyKivi(userId, c.question),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('case timed out after 180s')), 180_000)
      ),
    ]);
  } catch (e: any) {
    error = String(e?.message ?? e);
    result = { answer: '', outcome: 'error', citations: { memories: [], dictations: [] }, trace: { steps: [], notes: [error], totalMs: Date.now() - started, retrievalMs: 0, modelMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, rounds: 0 } };
  }

  const haystack = norm(`${result.answer} ${result.draft ?? ''}`);
  const failures: string[] = [];

  // outcome
  const expected = Array.isArray(c.expect_outcome) ? c.expect_outcome : c.expect_outcome ? [c.expect_outcome] : null;
  if (expected && !expected.includes(result.outcome)) {
    failures.push(`outcome was "${result.outcome}", expected ${expected.join(' or ')}`);
  }

  // content
  if (c.expect_any?.length) {
    const hit = c.expect_any.some((s: string) => haystack.includes(norm(s)));
    if (!hit) failures.push(`answer contained none of: ${c.expect_any.join(' | ')}`);
  }
  for (const bad of c.must_not_contain ?? []) {
    if (haystack.includes(norm(bad))) failures.push(`answer contained forbidden text "${bad}"`);
  }

  // citations
  const citedDictations: string[] = (result.citations?.dictations ?? []).map((d: any) => d.id);
  const citedMemories: string[] = (result.citations?.memories ?? []).map((m: any) => m.id);
  const citedViaMemory = new Set<string>();
  for (const mid of citedMemories) {
    for (const r of evidenceOf.all(mid) as any[]) citedViaMemory.add(r.dictation_id);
  }
  if (c.cite_planted) {
    const wanted = planted.get(c.cite_planted) ?? new Set<string>();
    const ok = [...wanted].some((id) => citedDictations.includes(id) || citedViaMemory.has(id));
    if (!ok) {
      failures.push(
        `did not cite the source dictation for "${c.cite_planted}" (${[...wanted].join(', ') || 'tag absent from corpus'})`
      );
    }
  }
  if (expected?.includes('answered') && result.outcome === 'answered' && citedDictations.length + citedMemories.length === 0) {
    failures.push('answered with no citation at all');
  }

  // drafts
  if (c.expect_draft && !result.draft) failures.push('expected a draft, got none');
  if (c.draft_checks && result.draft) {
    const d = result.draft as string;
    if (c.draft_checks.max_lines && d.split(/\n+/).filter((l: string) => l.trim()).length > c.draft_checks.max_lines) {
      failures.push(`draft has more than ${c.draft_checks.max_lines} lines`);
    }
    if (c.draft_checks.max_sentences) {
      const sentences = d.split(/[.!?]+\s/).filter((s: string) => s.trim().length > 3).length;
      if (sentences > c.draft_checks.max_sentences) {
        failures.push(`draft has ${sentences} sentences, preference says at most ${c.draft_checks.max_sentences}`);
      }
    }
    for (const bad of c.draft_checks.must_not_contain ?? []) {
      if (norm(d).includes(norm(bad))) failures.push(`draft used a word the person banned: "${bad}"`);
    }
  }

  // explicit "remember this"
  if (c.expect_memory_created) {
    const found = db()
      .prepare(
        `SELECT id, statement FROM memories WHERE user_id = ? AND status='active' AND source='user_stated'
         AND lower(statement) LIKE ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(userId, `%${String(c.expect_memory_created).toLowerCase()}%`) as any;
    if (!found) failures.push(`no user-stated memory containing "${c.expect_memory_created}" was created`);
  }

  const record = {
    id: c.id,
    group: c.group,
    question: c.question,
    why_this_case_exists: c.why ?? null,
    expected: { outcome: c.expect_outcome ?? null, any_of: c.expect_any ?? null, cite_planted: c.cite_planted ?? null },
    passed: failures.length === 0,
    failures,
    error,
    outcome: result.outcome,
    confidence: result.confidence,
    answer: result.answer,
    draft: result.draft ?? null,
    citations: {
      memories: (result.citations?.memories ?? []).map((m: any) => ({
        id: m.id, kind: m.kind, statement: m.statement, confidence: m.confidence,
        support_count: m.support_count, source: m.source,
        provenance: (evidenceOf.all(m.id) as any[]).map((e) => e.dictation_id),
      })),
      dictations: (result.citations?.dictations ?? []).map((d: any) => ({
        id: d.id, spoken_at: d.spoken_at, app: d.app, formatted: d.formatted,
      })),
    },
    reasoning_trace: {
      rounds: result.trace.rounds,
      notes: result.trace.notes,
      steps: result.trace.steps.map((s: any) => ({
        tool: s.tool, args: s.args, ms: s.ms, summary: s.summary,
        candidates: (s.candidates ?? []).slice(0, 8),
      })),
    },
    metrics: {
      total_ms: result.trace.totalMs,
      retrieval_ms: result.trace.retrievalMs,
      model_ms: result.trace.modelMs,
      input_tokens: result.trace.inputTokens,
      output_tokens: result.trace.outputTokens,
      cost_usd: result.trace.costUsd,
    },
  };
  results.push(record);
  console.log(`${record.passed ? 'pass' : 'FAIL'} (${((Date.now() - started) / 1000).toFixed(1)}s)${record.passed ? '' : ' — ' + failures.join('; ')}`);

  // Written after every case: an evaluation that loses its evidence when the last case
  // fails is not an evaluation. The final write below replaces this with the full report.
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'results.partial.json'),
    JSON.stringify({ in_progress: true, completed: results.length, of: cases.length, cases: results }, null, 2)
  );
}

// --- memory state checks (no model involved) ---
const stateResults: any[] = [];
for (const check of spec.memory_state_checks ?? []) {
  const failures: string[] = [];
  if (check.forbidden_terms) {
    for (const term of check.forbidden_terms) {
      const hits = db()
        .prepare(`SELECT id, statement FROM memories WHERE user_id=? AND status='active' AND lower(statement) LIKE ?`)
        .all(userId, `%${term.toLowerCase()}%`) as any[];
      for (const h of hits) failures.push(`${h.id} contains "${term}": ${h.statement}`);
    }
  }
  if (check.requires_superseded_containing) {
    for (const term of check.requires_superseded_containing) {
      const row = db()
        .prepare(`SELECT id FROM memories WHERE user_id=? AND status='superseded' AND lower(statement) LIKE ?`)
        .get(userId, `%${term.toLowerCase()}%`);
      if (!row) failures.push(`expected a superseded memory containing "${term}", found none`);
    }
  }
  if (check.requires_personal_dictations_min) {
    const n = (db()
      .prepare(`SELECT COUNT(*) c FROM dictations WHERE user_id = ? AND sensitivity = 'personal'`)
      .get(userId) as any).c;
    if (n < check.requires_personal_dictations_min) {
      failures.push(`only ${n} dictations were classified personal, expected at least ${check.requires_personal_dictations_min}`);
    }
  }
  if (check.no_memory_from_personal) {
    const leaked = db()
      .prepare(
        `SELECT m.id, m.statement, d.id AS dictation_id
         FROM memory_evidence e
         JOIN memories m ON m.id = e.memory_id
         JOIN dictations d ON d.id = e.dictation_id
         WHERE d.sensitivity = 'personal' AND m.status = 'active'`
      )
      .all() as any[];
    for (const l of leaked) failures.push(`${l.id} was learned from personal dictation ${l.dictation_id}: ${l.statement}`);
  }
  if (check.max_active_matching) {
    const { terms, kind, max } = check.max_active_matching;
    const rows = db()
      .prepare(
        `SELECT id, statement, support_count FROM memories
         WHERE user_id=? AND status='active' AND kind=? AND lower(statement) LIKE ?`
      )
      .all(userId, kind, `%${terms[0].toLowerCase()}%`) as any[];
    if (rows.length > max) failures.push(`${rows.length} active ${kind} memories match "${terms[0]}", expected at most ${max}`);
  }
  stateResults.push({ id: check.id, description: check.description, passed: failures.length === 0, failures });
}

// --- roll-up ---
const bytesAfter = dbSizeBytes();
const callsAfter = (db().prepare('SELECT COUNT(*) c FROM model_calls').get() as any).c;
const latencies = results.map((r) => r.metrics.total_ms).sort((a, b) => a - b);
const retrievalLatencies = results.map((r) => r.metrics.retrieval_ms).sort((a, b) => a - b);
const pct = (arr: number[], p: number) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);

const byGroup: Record<string, { passed: number; total: number }> = {};
for (const r of results) {
  byGroup[r.group] ??= { passed: 0, total: 0 };
  byGroup[r.group].total++;
  if (r.passed) byGroup[r.group].passed++;
}

const memStats = db()
  .prepare(
    `SELECT kind, status, COUNT(*) c FROM memories WHERE user_id=? GROUP BY kind, status`
  )
  .all(userId);
const ingestRun = db().prepare('SELECT * FROM ingest_runs ORDER BY started_at DESC LIMIT 1').get() as any;
const modelUsage = db()
  .prepare(
    `SELECT purpose, model, COUNT(*) calls, SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens,
            ROUND(SUM(cost_usd),5) cost_usd, ROUND(AVG(latency_ms)) avg_ms
     FROM model_calls GROUP BY purpose, model`
  )
  .all();

const summary = {
  ran_at: new Date().toISOString(),
  models: { chat: config.chatModel, extract: config.extractModel, embed: config.embedModel },
  corpus: {
    dictations: dictationCount,
    ingest_run: ingestRun ? JSON.parse(ingestRun.stats_json || '{}') : null,
  },
  cases: { passed: results.filter((r) => r.passed).length, total: results.length, by_group: byGroup },
  memory_state: { passed: stateResults.filter((r) => r.passed).length, total: stateResults.length },
  memory_counts: memStats,
  latency_ms: {
    end_to_end_p50: pct(latencies, 50), end_to_end_p90: pct(latencies, 90), end_to_end_max: latencies.at(-1) ?? 0,
    retrieval_p50: pct(retrievalLatencies, 50), retrieval_p90: pct(retrievalLatencies, 90),
  },
  cost_usd: {
    this_eval: Number(results.reduce((a, r) => a + r.metrics.cost_usd, 0).toFixed(5)),
    per_question: Number((results.reduce((a, r) => a + r.metrics.cost_usd, 0) / Math.max(1, results.length)).toFixed(6)),
  },
  model_calls: { before: callsBefore, after: callsAfter, usage_by_purpose: modelUsage },
  database_bytes: { before: bytesBefore, after: bytesAfter, per_dictation: Math.round(bytesAfter / Math.max(1, dictationCount)) },
  wall_clock_ms: Date.now() - t0,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ summary, cases: results, memory_state: stateResults }, null, 2));
fs.writeFileSync(path.join(outDir, 'results.md'), renderMarkdown(summary, results, stateResults));

console.log(`\n${summary.cases.passed}/${summary.cases.total} cases passed · ${summary.memory_state.passed}/${summary.memory_state.total} memory-state checks passed`);
console.log(`p50 ${summary.latency_ms.end_to_end_p50}ms · p90 ${summary.latency_ms.end_to_end_p90}ms · $${summary.cost_usd.this_eval} total`);
try { fs.rmSync(path.join(outDir, 'results.partial.json')); } catch { /* nothing to clean up */ }
console.log(`wrote ${path.join(outDir, 'results.json')} and results.md`);

function renderMarkdown(s: any, rs: any[], ms: any[]): string {
  const L: string[] = [];
  L.push('# Evaluation results');
  L.push('');
  L.push(`Run ${s.ran_at} · chat model \`${s.models.chat}\` · extraction \`${s.models.extract}\` · embeddings \`${s.models.embed}\``);
  L.push('');
  L.push(`**${s.cases.passed}/${s.cases.total} question cases passed. ${s.memory_state.passed}/${s.memory_state.total} memory-state checks passed.**`);
  L.push('');
  L.push('| group | passed |');
  L.push('| --- | --- |');
  for (const [g, v] of Object.entries(s.cases.by_group as any)) {
    L.push(`| ${g} | ${(v as any).passed}/${(v as any).total} |`);
  }
  L.push('');
  L.push('## Cost and latency');
  L.push('');
  L.push(`- End-to-end per question: p50 **${s.latency_ms.end_to_end_p50}ms**, p90 **${s.latency_ms.end_to_end_p90}ms**, max ${s.latency_ms.end_to_end_max}ms`);
  L.push(`- Retrieval only: p50 **${s.latency_ms.retrieval_p50}ms**, p90 ${s.latency_ms.retrieval_p90}ms`);
  L.push(`- Cost of this evaluation: **$${s.cost_usd.this_eval}** (${'$'}${s.cost_usd.per_question} per question)`);
  if (s.corpus.ingest_run?.costUsd !== undefined) {
    const ir = s.corpus.ingest_run;
    L.push(`- Ingesting ${ir.dictations} dictations cost **$${Number(ir.costUsd).toFixed(4)}** in ${(ir.totalMs / 1000).toFixed(0)}s (${(ir.totalMs / Math.max(1, ir.dictations)).toFixed(0)}ms per dictation)`);
    L.push(`- Memories written: ${ir.created} created, ${ir.reinforced} reinforced, ${ir.superseded} superseded, ${ir.episodes} episodes, ${ir.rejected} candidates deliberately rejected, ${ir.skipped} dictations never read`);
  }
  L.push(`- Database: ${(s.database_bytes.after / 1_048_576).toFixed(2)} MB for ${s.corpus.dictations} dictations (~${s.database_bytes.per_dictation} bytes each)`);
  L.push('');
  L.push('| purpose | model | calls | in | out | avg ms | cost |');
  L.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const m of s.model_calls.usage_by_purpose as any[]) {
    L.push(`| ${m.purpose} | ${m.model} | ${m.calls} | ${m.input_tokens} | ${m.output_tokens} | ${m.avg_ms} | $${m.cost_usd} |`);
  }
  L.push('');
  const failed = rs.filter((r) => !r.passed);
  L.push(`## Failures (${failed.length})`);
  L.push('');
  if (failed.length === 0) L.push('_None._');
  for (const f of failed) {
    L.push(`### ${f.id} — ${f.group}`);
    L.push(`> ${f.question}`);
    L.push('');
    L.push(`- outcome: \`${f.outcome}\``);
    for (const x of f.failures) L.push(`- **${x}**`);
    L.push(`- answer: ${JSON.stringify(f.answer)}`);
    if (f.reasoning_trace.steps.length) {
      L.push(`- tools used: ${f.reasoning_trace.steps.map((s: any) => s.tool).join(' → ')}`);
    }
    L.push('');
  }
  L.push('## Memory state');
  L.push('');
  for (const m of ms) {
    L.push(`- ${m.passed ? 'ok' : 'FAILED'} — ${m.description}${m.failures.length ? `: ${m.failures.join('; ')}` : ''}`);
  }
  L.push('');
  L.push('## Every case');
  L.push('');
  L.push('| case | group | outcome | passed | cites | ms |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of rs) {
    const cites = r.citations.memories.length + r.citations.dictations.length;
    L.push(`| ${r.id} | ${r.group} | ${r.outcome} | ${r.passed ? 'yes' : 'NO'} | ${cites} | ${r.metrics.total_ms} |`);
  }
  L.push('');
  L.push('Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.');
  return L.join('\n');
}
