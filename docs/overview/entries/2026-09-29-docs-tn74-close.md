# 2026-09-29 — TN-74 closed: the last open item was migration 168's residue

**Lane A · investigation, docs-only.**

- **The last open item** was four `exercise_logs` rows (the 2026-08-06 whole-session deload) holding
  `estimated_1rm = 0` beside a positive `target_80`, all with `updated_at` 2026-08-07
  04:41:27.227Z, and "which later write set `target_80`".
- **Answer:** none did. `schema_migrations` shows **`168_q115_whole_session_deload_pr_correction.sql`
  applied at 04:41:27.240Z**, 13 ms later in the same deploy. That migration re-flagged the four
  logs `exercise_deloaded = true` and set **`estimated_1rm = 0`, but never touched `target_80`**, so
  the original values survived. The entry had the direction reversed: a later write cleared the 1RM
  and left the target.
- **Also ruled out, by reading the code:** the exercise-log upsert (it writes the pair together), the
  server log path (it recomputes the pair from sets, ignoring client values), migration 148 (six June
  bodyweight rows only), and the lbs→kg fix (it keeps the old target when the 1RM is 0).
- **No code change:** nothing live produces this shape. **No data change:** repairing historical
  rows is the owner's call per the entry, and these four August rows are superseded by later logs of
  the same exercises, so no reader treats them as current.
- **TN-74 leaves the queue.** Items 2 and 3 were already resolved (2026-09-27); this was the last
  open item.
