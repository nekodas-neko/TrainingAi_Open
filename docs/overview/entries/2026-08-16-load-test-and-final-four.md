# 2026-08-16 — the last four reviews, and the load test that was deferred four times

**Branch:** `claude/gym-app-comprehensive-review-j38fo9` · **Type:** review + a measurement harness ·
**Backlog:** Q-306, Q-307, Q-308 · **Q-298 RESOLVED** · **Q-305 extended**

Fifth review in the series. Closes the four items earlier rounds listed as *not started* and answers
the question that had been deferred four times.

## Q-298 is resolved, and the answer was two queries away

The five unexplained 2026-08-09 zero-1RM rows all belong to **one `Pull` session**, and
`session_periodization` shows **Pull entered the `deload` phase on exactly 2026-08-09**. So
`estimateOneRm` was called with `deloaded: true` from the phase and correctly returned 0 — the same
deliberate branch that explains the 08-06 `Upper` session.

**The zeros were never the bug.** The defect is that the phase-level deload zeroed the estimate and
**never stamped `exercise_deloaded` on the row** — which is exactly why Q-228's filter misses them
and why they leak into prescription. The original entry claimed that outcome with the wrong reason;
the outcome stands and now has a cause, and the work is two small changes instead of an
investigation.

Worth noting the sequence: this entry was filed wrong, corrected once (half the rows were by
design), and resolved on the third pass. Each pass was cheap because the previous one wrote down
what it had actually checked.

## The load test

Two committed harnesses under `scripts/load-test/`, both refusing to run against a non-local
database. Seeded 10 users at the owner's real production profile — 10,527 set logs, 20,000 HR rows,
11 seconds — then replayed `getSyncDelta`'s 21-query fan-out at production's `poolMax = 10`.

**Nothing breaks at 10 users. Nothing breaks at 100.** p95 of 210 ms at 10 concurrent syncs, 1,562 ms
at 100, **zero failures at any level up to 200**. First failures extrapolate to ~300 concurrent
syncs, arriving as timeouts rather than errors. And 10 users is not 10 concurrent syncs — real
concurrency is near zero unless devices sync on a shared schedule, which is the thing actually worth
watching.

**Two results that matter more than the limit.** A **bigger pool does not help — it is slightly
worse** (50 concurrent: 778 ms at poolMax 10, 803 at 20, 952 at 40). And the **entire fan-out is
22.6 ms of query work**, so it demands 21 connections to save about 8 ms. Running it serially gives
**identical p95 for a 21× cut in connection demand**.

Both of those bear on Q-107 and Q-213, which attribute production sync failures to "DB-pool
contention" — the pool measures as not the binding constraint. I have **not** struck those entries:
the production faults were real, and a local measurement does not refute a production diagnosis. It
does mean the next session should not inherit "pool contention" as settled cause.

**And I did not act on the serial result**, because the harness runs over a Unix socket where
per-query RTT is ~0 and Railway is a real network — serial would add 21 × RTT. Q-308's first task is
measuring that, not applying the change.

## The other three

**Deload policy** (Q-306): fired once in 3.5 months, so not over-firing today — but the emergency
trigger is `rpeTrend.delta > 2.0` and Q-289 measured a systematic **+1.93**. Blocked on Q-289, since
the threshold has to be re-derived after that calibration rather than tuned now. Also noted: ACWR
now drives three behaviours at three thresholds.

**Cardio** (Q-307): `avg_pace_sec_per_km` populated on 7 of 46 logs while 39 carry both duration and
distance. Read from the column, never derived, written as an explicit `null` at save — same shape as
Q-230, and flagged as very likely one fix for pace, steps and calories together.

**Phase engine**: clean. Five rows that looked like stuck `sessions_in_phase` counters — and
`CLAUDE.md` has a whole Stored Counters rule about exactly that drift — turned out to belong to an
**inactive** program. Fifth finding to die on verification across these five reviews.

**Muscle balance**: push:pull 1.30, mildly push-dominant and not alarming. Folded into Q-305 rather
than filed separately, since it is the same missing surface.

## Still open

The systematic AI-output audit (8 of 117 read), the degradation matrix against a running app
(Q-294), and **Railway per-query RTT** — which cannot be measured from the sandbox and is what
Q-308 needs before anyone touches the fan-out.
