-- #4129: how many stored lift names have no visible character. READ-ONLY, COUNTS ONLY: no name, id or
-- user is selected, so nothing here can be pasted into an issue by mistake. Nothing is renamed or deleted.
--
--   psql "$DATABASE_URL" -f scripts/tuning/blank-exercise-names-4129.sql          (local)
--   the same text through /api/admin/db-query                                      (production, the Orchestrator)
--
-- The pattern is `hasVisibleCharacter`'s (packages/shared/src/validation/visible-name.ts) written for
-- Postgres, which has no \p{Cf}: the format characters are listed by range (soft hyphen, Arabic
-- number signs, Syriac and Arabic marks, Mongolian separators, zero-width and bidi controls, word
-- joiners and invisible operators, BOM, interlinear marks, tag characters), then the control
-- characters, whitespace, and the fillers and selectors. A name is blank when nothing else is left.
WITH invisible(re) AS (
  VALUES ('[\u0001-\u0020\u007F- ­؀-؅؜۝܏࣢ᅟᅠ ᠋-᠏ -‏ -  -⁯⠀͏　ㅤ︀-️﻿ﾠ￹-￻\U000E0001\U000E0020-\U000E007F\U000E0100-\U000E01EF]')
),
lib AS (
  SELECT count(*) AS exercises_total,
         count(*) FILTER (WHERE regexp_replace(l.name, i.re, '', 'g') = '') AS exercises_blank
  FROM claude_ro.exercise_library l CROSS JOIN invisible i
),
lifts AS (
  SELECT count(*) AS session_lifts_total,
         count(*) FILTER (WHERE regexp_replace(e.exercise_name, i.re, '', 'g') = '') AS session_lifts_blank
  FROM claude_ro.session_exercises e CROSS JOIN invisible i
  WHERE e.deleted_at IS NULL
)
SELECT lib.exercises_total, lib.exercises_blank, lifts.session_lifts_total, lifts.session_lifts_blank
FROM lib CROSS JOIN lifts;
