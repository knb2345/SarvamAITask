-- Some dictations must not reach Hey Kivi at all.
--
-- The memory writer already refuses to store facts and preferences about health, money,
-- family, politics and credentials. That was not enough: an episode was still written for
-- every dictation, and an episode summarises the very content the rules exclude. The
-- decision belongs on the dictation itself, made once at ingest, so that both the memory
-- writer and the Hey Kivi retrieval tools honour it.
--
-- NULL / 'work'   : ordinary working material
-- 'personal'      : recognised as private; no memory is written and Hey Kivi will not
--                   retrieve it. The dictation itself is kept — it is the person's own
--                   history and they can still read it in the app.

ALTER TABLE dictations ADD COLUMN sensitivity TEXT;
ALTER TABLE dictations ADD COLUMN sensitivity_reason TEXT;

CREATE INDEX idx_dictations_sensitivity ON dictations(user_id, sensitivity);
