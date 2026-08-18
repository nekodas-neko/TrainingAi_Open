# 2026-08-18 — Review: write concurrency, measured for the first time

**Agent:** Review 📖 · **Branch:** `claude/review-write-concurrency` · **Docs-only.**
**Filed:** Q-473, Q-474 · **Review:** [`docs/reviews/2026-08-18-write-concurrency.md`](../../reviews/2026-08-18-write-concurrency.md)

## What this sweep was for

`CLAUDE.md` has carried a **Stored Counters** rule since early on — *"Every stored counter in this
project has drifted"* — naming `sessions_in_phase` as having been fixed three separate times, and it
records a real incident where five rapid taps fired four `complete-workout` POSTs. Three previous
reviews discuss races. **None had ever fired two requests at once and read the row afterwards.** This
sweep did.

## Q-473 — the counter drifted again, and it is measurable

Four concurrent `POST /api/complete-workout` for **one** workout session: four `200`s,
`completed_at` stamped on exactly one row, and `sessions_in_phase` landing on **3, 3, 2, 1** across
four trials. Reproduced in 4 of 5 bursts.

The guarded UPDATE is already there (`isNull(completedAt)` in the `WHERE`) — it just returns `void`,
so the idempotency decision is taken from a read that happens *before* it. Every request that read
first believes it is first, and every one of them increments. `completeWorkoutFromPayload`'s own
comment promises the opposite outcome.

It matters because `sessions_in_phase` advances the periodization phase, so over-counting walks the
lifter into the next phase — and into a deload — early, off a session that was never trained. The
outbox replay path calls the same shared function, which is exactly the case the comment names.

The fix already exists nearby: `upsertPersonalRecordIfBetter` does the same read-then-write correctly
with `db.transaction` + `SELECT … FOR UPDATE`. Cheaper still, `CLAUDE.md`'s own write-path rule (a)
— return the affected-row count and decide from that.

## Q-474 — the trap that made the first run read as a clean result

`workout_sessions` has **two** foreign keys to `program_sessions`: the live `session_id` and a dead
`program_session_id` (migration 079, zero code references, 0 of the owner's 91 production rows
populated). The dead column owns the name the live one is used under —
`getWorkoutSessionProgramSessionId()` reads `session_id`, and `ensureWorkoutSession`'s
`programSessionId` argument is written into `session_id`.

The first Q-473 fixture populated the dead column. The periodization block took the `null` branch, the
counter never moved, and the honest reading of that run was *"the race does not exist"*. It does. That
near-miss is the reason Q-474 is filed at all — nothing is broken today, but the next person building
that fixture hits the same wall.

## Recorded clean, so they are not re-run

`day-checkin` is idempotent under concurrency (5 concurrent → 1 row); `completeWorkoutSession`'s own
UPDATE is correctly guarded; `upsertPersonalRecordIfBetter` is correctly locked; the phase-`transition`
route is idempotent by construction (`advancePhase` sets absolute values).

`POST /api/activity-logs` duplicates freely — five concurrent → five rows, no dedupe, no rate limit —
and was **deliberately not filed**: both button-driven callers hold an in-flight `saving` guard, the
third writes automatically, and server-side dedupe would be wrong (two walks in a day are two real
rows). Protection is single-layer and client-side, which is acceptable for append data. Recorded, not
queued.

## Method notes worth keeping

- **The rate limiter's L1 is in-memory** (`lib/rate-limit.ts`), so `DELETE FROM rate_limits` does not
  reset it — six consecutive trials all returned `429`. Space concurrency trials by the full window.
- **Populate a fixture through the code path's own writer, or verify which column it reads.**
  Hand-writing a plausibly-named column produced this session's one false negative.
