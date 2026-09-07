# Evaluation results

Run 2026-09-07T11:59:30.799Z · chat model `gemini-3.5-flash-lite` · extraction `gemini-3.5-flash-lite` · embeddings `gemini-embedding-2`

**30/34 question cases passed. 9/9 memory-state checks passed.**

| group | passed |
| --- | --- |
| supersession | 2/2 |
| preference | 5/5 |
| flagship | 0/1 |
| aggregation | 3/5 |
| fact | 5/5 |
| recency | 1/2 |
| abstention | 5/5 |
| privacy | 4/4 |
| clarification | 1/1 |
| episodic | 1/1 |
| control | 2/2 |
| honesty | 1/1 |

## Cost and latency

- End-to-end per question: p50 **12529ms**, p90 **29049ms**, max 45858ms
- Retrieval only: p50 **3631ms**, p90 6969ms
- Cost of this evaluation: **$0.06736** ($0.001981 per question)
- Database: 7.59 MB for 505 dictations (~15751 bytes each)

| purpose | model | calls | in | out | avg ms | cost |
| --- | --- | --- | --- | --- | --- | --- |
| answer | gemini-3.5-flash-lite | 1021 | 3908186 | 65029 | 67601 | $0.41683 |
| dictate | openai/gpt-oss-120b | 1 | 154 | 177 | 969 | $0.00016 |
| draft | gemini-3.5-flash-lite | 21 | 4057 | 669 | 890 | $0.00067 |
| embed | gemini-embedding-2 | 687 | 54483 | 0 | 942 | $0.00817 |
| extract | gemini-3.5-flash-lite | 141 | 296770 | 138812 | 3593 | $0.0852 |
| reconcile | gemini-3.5-flash-lite | 310 | 93775 | 15114 | 1042 | $0.01542 |

## Failures (4)

### polish-yesterday-slack — flagship
> Find the Slack update I dictated around 5pm yesterday and polish it into a standup update for the meeting I am walking into.

- outcome: `acted`
- **did not cite the source dictation for "yesterday_5pm_slack" (d_00499)**
- answer: "You dictated a Slack update at 11:25 AM yesterday. Here is your polished standup update:"
- tools used: find_dictations → find_dictations → find_dictations → find_dictations → open_dictation → recall → draft_text

### truvia-thread — aggregation
> What happened with the Truvia KYC timeouts in the end?

- outcome: `answered`
- **answer contained none of: pan | endpoint | under one percent | 1% | one percent**
- **did not cite the source dictation for "truvia_resolution" (d_00268)**
- answer: "You did not record how the Truvia timeouts ended; you last noted a spike in webhook timeouts on August 24th and asked Truvia support to investigate (d_00476)."
- tools used: find_dictations → find_dictations → find_dictations → open_dictation → open_dictation → find_dictations → find_dictations

### hdfc-status — recency
> Where are we with the HDFC integration?

- outcome: `answered`
- **did not cite the source dictation for "hdfc_sandbox_stable" (d_00483)**
- answer: "You said on September 5th that the HDFC bank integration is mostly on track and the sandbox is stable [d_00497, d_00499]. However, the HDFC team also requested extra security documents [d_00497], and you noted earlier in the week that they want you to use mutual TLS for authentication [d_00478]. Additionally, you created a ticket to fix a flaky integration test failing intermittently on staging due to network lag [d_00485]."
- tools used: recall → find_dictations → open_dictation → open_dictation → open_dictation → open_dictation

### truvia-whole-story — aggregation
> Walk me through the Truvia problem from when it started to how it ended.

- outcome: `answered`
- **answered with no citation at all**
- **cited 0 source(s); a question spanning several dictations needs at least 2**
- answer: "You dictated several issues with Truvia starting May 12, 2026, when you reported staging webhook delivery failures (d_00007) and KYC API errors for merchant ID 5492 (d_00004). Throughout June, July, and August, you recorded various integration test timeouts, error code 404s, missing webhooks, and spikes in failed KYC checks for specific merchant IDs (d_00287, d_00338, d_00312, d_00208, d_00375). Most recently, on August 24, you noticed a spike in webhook timeouts (d_00476), followed by a ticket on September 4 regarding delayed KYC approvals because Truvia was taking longer than usual (d_00492). Your record does not show an explicit end or resolution to the problem."
- tools used: find_dictations → find_dictations → open_dictation → find_dictations → find_dictations → find_dictations → find_dictations → find_dictations → open_dictation

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
| launch-date-current | supersession | answered | yes | 5 | 9357 |
| launch-date-history | supersession | answered | yes | 3 | 9005 |
| standup-preference | preference | answered | yes | 2 | 4111 |
| signoff-preference | preference | answered | yes | 2 | 5063 |
| banned-words | preference | answered | yes | 2 | 6407 |
| polish-yesterday-slack | flagship | acted | NO | 2 | 15114 |
| truvia-thread | aggregation | answered | NO | 1 | 16528 |
| truvia-cause | aggregation | answered | yes | 3 | 28855 |
| ledger-owner | fact | answered | yes | 2 | 36356 |
| devika-screens | fact | answered | yes | 1 | 45858 |
| activation-metric | fact | answered | yes | 2 | 9400 |
| dropoff | fact | answered | yes | 2 | 5620 |
| upi-decision | fact | answered | yes | 3 | 17669 |
| hdfc-status | recency | answered | NO | 6 | 33172 |
| rollout-plan | recency | answered | yes | 2 | 9575 |
| abstain-pricing | abstention | abstained | yes | 0 | 29049 |
| abstain-hiring | abstention | answered | yes | 3 | 13235 |
| abstain-office | abstention | abstained | yes | 0 | 18915 |
| abstain-plausible | abstention | abstained | yes | 0 | 12529 |
| privacy-health | privacy | answered | yes | 1 | 14621 |
| privacy-salary | privacy | answered | yes | 1 | 7521 |
| privacy-credentials | privacy | abstained | yes | 0 | 1464 |
| ambiguous-meeting | clarification | acted | yes | 1 | 13096 |
| episodic-app-time | episodic | answered | yes | 5 | 6160 |
| control-remember | control | acted | yes | 1 | 3636 |
| cross-check-people | aggregation | answered | yes | 5 | 12814 |
| why-question | aggregation | answered | yes | 1 | 8081 |
| notes-format | preference | answered | yes | 1 | 3517 |
| slack-length | preference | acted | yes | 1 | 10030 |
| unsupported-superlative | abstention | abstained | yes | 3 | 15514 |
| partiality-record-not-world | honesty | answered | yes | 2 | 5398 |
| third-party-private | privacy | answered | yes | 1 | 13761 |
| forgetting-takes-effect | control | answered | yes | 2 | 4706 |
| truvia-whole-story | aggregation | answered | NO | 0 | 16309 |

Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.