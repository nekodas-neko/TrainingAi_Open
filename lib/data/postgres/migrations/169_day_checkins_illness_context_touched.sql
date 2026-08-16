-- Q-113: stop the Morning Check-in's Recovery/Sleep-quality-feel scales from silently reflecting
-- Readiness/Sleep score back at the owner, and replace "Motivation to train" (no calibration or
-- gating use anywhere) with a quick illness/context flag.
--
-- perceived_recovery_touched / sleep_quality_feel_touched: distinguishes a genuinely-edited answer
-- from an accepted score-derived prefill, so calibration work (battery-recovery-calibration.ts,
-- any future correlation study) can filter to real self-report only. Both default false; existing
-- rows are historical prefill-or-edited ambiguity that predates this fix and are left as-is rather
-- than guessed at.
--
-- illness_context: replaces `motivation` going forward (that column is retired in place, same
-- pattern as wake_mood/resting_soreness before it — historical rows keep their value, new rows
-- always write null). Ties into the AI-periodization system's existing self-reported-sick signal
-- (packages/shared/src/ai-periodization/signals.ts) rather than adding a second, parallel one.
ALTER TABLE day_checkins
  ADD COLUMN IF NOT EXISTS illness_context text,
  ADD COLUMN IF NOT EXISTS perceived_recovery_touched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sleep_quality_feel_touched boolean NOT NULL DEFAULT false;
