-- OR-102a — the reta tracker's engine half. Two things, both of which have to exist BEFORE any dose
-- is logged, because neither can be back-filled from what the table holds today.
--
-- 1. A VIAL RECORD, so the unit calculator has a concentration.
--
--    Concentration is `strength_mg / water_ml` and is DERIVED, never stored as its own truth: a
--    stored concentration is a third number that can disagree with the two it came from, and the
--    first time it does, nothing says which is right. `syringe_units_per_ml` defaults to 100 for a
--    U-100 barrel and is stored because a different barrel is a real possibility, not a constant.
--
--    Reconstitution is stable in practice — the owner mixes a vial and uses it for weeks — so the
--    newest un-deleted vial is the sticky default and carries forward. Opening a new one is an
--    explicit act, not a form to refill at every dose.
--
-- 2. `supplement_logs.taken_at`, A REAL TIMESTAMP.
--
--    The table has `log_date`, a DATE, and no time at all. The request this serves — correlate
--    sleep and heart rate against when the dose was actually taken — is not expressible without it.
--
--    It is also the column that makes the ONE honest analysis possible. On a titration, dose,
--    cumulative level and elapsed time all rise together, so almost nothing separates them. The
--    exception is hours-since-dose WITHIN a single week, which varies while the dose is held
--    constant. With no time recorded, that contrast does not exist and the tracker can only ever
--    show correlations confounded by the schedule.
--
-- THE RECONSTITUTION IS STAMPED ON THE LOG, NOT ONLY ON THE VIAL, and that is the half that cannot
-- be repaired later. Mix the next vial at a different water volume and the same milligram dose
-- becomes a different number of units. The stored mg stays correct; a historical "15 units" starts
-- reading wrong, silently, with nothing in the row to show it changed. This is BF-3's dose-freezing
-- rule (migration 244) one layer up: freeze the inputs the display is derived from, at the moment
-- it was true.
--
-- Additive only. No existing row is rewritten and every new column is nullable or defaulted, so the
-- reversal is a corrective migration rather than a restore.

CREATE TABLE IF NOT EXISTS supplement_vials (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplement_id        UUID NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
  strength_mg          DOUBLE PRECISION NOT NULL,
  water_ml             DOUBLE PRECISION NOT NULL,
  syringe_units_per_ml DOUBLE PRECISION NOT NULL DEFAULT 100,
  opened_on            DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

-- `opened_on DESC` first: every read of this table is "the current vial for this supplement", and
-- the tie-break on `created_at` matters because two vials opened the same day are otherwise
-- ordered arbitrarily and the sticky default would flip between page loads.
CREATE INDEX IF NOT EXISTS supplement_vials_current_idx
  ON supplement_vials (user_id, supplement_id, opened_on DESC, created_at DESC)
  WHERE deleted_at IS NULL;

-- Nullable, and it stays nullable: every row that exists today has no time and inventing one —
-- midnight, or the row's `created_at` — would manufacture a data point for the exact analysis this
-- column exists to make possible.
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

-- The frozen reconstitution. Three numbers rather than a `vial_id` FK on purpose: an FK points at a
-- row that can be edited afterwards, which is precisely the rewrite this is here to prevent.
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS vial_strength_mg    DOUBLE PRECISION;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS vial_water_ml       DOUBLE PRECISION;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS vial_units_per_ml   DOUBLE PRECISION;
