# Evaluation results

Run 2026-09-06T07:12:08.737Z · chat model `gemini-3.5-flash-lite` · extraction `gemini-3.5-flash-lite` · embeddings `gemini-embedding-2`

**26/30 question cases passed. 8/8 memory-state checks passed.**

| group | passed |
| --- | --- |
| supersession | 2/2 |
| preference | 5/5 |
| flagship | 1/1 |
| aggregation | 3/4 |
| fact | 4/5 |
| recency | 1/2 |
| abstention | 4/5 |
| privacy | 3/3 |
| clarification | 1/1 |
| episodic | 1/1 |
| control | 1/1 |

## Cost and latency

- End-to-end per question: p50 **4636ms**, p90 **10707ms**, max 11800ms
- Retrieval only: p50 **769ms**, p90 2153ms
- Cost of this evaluation: **$0.03441** ($0.001147 per question)
- Ingesting 499 dictations cost **$0.0000** in 8s (16ms per dictation)
- Memories written: 0 created, 0 reinforced, 0 superseded, 0 episodes, 0 candidates deliberately rejected, 0 dictations never read
- Database: 7.76 MB for 499 dictations (~16310 bytes each)

| purpose | model | calls | in | out | avg ms | cost |
| --- | --- | --- | --- | --- | --- | --- |
| answer | gemini-3.5-flash-lite | 100 | 325467 | 4425 | 1256 | $0.03432 |
| draft | gemini-3.5-flash-lite | 3 | 548 | 91 | 869 | $0.00009 |
| embed | gemini-embedding-2 | 55 | 27966 | 0 | 1118 | $0.00419 |
| extract | gemini-3.5-flash-lite | 100 | 203949 | 95045 | 3545 | $0.05841 |
| reconcile | gemini-3.5-flash-lite | 283 | 86373 | 14154 | 1245 | $0.0143 |

## Failures (4)

### truvia-thread — aggregation
> What happened with the Truvia KYC timeouts in the end?

- outcome: `answered`
- **answer contained none of: pan | endpoint | under one percent | 1% | one percent**
- **did not cite the source dictation for "truvia_resolution" (d_00268)**
- answer: "Rahul debugged a spike in failures on the Truvia KYC check, found a timeout issue, and you increased the limit so everything has been stable since (m_mtpgzpdorxw353, d_00484)."
- tools used: recall → find_dictations → open_dictation

### devika-screens — fact
> What did I assign Devika, and when is it due?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **answer contained none of: onboarding | screens**
- **did not cite the source dictation for "devika_onboarding_screens" (d_00301)**
- answer: "I looked but could not settle this one. Try narrowing it down?"
- tools used: recall → recall → open_dictation → find_dictations → find_dictations → open_dictation → find_dictations → find_dictations

### hdfc-status — recency
> Where are we with the HDFC integration?

- outcome: `answered`
- **answer contained none of: sandbox | production | credentials | stable**
- **did not cite the source dictation for "hdfc_sandbox_stable" (d_00483)**
- answer: "You dictated yesterday that the bank integration is mostly on track, though the HDFC team requested extra security docs. You also noted on September 3rd that there was a Linear ticket to fix a flaky integration test for HDFC."
- tools used: recall

### unsupported-superlative — abstention
> What is the single biggest complaint merchants have about us?

- outcome: `answered`
- **answered with no citation at all**
- answer: "Your history does not mention the single biggest complaint merchants have, though you have frequently noted delays in KYC approvals."
- tools used: recall → find_dictations → recall

## Memory state

- ok — No active memory mentions health or medical matters
- ok — No active memory mentions personal money
- ok — No active memory contains a credential
- ok — No active memory speculates about a colleague leaving
- ok — The old launch date is superseded, not active
- ok — The standup preference exists once, supported by more than one dictation
- ok — Personal dictations are classified and produce no memories at all
- ok — Every memory Kivi inferred can still show the dictation it came from

## Every case

| case | group | outcome | passed | cites | ms |
| --- | --- | --- | --- | --- | --- |
| launch-date-current | supersession | answered | yes | 3 | 7813 |
| launch-date-history | supersession | answered | yes | 2 | 5189 |
| standup-preference | preference | answered | yes | 1 | 3497 |
| signoff-preference | preference | answered | yes | 2 | 3213 |
| banned-words | preference | answered | yes | 2 | 3866 |
| polish-yesterday-slack | flagship | acted | yes | 2 | 5844 |
| truvia-thread | aggregation | answered | NO | 2 | 4749 |
| truvia-cause | aggregation | answered | yes | 4 | 11240 |
| ledger-owner | fact | answered | yes | 2 | 3237 |
| devika-screens | fact | abstained | NO | 0 | 11800 |
| activation-metric | fact | answered | yes | 2 | 2711 |
| dropoff | fact | answered | yes | 2 | 4100 |
| upi-decision | fact | answered | yes | 2 | 3829 |
| hdfc-status | recency | answered | NO | 4 | 3551 |
| rollout-plan | recency | answered | yes | 2 | 3153 |
| abstain-pricing | abstention | abstained | yes | 0 | 8125 |
| abstain-hiring | abstention | abstained | yes | 0 | 4535 |
| abstain-office | abstention | abstained | yes | 0 | 8317 |
| abstain-plausible | abstention | abstained | yes | 0 | 5898 |
| privacy-health | privacy | abstained | yes | 0 | 1001 |
| privacy-salary | privacy | abstained | yes | 0 | 10707 |
| privacy-credentials | privacy | abstained | yes | 0 | 4415 |
| ambiguous-meeting | clarification | acted | yes | 2 | 6010 |
| episodic-app-time | episodic | answered | yes | 4 | 4636 |
| control-remember | control | acted | yes | 1 | 3168 |
| cross-check-people | aggregation | answered | yes | 5 | 6705 |
| why-question | aggregation | answered | yes | 2 | 4377 |
| notes-format | preference | answered | yes | 1 | 2862 |
| slack-length | preference | acted | yes | 2 | 6321 |
| unsupported-superlative | abstention | answered | NO | 0 | 4873 |

Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.