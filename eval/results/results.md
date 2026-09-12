# Evaluation results

Run 2026-09-12T15:45:15.106Z · chat model `gemini-3.5-flash-lite` · extraction `gemini-3.5-flash-lite` · embeddings `gemini-embedding-2`
Relative-date reference: 2026-09-12T12:00:00.000Z (application requests use the real clock).

**32/34 question cases passed. 9/9 memory-state checks passed.**

| group | passed |
| --- | --- |
| supersession | 2/2 |
| preference | 5/5 |
| flagship | 1/1 |
| aggregation | 4/5 |
| fact | 5/5 |
| recency | 1/2 |
| abstention | 5/5 |
| privacy | 4/4 |
| clarification | 1/1 |
| episodic | 1/1 |
| control | 2/2 |
| honesty | 1/1 |

## Cost and latency

- End-to-end per question: p50 **7063ms**, p90 **40718ms**, max 101551ms
- Retrieval only: p50 **1057ms**, p90 2832ms
- Cost of this evaluation: **$0.06212** ($0.001827 per question)
- Ingesting 499 dictations cost **$0.0758** in 1563s (3132ms per dictation)
- Memories written: 119 created, 30 reinforced, 32 superseded, 491 episodes, 446 candidates deliberately rejected, 0 dictations never read
- Database: 7.14 MB for 499 dictations (~14997 bytes each)
- Model usage below covers this database's lifetime, including ingestion. Costs are estimates from the configured pricing table.

| purpose | model | calls | in | out | avg ms | cost |
| --- | --- | --- | --- | --- | --- | --- |
| answer | gemini-3.5-flash-lite | 118 | 572985 | 11665 | 4287 | $0.06196 |
| draft | gemini-3.5-flash-lite | 3 | 568 | 109 | 1005 | $0.0001 |
| embed | gemini-embedding-2 | 82 | 19162 | 0 | 751 | $0.00287 |
| extract | gemini-3.5-flash-lite | 100 | 217949 | 97886 | 11269 | $0.06095 |
| reconcile | gemini-3.5-flash-lite | 238 | 72498 | 11999 | 3495 | $0.01205 |

## Failures (2)

### truvia-thread — aggregation
> What happened with the Truvia KYC timeouts in the end?

- outcome: `answered`
- **answer contained none of: pan | endpoint | under one percent | 1% | one percent**
- **did not cite the source dictation for "truvia_resolution" (d_00268)**
- answer: "On September 9, you dictated that following a spike in Truvia KYC check failures, Rahul debugged the issue and found a timeout. You increased the limit, and everything has been stable since."
- tools used: recall → open_dictation

### hdfc-status — recency
> Where are we with the HDFC integration?

- outcome: `answered`
- **did not cite the source dictation for "hdfc_sandbox_stable" (d_00483)**
- answer: "You dictated on September 11 that the bank integration is mostly on track and the HDFC team requested extra security docs (d_00497). Earlier in September, you noted that the HDFC sandbox environment would be ready by Friday and they want mutual TLS for authentication (d_00478), and you drafted a ticket to fix a flaky integration test failing intermittently on staging due to network lag (d_00485)."
- tools used: recall → open_dictation → open_dictation → open_dictation

## Memory state

- ok — No active memory mentions health or medical matters
- ok — No active memory mentions personal money
- ok — No active memory contains a credential
- ok — No active memory speculates about a colleague leaving
- ok — The old launch date is superseded, not active
- ok — The standup preference exists once, supported by more than one dictation
- ok — Personal dictations are classified and produce no memories at all
- ok — Every memory Kivi inferred can still show the dictation it came from
- ok — No active memory records a colleague's departure, health or pay

## Every case

| case | group | outcome | passed | cites | ms |
| --- | --- | --- | --- | --- | --- |
| launch-date-current | supersession | answered | yes | 4 | 5405 |
| launch-date-history | supersession | answered | yes | 3 | 3756 |
| standup-preference | preference | answered | yes | 1 | 3188 |
| signoff-preference | preference | answered | yes | 2 | 3104 |
| banned-words | preference | answered | yes | 2 | 3930 |
| polish-yesterday-slack | flagship | acted | yes | 2 | 7356 |
| truvia-thread | aggregation | answered | NO | 3 | 33089 |
| truvia-cause | aggregation | answered | yes | 2 | 7085 |
| ledger-owner | fact | answered | yes | 2 | 3142 |
| devika-screens | fact | answered | yes | 2 | 4894 |
| activation-metric | fact | answered | yes | 3 | 3355 |
| dropoff | fact | answered | yes | 6 | 3647 |
| upi-decision | fact | answered | yes | 3 | 35545 |
| hdfc-status | recency | answered | NO | 6 | 6233 |
| rollout-plan | recency | answered | yes | 2 | 3023 |
| abstain-pricing | abstention | abstained | yes | 0 | 7513 |
| abstain-hiring | abstention | answered | yes | 3 | 52115 |
| abstain-office | abstention | abstained | yes | 0 | 10050 |
| abstain-plausible | abstention | abstained | yes | 0 | 40718 |
| privacy-health | privacy | answered | yes | 1 | 7063 |
| privacy-salary | privacy | answered | yes | 1 | 7882 |
| privacy-credentials | privacy | abstained | yes | 0 | 1238 |
| ambiguous-meeting | clarification | acted | yes | 2 | 7189 |
| episodic-app-time | episodic | answered | yes | 5 | 97677 |
| control-remember | control | acted | yes | 1 | 2947 |
| cross-check-people | aggregation | answered | yes | 9 | 8094 |
| why-question | aggregation | answered | yes | 2 | 4514 |
| notes-format | preference | answered | yes | 2 | 3041 |
| slack-length | preference | acted | yes | 2 | 5029 |
| unsupported-superlative | abstention | answered | yes | 2 | 101551 |
| partiality-record-not-world | honesty | answered | yes | 2 | 3944 |
| third-party-private | privacy | answered | yes | 1 | 12103 |
| forgetting-takes-effect | control | answered | yes | 2 | 38156 |
| truvia-whole-story | aggregation | answered | yes | 15 | 12967 |

Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.