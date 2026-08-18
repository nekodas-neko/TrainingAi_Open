# 2026-08-18 — one workout, one increment: the completion race on `sessions_in_phase` (Q-473)

**Lane A** · branch `fix/complete-workout-increment-race` · no migration, no Kotlin, no APK — a
Railway deploy delivers it.

Four concurrent `POST /api/complete-workout` for a single session advanced `sessions_in_phase` by up
to 3. The counter drives phase progression (baseline → accumulation → intensification → realisation
→ deload), so over-counting moves the lifter into the next phase, and into a deload, off sessions
that were never trained. The workout row itself was correct every time.

## What was actually wrong

Not the UPDATE. `completeWorkoutSession` already carried `isNull(completed_at)` in its `WHERE`, so
the database elected exactly one winner all along. It returned `void`, and
`completeWorkoutFromPayload` therefore decided idempotence from a read taken *before* the write —
which holds for a sequential replay and fails for a simultaneous one, because every racer reads
`completedAt = null` and every racer believes it is first.

The fix is `CLAUDE.md`'s own write-path rule (a): return the affected-row count and derive
`alreadyCompleted` from it. `.returning({ id })` on the existing guarded UPDATE — no new
transaction on a hot path, no lock, no second query.

Two callers are covered by one change, because both go through the shared function: the web route
and `pushMutations`' `complete_workout` branch (the outbox replay the function's own comment names).

## The test almost shipped worthless

The first draft of the DB-backed test **passed on the broken code**, and that is the part worth
carrying forward. Four in-process `completeWorkoutFromPayload` calls under `Promise.all` do *not*
race: the first one pays for the lazy `import('@/lib/data')`, the `getRepository` singleton and four
cold `pg` connections, and finishes writing before the others reach their read. Instrumented, the
old logic printed `alreadyCompleted = false, true, true, true` — serialised.

Warming the module graph and the pool on a throwaway session first makes it race for real. Measured
both ways on that shape:

| | old logic | fixed |
|---|---:|---:|
| `sessions_in_phase` after 4 concurrent completions | **4** | **1** |
| rows with `completed_at` set | 1 | 1 |

The warm-up is now a commented line in the test, because deleting it silently converts the file back
into one that cannot fail.

## Live route, on `pnpm dev`

Four concurrent HTTP `POST /api/complete-workout` on one session: **four 200s, one `completed_at`,
`sessions_in_phase = 1`**. Reverting the fix under hot-reload and repeating gave `1` once and `0`
once — the live rig is a flaky discriminator, which matches the review's own "reproduced in 4 of 5".
That is why the deterministic gate is the warmed DB-backed test, not the curl loop.

## Drift already in the database

`reconcileSessionsInPhase` derives the counter from real completed, non-deleted, non-empty sessions
since `phase_started_at`, so it corrects over-count as well as under-count. It runs on the two read
paths that consume the counter — `/api/workout-data` (both branches) and
`/api/ai-periodization/program-overview` — each gated on `isAiDynamic`, which is also the only mode
that reads the counter. So existing drift self-heals wherever it can be observed; no repair
migration is needed.

## Not exercised

Production (it writes), the APK, and a multi-replica deployment. Local `pnpm dev` is a single node —
more replicas widen the race window rather than narrow it, and the fix is a single guarded UPDATE, so
it holds across replicas by construction.
