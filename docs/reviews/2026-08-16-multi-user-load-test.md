# The last four reviews, and the multi-user load test

**Date:** 2026-08-16 · **Against:** `main` at `aff5475` · **Type:** review + one measurement harness
**Fifth of five.** Preceded by [scoring pillars](2026-08-15-comprehensive-app-review.md) →
[six unused lenses](2026-08-15-uncovered-lenses-review.md) →
[pillar model soundness](2026-08-15-pillar-model-soundness-review.md) →
[workout round 3](2026-08-15-workout-model-round-3.md)
**Backlog:** Q-306, Q-307, Q-308 · **Q-298 RESOLVED** and amended · **Q-305 extended**

This closes the four items previous rounds listed as *not started*, and answers the question that
had been deferred four times: **what breaks at 10 users, at 100?**

**Short answer: nothing breaks at 10, and nothing breaks at 100.** The measured limit is ~300
concurrent syncs, and it arrives as timeout rather than error. The interesting result is not the
limit — it is that **the sync fan-out's parallelism buys no latency under load while costing 21×
the connections**, which reframes the cause Q-107 and Q-213 were written against.

---

## 1. Q-298 is RESOLVED — the mystery rows were a deload the row never recorded

Round 3 left five 2026-08-09 rows with `estimated_1rm = 0`, `exercise_deloaded = false`, real
weights and real reps — "these three should compute and do not". Two queries settle it.

**Every one of those five exercises belongs to one `Pull` session:**

```
Pull  Sumo Deadlift           e1rm=0  deloaded=false
Pull  Bent-Over Barbell Row   e1rm=0  deloaded=false
Pull  Barbell Shrug           e1rm=0  deloaded=false
Pull  Pull-Up                 e1rm=0  deloaded=false
Pull  Dumbbell Preacher Curl  e1rm=0  deloaded=false
```

**And `session_periodization` shows Pull entered the `deload` phase on exactly 2026-08-09.**

So `estimateOneRm` was called with `deloaded: true` from the phase and correctly returned 0 — the
same deliberate branch (`1rm.ts:158`) that explains the 2026-08-06 `Upper` session. The zeros were
never the bug.

**The defect is the provenance mismatch: the phase-level deload zeroed the estimate and did not
stamp `exercise_deloaded` on the row.** That is precisely why Q-228's fix does not catch them —
`getLastRealOneRmBatch` filters on `exercise_deloaded`, which is `false` here, so these zeros **do**
leak into prescription. My original entry claimed that outcome and gave the wrong reason; the
outcome stands and now has a cause.

Q-298 is amended with this. The remaining work is small and well-defined: stamp the column from the
phase, and use `null` rather than `0`.

---

## 2. Deload policy

**Fired once in 3.5 months.** `exercise_deloaded` is true on exactly one day (2026-08-06, 5
exercises), and one session type sits in the `deload` phase (Pull, since 08-09).

All six emergency triggers are **reactive** (`emergency-deload.ts`), OR'd together:

```
selfReportedSick
consecutiveSessionDaysOfThisType >= 4
hoursSinceLastSession < 36 && soreMusclesInSession.length >= 3
acwr > 1.5
rpeTrend.delta > 2.0
repCompletionRate < 0.7
```

Three observations, in descending order of concern:

1. **The RPE trigger sits inside Q-289's measured error band.** Q-289 found a systematic
   **+1.93** RPE delta at expected-5 sets. The trigger is `> 2.0`. A session of light prescriptions
   is **0.07 away from firing an emergency deload on model miscalibration alone.**
2. **ACWR now drives three separate behaviours at three thresholds** — `> 1.5` here,
   `EARLY_DELOAD_ACWR_MIN = 1.2`, and `ACWR_TAPER_START = 1.5` in the Activity Score. Q-279 already
   questions the evidence base; three uncoordinated thresholds on one contested metric is worth
   consolidating.
3. **`repCompletionRate < 0.7` is correctly null-guarded here** (`!== null`), unlike the
   autoregulation path in Q-299. Given the field is null on ~83% of sets, this trigger mostly cannot
   fire — but it fails *safe*, which is the right direction.

**Planned deloads do exist** — the program's phase sequence carries a `deload` phase at position 4,
after Accumulation(4) → Intensification(3) → Peak(2) → Testing(1), so roughly 10 cycles between
deloads. That is on the long side of common practice but is a program-design choice, not a defect.

Filed as **Q-306**, focused on the trigger threshold that overlaps a known measurement error.

---

## 3. Phase engine — CLEAN

The active program (`Shikai`) is progressing coherently:

```
Lower  intensification  in_phase=3  since 2026-08-01
Push   intensification  in_phase=2  since 2026-08-04
Legs   intensification  in_phase=2  since 2026-08-06
Upper  intensification  in_phase=2  since 2026-08-06
Pull   deload           in_phase=1  since 2026-08-09
```

**A finding died here.** Five further rows sit in `accumulation` with `sessions_in_phase` of 0–1
*since 2026-06-28* — 48 days — which read as stuck counters, and `CLAUDE.md` has a whole
**Stored Counters** rule about `sessions_in_phase` drifting. Joining to `programs` resolves it:
those rows belong to **`AI-Phase1`, `is_active = false`**. Dormant state for a retired program,
which is correct. **Fifth finding to die on verification across these five reviews.** No entry.

---

## 4. Muscle balance

Sets per muscle group over 60 days, unnested and normalised:

```
legs 481 (33%) · push 433 (30%) · pull 333 (23%) · other 168 (11%)
push:pull ratio = 1.30
```

A 1.3 push:pull ratio is mildly push-dominant — common in self-directed training and generally
flagged as worth correcting toward 1.0, but not alarming and well short of anything pathological.
**Nothing in the app computes or surfaces it.** Folded into **Q-305** (volume landmarks computed and
never shown) rather than filed separately: same surface, same fix.

---

## 5. Cardio — the pace column is null on 32 of 39 logs that could compute it

Field completeness across 46 activity logs:

| field | populated |
|---|---|
| `duration_min` | 46 / 46 |
| `distance_km` | 39 / 46 |
| `avg_hr` | 21 / 46 |
| `calories_burned` | **18 / 46** |
| `avg_pace_sec_per_km` | **7 / 46** |
| `cadence_spm` | 4 / 46 |
| `steps` | **1 / 46** |

**Pace is trivially derivable** — `duration_min × 60 ÷ distance_km` — and **39 logs have both
inputs while 7 have the pace.** It is read from the column (`efficiency-chart.tsx` plots
`p.avgPaceSecPerKm`; `done-activity-screen.tsx` guards on `!= null`), and
`exercise-review-sheet.tsx:143` explicitly writes `avgPaceSecPerKm: null` at save — the same
hardcoded-null shape as **Q-230** (steps and calories on guided walks).

So the efficiency chart has gaps for 32 of 39 distance-bearing activities, and pace — the number a
walker or runner actually looks at — is absent on 85% of logs. Filed as **Q-307**, cross-referenced
to Q-230 as very likely the same fix.

---

## 6. The load test — what actually breaks

### 6.1 What was built

Two scripts, both **refusing to run against anything but localhost**:

- `scripts/load-test/seed-users.js` — seeds N users at the owner's real production profile
  (50 workout sessions, ~350 exercise logs, ~1,000 set logs, 45 sleep rows, 2,000 HR samples each).
  10 users → **10,527 set logs, 20,000 HR rows**, in 11 s.
- `scripts/load-test/sync-fanout.js` — replays `getSyncDelta`'s 21-query `Promise.all` at a given
  concurrency against a given pool size, reporting p50/p95, worst pool wait, and failures.

**What it measures, precisely:** connection demand per sync × concurrent syncs against a fixed
pool, as raw SQL. **Not** drizzle overhead, Next request handling, or network latency. Numbers here
are a floor on contention, not a prediction of end-to-end response time.

### 6.2 The answer

`poolMax = 10` (production's value), 21 queries per sync:

| concurrent syncs | connection demand | p50 | **p95** | worst pool wait | failures |
|---|---|---|---|---|---|
| 1 | 21 (2.1×) | 31 | 31 ms | 22 ms | 0 |
| 10 | 210 (21×) | 150 | **210 ms** | 206 ms | 0 |
| 25 | 525 (52×) | 240 | 429 ms | 437 ms | 0 |
| 50 | 1,050 (105×) | 461 | 778 ms | 794 ms | 0 |
| 100 | 2,100 (210×) | 845 | **1,562 ms** | 1,596 ms | 0 |
| 200 | 4,200 (420×) | 1,674 | **2,868 ms** | 2,973 ms | 0 |

**Nothing breaks at 10 users. Nothing breaks at 100.** Degradation is linear (~15 ms of p95 per
additional concurrent sync) and **zero queries failed at any level.** Extrapolating to production's
`connectionTimeoutMillis: 5_000`, the first failures appear near **300 concurrent syncs**, and they
arrive as connection timeouts rather than errors.

**And 10 users ≠ 10 concurrent syncs.** Ten users syncing a few times an hour produce a real
concurrency near zero. The number to worry about is *simultaneous* syncs, which only approaches user
count if devices sync on a shared schedule — worth checking before it matters.

### 6.3 Two results that change the diagnosis

**A bigger pool does not help. It is slightly worse.** Same 50 concurrent syncs:

| poolMax | wall clock | p95 |
|---|---|---|
| 10 | 823 ms | 778 ms |
| 20 | 824 ms | 803 ms |
| 40 | 1,068 ms | 952 ms |

The limiter is the database's capacity to execute, not connection availability. **Q-107 and Q-213
both attribute production sync failures to "DB-pool contention"** — on this evidence the pool is not
the binding constraint at these concurrencies, and raising `max` would consume Railway connection
budget for nothing.

**The entire fan-out is 22.6 ms of actual query work**, measured serially, warm, one user:

```
set_logs 5.4 · exercise_logs 3.6 · oura_heartrate 2.6 · body_metrics 1.8 · sleep_sessions 1.0
… 16 more, each ≤ 1.0 ms …                                          TOTAL serial: 22.6 ms
```

So the parallel fan-out demands **21 connections to save ~8 ms** at concurrency 1. Running the same
reads serially on **one** connection:

| concurrent | parallel p95 | **serial p95** | parallel conns | **serial conns** |
|---|---|---|---|---|
| 10 | 174 ms | **180 ms** | 210 | **10** |
| 50 | 748 ms | **764 ms** | 1,050 | **50** |
| 100 | 1,450 ms | **1,519 ms** | 2,100 | **100** |

**Identical p95 at every level, for a 21× reduction in connection demand** — and lower variance
(serial min 152 ms vs parallel min 26 ms, so it is far more predictable).

**⚠️ The caveat that stops this being a recommendation.** This runs against a local Postgres over a
Unix socket, where per-query round-trip is ~0. On Railway the app and database are separated by a
real network, so serialising 21 queries adds **21 × RTT**. At a 2 ms RTT that is +42 ms per sync; at
10 ms it is +210 ms and serial loses badly at low concurrency. **Measure Railway's per-query RTT
before acting on this.** Filed as **Q-308** with that measurement as the first step, not the fix.

---

## 7. Surfaces NOT exercised

- **The load test is local Postgres, raw SQL, one instance.** No Railway network, no Next request
  path, no drizzle overhead, no replica count, no PgBouncer. It answers a contention question, not a
  capacity-planning question.
- **No device, emulator, browser or `pnpm dev`** in any of the five reviews.
- **Synthetic users are uniform** — same row counts, same shapes. Real users vary, and a single
  heavy user is not modelled.
- Cardio was assessed on **field completeness**, not on whether pace/HR values are physiologically
  correct where present.
- Muscle balance is 60 days of one user.
- `error_events` prunes at 30 days.

## 8. Still open

- **Systematic AI-output audit** — 8 of 117 insights read.
- **Degradation matrix against a running app** — desk-only (Q-294).
- **Railway per-query RTT** — the measurement Q-308 needs, which cannot be taken from here.
