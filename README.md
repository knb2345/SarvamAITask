# Kivi — semantic memory

**Kivi remembers your work, not you.**

This repository is a working end-to-end product: a voice-first interface (Hey Kivi) that
answers questions about a person's own dictation history, a memory system that decides what
is worth keeping from 500 dictations, and the evidence that both behave.

- Product positioning statement → [`docs/POSITIONING.md`](docs/POSITIONING.md)
- Product vision → [`docs/VISION.md`](docs/VISION.md)
- **How to run and review it → [`RUN.md`](RUN.md)** ← start here
- Evaluation results → [`eval/results/results.md`](eval/results/results.md)

---

## The product

Four surfaces. The first three are for a normal person; the fourth is for us.

**Hey Kivi (`/`)** — you ask, it answers from your own words. Every answer carries the
memories and dictations it was built from as chips you can open, and a plain "how did Kivi
get here?" link. When your history does not contain the answer, it says so instead of
guessing, and the interface labels that turn *not in your history* rather than dressing it
up as an answer.

**What Kivi knows (`/memory`)** — the memory itself, written as sentences a person can read.
Each card shows how many times you said it, since when, and — one click away — the exact
words that produced it. "Fix it" and "forget it" are on every card, and forgetting also
works mid-conversation when Kivi gets something wrong in front of you. There is nothing to
configure: no consent screen, no retention settings, no administration.

**Dictation history (`/history`)** — the raw material. For each dictation: what was sent,
what the recogniser actually heard, what Kivi kept from it, and *what it decided not to
keep, with reasons*. That last section is the trust argument made visible.

**Why (`/inspect`)** — the engineer's surface: every Hey Kivi turn with its retrieval
candidates and fused/vector/BM25 scores, which ones cleared the floor, the tool sequence,
tokens, latency and cost; plus the most recent extraction decisions.

### The boundary with dictation

Semantic memory **never touches regular dictation**. Dictation stays a fast, predictable
path from speech to text governed by styles and phonetic memory. If memory could reach into
it, the same sentence would come out differently on different days, and the person could not
predict their own tool. Memory earns its place in Hey Kivi, where a question was asked and
the reasoning can be shown. This is a product decision, and the code enforces it: nothing in
the dictation path reads the `memories` table.

## Use cases it was built around

Three, chosen because they create value that a search box does not:

1. **Recover something you said** — by time, app and subject. *"Find the Slack update I
   dictated around 5pm yesterday."*
2. **Assemble a fact that lives across several dictations** — *"What happened with the
   Truvia KYC timeouts?"* is answered from three dictations in three apps three weeks apart.
3. **Produce work that sounds like you** — *"…and polish it for the meeting I'm walking
   into"* applies preferences you stated weeks ago (three bullets, no greeting, never the
   word "synergy").

And one non-capability that matters as much: **refusing**. Pricing, hiring plans and your
last performance review are not in the history, and Kivi says so.

## Architecture

```
corpus (jsonl)
   │
   ├─ prefilter ─────────────────► skipped, with a reason        [extraction_decisions]
   │
   ├─ extract (Gemini, batched, JSON-schema'd)
   │     ├─ episode summary (always, one per dictation)
   │     ├─ fact / preference candidates + verbatim quote + confidence
   │     └─ "ignored" list + reason                              [extraction_decisions]
   │
   ├─ groundedness gate: quote must appear in the dictation, else dropped
   │
   └─ reconcile, in chronological order
         cosine ≥ 0.93  → reinforce (add evidence, raise confidence)  [memory_revisions]
         0.78 – 0.93    → model adjudication: same / update / distinct
                          update → supersede (old kept as history)
         < 0.78         → create                                     [memory_evidence]

Hey Kivi:  question → tools(recall, find_dictations, open_dictation, draft_text,
                            remember, forget) → respond(answer, outcome, citations)
           retrieval = dense (Gemini embeddings) ⊕ BM25 (FTS5), fused by RRF,
                       weighted by support count, confidence and (for episodes) recency
```

### What a memory is

One claim, in the third person, self-contained, that will still be useful in a month —
plus the sentence that produced it. Three kinds:

| kind | what it is | why it exists |
| --- | --- | --- |
| `fact` | durable, checkable things about the work: dates, owners, decisions, numbers | most questions are factual |
| `preference` | how this person wants language produced, stated as a rule | this is what makes drafts sound like them |
| `episode` | one line per dictation: what it was, where it went, when | makes "the thing I sent at 5pm" findable, and keeps transient content *out* of facts |

Facts and preferences are scarce and heavily deduplicated. Episodes are dense — exactly one
per dictation, never merged — and act as the index over what happened.

### What it deliberately ignores

Enforced in the extraction prompt and visible in `extraction_decisions`: health and medical
matters, money and salary, family and relationships, politics and religion, credentials,
third-party private detail, moods and one-off feelings, and the transient content of a
single message. The corpus contains all of these on purpose (a migraine, an appraisal
number, a staging password, gossip about a colleague resigning) and the evaluation asserts
that none of them made it into memory.

### Storage and retrieval

SQLite (`better-sqlite3`), schema in `db/migrations/001_init.sql`:

- `dictations` + `dictations_fts` (FTS5) + `dictation_embeddings` (768-dim float32 blobs)
- `memories` + `memories_fts` + `memory_embeddings`
- `memory_evidence` — memory ↔ dictation with the quote (provenance)
- `memory_revisions` — every change, who made it, and why (created / reinforced / amended /
  superseded / forgotten / confirmed)
- `extraction_decisions` — every candidate and its fate, *including the rejected ones*
- `model_calls` — tokens, latency and cost for every request the system makes
- `conversations` / `turns` — every Hey Kivi turn with its full trace

Retrieval is a flat scan fused with FTS5. At this scale (one user, hundreds of memories,
thousands of dictations) an ANN index would be ceremony: p50 retrieval is a few hundred
milliseconds, dominated by the embedding round-trip, not the search. A vector extension
becomes worthwhile in the tens of thousands of memories per user.

**Embeddings are not allowed to be a single point of failure.** If the embedding API is
out of quota or unreachable, a circuit breaker trips once and the rest of the run uses a
built-in local embedder (`src/lib/localembed.ts`: a hashing vectoriser over words, word
pairs and character 4-grams — the n-grams are what keep an ASR spelling like "true via"
near "Truvia"). It is weaker at paraphrase than a neural embedding, which is exactly why
retrieval fuses dense with BM25 instead of trusting either alone, and why the duplicate
thresholds are calibrated per provider. Every vector row records the provider that made
it, and a query is only ever compared against vectors from the same provider, so the two
spaces are never mixed. `npm run reindex` re-embeds with the API when quota returns.

### Why an answer came out that way

Every Hey Kivi turn stores its trace: the exact tool arguments, every retrieval candidate
with its fused, vector and BM25 scores, whether it cleared `KIVI_MIN_MEMORY_SCORE`, the tool
results, the rounds, tokens, latency and cost. A memory that *did not* influence a result
appears in the trace as a candidate below the floor — the negative case is inspectable, not
just the positive one. Read it at `/inspect`, under any answer, or in `eval/results/results.json`.

Citations are verified server-side: any memory or dictation id the model cites that does not
resolve to a row is dropped and recorded in the trace as a warning, and an "answered" turn
with no surviving citation is flagged as unsupported.

## Corpus

`corpus/dictations.jsonl` — **499 records** for one user (Ananya Rao, a PM at a payments
company) over four months, across Slack, Gmail, Linear, Notion, WhatsApp, notes and docs.
Each record has raw ASR output (disfluencies, no punctuation, plausible mis-recognitions of
names), the formatted output that was actually sent, and metadata (app, window/thread label,
style, duration, device).

The schedule — every date, app, style and subject — is deterministic and lives in
`scripts/corpus-plan.ts`; only the wording was generated (Gemini), which is what makes the
ground truth ours. 22 records carry `planted` tags the evaluation asserts against: a launch
date that moves mid-corpus, five stated preferences, a three-part incident story, metrics,
decisions, and six records containing exactly the material Kivi must refuse to remember.

Regenerate with `npm run corpus:generate` (the committed file is what the evaluation uses).

## Evaluation

`npm run eval` runs 30 question cases and 6 memory-state checks through the *complete*
pipeline — real retrieval, real tools, real model — and writes `eval/results/results.json`
(everything: input, candidates with scores, memory provenance, trace, verdict) and
`results.md` (summary, latency, cost, failures).

Cases are grouped by what they test: `supersession`, `preference`, `flagship`, `aggregation`,
`fact`, `recency`, `abstention`, `privacy`, `clarification`, `episodic`, `control`. Roughly a
third of them are cases where the correct behaviour is to *refuse* or to *not know* — this is
the part of the evaluation that keeps the rest honest.

Results, including the failures, are in [`eval/results/results.md`](eval/results/results.md).

## What the evaluation found, and what changed because of it

The first full evaluation run scored **22/30 question cases and 2/6 memory-state checks**, and
it earned its place by finding two real architectural faults rather than cosmetic ones.

**Privacy leaked through episodes.** The memory writer correctly refused to store facts or
preferences about health, money or family — but an episode was written for *every* dictation,
and an episode summarises the very content the rules exclude. Kivi had stored *"The user sent a
WhatsApp message to their sister about having a migraine and booking a neurologist
appointment."* The rule was enforced in one layer and not the other.

The fix moves the decision to where it can only be made once: extraction now classifies each
dictation `work` or `personal` **before** anything else, a personal one produces no episode and
no memories (enforced in code as well as in the prompt), the classification is stored on the
dictation (`003_sensitivity.sql`), and both Hey Kivi retrieval tools exclude those rows. Kivi
says so plainly instead of pretending the history is empty. `/history` labels them, `/inspect`
counts them, and a memory-state check now fails if any active memory has evidence from a
personal dictation.

**Supersession silently failed.** Both launch dates stayed active at once and Kivi answered with
the stale one. Reading was hybrid; *writing* was dense-only — reconciliation looked for
duplicate candidates by vector similarity alone, so when the embedder scored two contradictory
statements far apart, no adjudication ever happened. Candidate lookup is now hybrid as well, and
the closest few candidates are adjudicated rather than only the single closest: the older launch
date came back *third* in the lexical ranking, behind two episodes about the same subject.

One failure was the evaluation's fault, not the product's: `signoff-preference` failed because
Kivi correctly answered *"never use Warm regards"*, and a substring assertion cannot tell a
quotation from a usage. That assertion was corrected.

## Limitations

- **One user.** No multi-tenant separation beyond a `user_id` column and no auth; the demo
  operates as `KIVI_USER_ID`.
- **Retrieval is a flat scan.** Correct and fast at this scale; it would need an ANN index
  well before a million memories.
- **Extraction quality is the ceiling.** Everything downstream depends on the memory writer's
  judgement. The groundedness gate catches invented quotes, but a wrong-but-quotable reading
  of an ambiguous sentence will still get through — which is why every memory shows its
  source sentence and can be deleted in one tap.
- **Reconciliation is pairwise.** A candidate is compared against its nearest existing
  memory, not against a cluster; three-way contradictions are resolved in arrival order.
- **The model is not evaluated by another model.** Assertions are deterministic (outcome,
  substring, citation, memory-state), which makes them reproducible but coarser than a judge
  would be for open-ended answers.
- **Free-tier rate limits dominate wall-clock.** Ingestion is minutes of work and tens of
  minutes of waiting on a free key. On a paid key it is roughly 5 minutes.
- **No speech.** Per the brief, dictations are replayed from a corpus; the interface types
  what you would say.

## AI use

- The **implementation** (application code, schema, corpus generator, evaluation harness) was
  written with an AI coding agent (Claude Code, Opus 5), directed and reviewed by me.
- The **corpus wording** was generated with Gemini from a deterministic plan I wrote; the
  schedule, the planted ground truth and the evaluation assertions are mine.
- At **runtime** the system uses Gemini for three things only: memory extraction, conflict
  adjudication, and Hey Kivi's answering and drafting. Embeddings are `gemini-embedding-2`.
- **Part One** (positioning and vision) states my own position — the argument, what I chose to
  reject, and the boundary with dictation are mine and I am prepared to defend them in the
  interview.

## Repository map

```
docs/POSITIONING.md, docs/VISION.md   Part One
db/migrations/001_init.sql            schema (the only migration; db:reset applies it)
src/lib/config.ts                     env, model ids, pricing table
src/lib/db.ts                         connection, migrations, ids
src/lib/gemini.ts                     API client: retries, quota back-off, cost ledger
src/lib/extract.ts                    what may be learned, and what may never be (prompt)
src/lib/ingest.ts                     the pipeline: prefilter → extract → reconcile
src/lib/memory.ts                     create / reinforce / supersede / amend / forget
src/lib/retrieve.ts                   hybrid retrieval, RRF, similarity for dedup
src/lib/agent.ts                      Hey Kivi: tools, loop, citation verification, trace
src/app/                              the four surfaces + API routes
scripts/corpus-plan.ts                the deterministic corpus schedule and ground truth
scripts/generate-corpus.ts            corpus generation
scripts/ingest.ts, seed.ts            import
scripts/eval.ts                       the evaluation
scripts/migrate.ts, reset.ts          database lifecycle
eval/questions.json                   30 cases + 6 memory-state checks
eval/results/                         generated results
corpus/dictations.jsonl               499 records
```
