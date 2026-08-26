# Q-519's own audit: writing `sleep_start` at manual rank is not safe

**2026-08-26 · Lane A · the audit the entry commissioned, run before implementing**

Q-519 proposes recording a forgotten bedtime by writing **only `sleep_start`** into `sleep_sessions`
at `manual` rank (5), letting the per-field merge in `lib/data/health-source.ts` leave every measured
column at `oura_ble` (3). It closes with an instruction:

> **audit whether any consumer recomputes duration/efficiency from the span**; that audit is part of
> this item, not a finding of the review.

and with a warning:

> **If anyone later recomputes duration or efficiency from the span, this silently produces a 9-hour
> night at 34% efficiency.**

**Something already does.** The audit's answer is that the design's central premise does not hold.

---

## 1. `aggregateNight` recomputes time-in-bed and efficiency from the span

`packages/shared/src/health/sleep-night.ts:225`:

```ts
const timeInBed = (last.sleepEnd.getTime() - first.sleepStart.getTime()) / 3_600_000
…
efficiency: timeInBed > 0 ? Math.min(100, Math.round((totalSleep / timeInBed) * 100)) : null,
```

On the owner's own reported night — measured 04:23→08:03, 3 h 5 m — a manual bedtime of 23:00 gives
`timeInBed = 9.05 h` and `efficiency = round(3.08 / 9.05 × 100)` = **34%**. That is the entry's
hypothetical, to the number.

**It is guarded, but not by anything the design controls.** `aggregateNight` returns the row
untouched when the night has exactly one window; the recomputation runs only on a **fragmented**
night. Q-274 measures **ten** fragment rows in production across 40 dates, and a night where the ring
sat off the finger until 4 am is a plausible place for one.

Reached through `nightSessions`, which is imported by seven consumers:
`lib/health/readiness-payload.ts`, `lib/ai-chat/tools.ts`, `app/api/ai/health-insight`,
`app/api/admin/sleep-feel-calibration`, `app/api/user/bedtime-estimate`,
`app/api/nutrition-goals/recommend`, `app/api/day-log`.

## 2. The daytime-HRV model trains on "is this sample inside the sleep window"

`daytime-hrv-model.ts:50` decides whether a sample is asleep by `ts >= sleepStart && ts < sleepEnd`,
and `extractNightlyTrainingSamples` is fed from **stored** rows — `lib/data/postgres/adapter.ts:5304`
calls `this.listSleepSessions(userId, fromIso, toIso)` immediately before it.

So a manual 23:00 start moves five hours of genuinely **awake** HRV into the model's *nightly*
training set. That fit is what `daytime-stress.ts` reads, which is what resilience reads — and
Q-507/Q-508/Q-510 are already open on resilience misbehaving.

**This one needs no fragmentation.** It fires on any night with a manual bedtime.

## 3. `primaryCluster` unions rows within an hour of the window

`lib/sleep/merge-sessions.ts:41-56` grows a window from the longest row and pulls in any same-date row
within `CONTIGUOUS_GAP_MS` (1 h) of it. Widening `start` by five hours moves that boundary back with
it, so an evening fragment previously excluded as "distant" can be unioned in — the "7:40 pm bedtime"
bug the function exists to prevent.

Note the longest-row *pick* is safe: it reads `durationHours ?? span`, and `duration_hours` stays at
`oura_ble`. It is the contiguity test that uses raw timestamps.

## 4. Two smaller consequences, stated for completeness

- **`sleep-score.ts:390`** feeds `sleepStart` into `habitualBedHour` (the schedule contributor), so a
  manual bedtime *does* reach the sleep score. Arguably correct — it is the real bedtime — but the
  entry's "what it does not fix" section reads as though nothing but duration reaches the score.
- **`app/api/oura/hr-day`** shades the chart with `bedtimeToMinuteWindow(primary.sleepStart, …)` using
  the raw start, so the chart would show five hours the ring never observed as asleep.
  (`lib/sleep/actual-window.ts` is *not* affected — it prefers `phaseWindowStart ?? sleepStart`, and a
  ring night has a phase window.)

## 5. One consumer that looks affected and is not — recorded so it is not re-derived

`lib/health/stress-resilience.ts:104` classifies HR samples as in-sleep by exactly the same window
test, which reads like a third unconditional hit. It is not: its `sleepStartMs` comes from
`lib/oura-ble/rollup/run.ts:1083`, and that `sleepRows` array is the one the **rollup just built from
BLE frames** (declared at :232, pushed at :476), never read back from the database. A stored manual
value cannot reach it.

This is the third wrong-source near-miss of the session, after `recovery_index_hours` on the wrong
table and `n_live_tup` against a real count. The rule that keeps catching it: **trace the value to
its writer before believing a consumer is affected.**

---

## What to build instead

**Do not write `sleep_start`.** Add a nullable `manual_sleep_start` to `sleep_sessions`, read by the
bedtime estimate (and any display that wants it) and by nothing else.

- **It delivers the owner's stated outcome exactly** — *"I don't want it to change estimated bed time
  values"* — while the measured window stays measured. Every consequence above disappears, because
  none of those consumers reads the new column.
- **It costs a migration**, which the entry ruled out ("no new schema"). That ruling was made on the
  belief that the merge made a schema change unnecessary; §1–§3 are why it does not.
- **It keeps the per-field merge doing what it is for.** The merge exists to let a better *measurement*
  of the same quantity win. A remembered bedtime is not a better measurement of the observed sleep
  window — it is a different quantity, and giving it the same column is what causes all of this.
- **Reversal cost: low.** One nullable column and one reader; drop it and nothing else changes.

Implementation shape (Lane A owns all of it): migration for the column, `schema.ts`, the repo write
and read mapping, a `claude_ro` view regen, the local SQLite column + `RECONCILE_COLUMNS` + a version
bump, the sync delta/pull/push mapping, an ingest route, and `bedtime-estimate` reading
`manualSleepStart ?? sleepStart`. The UI half is Lane B's.

**Q-520 is unaffected** and its "do Q-519 first" ordering still holds.
