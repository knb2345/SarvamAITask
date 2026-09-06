import { config } from './config';
import { db, newId } from './db';
import { generate, generationProvider, type GenContent } from './gemini';
import { confirmMemory, createMemory, forgetMemory, getMemory } from './memory';
import { RETRIEVAL_FLOOR, searchDictations, searchMemories } from './retrieve';

/**
 * Hey Kivi.
 *
 * A small, closed set of tools. The agent may only speak through `respond`, which forces
 * every answer to declare its outcome and carry the ids it relied on. Anything it says
 * that is not supported by a retrieved row is a bug we can see.
 */

/** Words too common to prove that a citation is about the same thing as the answer. */
const COMMON = new Set([
  'user', 'this', 'that', 'with', 'from', 'have', 'they', 'their', 'about', 'would',
  'should', 'there', 'which', 'when', 'what', 'said', 'says', 'dictated', 'message',
  'slack', 'email', 'note', 'team', 'work', 'into', 'been', 'were', 'will', 'them',
]);

export const HEY_KIVI_SYSTEM = `You are Hey Kivi — the voice interface to a person's own dictation history.

You are talking to the person whose history this is. You are warm, extremely brief, and you
never pad. You speak in the second person ("you dictated…", "you said…").

WHAT YOU KNOW
Nothing except what the tools return. You have no general knowledge of this person, this
company, or their projects. If the tools return nothing relevant, you do not know the answer,
and you say so plainly. Never fill a gap with something plausible.

WHAT YOU KNOW IS NOT WHAT HAPPENED
This history is what the person dictated, which is a fraction of their work. They spoke
some of it into Kivi and lived the rest. So speak about the record, never about the world:

  "You did not mention any doctor's appointment"   - correct.
  "You have no doctor's appointment"               - not yours to say.
  "You last said the sandbox was stable on the 3rd" - correct.
  "The sandbox is stable"                          - stated as fact about the world.

Attribute anything you assembled from several dictations: say what they said and when,
not what is true. An answer can be perfectly grounded in this history and still be wrong
about the world, and the person is the only one who can tell the difference.

HOW TO WORK
1. Start with recall() for what the person is likely to have told Kivi over time, and
   find_dictations() when they are pointing at a specific thing they said ("the message I sent
   yesterday", "that Slack update around 5pm").
2. Search with SHORT KEYWORD QUERIES, not the person's whole sentence. "V2 launch date"
   finds the answer; "when does merchant onboarding V2 launch" buries it under everything
   ever said about onboarding. Name the subject and the attribute, nothing else.
3. Search more than once, with different words, before concluding you do not know. Facts
   about one subject are often spread across several dictations, and if the first search
   returns only loosely related material, try a narrower query rather than giving up.
4. Use open_dictation() when you need the exact words rather than a summary.
5. Use draft_text() whenever the person asks you to write, polish, rewrite, or prepare
   something. Pass the preference memory ids you found so the draft sounds like them.
6. Finish by calling respond(). That is the only way to speak.

RESPOND
- outcome "answered": you found it. Cite every memory id and dictation id you used.
- outcome "abstained": the history does not contain the answer. Say what you looked for.
  This is a correct, valuable outcome. Prefer it over a guess, always.
- outcome "asked": the request is genuinely ambiguous (two matching things, an unclear
  timeframe) and one short question resolves it. Do not use this to avoid searching.
- outcome "acted": you wrote a draft or changed what Kivi remembers.
- outcome "chatted": the person said hello, thanked you, or made small talk. Answer in a
  few words and do not search. Never present conversation as something you recalled.

Rules that override everything above:
- Every factual claim in your answer must come from a tool result you cite.
- If memories disagree, say so. Where one clearly replaced the other, lead with the
  current one and name both dates. Where they simply conflict and nothing settles it,
  give the person both and say you cannot tell which holds — quietly choosing one is how
  a memory system starts lying.
- When they ask whether something changed, or what it used to be, call recall() with
  include_history: true. A superseded memory is what Kivi believed before, and saying so
  is the point of keeping it.
- If a memory is low confidence or supported by only one offhand remark, say how you know it.
- Never invent dictation or memory ids. Never quote words that were not returned to you.
- Cite the memory that actually carries the answer, not whatever else the search returned.
  A citation is the person's way of checking you; pointing them at something unrelated is
  worse than citing nothing.

PERSONAL MATERIAL
Some of what the person dictates is not working material — health, money, family, politics,
credentials. Kivi does not learn from it and cannot retrieve it, by design. If someone asks
about something of that kind, do not pretend their history is empty: say plainly that Kivi
does not keep or use personal dictations, and that they can still find the message
themselves in their own history. Use outcome "abstained".`;

export const TOOL_DECLARATIONS = [
  {
    functionDeclarations: [
      {
        name: 'recall',
        description:
          'Search what Kivi has learned about this person over time: facts about their work, their standing preferences, and one-line episodes of what they dictated. Use natural-language queries.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What you are looking for, in natural language.' },
            kinds: {
              type: 'array',
              items: { type: 'string', enum: ['fact', 'preference', 'episode'] },
              description: 'Restrict to these kinds. Omit to search all three.',
            },
            since: { type: 'string', description: 'ISO date lower bound, optional.' },
            until: { type: 'string', description: 'ISO date upper bound, optional.' },
            include_history: {
              type: 'boolean',
              description:
                'Also search what Kivi used to believe: memories replaced by something the person said later. Use this whenever they ask whether something changed, or what it was before.',
            },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'find_dictations',
        description:
          'Find the actual dictations the person spoke, by content, destination app, and time. Use this when they refer to a specific thing they said or sent.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            app: { type: 'string', description: 'e.g. slack, gmail, notion, linear, whatsapp' },
            since: { type: 'string', description: 'ISO datetime lower bound' },
            until: { type: 'string', description: 'ISO datetime upper bound' },
            limit: { type: 'number' },
          },
        },
      },
      {
        name: 'open_dictation',
        description: 'Read one dictation in full: raw ASR, the formatted text that was sent, and its metadata.',
        parameters: {
          type: 'object',
          properties: { dictation_id: { type: 'string' } },
          required: ['dictation_id'],
        },
      },
      {
        name: 'draft_text',
        description:
          'Write or polish text on the person\'s behalf, applying their stored preferences and any source dictations you pass in.',
        parameters: {
          type: 'object',
          properties: {
            instruction: { type: 'string', description: 'What to produce, e.g. "polish this into a 3-bullet standup update".' },
            source_dictation_ids: { type: 'array', items: { type: 'string' } },
            preference_memory_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['instruction'],
        },
      },
      {
        name: 'remember',
        description:
          'Store something the person has explicitly asked Kivi to remember, in their own words. Only use when they ask directly.',
        parameters: {
          type: 'object',
          properties: {
            statement: { type: 'string', description: 'Third person, one claim, self-contained.' },
            kind: { type: 'string', enum: ['fact', 'preference'] },
          },
          required: ['statement', 'kind'],
        },
      },
      {
        name: 'forget',
        description: 'Remove a memory because the person asked, or confirm one they say is right.',
        parameters: {
          type: 'object',
          properties: {
            memory_id: { type: 'string' },
            action: { type: 'string', enum: ['forget', 'confirm'] },
          },
          required: ['memory_id', 'action'],
        },
      },
      {
        name: 'respond',
        description: 'Say the final thing to the person. This is the only way to speak.',
        parameters: {
          type: 'object',
          properties: {
            answer: { type: 'string', description: 'What the person reads or hears. Brief.' },
            outcome: { type: 'string', enum: ['answered', 'abstained', 'asked', 'acted', 'chatted'] },
            memory_ids: { type: 'array', items: { type: 'string' } },
            dictation_ids: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            draft: { type: 'string', description: 'If you produced text for the person, put the final version here verbatim.' },
          },
          required: ['answer', 'outcome'],
        },
      },
    ],
  },
];

export type TraceStep = {
  tool: string;
  args: any;
  ms: number;
  summary: string;
  candidates?: { id: string; kind?: string; text: string; score: number; vec: number; bm25: number; used: boolean }[];
};

export type HeyKiviResult = {
  answer: string;
  outcome: 'answered' | 'abstained' | 'asked' | 'acted' | 'chatted';
  confidence: string;
  draft?: string;
  citations: { memories: any[]; dictations: any[] };
  trace: {
    steps: TraceStep[];
    rounds: number;
    notes: string[];
    retrievalMs: number;
    modelMs: number;
    totalMs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    system: string;
  };
};

const MAX_ROUNDS = 8;

export async function askHeyKivi(userId: string, question: string, history: { role: 'user' | 'kivi'; text: string }[] = []): Promise<HeyKiviResult> {
  const t0 = Date.now();
  const steps: TraceStep[] = [];
  const notes: string[] = [];
  let retrievalMs = 0;
  let modelMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;

  const now = new Date();
  const preamble = `Today is ${now.toISOString().slice(0, 10)} (${now.toUTCString()}). All stored timestamps are UTC ISO8601.`;

  const contents: GenContent[] = [];
  for (const h of history.slice(-6)) {
    contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: `${preamble}\n\n${question}` }] });

  let final: any = null;
  let rounds = 0;

  while (rounds < MAX_ROUNDS && !final) {
    rounds++;
    const res = await generate({
      system: HEY_KIVI_SYSTEM,
      contents,
      tools: TOOL_DECLARATIONS,
      temperature: 0.1,
      purpose: 'answer',
      forceToolCall: true,
      provider: generationProvider(config.chatProvider),
    });
    modelMs += res.usage.latencyMs;
    inputTokens += res.usage.inputTokens;
    outputTokens += res.usage.outputTokens;
    costUsd += res.usage.costUsd;

    const calls = res.parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      // The model spoke without using respond(). It has still answered, and its answer
      // usually names the ids it used — so recover them rather than throwing away a
      // good reply and calling it a refusal, which is what it is not.
      const ids = res.text.match(/\b[md]_[a-z0-9]+\b/g) ?? [];
      notes.push(
        `model answered in free text instead of calling respond(); recovered ${ids.length} citation(s) from the text`
      );
      final = {
        answer: res.text || 'I could not work that out.',
        outcome: res.text ? 'answered' : 'abstained',
        memory_ids: ids.filter((i) => i.startsWith('m_')),
        dictation_ids: ids.filter((i) => i.startsWith('d_')),
      };
      break;
    }

    contents.push({ role: 'model', parts: res.parts });
    const responses: any[] = [];

    for (const p of calls) {
      const fc = p.functionCall!;
      if (fc.name === 'respond') {
        final = fc.args;
        break;
      }
      const tStep = Date.now();
      const { result, step } = await runTool(fc.name, fc.args ?? {}, userId);
      const ms = Date.now() - tStep;
      if (fc.name === 'recall' || fc.name === 'find_dictations') retrievalMs += ms;
      if (fc.name === 'draft_text') {
        modelMs += (result.__usage?.latencyMs ?? 0);
        inputTokens += result.__usage?.inputTokens ?? 0;
        outputTokens += result.__usage?.outputTokens ?? 0;
        costUsd += result.__usage?.costUsd ?? 0;
        delete result.__usage;
      }
      steps.push({ ...step, tool: fc.name, args: fc.args ?? {}, ms });
      responses.push({ functionResponse: { name: fc.name, id: (fc as any).id, response: result } });
    }
    if (final) break;
    contents.push({ role: 'user', parts: responses });
  }

  if (!final) {
    notes.push(`stopped after ${MAX_ROUNDS} tool rounds without a final response`);
    final = { answer: 'I looked but could not settle this one. Try narrowing it down?', outcome: 'abstained', memory_ids: [], dictation_ids: [] };
  }

  // Citations must resolve to real rows AND actually bear on what was said.
  const memIds: string[] = final.memory_ids ?? [];
  const dictIds: string[] = final.dictation_ids ?? [];
  const memories = memIds.map((id) => getMemory(id)).filter(Boolean);
  const dictations = dictIds
    .map((id) => db().prepare('SELECT id, spoken_at, app, context_label, formatted FROM dictations WHERE id = ?').get(id))
    .filter(Boolean);
  const invalid = [
    ...memIds.filter((id) => !memories.find((m: any) => m.id === id)),
    ...dictIds.filter((id) => !dictations.find((d: any) => d.id === id)),
  ];
  if (invalid.length) notes.push(`dropped ${invalid.length} citation(s) that do not exist: ${invalid.join(', ')}`);

  /*
   * A citation that exists but has nothing to do with the answer is worse than no
   * citation at all: it makes an unsupported claim look sourced, and the person clicks
   * it expecting to see where the answer came from. Observed in practice — a correct
   * answer about the December launch date arrived cited to a memory about freezing
   * scope for HDFC. So each citation has to share real content with what was said, or
   * it is dropped and the discrepancy recorded.
   */
  const unrelated: string[] = [];
  const supported = (text: string) => {
    const words = (t: string) =>
      new Set(
        (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 3 && !COMMON.has(w))
      );
    const a = words(final.answer + ' ' + (final.draft ?? ''));
    const b = words(text);
    if (b.size === 0) return true;
    let shared = 0;
    for (const w of b) if (a.has(w)) shared++;
    return shared >= 2 || shared / b.size >= 0.34;
  };

  const keptMemories = (memories as any[]).filter((m) => {
    if (supported(m.statement)) return true;
    unrelated.push(m.id);
    return false;
  });
  const keptDictations = (dictations as any[]).filter((d) => {
    if (supported(d.formatted)) return true;
    unrelated.push(d.id);
    return false;
  });
  if (unrelated.length) {
    notes.push(
      `dropped ${unrelated.length} citation(s) that do not support the answer: ${unrelated.join(', ')}`
    );
  }
  if (final.outcome === 'answered' && keptMemories.length === 0 && keptDictations.length === 0) {
    // Saying "from your history" about an answer with no source is the very thing this
    // product exists not to do. What the turn actually was depends on what happened.
    const searched = steps.some((s) => s.tool === 'recall' || s.tool === 'find_dictations');
    const saysNothingFound =
      /(did ?n[o']?t find|could ?n[o']?t find|no (record|mention|dictation|reference)|nothing|does not (contain|mention|keep|use)|does not keep|do ?n[o']?t (have|keep|use)|never (said|mentioned)|not in your|by design)/i.test(
        final.answer
      );
    // Order matters: a refusal is an abstention whether or not Kivi searched first.
    // Declining on principle ("Kivi does not keep credentials") is not small talk, and
    // labelling it as such would hide the refusal the product is meant to be judged on.
    if (saysNothingFound) {
      final.outcome = 'abstained';
      notes.push('reported finding nothing, or declined; recorded as an abstention');
    } else if (!searched) {
      final.outcome = 'chatted';
      notes.push('no lookup was performed; recorded as conversation rather than recall');
    } else {
      notes.push('answered with no supporting citation — treat this result as unsupported');
    }
  }

  return {
    answer: final.answer,
    outcome: final.outcome,
    confidence: final.confidence ?? 'medium',
    draft: final.draft,
    citations: { memories: keptMemories, dictations: keptDictations },
    trace: {
      steps, rounds, notes, retrievalMs, modelMs,
      totalMs: Date.now() - t0,
      inputTokens, outputTokens, costUsd,
      system: HEY_KIVI_SYSTEM,
    },
  };
}

async function runTool(name: string, args: any, userId: string): Promise<{ result: any; step: Omit<TraceStep, 'tool' | 'args' | 'ms'> }> {
  switch (name) {
    case 'recall': {
      // Context is not free: every memory handed to the model costs tokens, latency and
      // a little of its attention. Six well-ranked memories with one quote each answer
      // the question; twenty with three quotes each mostly bury it.
      const found = await searchMemories({
        userId, query: args.query, kinds: args.kinds, since: args.since ?? null,
        until: args.until ?? null, limit: Math.min(args.limit ?? 6, 10),
        // Superseded memories are history, not deletions — but they stay out of the way
        // unless the person is actually asking what changed.
        includeInactive: args.include_history === true,
      });
      const kept = found.filter((m) => m.score >= RETRIEVAL_FLOOR);
      return {
        result: {
          memories: kept.map((m) => ({
            id: m.id, kind: m.kind, statement: m.statement, subject: m.subject,
            confidence: Number(m.confidence.toFixed(2)), supported_by_dictations: m.support_count,
            first_seen: m.first_seen_at.slice(0, 10), last_seen: m.last_seen_at.slice(0, 10),
            status: m.status === 'active' ? undefined : m.status,
            evidence: m.evidence.slice(0, 1).map((e) => ({
              dictation_id: e.dictation_id, on: e.spoken_at.slice(0, 16), app: e.app,
              quote: e.quote.slice(0, 160),
            })),
          })),
          note: kept.length === 0 ? 'nothing stored matched this query above the relevance floor' : undefined,
        },
        step: {
          summary: `${kept.length} of ${found.length} candidate memories passed the relevance floor (${RETRIEVAL_FLOOR})`,
          candidates: found.map((m) => ({
            id: m.id, kind: m.kind, text: m.statement, score: Number(m.score.toFixed(4)),
            vec: Number(m.vec_score.toFixed(4)), bm25: Number(m.bm25_score.toFixed(3)),
            used: m.score >= RETRIEVAL_FLOOR,
          })),
        },
      };
    }
    case 'find_dictations': {
      const found = await searchDictations({
        userId, query: args.query, app: args.app ?? null, since: args.since ?? null,
        until: args.until ?? null, limit: Math.min(args.limit ?? 6, 12),
      });
      const withheld = (
        db()
          .prepare(
            `SELECT COUNT(*) c FROM dictations WHERE user_id = ? AND sensitivity = 'personal'`
          )
          .get(userId) as any
      ).c;
      return {
        result: {
          dictations: found.map((d) => ({
            id: d.id, spoken_at: d.spoken_at, app: d.app, context: d.context_label,
            style: d.style, preview: d.formatted.slice(0, 220),
          })),
          note: found.length === 0 ? 'no dictations matched' : undefined,
          excluded_personal_dictations: withheld,
        },
        step: {
          summary: `${found.length} dictations matched (${withheld} personal dictations are excluded from every search)`,
          candidates: found.map((d) => ({
            id: d.id, text: d.formatted.slice(0, 140), score: Number(d.score.toFixed(4)),
            vec: Number(d.vec_score.toFixed(4)), bm25: Number(d.bm25_score.toFixed(3)), used: true,
          })),
        },
      };
    }
    case 'open_dictation': {
      const d = db().prepare('SELECT * FROM dictations WHERE id = ? AND user_id = ?').get(args.dictation_id, userId) as any;
      if (!d) return { result: { error: 'no dictation with that id' }, step: { summary: `miss: ${args.dictation_id}` } };
      if (d.sensitivity === 'personal') {
        return {
          result: { error: 'this dictation is personal, not working material, and Kivi does not use it' },
          step: { summary: `withheld ${d.id}: classified personal at ingest` },
        };
      }
      const mem = db()
        .prepare(`SELECT m.id, m.kind, m.statement FROM memory_evidence e JOIN memories m ON m.id = e.memory_id WHERE e.dictation_id = ?`)
        .all(d.id);
      return {
        result: {
          id: d.id, spoken_at: d.spoken_at, app: d.app, context: d.context_label, style: d.style,
          raw_asr: d.raw_asr, formatted: d.formatted, metadata: JSON.parse(d.metadata_json || '{}'),
          memories_from_this_dictation: mem,
        },
        step: { summary: `opened ${d.id} (${d.app ?? 'unknown app'}, ${d.spoken_at.slice(0, 16)})` },
      };
    }
    case 'draft_text': {
      const sources = (args.source_dictation_ids ?? [])
        .map((id: string) => db().prepare('SELECT id, spoken_at, app, formatted FROM dictations WHERE id = ?').get(id))
        .filter(Boolean) as any[];
      const prefs = (args.preference_memory_ids ?? []).map((id: string) => getMemory(id)).filter(Boolean) as any[];
      const res = await generate({
        system: `You write in another person's voice inside Kivi. Produce only the finished text —
no preamble, no explanation, no options. Follow the person's stored preferences exactly; where
they are silent, keep the person's own words from the source material rather than improving them.
Never introduce a fact that is not in the sources.`,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  `TASK: ${args.instruction}`,
                  prefs.length ? `\nTHIS PERSON'S STORED PREFERENCES:\n${prefs.map((p) => `- ${p.statement}`).join('\n')}` : '\n(no stored preferences apply)',
                  sources.length
                    ? `\nSOURCE MATERIAL (their own dictations):\n${sources.map((s) => `[${s.id}, ${s.spoken_at.slice(0, 16)}, ${s.app}]\n${s.formatted}`).join('\n\n')}`
                    : '',
                ].join('\n'),
              },
            ],
          },
        ],
        temperature: 0.3,
        purpose: 'draft',
        provider: generationProvider(config.chatProvider),
      });
      return {
        result: {
          draft: res.text,
          applied_preferences: prefs.map((p) => ({ id: p.id, statement: p.statement })),
          used_sources: sources.map((s) => s.id),
          __usage: res.usage,
        },
        step: {
          summary: `drafted ${res.text.length} chars applying ${prefs.length} preference(s) and ${sources.length} source(s)`,
        },
      };
    }
    case 'remember': {
      const m = await createMemory(
        {
          userId, kind: args.kind, statement: args.statement, confidence: 0.98,
          source: 'user_stated', seenAt: new Date().toISOString(),
        },
        [],
        'the person asked Kivi to remember this during a Hey Kivi conversation',
        'user'
      );
      return { result: { memory_id: m.id, stored: m.statement }, step: { summary: `stored ${m.id} at the person's request` } };
    }
    case 'forget': {
      const before = getMemory(args.memory_id);
      if (!before) return { result: { error: 'no such memory' }, step: { summary: `miss: ${args.memory_id}` } };
      if (args.action === 'confirm') {
        confirmMemory(args.memory_id, 'confirmed by the person in conversation');
        return { result: { ok: true, memory_id: args.memory_id, status: 'confirmed' }, step: { summary: `confirmed ${args.memory_id}` } };
      }
      forgetMemory(args.memory_id, 'user', 'the person asked Kivi to forget this in conversation');
      return { result: { ok: true, memory_id: args.memory_id, status: 'forgotten' }, step: { summary: `forgot ${args.memory_id}` } };
    }
    default:
      return { result: { error: `unknown tool ${name}` }, step: { summary: `unknown tool ${name}` } };
  }
}

export function saveTurn(conversationId: string, role: 'user' | 'kivi', text: string, result?: HeyKiviResult) {
  const id = newId('t');
  db()
    .prepare(
      `INSERT INTO turns (id, conversation_id, role, text, outcome, trace_json, citations_json,
         latency_ms, input_tokens, output_tokens, cost_usd)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, conversationId, role, text, result?.outcome ?? null,
      result ? JSON.stringify(result.trace) : null,
      JSON.stringify(result?.citations ?? []),
      result?.trace.totalMs ?? null, result?.trace.inputTokens ?? null,
      result?.trace.outputTokens ?? null, result?.trace.costUsd ?? null
    );
  return id;
}

export function ensureConversation(userId: string, id?: string): string {
  if (id) {
    const row = db().prepare('SELECT id FROM conversations WHERE id = ?').get(id);
    if (row) return id;
  }
  const cid = id || newId('c');
  db().prepare('INSERT OR IGNORE INTO conversations (id, user_id) VALUES (?,?)').run(cid, userId);
  return cid;
}

export const RETRIEVAL_FLOOR_EXPORT = config.minMemoryScore;
