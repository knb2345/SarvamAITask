# Evaluation

`npm run eval` runs the complete pipeline — real retrieval, real tools, real model calls —
against whatever is currently in the database, and writes both a machine-readable and a
human-readable record.

## What is asserted

`questions.json` holds two kinds of check.

**Question cases** (30). Each one states what a correct product does, not what a model
happens to say:

| field | meaning |
| --- | --- |
| `expect_outcome` | `answered`, `abstained`, `asked` or `acted` — a list means any of them is acceptable |
| `expect_any` | at least one of these strings must appear in the answer or draft |
| `must_not_contain` | none of these may appear — this is where superseded facts and refused-memory content are caught |
| `cite_planted` | the answer must cite the dictation carrying this planted tag, directly or through a memory's evidence |
| `expect_draft` / `draft_checks` | a draft was produced and obeys the person's stated preferences (line count, sentence count, banned words) |
| `expect_memory_created` | an explicit "remember this" actually wrote a `user_stated` memory |
| `why` | why this case is in the set at all |

**Memory-state checks** (6). Assertions about the database itself, with no model involved:
that nothing about health, personal money, credentials or gossip was ever written; that the
old launch date is `superseded` rather than deleted; and that a preference stated three times
is one memory rather than three.

Around a third of the question cases expect a refusal. A memory system that answers
everything is not trustworthy — those cases are what keeps the rest honest.

## What is produced

- `results/results.md` — pass/fail by group, latency percentiles, cost per question,
  ingestion cost and database growth, then every failure written out with its trace.
- `results/results.json` — for every case: the question, the outcome, the answer, each cited
  memory with its provenance dictation ids, and the full reasoning trace including every
  retrieval candidate with its fused / vector / BM25 score and whether it cleared the floor.

## Reading a failure

Each failure names the assertion that broke ("outcome was abstained, expected answered",
"did not cite the source dictation for `truvia_resolution`"). Open the same case id in
`results.json` and the `reasoning_trace.steps[].candidates` list shows whether the memory was
never retrieved, retrieved but below the floor, or retrieved and ignored by the model — which
are three different bugs with three different fixes.
