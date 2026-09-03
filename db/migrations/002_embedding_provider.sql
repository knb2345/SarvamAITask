-- Vectors from two different embedders are not comparable. Record which one produced
-- each vector so retrieval can compare like with like, and so an engineer can see at a
-- glance whether a database was built with the API embedder or the local fallback.

ALTER TABLE dictation_embeddings ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini';
ALTER TABLE memory_embeddings    ADD COLUMN provider TEXT NOT NULL DEFAULT 'gemini';

CREATE INDEX idx_dictation_embeddings_provider ON dictation_embeddings(provider);
CREATE INDEX idx_memory_embeddings_provider ON memory_embeddings(provider);
