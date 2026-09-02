-- BF-69 stage 1 — a day's exposure is an AMOUNT derived from CONTRIBUTIONS, not a tick.
--
-- Decided by the owner on 2026-08-30 and sequenced in
-- docs/superpowers/plans/2026-09-01-dosed-substance-exposure.md. Each act of taking something is
-- its own row carrying its amount/unit and where it came from; the day's figure is the sum of the
-- live contributions, computed on read. No stored daily total — every stored counter in this
-- project has drifted.
--
-- WHY THE UNIQUE CONSTRAINT HAS TO GO. `unique (supplement_id, log_date)` makes two doses on one
-- day impossible, and two doses on one day are independent events that ADD: a meal carrying
-- creatine plus a hand-tick on the supplements page is two contributions, and the same meal logged
-- twice is two doses, correctly. The old constraint made both of those last-writer-wins, and made
-- `unlogSupplement` wipe the whole day whoever wrote it — silent data loss the moment a second
-- writer exists.
--
-- WHY THE REPLACEMENT IS PARTIAL AND MANUAL-ONLY. The plan warns against replacing it with a
-- narrower three-column unique on (supplement_id, log_date, source), and that warning stands: it
-- would cap meal contributions at one per day and break the case the feature exists for. The index
-- below is a different thing — it constrains ONLY `source = 'manual'` rows, leaving meal
-- contributions unconstrained. It is what keeps the supplements page's tick idempotent: a
-- double-tap, or an outbox mutation replayed after a retry, re-stamps the one manual contribution
-- instead of doubling the recorded dose. `deleted_at IS NULL` is in the predicate so that a
-- soft-deleted (unticked) row does not block re-ticking the same day.
-- The name is Postgres's own: migration 076 declared it inline as `UNIQUE (supplement_id, log_date)`
-- in the CREATE TABLE, and that is the only place this table is created, so the generated name is
-- the same everywhere the migration has run.
ALTER TABLE supplement_logs DROP CONSTRAINT IF EXISTS supplement_logs_supplement_id_log_date_key;

-- 'manual' | 'meal'. Existing rows migrate forward as one manual contribution each, preserving the
-- BF-3 dose snapshot: the default does it, and no history is rewritten.
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
-- The food_logs row this contribution came from, when source = 'meal'. Deliberately NOT a foreign
-- key: food_logs are soft-deleted rather than removed, the meal path resolves its own contribution
-- by this id, and an FK here would turn a hard delete of a log into a cascade over exposure
-- history.
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS source_ref uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplement_logs_manual_day
  ON supplement_logs (supplement_id, log_date)
  WHERE source = 'manual';

-- THE PRESENCE MODEL — a missing row is not a zero.
--
-- Today a row exists only on days something was logged, so "did not take it" and "forgot to log it"
-- are the same absence, and a run of unlogged days read as zeros invents an effect. The window
-- makes the distinction storable: a date OUTSIDE [started_on, stopped_on] is a true zero, a date
-- INSIDE it with no contribution is UNKNOWN and must be excluded from any aggregate rather than
-- coerced to 0.
--
-- It is also what makes the owner's baseline week work without daily discipline — "Reta = 0 so it
-- has a baseline" is a started_on before the first dose with no contributions in between.
--
-- NULL on every existing row, and both ends are nullable on purpose: an open-ended course has no
-- stopped_on, and a substance nobody has dated yet says nothing rather than claiming a window.
ALTER TABLE supplements ADD COLUMN IF NOT EXISTS started_on date;
ALTER TABLE supplements ADD COLUMN IF NOT EXISTS stopped_on date;
-- "Ask me when logging" — the variable-dose half, which is one flag rather than a second flow.
-- Creatine is 5 g every time; a titrating drug is not, and its whole story is the number changing.
ALTER TABLE supplements ADD COLUMN IF NOT EXISTS dose_prompt boolean NOT NULL DEFAULT false;
