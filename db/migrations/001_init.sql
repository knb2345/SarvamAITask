-- Kivi semantic memory — initial schema.
-- Everything Hey Kivi says must be traceable back to a row in here.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One dictation = one thing the person said into Kivi.
CREATE TABLE dictations (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spoken_at      TEXT NOT NULL,              -- ISO8601 UTC
  app            TEXT,                       -- destination app: slack, gmail, notion, ...
  context_label  TEXT,                       -- window/thread title where available
  style          TEXT,                       -- dictation style in force (email, message, notes...)
  duration_ms    INTEGER,
  raw_asr        TEXT NOT NULL,              -- unformatted ASR output
  formatted      TEXT NOT NULL,              -- LLM-formatted output the person actually sent
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  ingested_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dictations_user_time ON dictations(user_id, spoken_at DESC);
CREATE INDEX idx_dictations_app ON dictations(user_id, app);

CREATE VIRTUAL TABLE dictations_fts USING fts5(
  dictation_id UNINDEXED, formatted, raw_asr, context_label, tokenize='porter unicode61'
);

-- Vector index (flat; corpus is one user's history, thousands of rows at most).
CREATE TABLE dictation_embeddings (
  dictation_id TEXT PRIMARY KEY REFERENCES dictations(id) ON DELETE CASCADE,
  dim          INTEGER NOT NULL,
  vec          BLOB NOT NULL                 -- Float32Array, L2-normalised
);

-- A memory is a single durable statement Kivi is prepared to act on.
-- kind: fact | preference | episode
CREATE TABLE memories (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('fact','preference','episode')),
  statement      TEXT NOT NULL,              -- third person, self-contained, one claim
  subject        TEXT,                       -- normalised entity this is "about"
  topics_json    TEXT NOT NULL DEFAULT '[]',
  confidence     REAL NOT NULL,              -- 0..1 at creation
  support_count  INTEGER NOT NULL DEFAULT 1, -- distinct dictations that support it
  -- active     : Kivi will use this
  -- superseded : replaced by something the person said later; kept as history
  -- forgotten  : removed by the person; the revision trail survives
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','superseded','forgotten')),
  source         TEXT NOT NULL DEFAULT 'inferred'
                 CHECK (source IN ('inferred','user_stated','user_edited')),
  supersedes_id  TEXT REFERENCES memories(id),
  valid_from     TEXT,                       -- when the claim started being true
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_memories_user_kind ON memories(user_id, kind, status);
CREATE INDEX idx_memories_last_seen ON memories(user_id, last_seen_at DESC);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED, statement, subject, topics, tokenize='porter unicode61'
);

CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  dim       INTEGER NOT NULL,
  vec       BLOB NOT NULL
);

-- Provenance: which dictation, and the exact words, put this memory here.
CREATE TABLE memory_evidence (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  dictation_id  TEXT NOT NULL REFERENCES dictations(id) ON DELETE CASCADE,
  quote         TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (memory_id, dictation_id)
);
CREATE INDEX idx_evidence_dictation ON memory_evidence(dictation_id);

-- Every change to a memory, including the ones the person made.
CREATE TABLE memory_revisions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id     TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,               -- created|reinforced|amended|superseded|forgotten|restored|confirmed
  actor         TEXT NOT NULL,               -- system|user
  before_json   TEXT,
  after_json    TEXT,
  reason        TEXT NOT NULL,
  dictation_id  TEXT REFERENCES dictations(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_revisions_memory ON memory_revisions(memory_id, created_at);

-- Why a candidate did NOT become a memory. This table is the point of the system.
CREATE TABLE extraction_decisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL,
  dictation_id   TEXT NOT NULL REFERENCES dictations(id) ON DELETE CASCADE,
  candidate_json TEXT NOT NULL,
  decision       TEXT NOT NULL,              -- created|merged|superseded|rejected|skipped
  memory_id      TEXT REFERENCES memories(id),
  reason         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_decisions_dictation ON extraction_decisions(dictation_id);
CREATE INDEX idx_decisions_run ON extraction_decisions(run_id, decision);

CREATE TABLE ingest_runs (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  dictation_count INTEGER NOT NULL DEFAULT 0,
  stats_json     TEXT NOT NULL DEFAULT '{}'
);

-- Hey Kivi conversations.
CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE turns (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,            -- user|kivi
  text             TEXT NOT NULL,
  outcome          TEXT,                     -- answered|abstained|asked|acted
  trace_json       TEXT,                     -- retrieval candidates, tool calls, prompts
  citations_json   TEXT NOT NULL DEFAULT '[]',
  latency_ms       INTEGER,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  cost_usd         REAL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_turns_conversation ON turns(conversation_id, created_at);

-- Model call ledger — latency / tokens / cost for every request we make.
CREATE TABLE model_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT,
  purpose       TEXT NOT NULL,               -- extract|reconcile|answer|embed|corpus
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL,
  cost_usd      REAL NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_model_calls_purpose ON model_calls(purpose, created_at);
