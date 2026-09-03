import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/lib/config';
import { migrate } from '../src/lib/db';
import { ingest, type RawRecord } from '../src/lib/ingest';

function loadRecords(file: string): RawRecord[] {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    return text.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l));
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.records ?? parsed.dictations ?? []);
}

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--')) ?? path.join('corpus', 'dictations.jsonl');
const userArg = args.find(a => a.startsWith('--user='));
const limitArg = args.find(a => a.startsWith('--limit='));
const userId = userArg ? userArg.split('=')[1] : config.defaultUserId;

migrate();
let records = loadRecords(file);
if (limitArg) records = records.slice(0, Number(limitArg.split('=')[1]));

console.log(`ingesting ${records.length} records from ${file} as user ${userId}`);
if (!args.includes('--keep-dates')) {
  console.log('timestamps will be shifted so the newest dictation lands yesterday (pass --keep-dates to import them unchanged)');
}
let lastNote = '';
const shift = !args.includes('--keep-dates');
const stats = await ingest(records, userId, (done, total, note) => {
  if (note !== lastNote || done % 25 === 0 || done === total) {
    lastNote = note;
    process.stdout.write(`\r  ${note}: ${done}/${total}   `);
  }
});
process.stdout.write('\n');
console.log(JSON.stringify(stats, null, 2));
console.log(`\ndb grew from ${(stats.dbBytesBefore / 1024).toFixed(0)}KB to ${(stats.dbBytesAfter / 1024).toFixed(0)}KB`);
