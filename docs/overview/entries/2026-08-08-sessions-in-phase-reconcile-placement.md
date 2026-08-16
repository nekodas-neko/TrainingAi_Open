# 2026-08-08 — `sessions_in_phase` is now reconciled where it is actually read

**Domain:** workouts / platform — v1.270.2, JS-only (no APK rebuild)

## The gap

Q-128, from the 2026-08-07 full-app review (§3.14). `reconcileSessionsInPhase` existed and worked,
but sat at exactly one read site: `app/api/ai-periodization/program-overview/route.ts:17`. The two
places that turn the counter into something the user sees or the engine acts on read it raw:

- `app/api/workout-data/route.ts` → `completedCycles` and `phaseSessionNumber`, rendered on the
  workout screen ("session N of phase");
- `packages/shared/src/ai-periodization/signals.ts` → `sessionsInPhase`, which goes into the
  prescription prompt.

This counter has drifted three separate times (over-count on re-sync, no decrement on delete,
direct DB edits), so a drifted row mislabels the phase progress and skews what the AI is told —
healed only if the user happened to open the program-overview screen.

## Scope check before building

Production, 2026-08-07: of 10 `session_periodization` rows exactly one is drifted, and it is on an
**inactive** program. The structural gap is real; today's user impact is nil. Fixed as hardening,
not escalated.

## The fix

- `workout-data/route.ts`, batch path (`?tab=all`): `reconcileSessionsInPhase` joins the existing
  `Promise.all`, which completes before the per-session periodization map is built. No extra
  round-trip.
- `workout-data/route.ts`, single-session path: the periodization slot in its `Promise.all` becomes
  `reconcile(...).then(() => getSessionPeriodization(...))`, so the heal still runs alongside the
  other five queries rather than serially in front of them.
- `signals.ts`: after the initial fetch, `aggregateSignals` reconciles and re-reads its own state.
  The prescribe path already reconciles upstream (`generate-prescription.ts:198`, SYNC-T2), but
  the `workout-review` caller never passed through it, so the shared function now carries the
  guarantee instead of each caller.

Both new calls are advisory — `.catch(() => {})` on the reconcile, falling back to the unreconciled
row in `signals.ts`. A failed self-heal must not take down the workout screen or a review.

## Why not inside `getSessionPeriodization`

That was the backlog's first suggestion and it is wrong here. `completeWorkoutFromPayload` marks
the session complete, **then** reads periodization, **then** fires `incrementSessionsInPhase`. A
reconcile hidden inside the read would count the just-completed session and the increment would
then add it a second time — turning a self-heal into a double-count. The read sites are reconciled
instead, which is also what `reconcileUserStats` does at `achievements.ts:82`.

## Verification

`tsc --noEmit` clean. `eslint` on both touched files matches the pre-existing baseline (the one
warning in `signals.ts` is unrelated and present on `main` — confirmed by re-running against a
stashed tree). Full suite: 404 files / 3217 tests, one failure
(`scale-ble-multi-reading.test.ts` → "another account's reading is not this one's trend"), which
**also fails on a stashed clean tree** — it needs a second user row that the local seed does not
have, so its `INSERT … SELECT … WHERE id <> $1` inserts nothing and the prior test's row is still
read. Local-seed artifact, not this change.

**Live-verified against `pnpm dev` and the local DB**, both routes, both directions of drift:
1. Set the program to `ai_dynamic`, created two `session_periodization` rows with
   `phase_started_at = 2026-07-01` — one under-counted (`sessions_in_phase = 0`) and one
   over-counted (`9`), against 3 genuinely completed sessions each.
2. `GET /api/workout-data?tab=all` → both rows read back **3**.
3. Re-drifted both to `7`, then `GET /api/workout-data?session=<id>` → both rows read back **3**
   again (the reconcile is program-scoped, so the single-session path heals its siblings too).

Local seed restored to `phase_mode = 'manual'` and the test periodization rows deleted afterward.

**Not exercised:** the `signals.ts` half was verified by type-check and code review rather than a
live run — reaching it needs a real prescription/review generation (a Gemini call) and the change
is a reconcile-then-re-read of the same shape already proven at
`generate-prescription.ts:198-199`. No on-device verification — server-only, no native, safe-area
or gesture surface touched.
