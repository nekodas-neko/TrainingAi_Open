# 2026-09-29 — LA-169 closed: bodyweight exercises already get a reps-only plan

**Lane A · investigation, docs-only.**

- **The owner's answer (2026-09-28):** prescribe REPS on bodyweight movements, record them as the
  plan, and leave `planned_pct` empty.
- **That is already what the app does.** `resolveBodyweightStyle` (`packages/shared/src/1rm.ts`)
  rescales a bodyweight style's reps from the stored rep max, and `log-exercise.ts:263-264` records
  `planned_reps` from the style while leaving `planned_pct` undefined for `exercise_type =
  'bodyweight'`.
- **Measured in production, September:** 27 bodyweight sets, **23 with `planned_reps`**:

  | Exercise | Sets | Planned |
  |---|---:|---:|
  | Hanging Leg Raise | 14 | 12 |
  | Pull-Up | 7 | 6 |
  | Chin-Up | 6 | 5 |

  **All 4 without a plan are the 09-07→09-12 calibration round**, single AMRAP sets with no plan
  by design. TN-75 now marks new calibration sessions `phase_type = 'baseline'`.
- **So the "23 of 49 unplanned sets are bodyweight" figure was a measurement artefact:** it counted
  a NULL `planned_pct` as "no plan", and for bodyweight that column is empty by design. **Tuning:
  measure bodyweight adherence on `planned_reps`, not `planned_pct`.**
- **No code change and no migration.** LA-169 leaves the queue.
