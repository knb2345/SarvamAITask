# Evaluation results

Run 2026-09-06T11:01:02.620Z · chat model `gemini-3.5-flash-lite` · extraction `gemini-3.5-flash-lite` · embeddings `gemini-embedding-2`

**30/32 question cases passed. 9/9 memory-state checks passed.**

| group | passed |
| --- | --- |
| supersession | 2/2 |
| preference | 5/5 |
| flagship | 1/1 |
| aggregation | 3/4 |
| fact | 5/5 |
| recency | 1/2 |
| abstention | 5/5 |
| privacy | 4/4 |
| clarification | 1/1 |
| episodic | 1/1 |
| control | 1/1 |
| honesty | 1/1 |

## Cost and latency

- End-to-end per question: p50 **5638ms**, p90 **12331ms**, max 13260ms
- Retrieval only: p50 **1644ms**, p90 4953ms
- Cost of this evaluation: **$0.04236** ($0.001324 per question)
- Database: 7.47 MB for 499 dictations (~15703 bytes each)

| purpose | model | calls | in | out | avg ms | cost |
| --- | --- | --- | --- | --- | --- | --- |
| answer | gemini-3.5-flash-lite | 224 | 796715 | 13823 | 1217 | $0.0852 |
| draft | gemini-3.5-flash-lite | 5 | 885 | 135 | 940 | $0.00014 |
| embed | gemini-embedding-2 | 172 | 51763 | 0 | 1099 | $0.00776 |
| extract | gemini-3.5-flash-lite | 140 | 295289 | 138485 | 3605 | $0.08492 |
| reconcile | gemini-3.5-flash-lite | 310 | 93775 | 15114 | 1042 | $0.01542 |

## Failures (2)

### truvia-thread — aggregation
> What happened with the Truvia KYC timeouts in the end?

- outcome: `answered`
- **did not cite the source dictation for "truvia_resolution" (d_00268)**
- answer: "You said on June 26 that Farah checked the logs and determined the Truvia timeouts were coming from their PAN verification endpoint and not your side (m_mtpmh9gaijrs20). You also noted intermittent timeout issues in sandbox integration tests (d_00358), followed up on specific merchant timeouts with support in July and September (d_00312, d_00476), and Rahul was debugging a timeout issue as of September 3 (m_mtpoyr4u1ku39f), but your history does not record a final resolution."
- tools used: recall → find_dictations → recall

### hdfc-status — recency
> Where are we with the HDFC integration?

- outcome: `answered`
- **answer contained none of: sandbox | production | credentials | stable**
- **did not cite the source dictation for "hdfc_sandbox_stable" (d_00483)**
- answer: "Yesterday (Sept 5), you said the bank integration is mostly on track, and the HDFC team asked for some extra security docs."
- tools used: recall → find_dictations

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
| launch-date-current | supersession | answered | yes | 4 | 6058 |
| launch-date-history | supersession | answered | yes | 1 | 9327 |
| standup-preference | preference | answered | yes | 1 | 2832 |
| signoff-preference | preference | answered | yes | 1 | 3563 |
| banned-words | preference | answered | yes | 2 | 4121 |
| polish-yesterday-slack | flagship | acted | yes | 2 | 5638 |
| truvia-thread | aggregation | answered | NO | 5 | 5974 |
| truvia-cause | aggregation | answered | yes | 1 | 5638 |
| ledger-owner | fact | answered | yes | 2 | 2907 |
| devika-screens | fact | answered | yes | 2 | 5838 |
| activation-metric | fact | answered | yes | 2 | 4222 |
| dropoff | fact | answered | yes | 4 | 11641 |
| upi-decision | fact | answered | yes | 4 | 4460 |
| hdfc-status | recency | answered | NO | 2 | 5376 |
| rollout-plan | recency | answered | yes | 1 | 5431 |
| abstain-pricing | abstention | abstained | yes | 0 | 13036 |
| abstain-hiring | abstention | abstained | yes | 0 | 11934 |
| abstain-office | abstention | abstained | yes | 0 | 12331 |
| abstain-plausible | abstention | abstained | yes | 0 | 11010 |
| privacy-health | privacy | abstained | yes | 0 | 1460 |
| privacy-salary | privacy | abstained | yes | 0 | 13260 |
| privacy-credentials | privacy | abstained | yes | 0 | 1627 |
| ambiguous-meeting | clarification | acted | yes | 1 | 5520 |
| episodic-app-time | episodic | answered | yes | 5 | 2852 |
| control-remember | control | acted | yes | 1 | 4153 |
| cross-check-people | aggregation | answered | yes | 5 | 7260 |
| why-question | aggregation | answered | yes | 1 | 5825 |
| notes-format | preference | answered | yes | 2 | 4808 |
| slack-length | preference | acted | yes | 2 | 8457 |
| unsupported-superlative | abstention | abstained | yes | 0 | 13141 |
| partiality-record-not-world | honesty | answered | yes | 2 | 2783 |
| third-party-private | privacy | abstained | yes | 0 | 6455 |

Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.