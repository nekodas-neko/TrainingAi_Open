-- BF-3 gap 1: stamp the dose on the LOG, so titration history survives a dose change.
--
-- `supplements.dose` is free text on the DEFINITION and `supplement_logs` carries no dose at all, so
-- editing the dose rewrites history: titrate 2 mg → 4 mg → 8 mg and every past log retroactively
-- reads 8 mg. For a drug whose entire clinical story is the escalation schedule, the escalation is
-- exactly what is destroyed — and it cannot be reconstructed afterwards, because nothing recorded it.
-- The owner is about to start retatrutide, which is what makes this the urgent half of BF-3.
--
-- Three columns on the log, and the third is the one that makes this work for supplements nobody
-- ever converts to structured amounts:
--
--   amount/unit  the numeric dose, which is what a correlation against resting HR needs — an
--                exposure variable has to be a number on a date.
--   dose_text    the definition's free-text `dose` AS IT READ when the log was written. Every
--                existing supplement has only free text, so without this the fix would require the
--                owner to re-enter each one as a number before their history was safe. With it,
--                today's UI freezes the dose with no change to the UI at all.
--
-- All nullable and additive: no existing row changes, nothing is back-filled, and a log written
-- before today keeps reading the definition's dose exactly as it does now. **Back-filling would be
-- the wrong thing** — it would stamp today's dose onto history and manufacture the very claim this
-- migration exists to stop.
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS amount double precision;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE supplement_logs ADD COLUMN IF NOT EXISTS dose_text text;

-- The structured half of the definition. `dose` stays as the display fallback for the rows that
-- have only it — this is a second way to say the dose, not a replacement, and BF-3's own
-- recommendation is that free text survives.
ALTER TABLE supplements ADD COLUMN IF NOT EXISTS default_amount double precision;
ALTER TABLE supplements ADD COLUMN IF NOT EXISTS unit text;
