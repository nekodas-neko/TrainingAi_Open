# Review — write concurrency: what happens when the same write arrives twice at once

**Date:** 2026-08-18 · **Agent:** Review · **Lens:** concurrent/duplicate writes and idempotency
**Findings filed:** Q-473, Q-474 · **Clean results recorded:** four

## Why this lens

`CLAUDE.md` records a real production incident in this exact class — *"5 rapid taps once fired 4
`complete-workout` POSTs"* — and a whole standing section, **Stored Counters**, that opens with
*"Every stored counter in this project has drifted"* and names `sessions_in_phase` as having been
fixed **three separate times**. Three earlier reviews discuss races in the abstract. **None of them
ever fired two requests at once and looked at the result.** That is the gap this sweep closes.

Method: local `pnpm dev` against the seeded local Postgres, N concurrent `curl`s from one shell
(`&` + `wait`), reading the affected rows out of the database before and after. Every probe was run
with a single-request control first, so a "clean" result means *the concurrent case matched the
serial case*, not merely that nothing 500'd.

---

## Finding 1 (Q-473) — completing one workout N times concurrently increments `sessions_in_phase` N times

**This is the counter `CLAUDE.md` says has already drifted three times, and the function that owns it
carries a comment promising the exact guarantee it does not provide:**

```ts
// Idempotent: a retried/replayed completion (network retry, or an outbox
// mutation re-pushed after its response was lost) must not re-consume the
// prescription or double-increment the sessions_in_phase stored counter.
export async function completeWorkoutFromPayload(...)
```
— `packages/shared/src/workout/complete-workout.ts:36-39`

### The shape

```ts
const existing = await repo.getWorkoutSessionById(userId, workoutSessionId)
const alreadyCompleted = existing.completedAt != null        // ← read
await repo.completeWorkoutSession(workoutSessionId, userId, completedAt)   // ← write
...
if (programSessionId && !alreadyCompleted) {
  repo.incrementSessionsInPhase(userId, programSessionId).catch(...)       // ← non-idempotent
}
```

Textbook check-then-act. `completeWorkoutSession` **is** correctly guarded —
`adapter.ts:806-814` carries `isNull(s.workoutSessions.completedAt)` in its `WHERE`, so only one
concurrent request actually stamps `completed_at`. But it returns `void`. The idempotency decision is
taken from the **earlier read** instead of from that UPDATE's affected-row count, so every request
that read before the winner wrote believes it is the first, and every one of them increments.

### Measured

Four concurrent `POST /api/complete-workout` for one workout session, on a fresh row with
`sessions_in_phase` reset to 0, spaced 65 s apart to clear the `5 / 60 s` rate limit:

| Trial | Response codes | `completed_at` set | `sessions_in_phase` after |
|---|---|---|---|
| A | 200 200 200 200 | 1 row | **3** |
| B | 200 200 200 200 | 1 row | **3** |
| C | 200 200 200 200 | 1 row | **2** |
| D | 200 200 200 200 | 1 row | 1 |

An earlier 5-wide burst that the limiter cut to two survivors produced **2**. So the over-count
tracks the number of requests that get through, and it reproduced in **4 of 5** bursts. The
`completed_at` column is correct in every trial — the workout is completed exactly once. Only the
counter is wrong.

### Why it matters

`sessions_in_phase` is what advances the periodization phase (`baseline → accumulation →
intensification → realisation → deload`). Over-counting moves the lifter into the next phase — and
into a deload — **early**, off a phantom session that was never trained. It is also silent: nothing
compares the counter against `workout_sessions`, and the *workout* row looks perfect, so the drift is
only visible as "my programme advanced sooner than it should have", which is exactly the sort of
report that gets dismissed.

Two live vectors, not one:
- **Rapid taps.** The documented 5-taps-4-POSTs incident is this input.
- **Outbox replay.** The offline `pushMutations` `complete_workout` branch calls the *same* shared
  function, so a mutation re-pushed after a lost response takes the same path. That is precisely the
  case the comment above says is handled.

### The fix is already written elsewhere in this file's neighbourhood

`upsertPersonalRecordIfBetter` (`adapter.ts:2987-3004`) does the same read-then-conditionally-write
correctly — `db.transaction` + `SELECT … .for('update')`. The codebase knows this pattern; the
completion path just does not use it. The cheaper fix is `CLAUDE.md`'s own write-path rule (a),
*"check the affected-row count"*: have `completeWorkoutSession` return its row count and derive
`alreadyCompleted` from that instead of from the prior read. One guarded UPDATE already exists; only
its return value is being thrown away.

### Not verified

Reproduced on `pnpm dev` against local Postgres only. Not run against production (correct — this
writes), and **not** run on the APK. The dev server is a single node; a multi-replica deployment
would if anything widen the window, not narrow it.

---

## Finding 2 (Q-474) — `workout_sessions` has two FKs to `program_sessions`, one of which nothing has ever written

`workout_sessions` carries **both**:

```ts
sessionId:        uuid('session_id').references(() => programSessions.id, ...)          // line 157 — live
programSessionId: uuid('program_session_id').references(() => programSessions.id, ...)  // line 168 — dead
```
— `lib/data/postgres/schema.ts`

`program_session_id` was added by migration `079_ai_dynamic_periodization.sql:19`, its comment saying
*"for prescription trigger linkage"*. `grep` for `workoutSessions.programSessionId` across
`lib app packages` returns **zero hits**. Nothing writes it and nothing reads it.

**Production confirms it: 0 of the owner's 91 `workout_sessions` rows have `program_session_id` set;
45 have `session_id`.** (`claude_ro` is row-scoped to one user, so this is the owner's rows, not the
whole table — but a column nothing in the codebase references cannot be populated for anyone else
either.)

### The trap, which is the actual finding

The **dead** column owns the name that the live one is used under, in two places:

- `getWorkoutSessionProgramSessionId(userId, workoutSessionId)` — named for `program_session_id` —
  selects `s.workoutSessions.sessionId`, i.e. `session_id` (`slices/periodization.ts:299-306`).
- `ensureWorkoutSession(userId, sessionId, programSessionId, …)` takes a parameter called
  `programSessionId` and writes it into the **`sessionId`** field (`adapter.ts:772-780`).

So the identifier `programSessionId` refers to the live column everywhere in code, while the column
literally named `program_session_id` is inert. This cost this sweep a wrong conclusion: the Q-473
setup populated `program_session_id`, the periodization block silently took the `programSessionId ==
null` branch, the counter did not move, and the honest reading of that run was *"the race does not
exist"*. It does. Any implementer reading Q-473 and setting up the same fixture hits the same wall.

**Not a live bug** — nothing is broken today, because nothing uses the dead column. File it as the
maintenance hazard it is. Fix shape is the implementer's call, but note that dropping a column is a
data-losing migration and needs owner confirmation under `CLAUDE.md`; renaming the reader and
commenting the schema is the zero-risk half and removes most of the trap on its own.

---

## Clean results — recorded so the next sweep does not re-run them

- **`POST /api/day-checkin` — idempotent.** Five concurrent identical requests → five `201`s, **one
  row**. Upsert-keyed on the day; the concurrent result matches the serial result exactly.
- **`completeWorkoutSession` itself — correctly guarded.** `isNull(completedAt)` in the `WHERE` means
  the workout is completed once no matter how many requests arrive. The bug in Q-473 is downstream of
  this, not in it.
- **`upsertPersonalRecordIfBetter` — correctly locked.** `db.transaction` + `SELECT … FOR UPDATE`
  around the read-then-write. This is the reference implementation for the Q-473 fix.
- **`POST /api/ai-periodization/session/[id]/transition` — idempotent by construction.**
  `advancePhase` sets every field to an absolute value (`phase`, `sessionsInPhase: 0`, the
  prescription slots), so replaying it converges. Concurrent duplicates are harmless.

## One result deliberately **not** filed

`POST /api/activity-logs`: five concurrent identical requests → five `201`s and **five rows**. There
is no server-side dedupe and no rate limit on the route. I nearly filed this and then checked the
callers, which is the difference between a finding and noise:

- `done-activity-screen.tsx` and `exercise-review-sheet.tsx` both hold a `saving` flag and disable
  the button on it — `CLAUDE.md`'s in-flight-guard rule is satisfied on both.
- `walk-summary.tsx` has no save button at all; the write fires automatically and is `saved`-gated.

So there is no user-reachable double-tap vector today, and server-side dedupe would be **wrong** here
— two walks in one day are two legitimate rows. The honest statement is that protection is entirely
client-side and single-layer, which is acceptable for append data. Recorded, not queued.

## Method notes for the next sweep

- **The rate limiter's L1 is in-memory** (`lib/rate-limit.ts`), so `DELETE FROM rate_limits` does
  **not** reset it — six consecutive trials returned `429` after the first. Space concurrency trials
  by the full window (65 s for a 60 s limit) instead.
- **Always populate the fixture through the code path's own writer, or verify which column it
  reads.** Hand-writing a plausibly-named column is how the first Q-473 run produced a false negative
  (see Q-474).
