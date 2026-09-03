/**
 * Generates corpus/dictations.jsonl — ~500 transcript-like records for one user.
 *
 * The schedule (dates, apps, styles, subjects) is fixed in corpus-plan.ts. Only the wording
 * is produced by a model, in batches, so that the corpus is varied but the ground truth is
 * ours. Re-running with the same seed produces the same schedule; the committed .jsonl is
 * the artefact the evaluation actually uses.
 *
 *   npx tsx scripts/generate-corpus.ts [--out corpus/dictations.jsonl] [--count 500]
 */
import fs from 'node:fs';
import path from 'node:path';
import { generateJson } from '../src/lib/gemini';
import {
  APPS, CORPUS_END, FILLER_TOPICS, PERSONA, PLANTS, STYLE_FOR_APP, TOTAL_RECORDS,
  mulberry32, type PlanItem,
} from './corpus-plan';

const args = process.argv.slice(2);
const outFile = arg('--out') ?? path.join('corpus', 'dictations.jsonl');
const count = Number(arg('--count') ?? TOTAL_RECORDS);
function arg(name: string) {
  const a = args.find((x) => x.startsWith(name + '='));
  if (a) return a.split('=')[1];
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const rand = mulberry32(20260831);
const end = new Date(`${CORPUS_END}T00:00:00Z`).getTime();

function isoFor(daysAgo: number, hour: number, minute: number) {
  return new Date(end - daysAgo * 86_400_000 + hour * 3_600_000 + minute * 60_000).toISOString();
}

// Build the full schedule: planted items at their exact slots, filler spread over 120 days.
const plan: PlanItem[] = [...PLANTS];
const used = new Set(PLANTS.map((p) => `${p.day}:${p.hour}`));
let i = 0;
while (plan.length < count) {
  const day = 1 + Math.floor(rand() * 118);
  const hour = 8 + Math.floor(rand() * 12);
  if (used.has(`${day}:${hour}`)) continue;
  used.add(`${day}:${hour}`);
  const app = APPS[Math.floor(rand() * APPS.length)];
  plan.push({
    key: `filler_${i++}`,
    day, hour, app,
    style: STYLE_FOR_APP[app],
    brief: FILLER_TOPICS[Math.floor(rand() * FILLER_TOPICS.length)],
  });
}
plan.sort((a, b) => b.day - a.day || a.hour - b.hour);

const SYSTEM = `You produce realistic dictation records for testing a speech product.

${PERSONA}

For each brief you return TWO texts:

raw_asr — what a speech recogniser would emit before any cleanup: no capitalisation beyond
occasional accidents, almost no punctuation, filler words (um, uh, so, basically, actually,
you know), false starts and self-corrections, and OCCASIONAL plausible mis-recognitions of
names and terms (Devika -> "davika"/"debika", Rahul -> "rahool", Kavach -> "kavatch",
Truvia -> "truvia"/"true via", HDFC -> "h d f c", Linear -> "linear", KYC -> "k y c",
lakh/crore numbers written as words). Include the sentence structure of real speech.

formatted — the cleaned, correctly punctuated text she actually sent, in the requested style,
with names spelled correctly. Keep her voice; do not make it corporate.

Rules:
- 25 to 120 words each, occasionally longer for docs.
- Every string listed in must_contain must appear verbatim in formatted.
- Never invent contradictions with the brief.
- The two texts must say the same thing.`;

const SCHEMA = {
  type: 'object',
  properties: {
    records: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          raw_asr: { type: 'string' },
          formatted: { type: 'string' },
          context_label: { type: 'string' },
        },
        required: ['key', 'raw_asr', 'formatted', 'context_label'],
      },
    },
  },
  required: ['records'],
};

const BATCH = 10;
const CONCURRENCY = 5;
const results = new Map<string, { raw_asr: string; formatted: string; context_label: string }>();

const batches: PlanItem[][] = [];
for (let b = 0; b < plan.length; b += BATCH) batches.push(plan.slice(b, b + BATCH));

let completed = 0;
const queue = [...batches];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const batch = queue.shift();
      if (!batch) return;
      const prompt = batch
        .map((p) =>
          JSON.stringify({
            key: p.key,
            date: isoFor(p.day, p.hour, 0).slice(0, 10),
            app: p.app,
            style: p.style,
            brief: p.brief,
            must_contain: p.must_contain ?? [],
          })
        )
        .join('\n');
      try {
        const { value } = await generateJson<{ records: any[] }>({
          system: SYSTEM,
          contents: [{ role: 'user', parts: [{ text: `Write one record for each of these briefs:\n${prompt}` }] }],
          jsonSchema: SCHEMA,
          temperature: 1.0,
          purpose: 'corpus',
        });
        for (const r of value.records ?? []) results.set(r.key, r);
      } catch (e) {
        console.error(`batch failed (${batch[0].key}):`, (e as Error).message);
      }
      completed++;
      process.stdout.write(`\r  generated ${Math.min(completed * BATCH, plan.length)}/${plan.length}   `);
    }
  })
);
process.stdout.write('\n');

const DEVICES = ['macbook-pro', 'iphone-15', 'ipad'];
const lines: string[] = [];
let n = 0;
for (const p of plan) {
  const g = results.get(p.key);
  if (!g) continue;
  const minute = Math.floor(rand() * 60);
  const words = g.raw_asr.split(/\s+/).length;
  lines.push(
    JSON.stringify({
      id: `d_${String(++n).padStart(5, '0')}`,
      spoken_at: isoFor(p.day, p.hour, minute),
      app: p.app,
      context_label: g.context_label,
      style: p.style,
      duration_ms: Math.round((words / 2.6) * 1000),
      raw_asr: g.raw_asr,
      formatted: g.formatted,
      metadata: {
        device: DEVICES[Math.floor(rand() * DEVICES.length)],
        corpus_key: p.key,
        planted: p.planted ?? null,
      },
    })
  );
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.join('\n') + '\n');
console.log(`wrote ${lines.length} records to ${outFile}`);
const missing = plan.filter((p) => !results.has(p.key) && p.planted);
if (missing.length) console.error(`WARNING: planted records missing: ${missing.map((m) => m.key).join(', ')}`);
