export type MemoryKind = 'fact' | 'preference' | 'episode';

export type Memory = {
  id: string;
  user_id: string;
  kind: MemoryKind;
  statement: string;
  subject: string | null;
  topics_json: string;
  confidence: number;
  support_count: number;
  status: 'active' | 'superseded' | 'forgotten' | 'pending';
  source: 'inferred' | 'user_stated' | 'user_edited';
  supersedes_id: string | null;
  valid_from: string | null;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  created_at: string;
};

export type Dictation = {
  id: string;
  user_id: string;
  spoken_at: string;
  app: string | null;
  context_label: string | null;
  style: string | null;
  duration_ms: number | null;
  raw_asr: string;
  formatted: string;
  metadata_json: string;
};

export type Candidate = {
  kind: MemoryKind;
  statement: string;
  subject?: string;
  topics?: string[];
  confidence: number;
  quote: string;
  valid_from?: string | null;
};

export type Evidence = {
  dictation_id: string;
  quote: string;
  spoken_at: string;
  app: string | null;
  context_label?: string | null;
};

export type ScoredMemory = Memory & {
  score: number;
  vec_score: number;
  bm25_score: number;
  evidence: Evidence[];
};

export type ScoredDictation = Dictation & { score: number; vec_score: number; bm25_score: number };
