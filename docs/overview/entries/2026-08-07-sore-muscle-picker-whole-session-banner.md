# 2026-08-07 — Sore-muscle check-in warns before a whole-session deload, not just a narrow one

**Domain:** workouts — v1.267.12, JS-only (no APK rebuild)

## The report

Q-115-followup, split off from Q-115 after its 1RM-inflation half shipped (see
[`entries/2026-08-07-deload-1rm-inflation-fix.md`](2026-08-07-deload-1rm-inflation-fix.md)).
`SoreMusclePicker`'s overlap banner always said "those exercises will be lightened" — implying a
narrow, per-exercise effect — even when `computePerExerciseDeload` was about to escalate to a
**whole-session** deload (more than half the session's exercises matching a sore muscle on their
main-role assignment, by design). Directly observed in production: an owner check-in marking six
sore muscle groups triggered exactly this escalation, and the resulting session flagged 4 of 5
exercises "Personal Records" — the other half of Q-115, already fixed.

## Why this needed real plumbing, not a one-line copy fix

Predicting the escalation client-side means reusing `computePerExerciseDeload`'s exact match logic
— sore-muscle labels against each exercise's **main-role** assignment — not the flat muscle-name
list `SoreMusclePicker` used to receive. That list (`sessionMuscles?: string[]`) was built via
`.flatMap(ex => ex.muscleGroups)` with no role information at all.

## The fix

- `/api/next-session` now also returns `muscleAssignmentsByExercise: Record<string, MuscleAssignment[]>`
  (new optional field on `NextSessionRecommendation`), built from the same
  `repo.getExerciseMuscleAssignments()` already used server-side for the real computation —
  populated only when a session exists.
- `session-select-content.tsx` builds `moodSheetSessionExercises` (per-exercise
  `{sessionExerciseId, name, muscleAssignments}`, matching `PerExerciseDeloadInput` exactly) and
  threads it through `MoodCheckInSheet` → `SoreMusclePicker` as a new `sessionExercises` prop.
- `SoreMusclePicker` calls `computePerExerciseDeload(sessionExercises, selected, 'strength',
  'accumulation')` directly (the shared function, not a re-derivation) and switches the banner
  text when `outcome === 'whole_session'`. `trainingGoal`/`phase` are fixed placeholders —
  deliberately, since neither affects the escalation `outcome` this reads, only the override
  numbers/notes the banner doesn't use, and the real deload-phase gate is a separate, correct
  server-side concern this client prediction doesn't need to duplicate.
- `sessionExercises` is optional and the banner falls back to the original narrow phrasing when
  it's absent, so nothing regresses for any caller that doesn't thread it through.

## Verification

Typecheck and lint clean on all touched files. Full suite: 403 files / 3,187 tests green
(`computePerExerciseDeload` itself already has thorough dedicated coverage in
`lib/__tests__/per-exercise-deload.test.ts`; this change is a thin reuse of it, not new logic
worth a separate unit test — this repo has no React component-test infrastructure to test the
wrapping UI directly).

Ran `pnpm dev` against the local seeded DB and exercised the real path end-to-end: confirmed
`GET /api/next-session` returns real `muscleAssignmentsByExercise` for the seeded 3-exercise Push
session (Bench→chest, Overhead Press→shoulders, Tricep Pushdown→triceps, each main-role). Used
Playwright to open the mood check-in sheet via the home screen's "Log Readiness" button and select
Chest + Shoulders as sore (2 of 3 exercises match on main-role → escalates): banner correctly read
"over half the session is affected, so the whole session will be lightened, not just those
exercises." Deselecting Shoulders (back to 1 of 3) correctly reverted to the narrow "those
exercises will be lightened" phrasing. Verified in both light and dark themes — screenshots
confirmed correct rendering (pill colors, muscle heatmap, banner box) in both.

**Not exercised:** no on-device S25 verification — JS-only change, no native/safe-area/gesture
surface.
