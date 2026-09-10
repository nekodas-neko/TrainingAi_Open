## 2026-09-10 — Q-52 re-measured a third time: the precondition cleared, then the program was rebuilt (docs + one comment)

Lane A. Docs-only apart from a comment in `lib/data/postgres/adapter.ts`. Nothing implemented.
Full evidence: [`docs/reviews/2026-09-10-q52-phase-hold-remeasure.md`](../../reviews/2026-09-10-q52-phase-hold-remeasure.md).

Q-52 (per-exercise phase hold) carried an explicit outstanding precondition from 2026-08-03:
*"No session has transitioned since the auto-apply fix shipped… Re-run this once at least two
sessions have cycled."* This session ran it.

**The precondition is met.** Eight `session_periodization` rows carry a `phase_started_at` after
2026-08-03 (2026-08-16, 08-27, 09-01, 09-03, 09-06 ×2, 09-07, 09-09), each marking at least one
transition. Blocks now cycle.

**And meeting it made the entry's measurement unrunnable.** The active program is **Bankai, created
2026-09-06** — four days old. All eight transitions belong to its predecessor (**Shikai**,
2026-07-01), whose `program_sessions` are inactive, and phase state is keyed by
`program_session_id`, so the rebuild reset it: Push and Pull sit in `baseline` with
`baseline_complete: false`, Legs entered `accumulation` on 09-09, and Upper and Lower have no
periodization row at all. Every last-vs-previous 1RM pair therefore straddles the rebuild (`prev`
2026-08-17…08-30 on Shikai, `cur` 2026-09-06…09-09 on Bankai). The raw table reads 6 up · 10 down
with five declining compounds at −5% to −29%, but three of the five are mid-`baseline`
re-anchoring and the other two just left a realisation block. **The recipe cannot separate a
programmed drawdown from a stall once blocks actually cycle** — which is the point worth recording:
the precondition and the recipe were mutually exclusive all along.

The 2026-08-03 load-bearing claim ("the feature would apply to a single exercise") is now
**unsupported rather than refuted** — it was computed against a program that no longer exists. The
design is untouched. Earliest answerable date is mid-October, after Bankai's own sessions complete
baseline and cycle twice. The entry records that and says explicitly not to re-run the query before
then; it is deliberately **not** gated, because `Gate:` resolves to a person or the S25 and what is
owed here is elapsed training time.

**Upper and Lower having no periodization row is not a defect** — `ensureSessionPeriodization`
inserts lazily and neither has been prescribed since 2026-09-06. Checked rather than filed.

**The zero-1RM scare, and the one entry it produced.** 41 `exercise_logs` carry
`estimated_1rm = 0`; **31** are `exercise_deloaded = true` and correct per the documented invariant.
The other **10** are two whole Pull sessions (2026-08-09, 2026-08-16) storing `estimated_1rm = 0`
with `exercise_deloaded = false` on real working sets — Sumo Deadlift 82.5 kg × 6,
`use_for_1rm: true`, `planned_pct: 80`. That is exactly the shape **Q-298 already fixed**:
`log-exercise.ts` used to store `exerciseDeloaded ?? false` while passing
`exerciseDeloaded === true || (isAnyDeload && !isBaseline)` to the estimator, so a phase-level
deload zeroed the 1RM and the row denied it. All ten predate the fix, none after it has the shape,
and every 1RM reader excludes them via `estimated_1rm > 0`. Not filed.

**Checking that is what produced LA-96.** `getLastRealOneRmBatch` justifies its second predicate
with a cited production violation — a 2026-08-06 log at `estimated_1rm = 85.75` with
`exercise_deloaded = true`. **That row is gone:** 0 of 444 logs hold that shape, deleted rows
included, and 2026-08-06 now reads consistently (five non-deloaded logs with real values, five
deloaded at 0). The comment's evidence is stale; its argument is not — a backstop exists for the
*next* regression — so the filter stays and the comment now records the correction alongside the
surviving opposite-direction residue. What the check did expose is a sibling-surface gap: **of six
1RM read sites only two apply both markers**; `getYearReviewTopExercises`, `listRecent1rm`,
`getStrengthTrend` and `/api/strength-trend` guard on `> 0` alone. Filed low in the queue, because
with zero rows of the offending shape the exposure is nil. LA-96 also notes that the last two of
those four are the same 90-day query duplicated across a slice and a route — **One Formula, One
Place** — which if resolved first makes it a three-site change.

**Not exercised:** no behaviour changed — the only code edit is a SQL comment. All measurements are
production reads through `/api/admin/db-query`, which is row-scoped to the owner; nothing here is a
claim about other accounts. No device run, and none is owed.
