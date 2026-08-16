# 2026-08-11 — Q-182 closed: the last eleven soft-delete filters have tests

**Branch:** `test/soft-delete-oura-slice` · no version bump (tests + docs)

## What was covered

The oura slice's eleven `deleted_at` filters, all in its workout queries:
`listSessionsMissingHrStats`, `getSetDetailsForSession`, `listSessionsMissingSetHrStats`,
`getSetTimestampsForSession`, `getUnsyncedHrSessionsForDay`, `getUnsyncedHrSessions` and
`getWorkoutSessionById`.

These are the HR-attribution **work lists**: which finished sessions still need heart-rate stats,
and which sets those stats attach to. A broken filter here loses no data — it hands a deleted
session or set to the HR pipeline, which writes stats for a workout the user removed and then
re-selects it on every run, because the stats never "complete". `getSetTimestampsForSession` is
worse than a wasted pass: a deleted set's window would claim readings belonging to the set the user
kept.

18 cases over one fixture, each deleting at exactly one level. **All eleven verified by individual
mutation** — replacing each `isNull(...deletedAt)` with an always-true predicate on the same table
fails exactly the case named for it.

One case is a non-obvious guard: deleting *one* of two sets must **still** leave the session on
`listSessionsMissingSetHrStats`. It inner-joins through the logs, so an over-eager filter there
would strand a session that still has live sets needing stats.

## The entry's deferral reason was wrong

Q-182 held `oura.ts` back as "the one that needs a seeded rollup window, which is the real work in
this entry". It does not. Every one of its eleven filters is in a work-list query over
`workout_sessions` / `exercise_logs` / `set_logs` — the same fixture shape as `user-stats.ts` and
`periodization.ts`, and no rollup anywhere. The slice is *named* oura, and the estimate came from
the name rather than from reading the queries.

Worth remembering before deferring on a size estimate again: the deferral cost more sessions than
the work did.

## Q-182 is complete

| slice | filters | where |
|---|---:|---|
| `adapter.ts` | 6 | Q-178 |
| `nutrition.ts` | 1 | Q-178 |
| `user-stats.ts` | 7 | #1244 |
| `periodization.ts` | 17 | #1251 |
| `oura.ts` | 11 | this PR |
| **total** | **42** | of which the 35 Q-182 tracked |

The entry is removed and replaced with a short note recording the correction.

## Not exercised

Local Postgres read paths only. **No device run** — no offline-first domain, native plugin,
safe-area or notification surface, and no product code changed.
