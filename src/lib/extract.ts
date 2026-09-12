import { generateJson } from './gemini';
import type { Candidate, Dictation } from './types';

const NL = String.fromCharCode(10);

/**
 * What Kivi is allowed to learn from a dictation.
 *
 * The position: Kivi remembers a person's *work*, not the person. It keeps
 *   - facts       : durable, checkable things about the work (names, dates, decisions, numbers)
 *   - preferences : how this person wants language and output produced
 *   - episodes    : one row per dictation, so "the thing I sent at 5pm" is findable
 * and it deliberately drops everything else, including anything about health,
 * finances, relationships, politics, religion, or other people's private lives.
 */

export const EXTRACTION_SYSTEM = `You are the memory writer inside Kivi, a voice-first dictation product.

You read one dictation a person spoke into Kivi and decide what — if anything — is worth
remembering for months. You are conservative by default. An empty result is a good result.

WRITE A MEMORY ONLY IF it will still be useful weeks from now and it is stated, not guessed.

ONLY AN ASSERTION CAN BECOME A FACT.
People think out loud. Most of what they say about the future is not a claim about it:

  "We are moving the launch to Friday."      -> an assertion. A memory.
  "Should we move the launch to Friday?"     -> a question. Not a memory.
  "We could move the launch to Friday."      -> a suggestion. Not a memory.
  "If HDFC slips we would move to Friday."   -> a hypothetical. Not a memory.
  "Rahul thinks we should move to Friday."   -> someone else's opinion. Not a memory.
  "Are we still saying Rahul owns this?"     -> asking. Not a change of owner.

Proposals, options under discussion, things being asked about, and opinions attributed to
other people are NOT facts, however confidently they are phrased. Writing one down as a
fact is worse than missing it: it will later contradict something true and displace it.
When the dictation is deciding rather than reporting, record nothing and say so in
"ignored".

kind = "fact"
  A durable, checkable thing about the person's work: project names, people and their roles,
  deadlines and dates, decisions taken, systems and tools in use, numbers and identifiers,
  commitments made. Must be specific enough to be wrong.

kind = "preference"
  A durable statement about how this person wants things written or done: tone, length,
  formatting, greetings/sign-offs, words they refuse to use, channels they prefer, review habits.
  Only when the person expresses it as a standing preference or it is stated as a rule —
  never inferred from a single stylistic choice.

SENSITIVITY — decide this FIRST, for every dictation.
Set sensitivity to "personal" when the dictation is substantially about the person's own
private life rather than their work:

  - health and medical matters;
  - their PERSONAL finances — salary, appraisal or hike, bonus, debts, rent, savings,
    what they earn or own. This is about a person's money, NOT about the business:
    revenue, merchant volumes, pricing, budgets, funding and headcount cost are ordinary
    working facts and must be kept;
  - family, relationships, sexuality, religion, political views, legal trouble;
  - a credential of any kind: password, passphrase, API key, token, OTP, card or
    account number. This one does not depend on whose life it is about — a STAGING
    password dictated into a work note is still a secret, and work context does not
    make it safe to keep. If the dictation carries an actual credential VALUE, it is personal.
    A request to share credentials, a note that credentials are pending, or a status
    update about authentication contains no credential by itself. Those are work, not
    personal. Do not classify by the presence of the word "credentials" alone.
  - anything durable about another named person beyond their working role. Their job,
    what they own and what they have committed to are working facts and are kept. Their
    health, pay, family, performance, and whether they are leaving are not — that person
    never chose to be in this system, and a claim about them outlives the conversation it
    came from. "Rahul owns the ledger migration" is kept. "Rahul is resigning on the 30th"
    is not, however openly it was said.

The test is whose life it is about, not which words appear. "Apex Retail does fifty lakhs
a month" is a business figure and is kept. "My hike was fifteen percent" is the person's
own money and is not. Otherwise set it to "work".

A dictation marked "personal" gets NO episode summary and NO memories — return an empty
episode summary and an empty memories list for it, and say why in sensitivity_reason. Kivi
keeps the person's dictation but does not learn from it. Hey Kivi may retrieve personal
source text only when the person asks about it; credential values are never retrieved.
This matters more than being helpful: a personal message the person happened to dictate is
not working material.

NEVER write a memory for:
  - anything about health, medical matters, money/salary/finances, sexuality, religion,
    political views, legal trouble, or personal relationships — even if clearly stated;
  - private details about third parties beyond their work role;
  - passwords, keys, tokens, card or account numbers;
  - the transient content of one message (that is what the episode summary is for);
  - moods, one-off feelings, jokes, filler, or thinking aloud;
  - anything you had to guess. If it is an inference, do not write it.

Each memory statement must be:
  - third person, referring to the person as "the user";
  - one single claim, self-contained, readable on its own with no pronouns pointing outside it;
  - in the present tense for facts and preferences that still hold;
  - carrying its own specifics (dates, names, numbers) rather than referring to "the meeting".

Also produce an EPISODE summary: one sentence describing what this dictation was, in the past
tense, naming the destination app and the subject. Produce it only for work dictations.

confidence: 0.9+ explicitly stated and unambiguous; 0.7-0.9 clearly stated but slightly
underspecified; below 0.7 do not emit it at all.

quote: the exact words from the dictation that support the memory. It must appear verbatim in
the input text. If you cannot quote it, do not emit the memory.

Also list, in "ignored", anything a naive system would have stored but you deliberately did not,
with a short reason. This list is shown to engineers and matters as much as the memories.`;

const RECORD_SCHEMA = {
  type: 'object',
  properties: {
    dictation_id: { type: 'string' },
    sensitivity: { type: 'string', enum: ['work', 'personal'] },
    sensitivity_reason: { type: 'string' },
    episode: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        topics: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
      },
      required: ['summary', 'topics'],
    },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['fact', 'preference'] },
          statement: { type: 'string' },
          subject: { type: 'string' },
          topics: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
          quote: { type: 'string' },
          valid_from: { type: 'string' },
        },
        required: ['kind', 'statement', 'confidence', 'quote'],
      },
    },
    ignored: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, reason: { type: 'string' } },
        required: ['text', 'reason'],
      },
    },
  },
  required: ['dictation_id', 'sensitivity', 'episode', 'memories', 'ignored'],
} as const;

const BATCH_SCHEMA = {
  type: 'object',
  properties: { results: { type: 'array', items: RECORD_SCHEMA } },
  required: ['results'],
} as const;

export type ExtractionResult = {
  sensitivity: 'work' | 'personal' | 'secret';
  sensitivity_reason?: string;
  episode: { summary: string; topics: string[]; subject?: string };
  memories: Candidate[];
  ignored: { text: string; reason: string }[];
};

/**
 * A deterministic screen for secrets, applied regardless of what the model decided.
 *
 * The classifier reasonably read "here is the staging password for the test account" as
 * working material — it is about work — and Kivi then recited the password back when
 * asked. Judgement is the wrong and only line of defence for this one category: the cost
 * of missing a credential is unbounded, the cost of over-excluding a dictation is that
 * one message is not learned from. So a pattern match overrides the model here, and only
 * here.
 */
export function carriesCredential(text: string): string | null {
  const t = text.toLowerCase();
  const patterns: [RegExp, string][] = [
    [/\b(pass(word|phrase|code)|otp|pin)\b[^.!?\n]{0,40}?(is|=|:)\s*\S/i, 'states a password or passcode'],
    [/\b(api[ -]?key|secret[ -]?key|access[ -]?token|bearer|auth token|private key)\b/i, 'mentions an API key or token'],
    [/\b(sk-|gsk_|ghp_|xox[baprs]-|AIza)[A-Za-z0-9_-]{8,}/, 'contains something shaped like a key'],
    [/\b(?:\d[ -]?){13,16}\b/, 'contains something shaped like a card number'],
    [/\bcvv\b|\bifsc\b[^.!?\n]{0,30}\d/i, 'contains payment credentials'],
  ];
  for (const [re, why] of patterns) if (re.test(t)) return why;
  return null;
}

/** Cheap gate before we spend a model call. */
export function prefilter(d: Dictation): string | null {
  const text = (d.formatted || d.raw_asr || '').trim();
  if (text.length < 25) return 'too short to contain a durable claim';
  const words = text.split(/\s+/).length;
  if (words < 6) return 'fewer than six words';
  if (/^(um+|uh+|hmm+|testing|test)[\s.,!]*$/i.test(text)) return 'filler or a microphone test';
  return null;
}

function renderDictation(d: Dictation): string {
  const meta = JSON.parse(d.metadata_json || '{}');
  return [
    `--- DICTATION ${d.id} ---`,
    `Spoken at: ${d.spoken_at} (UTC)`,
    `Destination app: ${d.app ?? 'unknown'}`,
    d.context_label ? `Window / thread: ${d.context_label}` : null,
    d.style ? `Dictation style in force: ${d.style}` : null,
    meta.device ? `Device: ${meta.device}` : null,
    'RAW ASR OUTPUT:',
    d.raw_asr,
    'FORMATTED OUTPUT THE PERSON ACTUALLY SENT:',
    d.formatted,
  ]
    .filter(Boolean)
    .join(NL);
}

/**
 * Reads a batch of dictations in one model call. Batching is what makes ingesting a
 * 500-record corpus affordable: one request per five dictations rather than one each.
 * Each result is keyed by dictation_id so a partial response is still usable.
 */
export async function extractBatch(
  dictations: Dictation[],
  runId: string
): Promise<Map<string, ExtractionResult>> {
  const { value } = await generateJson<{ results: (ExtractionResult & { dictation_id: string })[] }>({
    system: EXTRACTION_SYSTEM,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Process each of the following ${dictations.length} dictations independently. ` +
              `Return one result per dictation, echoing its id in dictation_id.` + NL + NL +
              dictations.map(renderDictation).join(NL + NL),
          },
        ],
      },
    ],
    jsonSchema: BATCH_SCHEMA as any,
    temperature: 0,
    purpose: 'extract',
    runId,
  });

  const byId = new Map(dictations.map((d) => [d.id, d]));
  const out = new Map<string, ExtractionResult>();
  for (const r of value.results ?? []) {
    const d = byId.get(r.dictation_id);
    if (!d) continue;
    // Two different refusals, and they are not the same strength.
    //   personal - never learned from, but still the person's own words to find.
    //   secret   - never learned from and never retrieved, because repeating a
    //              credential back has no upside that could outweigh leaking it.
    const secret = carriesCredential(`${d.raw_asr} ${d.formatted}`);
    const personal = r.sensitivity === 'personal' || secret !== null;
    out.set(d.id, {
      sensitivity: secret ? 'secret' : personal ? 'personal' : 'work',
      sensitivity_reason: secret
        ? `${secret}; credentials are never learned from, whatever they are for`
        : r.sensitivity_reason,
      // Enforced here as well as in the prompt: a personal dictation produces nothing,
      // whatever the model returned alongside its classification.
      episode: personal
        ? { summary: '', topics: [] }
        : r.episode ?? { summary: d.formatted.slice(0, 180), topics: [] },
      memories: personal ? [] : groundedOnly(r.memories ?? [], d),
      ignored: r.ignored ?? [],
    });
  }
  return out;
}

/** A memory whose supporting quote is not in the dictation is a hallucination. Drop it. */
function groundedOnly(candidates: Candidate[], d: Dictation): Candidate[] {
  const text = `${d.raw_asr} ${d.formatted}`.toLowerCase();
  return candidates.filter((c) => {
    if (!c.statement || !c.quote) return false;
    if (c.confidence < 0.7) return false;
    const q = c.quote.toLowerCase().replace(/\s+/g, ' ').trim();
    return q.length > 0 && (text.includes(q) || overlapRatio(q, text) > 0.8);
  });
}

/** Tolerates small re-punctuations of a quote without letting invented text through. */
function overlapRatio(quote: string, haystack: string): number {
  const words = quote.match(/[a-z0-9']+/g) ?? [];
  if (words.length === 0) return 0;
  const hit = words.filter((w) => haystack.includes(w)).length;
  return hit / words.length;
}

/** Used only when a new candidate is close to something already stored. */
export const RECONCILE_SYSTEM = `You maintain a person's long-term memory in Kivi.

You are given one EXISTING memory and one NEW candidate that are textually similar.
Decide the relationship:

  "same"        - the new candidate says the same thing. Keep the existing memory, add evidence.
  "update"      - the new candidate contradicts or replaces the existing one (a date moved, a
                  decision changed, a preference reversed). The existing memory becomes history.
  "distinct"    - they are about different things and both should be kept.

Prefer "same" when in doubt. Choose "update" only when both cannot be true at once and the new
one is more recent. Give a one-sentence reason an engineer could audit.`;

export const RECONCILE_SCHEMA = {
  type: 'object',
  properties: {
    relation: { type: 'string', enum: ['same', 'update', 'distinct'] },
    reason: { type: 'string' },
    merged_statement: { type: 'string' },
  },
  required: ['relation', 'reason'],
} as const;
