/**
 * Ask what retrieval would return for a query, without involving the model.
 *
 *   npx tsx scripts/why.ts "when does V2 launch"
 *
 * Prints the memories and dictations that a Hey Kivi `recall` / `find_dictations` call
 * would see, with their fused, vector and lexical scores, and whether each cleared the
 * relevance floor. When Hey Kivi cannot answer something, this says whether the material
 * was never retrieved, retrieved but scored below the floor, or retrieved and ignored.
 */
import { config } from '../src/lib/config';
import { migrate } from '../src/lib/db';
import { RETRIEVAL_FLOOR, searchDictations, searchMemories } from '../src/lib/retrieve';

migrate();

const query = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
if (!query) {
  console.error('usage: npx tsx scripts/why.ts "your question"');
  process.exit(1);
}

console.log(`query: ${query}`);
console.log(`relevance floor: ${RETRIEVAL_FLOOR}\n`);

const memories = await searchMemories({ userId: config.defaultUserId, query, limit: 10 });
console.log('MEMORIES');
if (memories.length === 0) console.log('  (nothing matched at all)');
for (const m of memories) {
  const mark = m.score >= RETRIEVAL_FLOOR ? 'in ' : 'OUT';
  console.log(
    `  ${mark} ${m.score.toFixed(3)}  vec ${m.vec_score.toFixed(3)}  bm25 ${m.bm25_score.toFixed(1)}  ` +
      `[${m.kind}] ${m.statement.slice(0, 88)}`
  );
}

const dictations = await searchDictations({ userId: config.defaultUserId, query, limit: 8 });
console.log('\nDICTATIONS');
if (dictations.length === 0) console.log('  (nothing matched at all)');
for (const d of dictations) {
  console.log(
    `  ${d.score.toFixed(3)}  vec ${d.vec_score.toFixed(3)}  bm25 ${d.bm25_score.toFixed(1)}  ` +
      `${d.id} ${d.spoken_at.slice(0, 16)} ${d.app} :: ${d.formatted.slice(0, 70)}`
  );
}
