// A quick text view of what is in the database, for when the interface is not running.
import { db, dbSizeBytes, migrate } from '../src/lib/db';
import { config } from '../src/lib/config';

migrate();
const d = db();
const rows = (sql: string, ...p: any[]) => d.prepare(sql).all(...p) as any[];

console.log(`database: ${config.dbPath} (${(dbSizeBytes() / 1048576).toFixed(2)} MB)`);
console.log(`dictations: ${(d.prepare('SELECT COUNT(*) c FROM dictations').get() as any).c}`);
console.table(rows('SELECT kind, status, COUNT(*) count FROM memories GROUP BY kind, status'));
console.table(rows(`SELECT 'memories' AS vectors, provider, COUNT(*) count FROM memory_embeddings GROUP BY provider
  UNION ALL SELECT 'dictations', provider, COUNT(*) FROM dictation_embeddings GROUP BY provider`));
console.table(rows('SELECT decision, COUNT(*) count FROM extraction_decisions GROUP BY decision'));
console.table(rows(`SELECT purpose, model, COUNT(*) calls, SUM(input_tokens) in_tok,
  SUM(output_tokens) out_tok, ROUND(SUM(cost_usd),4) cost_usd, ROUND(AVG(latency_ms)) avg_ms
  FROM model_calls GROUP BY purpose, model`));

console.log('\nmost-supported memories:');
for (const m of rows(`SELECT kind, support_count, statement FROM memories WHERE status='active'
    ORDER BY support_count DESC, confidence DESC LIMIT 12`)) {
  console.log(`  [${m.kind}] x${m.support_count}  ${m.statement}`);
}
console.log('\nsuperseded (kept as history):');
for (const m of rows(`SELECT statement FROM memories WHERE status='superseded' LIMIT 10`)) {
  console.log(`  ${m.statement}`);
}
console.log('\na sample of what was deliberately not kept:');
for (const r of rows(`SELECT reason FROM extraction_decisions WHERE decision='rejected'
    ORDER BY RANDOM() LIMIT 10`)) {
  console.log(`  ${r.reason}`);
}
