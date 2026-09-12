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

Five surfaces. The first four are for a normal person; the last is for us.

**Hey Kivi (`/`)** — you ask, it answers from your own words. Every answer carries the
memories and dictations it was built from as chips you can open, and a plain "how did Kivi
get here?" link. When your history does not contain the answer, it says so instead of
guessing, and the interface labels that turn *not in your history* rather than dressing it
up as an answer.

**Dictation (`/dictate`)** — the half memory never touches. Speech becomes text from the
chosen style and nothing else; the endpoint returns the exact instructions it used so the
interface can show that no memory reached them, and the dictation is then read by the
memory writer so you can watch what was learned, which is usually nothing. Speech
recognition is the browser's own where available, and typing is the same path otherwise —
the brief does not ask for speech recognition, and nothing downstream depends on it.

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
           retrieval = dense (embeddings) ⊕ BM25 (FTS5), fused by RRF, weighted by
                       support count, confidence and (for episodes) recency
```

The two model workloads have opposite shapes, so they are routed independently.
Extraction is roughly a hundred large batched calls; Hey Kivi is many small ones where
latency is what the person feels. Free tiers are metered on opposite axes — Gemini by
requests per day, Groq by tokens per minute — so each workload goes where its limit is
not the binding one, and either can be pinned with `KIVI_EXTRACT_PROVIDER` and
`KIVI_CHAT_PROVIDER`. Embeddings stay on Gemini (Groq has none) with a local hashing
embedder as the last resort. Every call records which model served it.

### Three layers, not one

The distinction that makes the rest coherent is between what Kivi *kept* and what Kivi
*learned*. They are different things with different rules, and conflating them is how a
memory product ends up either useless or untrustworthy.

```
source history    every dictation, stored whole and searchable.
                  Nothing is summarised away; this is the person's own record.
      |
      v
index             one episode per dictation: what it was, where it went, when.
                  Derived, cheap, non-authoritative. It makes "the update I sent
                  around 5pm" findable without promoting its contents to a claim.
      |
      v
semantic memory   the small set of facts and preferences promoted because they will
                  still matter in a month. This is what Kivi will act on and repeat.
```

Only the third layer makes claims. That is why the transient content of a single
message is never a fact — it lives in source history, where it can be found but not
asserted — and why "anything you ever said stays findable" and "most of it is thrown
away" are both true without contradiction.

| layer | kind | what it is | why it exists |
| --- | --- | --- | --- |
| source | `dictations` | raw ASR, formatted output, app, time | the record; nothing else is authoritative |
| index | `episode` | one line per dictation | time-and-app recall, and keeping content out of facts |
| memory | `fact` | durable, checkable things: dates, owners, decisions, numbers | most questions are factual |
| memory | `preference` | how this person wants language produced, stated as a rule | this is what makes drafts sound like them |

Facts and preferences are scarce and heavily deduplicated: 166 facts and 7 preferences
from 499 dictations. Episodes are dense, one per dictation, and never merged.

### Inference, not guessing

Kivi is expected to combine things. The Truvia story takes three dictations across three
weeks and no single message contains it; assembling that *is* the product. What it must
not do is turn an assumption into a fact.

The line is grounded synthesis versus unsupported assertion, and it is enforced rather
than asked for: a memory is only written if the model can quote the sentence that
created it and that quote is found in the dictation; an answer's citations are checked
for existence *and* for actually bearing on what was said; and only an assertion becomes
a fact — a question, a suggestion, a hypothetical or someone else's opinion does not.

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

## Results

The evaluation in this repository, run against the committed corpus.

| | |
| --- | --- |
| Question cases passed | **30/34** |
| Memory-state checks passed | **9/9** |
| End-to-end latency | p50 **12529ms**, p90 29049ms |
| Cost of the evaluation | $0.06736 ($0.001981 per question) |
| Database | 7.6 MB for 505 dictations |

By group: supersession 2/2, preference 5/5, flagship 0/1, aggregation 3/5, fact 5/5, recency 1/2, abstention 5/5, privacy 4/4, clarification 1/1, episodic 1/1, control 2/2, honesty 1/1.

**On variance.** Earlier runs scored between 28 and 30 with different cases moving each
time, which makes any single number an anecdote. Retrieval was already deterministic, so
the model's tool choices are now made at temperature 0 as well. What never moved across
any run is the part that carries the position: supersession, privacy, preferences, the
flagship case, and all nine memory-state checks. The cases that do move are ones where
several dictations could honestly answer the question and Kivi picks a different true
source than the one the case names.

Every group testing a promise the vision makes passes: **supersession 2/2** (the launch
date moved, Kivi answers with the new one and can still say what it used to believe),
**privacy 4/4** including credentials and third parties, **preference 5/5**, **abstention
5/5**, **control 2/2** — which includes proving that forgetting takes effect — and all
memory-state checks, among them that no memory was learned from a personal dictation and
no inferred memory has lost its evidence.

Ingesting 499 dictations produced 651 memories, 40 of which superseded an earlier version,
and 8 dictations that taught it nothing, for about $0.05.

The remaining failures are reported rather than tuned away. Three cite a real but different
source than the case names — `truvia-thread` explains the Truvia timeouts from the
diagnosis rather than the fix, `hdfc-status` answers from a later HDFC update, and
`polish-yesterday-slack` polishes the right message while citing a neighbouring one. One,
`truvia-whole-story`, assembles the narrative correctly but leaves its sources out of the
answer. None invents anything, which is the failure that would actually matter.

## What the evaluation found, and what changed because of it

Running the evaluation repeatedly, against real limits rather than imagined ones, found
five faults. None was cosmetic, and three would have failed in front of a reviewer.

**A re-import silently destroyed every memory's provenance.** Importing a corpus that had
already been read left 361 of 521 memories unable to show the sentence they came from.
`INSERT OR REPLACE` deletes the existing row before inserting, and everything referencing
a dictation cascades on delete — so re-running the importer took the evidence with it.
This is exactly what a reviewer importing their own corpus would have hit. Dictations are
upserted in place now, and a memory-state check fails the evaluation if any inferred
memory has lost its evidence.

**A citation existed but did not support the answer.** Kivi answered "the V2 launch is set
for December 5 2026" — correct — and cited a memory reading "Vikram mandated a freeze on
everything for the HDFC launch". The answer was right and the citation was a real row, so
every check passed. But a citation is how the person checks Kivi, and pointing them
somewhere unrelated makes an unsupported claim look sourced. Citations are now verified
for support as well as existence.

**Privacy leaked through episodes.** The memory writer refused to store facts about health
or money, but an episode was written for *every* dictation, and an episode summarises the
very content the rules exclude. Kivi had stored "the user sent a WhatsApp message to their
sister about having a migraine and booking a neurologist appointment". The decision now
happens once, at extraction: a dictation classified personal produces no episode and no
memories, is excluded from every Hey Kivi lookup, and is labelled in `/history`.

**Supersession missed contradictions.** Both launch dates stayed active at once and Kivi
answered with the stale one. Reading was hybrid but *writing* was dense-only, so when the
embedder scored two contradictory statements far apart, no adjudication happened. The
older date came back third in the lexical ranking, behind two episodes about the same
subject — so the writer is hybrid too now, and judges the closest few candidates rather
than only the closest.

**The product asserted provenance it did not have.** Saying "hi" came back labelled "from
your history, high confidence" after zero lookups, and took 24 seconds. Conversation is
now a distinct outcome, the interface refuses to claim a source it does not have, and the
thinking budget was cut: 24.3s to 1.6s for a greeting, and about 2.5s for a real question.

Two failures were the evaluation's fault rather than the product's, and were corrected:
assertions that banned words Kivi may legitimately quote while explaining a refusal
("never use Warm regards"; "I looked for salary and found nothing"), and free-text answers
being recorded as refusals when they were correct and cited.

## Limitations

Written after running the thing, not before.

- **"Personal" is a model's judgement.** Seven dictations were classified personal and
  nothing was learned from them, but this is classification, not a guarantee. Every
  decision is visible in `/history`, which is the honest mitigation: you can see what it
  refused, and disagree.
- **Episodes are one row per dictation.** Five hundred rows the person never asked for.
  They earn it — time-and-app recall depends on them, and they keep transient content out
  of the fact layer — but it is a real cost and the reason the memory page filters by kind.
- **Reconciliation is pairwise.** A candidate is compared against its nearest existing
  memories, not against a cluster, and three-way contradictions are resolved in arrival
  order. It also over-fires occasionally: an early run retired "Rahul is the engineering
  lead" on the strength of a sentence that was not an assertion at all, which is what the
  assertion rule in extraction now exists to prevent.
- **Citation support is lexical.** A cited memory must share real content with the answer.
  That catches the case actually observed — a correct answer about the launch date cited
  to an unrelated memory about freezing scope — but it is an overlap heuristic, not
  entailment, and it will pass a citation that is topical yet beside the point.
- **Retrieval is a flat scan.** Correct and quick at this scale; it would need an ANN
  index well before a million memories.
- **One user.** A `user_id` column and no authentication. The demo operates as
  `KIVI_USER_ID`.
- **Free-tier limits dominate wall-clock, not the system.** Answering is fast — p50 under
  three seconds. Ingesting 499 dictations is about 120 model calls and the evaluation
  about 150, which sits inside a paid tier comfortably and awkwardly across free-tier
  ceilings: Gemini meters requests per day, Groq meters tokens per minute. Hence key
  rotation, resumable ingestion, and a pacing option on the evaluation. None of it is
  needed with a paid key.
- **Forgetting removes the claim, not the record.** The evaluation demonstrates this: the
  memory Kivi cited is deleted, the question asked again, and the memory is correctly no
  longer used — but the fact comes back, re-derived from the dictation that produced it.
  That is the layering behaving as designed and it is the honest reading of "forget": a
  memory is a claim Kivi will act on, and deleting it stops Kivi acting on it. The
  person's own words survive, because they are the person's own words. Erasing source
  history is a heavier action and this product does not offer it casually.
- **The model is not judged by another model.** Assertions are deterministic — outcome,
  substring, citation, database state — which is reproducible but coarser than a judge
  would be for open-ended answers.

## AI use

Written plainly, because the alternative is a claim that would not survive an interview.

- **The implementation** — application code, schema, corpus generator, evaluation harness,
  and the first drafts of these documents — was built with an AI coding agent (Claude Code,
  Opus 5) over several working sessions. I directed it, reviewed what it produced, and made
  the calls it could not: which capabilities deserved to exist, where the boundary with
  dictation sits, what must never be learned, and what to throw away.
- **The corpus wording** was generated with Gemini from a deterministic plan in
  `scripts/corpus-plan.ts`. The schedule, the apps, the subjects and the planted ground
  truth are fixed in that file; only the phrasing of each dictation is generated. That is
  what keeps the evaluation answerable — the truth of this history is not the model's to
  decide.
- **At runtime** a model is called for five things: reading dictations into memories,
  adjudicating contradictions, answering in Hey Kivi, drafting text, and formatting
  dictation. Retrieval embeddings come from `gemini-embedding-2` with a local hashing
  embedder as a fallback. Groq is supported as an alternative backend and is not required.
- **Part One** was drafted with the same assistant, then argued with and rewritten. The
  separation of source history from semantic memory, the insistence that combining several
  dictations is inference rather than guessing, the question of what Kivi may hold about a
  colleague who never chose to be here, and the point that "read everything it knows in a
  minute" does not scale — those came out of my reading of the drafts, and the documents
  were reshaped around them. The position they arrive at is one I hold and can defend.

The most useful thing the assistant did was not writing code. It was running the
evaluation often enough to find nine real faults, several of which would have failed in
front of a reviewer: a staging password recited back, provenance destroyed by re-importing
a corpus, citations that pointed at memories unrelated to the answer. Those are written up
above rather than quietly fixed.

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
