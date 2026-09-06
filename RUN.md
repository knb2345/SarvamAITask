# RUN.md

## Primary review method

**A completely local application: Next.js (interface + backend) with an embedded SQLite
database, run with `npm run dev`.** Nothing is hosted, nothing is containerised, no
external database. The only external dependency is the Gemini API.

Everything below is copy-pasteable from the repository root.

---

## 1. Required runtimes

| Requirement | Version used | Notes |
| --- | --- | --- |
| Node.js | **22.18.0** (>= 20.11 works) | `better-sqlite3` needs a prebuilt binary; Node 20/22 LTS have them |
| npm | 11.x (any recent) | |
| SQLite | bundled with `better-sqlite3` (3.49, FTS5 enabled) | nothing to install |
| OS | Windows 11, macOS and Linux all fine | developed on Windows |

No Docker, no Python, no global installs.

## 2. Environment variables

Copy `.env.example` to `.env` and set the key:

```bash
cp .env.example .env
```

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `GROQ_API_KEY` | no | — | Groq key. When present Groq answers Hey Kivi by default — far faster than the Gemini free tier |
| `GROQ_API_KEYS` | no | — | Extra Groq keys, comma separated, rotated on rate limits |
| `KIVI_CHAT_PROVIDER` | no | `auto` | who answers Hey Kivi: `auto` (Groq if keyed), `groq`, `gemini` |
| `KIVI_EXTRACT_PROVIDER` | no | `gemini` | who reads dictations. Extraction sends few large batches, which suits Gemini's per-day limit better than Groq's per-minute one |
| `KIVI_EVAL_PACE_MS` | no | `0` | pause between evaluation cases. Set to `20000`–`60000` on a free tier so the run spends its budget answering rather than in retry back-off |
| `GEMINI_API_KEY` | **yes** | — | Google AI Studio key. Required for embeddings even when Groq generates |
| `GEMINI_API_KEYS` | no | — | Extra keys, comma separated. When one key's daily free-tier quota runs out mid-run the client switches to the next instead of stalling |
| `KIVI_DB_PATH` | no | `./db/kivi.db` | SQLite file |
| `KIVI_CHAT_MODEL` | no | `gemini-3.5-flash-lite` | Hey Kivi's model. Use `gemini-3.5-flash` on a paid key for better answers |
| `KIVI_EXTRACT_MODEL` | no | `gemini-3.5-flash-lite` | memory extraction and reconciliation |
| `KIVI_EMBED_PROVIDER` | no | `auto` | `auto` uses the embedding API and falls back to the built-in local embedder if it is unavailable; `gemini` forces the API; `local` never calls it |
| `KIVI_EMBED_MODEL` | no | `gemini-embedding-2` | retrieval embeddings. All vectors in one database must come from one provider — change this only before `db:reset` |
| `KIVI_EMBED_DIM` | no | `768` | embedding dimensionality |
| `KIVI_EXTRACT_BATCH` | no | `5` | dictations read per model call during ingestion |
| `KIVI_INGEST_CONCURRENCY` | no | `6` | parallel extraction calls. **Lower this to 2 on a free-tier key** |
| `KIVI_MIN_MEMORY_SCORE` | no | `0.30` | retrieval floor; below it a memory never reaches the model |
| `KIVI_USER_ID` | no | `u_demo` | the single user the demo operates as |

> **Free-tier notes.** `gemini-3.5-flash` is limited to **20 requests per day** on a free
> key, which is why the defaults are the flash-lite models; with a paid key, set both model
> variables to `gemini-3.5-flash` for noticeably better answers. The embedding API is
> limited to **1000 requests per day** across all embedding models; if that runs out
> mid-ingest, the run prints `[embeddings] falling back to the local embedder` and keeps
> going with the built-in embedder rather than failing. Which one produced a database's
> vectors is visible in `npm run db:summary`, and `npm run reindex` re-embeds with the API
> once quota is available.

## 3. Install dependencies

```bash
npm install
```

## 4. Create, migrate and seed the database

```bash
npm run db:reset      # deletes db/kivi.db and applies db/migrations/*.sql
npm run seed          # ingests the committed 499-record corpus (see timing note below)
```

`npm run seed` runs the full pipeline: it embeds every dictation, reads them in batches,
and writes/merges/supersedes memories in chronological order. It prints its statistics at
the end. **It takes roughly 25–45 minutes on a free-tier key** (rate limits dominate) and
costs about **$0.05**. `npm run setup` does both steps in one command.

To ingest a smaller slice first as a smoke test:

```bash
npx tsx scripts/ingest.ts corpus/dictations.jsonl --limit=40
```

## 5. Start the application

```bash
npm run dev
```

One process. It serves the interface and the API and opens the SQLite file directly.

## 6. Where to look

Open **http://localhost:3000**.

| Page | What it is |
| --- | --- |
| `/` | **Hey Kivi** — the product. Ask questions of your own dictation history |
| `/dictate` | **Dictation** — the half memory never touches. Speak (Chrome/Edge) or type what you would have said, and watch what Kivi does and does not learn from it |
| `/memory` | **What Kivi knows** — every memory, its evidence, edit and forget controls |
| `/history` | **Dictation history** — the raw corpus, and what was kept or ignored from each record |
| `/inspect` | **Why** — the engineer's surface: retrieval scores, tool traces, model cost, extraction decisions |

## 7. Interactions to try

On `/` (the starters on the empty page are the same list):

1. **"When does merchant onboarding V2 launch?"** — the date moved mid-corpus. Kivi should
   answer December 5th, not November 14th, and cite the later dictation.
2. **"Did the launch date ever change? What was it before?"** — superseded memories are kept
   as history, so it can tell you what it used to believe.
3. **"Find the Slack update I dictated around 5pm yesterday and polish it into a standup update."**
   — episodic retrieval by time and app, then a draft that obeys the stored preferences.
4. **"What happened with the Truvia KYC timeouts?"** — the answer is spread over three
   dictations in three different apps, weeks apart.
5. **"What is our new enterprise pricing?"** — never mentioned. Kivi should refuse.
6. **"Do I have any doctor appointments coming up?"** — it *is* in the corpus, and Kivi should
   still be unable to answer, because it refused to remember it. Check `/history`, search
   "neurologist", and read what it decided not to keep.
7. **"Remember that I want all merchant emails reviewed by Farah before they go out."** —
   then look at `/memory`, filtered to preferences.
8. On any answer, click **"how did Kivi get here?"** for retrieval scores and cost; on any
   citation chip, click through to the exact words that produced it.
9. On `/dictate`, dictate *"um so quick update the h d f c sandbox is stable now and davika
   ships the new screens on thursday"*. Kivi holds a memory that the colleague is **Devika**
   and still writes **Davika**, because memory is not allowed to reach into dictation and
   correcting a misheard name is phonetic memory's job. Click **"see the instructions used"**
   to confirm no memory reached the prompt, then read what was learned from it afterwards.
   Speech recognition uses the browser's own (Chrome or Edge); elsewhere type it instead —
   the path after that is identical.

## 8. Run the candidate evaluation

```bash
npm run eval
```

Runs all 30 question cases plus 6 memory-state checks against the live database and writes:

- `eval/results/results.json` — every case: the question, the full retrieval candidate list
  with scores, the tools called, the answer, cited memories with their provenance, and the
  reason it passed or failed;
- `eval/results/results.md` — the summary, latency percentiles, cost, database growth and
  the failure list.

Take roughly 6–12 minutes and ~$0.02. To run one group only:

```bash
npx tsx scripts/eval.ts --only=abstention
```

Groups: `supersession`, `preference`, `flagship`, `aggregation`, `fact`, `recency`,
`abstention`, `privacy`, `clarification`, `episodic`, `control`.

## 8b. Check the machinery without spending a model call

```bash
npm test
```

24 assertions over the parts that must not fail quietly and need no model: the import
normaliser (field aliases, nested transcript objects, epoch-seconds timestamps, preserved
unknown fields), the credential screen, the prefilter, FTS query building, and the local
embedder. Run this first if an import behaves oddly — it is instant and it isolates
whether the problem is the data or the pipeline.

## 9. Importing another corpus

Records may be **JSONL** (one object per line) or a **JSON array**. Field names:

```json
{
  "id": "d_00001",
  "spoken_at": "2026-08-30T17:12:00.000Z",
  "app": "slack",
  "context_label": "#product-team",
  "style": "message",
  "duration_ms": 21900,
  "raw_asr": "unformatted recogniser output",
  "formatted": "The formatted output the person actually sent.",
  "metadata": { "device": "macbook-pro" }
}
```

Only the text and a timestamp are genuinely required; everything else is optional. The
importer accepts the common variants rather than demanding exact names:

| field | also accepted |
| --- | --- |
| `raw_asr` | `asr`, `raw_text`, `transcript`, `raw`, `text` |
| `formatted` | `formatted_output`, `llm_output`, `output`, `final_text`, `text` |
| `spoken_at` | `timestamp`, `created_at`, `time`, `date`, `dictated_at` |
| `app` | `application`, `destination`, `target_app`, `app_name`, `client` |
| `context_label` | `context`, `window`, `window_title`, `thread`, `title` |
| `style` | `dictation_style`, `mode` |
| `duration_ms` | `duration`, `length_ms` |

Timestamps may be ISO 8601, `YYYY-MM-DD HH:MM:SS`, or a Unix epoch in seconds or
milliseconds. A text field arriving as `{"text": "..."}` is unwrapped rather than
stringified. A record with no id is numbered by position.
- **Any unrecognised top-level field is preserved verbatim** in `metadata_json`, so your log
  metadata does not need to be reshaped.

Then:

```bash
npm run db:reset                                   # start from empty
npx tsx scripts/ingest.ts /path/to/your-corpus.jsonl
npm run dev                                        # and ask Hey Kivi about it
```

Useful flags:

- `--limit=N` — ingest only the first N records.
- `--user=some_id` — ingest as a different user id (set `KIVI_USER_ID` to the same value
  so the interface shows it).
- `--keep-dates` — **by default the importer slides every timestamp forward so the newest
  dictation lands yesterday evening**, uniformly, preserving all intervals; this keeps
  phrases like "yesterday at 5pm" meaningful whenever the demo is run. Pass this flag to
  import the timestamps exactly as supplied.

Ingesting into a database that already has data is supported and additive: re-running the
same records updates them in place rather than duplicating (ids are the key).

## 10. Where results and memory state can be inspected

| What | Where |
| --- | --- |
| Evaluation results | `eval/results/results.md` and `results.json` |
| Memory state, in the product | `/memory` — filter by kind, toggle "Show changed & removed" |
| Memory provenance | click "where did this come from?" on any memory |
| Why an answer came out that way | `/inspect`, or "how did Kivi get here?" under any answer |
| What was deliberately ignored | `/history` → open a dictation → "And what it decided not to keep"; or `/inspect` → latest extraction decisions |
| Raw state, without the UI | `npm run db:summary` — counts by kind and status, decisions, model cost, the strongest memories, what was superseded and a sample of what was refused |
| The database itself | `db/kivi.db`, a plain SQLite file readable with any SQLite client |

## 11. Resetting

```bash
npm run db:reset     # deletes db/kivi.db (+ -wal/-shm) and recreates an empty schema
npm run seed         # re-ingest the shipped corpus
```

`npm run setup` is the two together. Nothing else on the machine is touched; deleting the
repository directory removes all state.
