-- BF-1: blood panel results, de-identified, as a nutrition baseline.
--
-- **The schema is written from a real 63-row report** (`docs/clinical-baseline-2026-08-27.md`,
-- de-identified) rather than from a description, which is what BF-41's own rule demands. Four
-- shapes in that report drove every column here, and each one breaks a simpler design:
--
--   1. **`<0.2` is a result that is not a number.** Storing `'<0.2'` as text makes it uncomparable;
--      storing `0.2` alone makes it wrong. `value_num` + `value_operator` keeps it both readable
--      and sortable, and a consumer that ignores the operator over-reads rather than crashing.
--   2. **Reference ranges arrive two-sided (`2.5-8.0`), one-sided in BOTH directions (`<25`, `>59`)
--      and absent.** So both bounds are nullable; neither is a sentinel.
--   3. **The collection date is a MONTH.** Without `date_precision` every panel lands on the 1st and
--      the record lies about a day it does not know.
--   4. **Flags are free-text commentary, not verdicts** — *"Normal (athletic)"* on a creatinine of
--      109 inside a 60-130 range, *"High (likely protein intake)"* on a urea. They store verbatim as
--      `flag_text` and are shown as the provider's words. **Whether a value is out of range is
--      DERIVED from the bounds** by `rangeVerdict` in `packages/shared/src/health/analyte-keys.ts`,
--      because CLAUDE.md forbids showing a self-reported judgement as fact.
--
-- **No patient identifiers, ever.** Name, date of birth and the provider's patient reference appear
-- on the source report and must not reach this database, a log, a commit message or a PR body.
-- `lab_name` is instrument metadata; it is not a person.
CREATE TABLE IF NOT EXISTS blood_panels (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collected_on   DATE NOT NULL,
  -- 'day' | 'month'. A month-precision panel stores the 1st and says so, rather than claiming a day.
  date_precision TEXT NOT NULL DEFAULT 'day',
  lab_name       TEXT,
  -- 'manual' | 'extracted'. The manual path is the fallback AND the confirm target: extraction
  -- prefills, the owner corrects, then it saves — so a fully manual panel must work with no
  -- extraction call at all.
  source         TEXT NOT NULL DEFAULT 'manual',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

-- One panel per user per collection date per lab. `lab_name` is nullable and NULLs do not compare
-- equal in a plain UNIQUE, so the coalesce is what actually enforces "one unlabelled panel a day".
CREATE UNIQUE INDEX IF NOT EXISTS blood_panels_user_date_lab_key
  ON blood_panels (user_id, collected_on, COALESCE(lab_name, ''));

CREATE TABLE IF NOT EXISTS blood_analytes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_id       UUID NOT NULL REFERENCES blood_panels(id) ON DELETE CASCADE,
  -- Normalised (`ldl_calculated`); what a consumer greps for.
  analyte_key    TEXT NOT NULL,
  -- The provider's own wording, verbatim. Labs disagree ("LDL (calculated)" vs "LDL-C"), so keeping
  -- both means changing provider does not orphan history.
  label          TEXT NOT NULL,
  unit           TEXT,
  value_num      DOUBLE PRECISION,
  value_operator TEXT,
  ref_low        DOUBLE PRECISION,
  ref_high       DOUBLE PRECISION,
  flag_text      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (panel_id, analyte_key)
);

CREATE INDEX IF NOT EXISTS blood_analytes_key_idx ON blood_analytes (analyte_key);
