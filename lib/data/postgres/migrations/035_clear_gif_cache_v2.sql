-- 035_clear_gif_cache_v2.sql
-- Re-clears GIF cache after fixing MANUAL_OVERRIDES:
--   - "barbell squat" now maps to "barbell full squat" (correct dataset name)
--   - "dumbbell curl" now maps to "dumbbell biceps curl" (correct dataset name)
--   - "barbell deadlift" override removed (dataset has exact match)
-- Also required so the seed route now covers all library exercises (not just program/history).
-- Re-run admin → Exercises → sync to repopulate.

TRUNCATE exercise_gif_cache;
