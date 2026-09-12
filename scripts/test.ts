/**
 * Tests for the parts that must not break quietly, and that need no model to check.
 *
 *   npm test
 *
 * The import path gets most of the attention because it is where someone else's corpus
 * meets this system, and the reviewing agent translating that corpus will not be here to
 * notice a field arriving as "[object Object]".
 */
import { normaliseRecord } from '../src/lib/ingest';
import { carriesCredential, prefilter } from '../src/lib/extract';
import { ftsEscape } from '../src/lib/memory';
import { localEmbed } from '../src/lib/localembed';
import { cosine } from '../src/lib/gemini';
import { citationIds, demoDateShift, evaluationTime } from '../src/lib/history-time';
import { config } from '../src/lib/config';
import { db, ensureUser, migrate } from '../src/lib/db';
import { insertDictation } from '../src/lib/ingest';
import { relatedDictations, searchDictations } from '../src/lib/retrieve';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const asDictation = (r: any) => normaliseRecord(r, 'u_test', 0);

// --- import: field names -----------------------------------------------------
check(
  'canonical fields',
  asDictation({ spoken_at: '2026-08-01T10:00:00Z', raw_asr: 'hello there', app: 'slack' }).raw_asr === 'hello there'
);
check(
  'aliases: asr / formatted_output / application',
  (() => {
    const d = asDictation({ timestamp: '2026-08-01T10:00:00Z', asr: 'raw words', formatted_output: 'Raw words.', application: 'gmail' });
    return d.raw_asr === 'raw words' && d.formatted === 'Raw words.' && d.app === 'gmail';
  })()
);
check(
  'a nested transcript object is unwrapped, not stringified',
  asDictation({ asr: { text: 'nested words' } }).raw_asr === 'nested words',
  'used to arrive as "[object Object]"'
);
check(
  'formatted falls back to raw when absent',
  asDictation({ raw_asr: 'only raw' }).formatted === 'only raw'
);
check(
  'unrecognised fields are preserved rather than dropped',
  JSON.parse(asDictation({ raw_asr: 'x', session_id: 'abc-123' }).metadata_json).session_id === 'abc-123'
);

// --- import: timestamps ------------------------------------------------------
check(
  'epoch seconds are not read as 1970',
  asDictation({ timestamp: 1785000000, raw_asr: 'x' }).spoken_at.startsWith('2026'),
  'a ten-digit timestamp is seconds, not milliseconds'
);
check('epoch milliseconds', asDictation({ timestamp: 1785000000000, raw_asr: 'x' }).spoken_at.startsWith('2026'));
check('space-separated datetime', asDictation({ timestamp: '2026-08-01 14:30:00', raw_asr: 'x' }).spoken_at.startsWith('2026-08-01T14:30'));
check('an unparseable date does not throw', typeof asDictation({ timestamp: 'not a date', raw_asr: 'x' }).spoken_at === 'string');
check('a missing id is generated', asDictation({ raw_asr: 'x' }).id.startsWith('d_'));

// --- credentials -------------------------------------------------------------
check('password statement is caught', carriesCredential('the password for staging is Hunter2xyz') !== null);
check('api key is caught', carriesCredential('use this api key when you call it') !== null);
check('card number is caught', carriesCredential('card is 4111 1111 1111 1111') !== null);
check(
  'ordinary work is not a credential',
  carriesCredential('Rahul owns the ledger migration and it ships in December') === null,
  'over-blocking would quietly delete working memory'
);
check(
  'a business figure is not a credential',
  carriesCredential('Apex Retail does about fifty lakhs in monthly volume') === null
);
check('asking for credentials does not itself disclose a credential', carriesCredential('Could you please share the production credentials when possible?') === null);

// --- prefilter ---------------------------------------------------------------
check('short utterances are skipped', prefilter({ formatted: 'ok thanks', raw_asr: 'ok thanks' } as any) !== null);
check('a microphone test is skipped', prefilter({ formatted: 'testing', raw_asr: 'testing' } as any) !== null);
check(
  'a real dictation is read',
  prefilter({ formatted: 'The merchant onboarding V2 launch has moved to the fifth of December.', raw_asr: 'x' } as any) === null
);

// --- FTS query building ------------------------------------------------------
check('fts strips stopwords', !ftsEscape('what did I say about the launch').includes('"the"'));
check('fts keeps the meaningful terms', ftsEscape('what did I say about the launch').includes('"launch"'));
check(
  'punctuation cannot break the query',
  (() => {
    try {
      return typeof ftsEscape('what about "this" AND (that) OR *') === 'string';
    } catch {
      return false;
    }
  })(),
  'FTS5 MATCH is a query language; unescaped input throws'
);

// --- local embedder ----------------------------------------------------------
const a = localEmbed('fact: the V2 launch date is the 5th of December');
const b = localEmbed('when does V2 launch');
const c = localEmbed('preference: standup updates should be three bullets');
check('related texts score above unrelated ones', cosine(a, b) > cosine(a, c), `related ${cosine(a, b).toFixed(3)} vs unrelated ${cosine(a, c).toFixed(3)}`);
check('embedding is deterministic', cosine(localEmbed('same text'), localEmbed('same text')) > 0.999);
check('vectors are normalised', Math.abs(cosine(a, a) - 1) < 1e-5);

// Regression: embedded citation IDs must be recovered even without structured IDs.
check('citations are recovered from prose and deduplicated',
  citationIds('First (d_00007), then [d_00268]; memory m_abc123 supports d_00268.').join(',') === 'd_00007,d_00268,m_abc123');
check('citation-like substrings inside another token are ignored', citationIds('notd_00007').length === 0);

const originalTime = '2026-08-30T17:48:00.000Z';
const shifted = new Date(Date.parse(originalTime) + demoDateShift(originalTime, new Date('2026-09-12T03:00:00Z'))).toISOString();
check('seed shifting preserves the hour and minute', shifted === '2026-09-11T17:48:00.000Z');
check('relative evaluation dates follow the corpus, not the wall clock', evaluationTime(shifted).toISOString() === '2026-09-12T12:00:00.000Z');
check('future-dated corpora can also be shifted to yesterday', demoDateShift('2027-01-01T17:48:00Z', new Date('2026-09-12T00:00:00Z')) < 0);

// Real SQLite retrieval over an isolated fixture; no embeddings or model calls.
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kivi-regression-'));
config.dbPath = path.join(testDir, 'test.db');
try {
  migrate();
  ensureUser('u_test');
  const fixture = [
    { id: 'exact', spoken_at: '2026-08-01T12:00:00Z', formatted: 'Acme moved verification to the new endpoint; failures fell below one percent.' },
    { id: 'recent', spoken_at: '2026-08-03T12:00:00Z', formatted: 'Acme endpoint rollout is complete.' },
    { id: 'other', spoken_at: '2026-08-04T12:00:00Z', formatted: 'A different vendor endpoint has an issue.' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `noise${i}`, spoken_at: '2026-08-02T12:00:00Z', formatted: 'Acme has another support ticket.' })),
  ];
  for (const r of fixture) insertDictation(normaliseRecord({ ...r, raw_asr: r.formatted, app: 'slack' }, 'u_test', 0));
  const relevant = await searchDictations({ userId: 'u_test', query: 'Acme endpoint', limit: 2 });
  check('exact topic/component sources survive broad-match noise', relevant.some((r) => r.id === 'exact') && relevant.some((r) => r.id === 'recent'));
  const recent = await searchDictations({ userId: 'u_test', query: 'Acme endpoint', sort: 'recent', limit: 2 });
  check('recent sort keeps topic constraints', recent[0]?.id === 'recent' && !recent.some((r) => r.id === 'other'));
  const timed = await searchDictations({ userId: 'u_test', app: 'slack', since: '2026-08-03T00:00:00Z', until: '2026-08-03T23:59:59Z' });
  check('time and app lookup returns only the requested window', timed.length === 1 && timed[0].id === 'recent');
  const connected = relatedDictations('u_test', 'Acme moved verification to a new endpoint', 4);
  check('memory expansion retrieves the detailed source of a resolution', connected.some((r) => r.id === 'exact'));
  db().prepare("UPDATE dictations SET sensitivity='personal' WHERE id='exact'").run();
  check('memory expansion excludes personal source material', !relatedDictations('u_test', 'Acme moved verification to a new endpoint').some((r) => r.id === 'exact'));
} finally {
  db().close();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = config.dbPath + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  fs.rmdirSync(testDir);
}

// --- report ------------------------------------------------------------------
console.log(`${passed}/${passed + failures.length} passed`);
for (const f of failures) console.log(`  FAILED: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
