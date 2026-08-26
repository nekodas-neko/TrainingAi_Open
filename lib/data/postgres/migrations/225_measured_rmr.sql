-- BF-33: somewhere to put a clinically measured resting metabolic rate.
--
-- The owner has a DEXA + RMR test booked. Today the app has no place to put the result: every
-- resting rate it uses is PREDICTED, from Cunningham when lean mass is known and Mifflin-St Jeor
-- otherwise. Building this before the appointment is the point of the entry — the numbers need
-- somewhere to go on the day, not afterwards.
--
-- ## Its own table, not a column on `body_metrics`
--
-- `body_metrics` is one row per calendar day of ordinary daily readings. A clinical measurement is
-- a different kind of thing: it happens a handful of times, it carries a provider and a method, and
-- the entry is explicit that a SECOND test must sit BESIDE the first rather than overwrite it —
-- because two measurements at different body compositions are how you learn whether the first one
-- is still describing this person. A column on a daily table gets overwritten by the next day's
-- upsert and has nowhere to record who measured it or how.
--
-- ## Why the fat-free mass at the test is stored, and is the load-bearing column
--
-- A measurement has to age somehow, and the obvious rule -- trust it for N months, then discard --
-- fails at both ends: full trust the day before expiry, total discard the day after, while what
-- actually invalidates it is a change in body composition, which has no fixed relationship to
-- elapsed time. Cunningham is linear in fat-free mass, so a measurement carries exactly one thing
-- the prediction does not: this person's RESIDUAL from it. Keep the FFM the test was taken at and
-- that residual can be re-applied at today's FFM forever (`personalRmr`, body-composition.ts).
-- Nullable, because a provider may report a rate and no composition -- and then the raw measurement
-- is used unchanged rather than re-scaled, which is honest about what was measured.

CREATE TABLE IF NOT EXISTS measured_rmr (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on       DATE NOT NULL,
  rmr_kcal          INTEGER NOT NULL,
  ffm_kg_at_test    DOUBLE PRECISION,
  weight_kg_at_test DOUBLE PRECISION,
  method            TEXT,
  provider          TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per test DATE per user: re-entering the same day corrects a typo, a later test is a new
-- row. This is what makes "a second test sits beside the first" true at the schema level rather
-- than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS measured_rmr_user_date_uniq
  ON measured_rmr (user_id, measured_on);

-- Every read is "the most recent test for this user", so the index carries the ordering.
CREATE INDEX IF NOT EXISTS measured_rmr_user_recent
  ON measured_rmr (user_id, measured_on DESC);
