/**
 * Backfills embeddings for any dictation or memory that does not have one.
 *
 * Useful after an ingest that ran out of embedding quota: the memories are already
 * correct and lexically searchable, and this restores dense retrieval.
 *
 *   npx tsx scripts/reindex.ts          # fill in what is missing
 *   npx tsx scripts/reindex.ts --all    # re-embed everything, e.g. to replace vectors
 *                                       # written by the local fallback once API quota
 *                                       # is available again
 */
import { config } from '../src/lib/config';
import { db, migrate } from '../src/lib/db';
import { embedWithProvider, toBlob } from '../src/lib/gemini';
import { embeddingTextFor } from '../src/lib/memory';

migrate();

const all = process.argv.includes('--all');

const missingDictations = db()
  .prepare(
    all
      ? `SELECT d.id, d.app, d.context_label, d.formatted FROM dictations d`
      : `SELECT d.id, d.app, d.context_label, d.formatted FROM dictations d
         LEFT JOIN dictation_embeddings e ON e.dictation_id = d.id WHERE e.dictation_id IS NULL`
  )
  .all() as any[];
const missingMemories = db()
  .prepare(
    all
      ? `SELECT m.id, m.kind, m.statement, m.subject FROM memories m WHERE m.status = 'active'`
      : `SELECT m.id, m.kind, m.statement, m.subject FROM memories m
         LEFT JOIN memory_embeddings e ON e.memory_id = m.id
         WHERE e.memory_id IS NULL AND m.status = 'active'`
  )
  .all() as any[];

console.log(
  all
    ? `re-embedding everything: ${missingDictations.length} dictations, ${missingMemories.length} memories`
    : `missing vectors: ${missingDictations.length} dictations, ${missingMemories.length} memories`
);
console.table(
  db().prepare(`SELECT 'memories' AS vectors, provider, COUNT(*) count FROM memory_embeddings GROUP BY provider
                UNION ALL SELECT 'dictations', provider, COUNT(*) FROM dictation_embeddings GROUP BY provider`).all()
);
console.log(`model: ${config.embedModel} (${config.embedDim} dimensions)`);

for (let i = 0; i < missingDictations.length; i += 64) {
  const chunk = missingDictations.slice(i, i + 64);
  const r = await embedWithProvider(chunk.map((d) => `${d.app ?? ''} ${d.context_label ?? ''}\n${d.formatted}`), 'RETRIEVAL_DOCUMENT');
  const vecs = r.vectors;
  const put = db().transaction(() => {
    chunk.forEach((d, j) => {
      if (vecs[j]) {
        db().prepare('INSERT OR REPLACE INTO dictation_embeddings (dictation_id, dim, vec, provider) VALUES (?,?,?,?)')
          .run(d.id, vecs[j].length, toBlob(vecs[j]), r.provider);
      }
    });
  });
  put();
  console.log(`  dictations ${Math.min(i + 64, missingDictations.length)}/${missingDictations.length}`);
}

for (let i = 0; i < missingMemories.length; i += 64) {
  const chunk = missingMemories.slice(i, i + 64);
  const r = await embedWithProvider(chunk.map((m) => embeddingTextFor(m)), 'RETRIEVAL_DOCUMENT');
  const vecs = r.vectors;
  const put = db().transaction(() => {
    chunk.forEach((m, j) => {
      if (vecs[j]) {
        db().prepare('INSERT OR REPLACE INTO memory_embeddings (memory_id, dim, vec, provider) VALUES (?,?,?,?)')
          .run(m.id, vecs[j].length, toBlob(vecs[j]), r.provider);
      }
    });
  });
  put();
  console.log(`  memories ${Math.min(i + 64, missingMemories.length)}/${missingMemories.length}`);
}
console.table(
  db().prepare(`SELECT 'memories' AS vectors, provider, COUNT(*) count FROM memory_embeddings GROUP BY provider
                UNION ALL SELECT 'dictations', provider, COUNT(*) FROM dictation_embeddings GROUP BY provider`).all()
);
console.log('done');
