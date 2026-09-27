# 2026-09-27 — RV-219 ①: `/api/day-log` says which lifts are bodyweight

Health → Day showed a chin-up as "0 kg". The repo already had the resolver
(`isBodyweightType`, `packages/shared/src/1rm.ts`), but `DayExercise` carried no exercise type,
so the card had nothing to pass it.

## What changed

- `ExerciseLog` (`packages/shared/src/types/log.ts`) gains an optional `exerciseType`.
  `buildWorkoutSessions` fills it with one lookup of `exercise_library` by the logs' `exercise_id`s.
  That lookup is separate from the log query, so the rows keep the shape every other caller reads.
- `DayExercise` (`app/api/day-log/route.ts`) carries `exerciseType`: `'bodyweight'`, `'weighted'`,
  or `null` for a log with no library row.
- **The render is Lane B's**, so it is filed as `LA-164` (`Needs: RV-219`) rather than done here.
  RV-219 leaves the queue: ② shipped in #1785, and ③ was always RV-208's.

## Checked before building

On production (owner's rows only, via `claude_ro`), **all 504 non-deleted logs carry an
`exercise_id`**, and "Chin-Up" resolves to `bodyweight`. A join through `exercise_id` therefore
covers the real data; a name-based fallback would have been machinery for rows that do not exist.

## Verification

- `rv219-day-log-exercise-type.test.ts` drives the route handler: a bodyweight, a weighted, and an
  unlinked log come back `bodyweight` / `weighted` / `null`.
- Mutants: the route dropping the field, and the adapter never resolving it, are both killed. The
  control (`??` → `||`, equivalent for non-empty strings) survives.
- `pnpm dev`: `GET /api/day-log` over HTTP returned `exerciseType` for a seeded session, `null`
  until its log was linked to a library row, then `bodyweight`. A bad date still gets a 400.
- The eight existing day-log and session tests pass unchanged.

## Not exercised

The device, and anything visible to the owner, which waits on `LA-164`.
