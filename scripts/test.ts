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

// --- report ------------------------------------------------------------------
console.log(`${passed}/${passed + failures.length} passed`);
for (const f of failures) console.log(`  FAILED: ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
