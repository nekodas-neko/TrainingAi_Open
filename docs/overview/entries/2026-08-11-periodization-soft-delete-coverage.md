# 2026-08-11 — the periodization slice's seventeen soft-delete filters now have tests (Q-182)

**Branch:** `test/soft-delete-periodization-oura` · no version bump (tests + docs)

## Why this slice

`periodization.ts` is what the AI prescription reads from: how many sessions a phase has seen, what
was lifted recently, how long sets take, the 1RM trend, and weekly sets per muscle. All aggregates —
so a broken `deleted_at` filter loses no data, it silently inflates a number the next prescription is
built on. `getWeeklySetsByMuscleGroup` overstating a muscle reads to the engine as "already at
volume target", and it prescribes *less*.

Removing any of the seventeen filters failed no test at all.

## What was added

`periodization-soft-delete.test.ts` — 21 cases over one fixture (a completed session, two exercise
logs, two sets), each deleting at exactly one level so a broken filter is attributable rather than
merely detectable. Covers `reconcileSessionsInPhase`, `getWorkoutSessionProgramSessionId`,
`getRecentSessionsOfType`, `getSetLogsForSessions`, `getSetTimingRows`, `getExercise1rmHistory` and
`getWeeklySetsByMuscleGroup`.

## Verified by mutation — and the sweep caught a real gap

Each of the seventeen was mutated on its own: raw SQL rewritten to `1 = 1`, drizzle `isNull(...)`
swapped for an always-true predicate. **Every one fails exactly one test.**

The first draft did not. Two filters survived — the library-branch `el` filter and the
non-library-branch `sl` filter of `getWeeklySetsByMuscleGroup`, which is **two queries carrying three
filters each**. A case that deletes only the library-side row never exercises the non-library query's
copy. Counting the tests would have called that covered; running the mutations named the two that
were not, and the fix was to run each delete from both sides.

**Gotcha worth keeping:** an always-true substitute predicate must name a table the query already
joins. The first attempt used `isNotNull(s.users.id)` in queries that never join `users`, and the
extra "failures" were SQL errors — a mutation that fails for the wrong reason looks exactly like
coverage.

## Where Q-182 stands

**24 of 35 covered.** `user-stats.ts` (7, #1244) and `periodization.ts` (17, this one).
**`oura.ts`'s 11 remain** — the slice that needs a seeded rollup window, and the reason the entry
stays open.

## Not exercised

Local Postgres read paths only. **No device run** — nothing here touches an offline-first domain, a
native plugin, safe-area or notifications, and no product code changed.
