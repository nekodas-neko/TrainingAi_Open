# 2026-09-29 — TN-75: AI-dynamic calibration sessions are stored as `baseline`

**Lane A · `packages/shared/src/workout/log-exercise.ts`. No migration.**

- **Why:** adherence reads could not tell a calibration set (no per-set plan, by design) from a lost
  plan, because `workout_sessions.phase_type` was NULL for AI-dynamic baseline sessions. The column
  and the `'baseline'` value already existed; the log path only ever checked the periodization
  state for `deload`.
- **Change:** it now applies `workout-data`'s own test (`phase === 'baseline' && !baselineComplete`),
  so the server and the workout screen agree this is a calibration session, and new sessions store
  `'baseline'`.
- **Side effect, measured before shipping:** the flag also routes the server's 1RM estimate through
  the AMRAP formula the client already used. On the real 09-07→09-12 round, 15 of 20 loaded logs are
  identical and 5 move by one 0.25 kg rounding step (mean 0.06 kg), computed with the repo's own
  `estimateOneRm` on production set data. `exercise-log-edits.ts` already keyed its recompute on
  `phase_type === 'baseline'`, so edits now agree too.
- **Not done:** historical sessions stay unmarked, so reads covering 09-07→09-12 still exclude that
  window by date.
- **Verified:** a log-exercise test (an unfinished baseline is stored as `'baseline'`, a finished
  one as nothing); the workout and log-exercise suites pass (329 tests); Custom Rules pass.
  **Not exercised:** a `pnpm dev` log inside an AI-dynamic baseline, which needs a seeded
  periodization state. The route is unchanged and the shared function is covered.
