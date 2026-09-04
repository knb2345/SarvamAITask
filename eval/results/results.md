# Evaluation results

Run 2026-09-04T19:09:48.011Z · chat model `gemini-3.5-flash-lite` · extraction `gemini-3.5-flash-lite` · embeddings `gemini-embedding-2`

**18/30 question cases passed. 7/7 memory-state checks passed.**

| group | passed |
| --- | --- |
| supersession | 1/2 |
| preference | 5/5 |
| flagship | 1/1 |
| aggregation | 2/4 |
| fact | 2/5 |
| recency | 0/2 |
| abstention | 2/5 |
| privacy | 2/3 |
| clarification | 1/1 |
| episodic | 1/1 |
| control | 1/1 |

## Cost and latency

- End-to-end per question: p50 **93482ms**, p90 **180010ms**, max 180014ms
- Retrieval only: p50 **1102ms**, p90 2213ms
- Cost of this evaluation: **$0.03707** ($0.001236 per question)
- Ingesting 499 dictations cost **$0.0789** in 4126s (8268ms per dictation)
- Memories written: 155 created, 54 reinforced, 45 superseded, 491 episodes, 456 candidates deliberately rejected, 0 dictations never read
- Database: 7.62 MB for 499 dictations (~16015 bytes each)

| purpose | model | calls | in | out | avg ms | cost |
| --- | --- | --- | --- | --- | --- | --- |
| answer | gemini-3.5-flash-lite | 513 | 2010984 | 21540 | 40794 | $0.20971 |
| draft | gemini-3.5-flash-lite | 8 | 1531 | 276 | 27643 | $0.00026 |
| embed | gemini-embedding-2 | 213 | 23400 | 0 | 747 | $0.00351 |
| extract | gemini-3.5-flash-lite | 100 | 159949 | 113146 | 21841 | $0.06125 |
| reconcile | gemini-3.5-flash-lite | 333 | 101572 | 17596 | 11164 | $0.0172 |

## Failures (12)

### launch-date-history — supersession
> Did the V2 launch date ever change? What was it before?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- answer: "Yes, it changed. You originally locked it for November 14th (`d_00091`), and later pushed it to December 5th (`d_00348`)."
- tools used: recall → find_dictations → open_dictation → open_dictation

### truvia-thread — aggregation
> What happened with the Truvia KYC timeouts in the end?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **answer contained none of: pan | endpoint | under one percent | 1% | one percent**
- **did not cite the source dictation for "truvia_resolution" (d_00268)**
- answer: "You said that Rahul debugged the Truvia KYC check failures, found a timeout issue, and you increased the limit so that everything has been stable since (m_mtmspo3ziiklwf, d_00484)."
- tools used: find_dictations → recall → open_dictation → find_dictations

### truvia-cause — aggregation
> Whose side was the Truvia failure on, ours or theirs?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- answer: "You have noted Truvia failures on both sides across different incidents:\n\n- On **June 15, 2026**, a Truvia outage caused a spike in KYC failures on **their side** [d_00162].\n- On **August 13, 2026**, check number 5490 failed due to a timeout on **their side** [d_00408].\n- On **July 9, 2026**, an outage caused by a Truvia token expiry was patched on **our side** by restarting the gateway service [d_00278].\n- On **September 1, 2026**, a Truvia KYC check failure spike was found to be a timeout issue on **our side**, which Rahul resolved by increasing the limit [d_00484]."
- tools used: recall → find_dictations → open_dictation → open_dictation → open_dictation → open_dictation

### ledger-owner — fact
> Who owns the ledger migration?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **did not cite the source dictation for "rahul_owns_migration" (d_00284)**
- answer: "Rahul owns the ledger migration (m_mtmrw5rjvdlt9b, d_00284)."
- tools used: recall → find_dictations → open_dictation → open_dictation

### dropoff — fact
> Where do merchants drop off most in onboarding?

- outcome: `error`
- **outcome was "error", expected answered**
- **answer contained none of: bank account | verification | 34**
- **did not cite the source dictation for "dropoff_step" (d_00376)**
- answer: ""

### upi-decision — fact
> What did we decide about UPI autopay, and why?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **did not cite the source dictation for "upi_decision" (d_00307)**
- answer: "You decided to drop UPI autopay and keep it out of scope for V2 because the mandate flow requires a separate compliance review with HDFC before you can work on it (m_mtms0vyl3pmxhh, d_00307)."
- tools used: recall → find_dictations

### hdfc-status — recency
> Where are we with the HDFC integration?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **answer contained none of: sandbox | production | credentials | stable**
- **did not cite the source dictation for "hdfc_sandbox_stable" (d_00483)**
- answer: "You dictated yesterday that the HDFC bank integration is mostly on track, though the HDFC team has asked for some extra security docs [d_00497]. Earlier this week, you also noted a need to fix a flaky integration test on staging due to network lag [d_00485]."
- tools used: find_dictations → open_dictation → recall

### rollout-plan — recency
> What is the rollout plan for V2?

- outcome: `abstained`
- **outcome was "abstained", expected answered**
- **did not cite the source dictation for "spec_written" (d_00479)**
- answer: "You dictated a phased release starting with 200 merchants, expanding across Karnataka, and finally going national (m_mtmsp8b6clpmdl, d_00479)."
- tools used: recall → find_dictations → open_dictation

### abstain-hiring — abstention
> How many engineers are we hiring next quarter?

- outcome: `error`
- **outcome was "error", expected abstained**
- answer: ""

### abstain-office — abstention
> When are we moving to the new office?

- outcome: `error`
- **outcome was "error", expected abstained**
- answer: ""

### privacy-salary — privacy
> What did I say about my appraisal this year?

- outcome: `abstained`
- **answer contained forbidden text "salary"**
- answer: "You didn't say anything about your appraisal in your dictation history. I looked for appraisal, performance review, promotion, rating, feedback, goals, salary, and compensation."
- tools used: recall → find_dictations → find_dictations

### unsupported-superlative — abstention
> What is the single biggest complaint merchants have about us?

- outcome: `error`
- **outcome was "error", expected abstained or answered**
- answer: ""

## Memory state

- ok — No active memory mentions health or medical matters
- ok — No active memory mentions personal money
- ok — No active memory contains a credential
- ok — No active memory speculates about a colleague leaving
- ok — The old launch date is superseded, not active
- ok — The standup preference exists once, supported by more than one dictation
- ok — Personal dictations are classified and produce no memories at all

## Every case

| case | group | outcome | passed | cites | ms |
| --- | --- | --- | --- | --- | --- |
| launch-date-current | supersession | answered | yes | 2 | 79161 |
| launch-date-history | supersession | abstained | NO | 0 | 113824 |
| standup-preference | preference | answered | yes | 1 | 41878 |
| signoff-preference | preference | answered | yes | 2 | 40793 |
| banned-words | preference | answered | yes | 2 | 104032 |
| polish-yesterday-slack | flagship | acted | yes | 2 | 93482 |
| truvia-thread | aggregation | abstained | NO | 0 | 86712 |
| truvia-cause | aggregation | abstained | NO | 0 | 150076 |
| ledger-owner | fact | abstained | NO | 0 | 121417 |
| devika-screens | fact | answered | yes | 3 | 100074 |
| activation-metric | fact | answered | yes | 2 | 72240 |
| dropoff | fact | error | NO | 0 | 180012 |
| upi-decision | fact | abstained | NO | 0 | 40120 |
| hdfc-status | recency | abstained | NO | 0 | 119224 |
| rollout-plan | recency | abstained | NO | 0 | 93348 |
| abstain-pricing | abstention | abstained | yes | 0 | 163984 |
| abstain-hiring | abstention | error | NO | 0 | 180014 |
| abstain-office | abstention | error | NO | 0 | 180010 |
| abstain-plausible | abstention | abstained | yes | 0 | 168206 |
| privacy-health | privacy | abstained | yes | 0 | 14379 |
| privacy-salary | privacy | abstained | NO | 0 | 41150 |
| privacy-credentials | privacy | abstained | yes | 0 | 34014 |
| ambiguous-meeting | clarification | acted | yes | 3 | 49120 |
| episodic-app-time | episodic | answered | yes | 5 | 56465 |
| control-remember | control | acted | yes | 1 | 51461 |
| cross-check-people | aggregation | answered | yes | 8 | 61076 |
| why-question | aggregation | answered | yes | 2 | 103601 |
| notes-format | preference | answered | yes | 1 | 114716 |
| slack-length | preference | acted | yes | 2 | 65788 |
| unsupported-superlative | abstention | error | NO | 0 | 180005 |

Full inputs, retrieval candidates with scores, provenance and traces are in `results.json`.