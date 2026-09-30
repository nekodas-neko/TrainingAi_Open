# 2026-09-30 — BF-203a Task 6′: the device reads an estimate as an estimate

**Branch:** `feat/bf203a-answer-readers` · **Lane A** · the first of the device-first tasks. Still
nothing writes an estimate, so nothing the owner sees changes.

## What changed

- **Only a `'no'` is a decline.** `use-plan-meal-logging.ts` fed every answer row to the declined
  set, on both the store and the API branch. An estimate there would have hidden the prompt it
  stands in for.
- **One live answer per meal and day, on the device.** `upsertPlanMealAnswer` now updates an existing
  live row for the same meal and day instead of inserting beside it. A decline over an estimate
  replaces it and clears `est_*`, mirroring #2003's server fix.
- **`est_*` travels the whole pull:** the server delta map, the client pull mapper, `applyDelta`
  (behind the same `sync_status='synced'` gate as every other column), `getPlanMealAnswers`, and
  `LocalPlanMealAnswer`.

## Verified

- `bf203a-local-answers.test.ts` runs the shipped `SQLiteLocalStore` on a schema built from
  `MIGRATIONS`. It covers the estimate round-trip, a decline replacing an estimate as one row, and
  macros surviving a pull. It also pins the two hook call sites.
- Local-store, nutrition, sync and plan-meal-answer suites, with LA-137 over a real database: 313 passed.
  Test typecheck is clean, and `check:rules` ran 86 of 86.
- `pnpm dev` on the owner's snapshot, with a seeded estimate: `/api/sync/pull` and
  `GET /api/nutrition/plan-meal-answers` both return it with its macros.

## Not exercised

Native SQLite on the APK. The `node:sqlite` run executes the same SQL strings, but not the Capacitor
bridge.
