# 2026-08-05 — Per-set/per-workout HR attribution no longer depends on opening the recap

**Domain:** heart-rate · workouts — v1.266.1, JS/server-only (no APK rebuild)

## The gap (Q-11 Defect B)

`GET /api/oura/hr-data` — the recap fetch — was the **only** trigger that computed and persisted
`set_hr_stats`/`workout_hr_stats`. Finish a workout and never open its recap, and the session got no
HR attribution, ever. Production showed this directly: four of seven recent sessions had zero
`set_hr_stats` rows despite hundreds of HR samples inside their own windows, and every `computed_at`
on the rows that did exist lagged its workout by days (whenever the recap finally got opened).

The fix wasn't simply "compute at completion instead" — `computeWorkoutHr`'s window includes a
10-minute buffer, and an Oura ring drains its buffer well after a workout ends, so an immediate
compute is very often partial. The trap: the existing upsert's fuller-wins COALESCE protects stored
*values* from being clobbered by a later partial write, but the backfill work-lists
(`listSessionsMissingHrStats`, `listSessionsMissingSetHrStats`) only checked whether a row
*existed* — so a completion-time compute that landed a zero-reading row would permanently vanish
from the work-list, and no later, fuller compute would ever be attempted again.

## What shipped

1. **A completion-time trigger.** `POST /api/complete-workout` now fires a best-effort, fire-and-
   forget HR compute + upsert (mirroring the existing `hr-sync` fire-and-forget already on that
   route) immediately after a workout is marked complete. For a live chest strap — already streaming
   into `oura_heartrate` during the workout — this closes the gap outright with no recap ever opened.
   It writes nothing when there are zero readings yet, matching the recap route's own gate.
2. **Coverage-aware work-lists.** `listSessionsMissingSetHrStats`'s `having` now checks
   `COALESCE(MAX(readings_count), 0) = 0` instead of `count(*) = 0`, and
   `listSessionsMissingHrStats` now also matches an existing row with `readings_count = 0`. A session
   whose only attempt so far produced empty rows stays on the backfill list, exactly like a session
   with no rows at all — so an Oura-ring-only workout (no immediate data at completion) still gets
   picked up once its ring drains and a backfill pass runs.
3. **Corrected stale comments** on both admin backfill routes that described the now-removed
   behaviour ("marked done and not re-scanned").

## Verification

Through the real routes against `pnpm dev`, authenticated as the seeded user, no mocks:

- Completed a workout with live chest-strap-style HR readings already in `oura_heartrate` inside the
  workout window, **recap never opened**: `workout_hr_stats` and `set_hr_stats` rows landed
  immediately (`readings_count: 5`, `source: chest_strap`), confirmed via direct DB read.
- Completed a second workout with **no** HR readings at all (the ring-hasn't-drained case): no rows
  written by the completion trigger, and the session stayed fully absent from `set_hr_stats`/
  `workout_hr_stats` — same as before this change.
- Inserted HR data for that second session afterward (simulating a delayed ring drain) and ran both
  admin backfill routes (`/api/oura-ble/backfill-hr-stats`, `/api/workout/backfill-set-hr-stats`):
  both picked it up (`withData: 1`) and it now carries real `readings_count`/`source` values — proof
  the coverage-aware work-list, not just the completion trigger, is what closes this gap for the
  delayed-ingest case.

New DB-backed regression tests cover the coverage-aware `having`/`where` change directly
(`set-hr-stats.test.ts`, `oura-workout-hr-stats.test.ts`), and a mocked route test covers the
completion-trigger wiring, including that a throwing HR compute never affects the completion
response (`app/api/complete-workout/__tests__/route.test.ts`).

Full suite: 400 files, 3,171 tests, all green except one pre-existing, unrelated failure
(`scale-ble-multi-reading.test.ts`, a leftover local-DB row from an earlier run — reproduces
identically on `main` with none of this diff applied). Typecheck clean except one pre-existing,
unrelated error (`voice-log-button.tsx` — a missing package, also reproduces on `main`). Lint clean;
`check-push-mutations` clean (this fix only touches the web route, not the offline outbox path — see
"what this doesn't touch" below).

## What this doesn't touch

- **The offline/outbox path.** The completion-time HR trigger lives only in the web
  `POST /api/complete-workout` route, not in `completeWorkoutFromPayload` (the function shared with
  `pushMutations`'s `complete_workout` branch) — same asymmetry the existing `hr-sync` fire-and-forget
  already has. An offline-completed workout still gets attribution once the device is back online and
  either its recap is opened or the next admin backfill pass runs.
- **The still-open half of Q-11.** Of the rows that exist, a large share have `coverage_ok=false` and
  a null `peak_bpm` — possibly genuine strap dropout during lifting, not a triggering bug. That
  question is deliberately left for a fresh re-measurement now that Defect B no longer contaminates
  the sample with stale, days-late computes.
- **Not exercised:** no device/native surface — this is server-side HR-attribution logic reached via
  Railway with no APK rebuild.
