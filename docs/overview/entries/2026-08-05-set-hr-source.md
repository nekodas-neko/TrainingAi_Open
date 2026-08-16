# 2026-08-05 — Per-set HR provenance: a column declared, never written, never read

**Domain:** heart-rate · workouts — v1.260.0, JS/server-only (no APK rebuild)

## How it was found

The gap sweep named its own biggest blind spot: *"a column that is always null in a populated
table — the `latency` / `onset_latency` class. A null-rate sweep per column is the natural follow-up
and was not run here."* This is that sweep.

**847 columns across 69 tables**, one `count(col)` per column, batched nine tables per request (the
admin endpoint rate-limits at 10/minute — the first attempt fired 69 and got cut off after 20).
Result: **49 columns that are 100% null in a table that has rows.**

Most are benign and were classified out rather than reported: optional user inputs nobody fills
(`waist_cm`, `barcode`, `notes`, `reminder_time`), tombstones (`deleted_at`), Oura Cloud columns
frozen since the BLE re-key, and columns whose *input* is null rather than whose producer is missing
— `workout_sessions.phase_id` is null because the active program has no phase set, and
`intensity_mode` is null because nothing was a deload. Each was checked against its writer before
being dismissed.

Two survived:

- **`oura_daily_derived`** — ten always-null columns. That is **Q-7b**, already queued (*"the eight
  device-owned columns have no producer"*); the sweep confirms it and corrects the count to ten.
- **`set_hr_stats.source`** — declared in migration 139, **never written by `upsertSetHrStats`, never
  read by anything**, across 582 rows.

## The fix

`source` records which device measured a set: `chest_strap`, `oura_ble`, `mixed`, or null. The data
was always available — `getHrForWindow` selects `source` and `summariseWorkoutHr` already derives a
workout-level one from it. It just never reached the per-set rows.

The per-set derivation mirrors the workout-level one — one distinct source wins, several become
`mixed`, none stays null — with two decisions worth stating:

- **It reads the working-set window only, not the rest that follows.** The rest period is exactly
  where the ring takes over if a strap comes off mid-workout, and attributing the ring to the *set*
  would be wrong.
- **Null, not `'unknown'`.** A made-up label is indistinguishable from a real one once it is in the
  table.

Persisted through the same `COALESCE` fuller-wins arm as its siblings, so a later partial recompute
that lost the source keeps the stored one.

## Why it is worth having

Strap and ring differ in accuracy under load, and *"were those sets ring-only?"* is the first
question asked of any suspect per-set HR — it is the exact question the still-open half of Q-11
needs answered about the sessions with zero attribution. Until now the table could not answer it for
any set ever recorded.

## Verification

Five unit tests on the derivation (single source, mixed, null, window-bounded, and the no-window
fallback) plus two DB round-trip tests. The round-trip pair matters on its own: `workout_hr_stats`
failed at exactly that seam — the value was computed correctly and rejected by the column — while
its unit tests passed. A derivation test alone would not have caught that.

Existing rows stay null until a recompute; **Admin → Tools → "Backfill per-set HR stats"** fills them.

Full suite: 397 files, 3,143 tests, 3 failures — all three the documented Oura-aggregate
pool-oversubscription flakes, all passing when re-run. Typecheck and lint clean.

## Found while verifying, and worth its own fix

Those three aggregate tests were timed **alone, with no contention**: 6.04 s, 5.25 s and 5.86 s of
test time against a **5000 ms per-test timeout**. They are not flaky because of contention alone —
they are inherently within ~20% of the limit, and any parallel load tips them over.

The daytime-HRV refit added by v1.259.1 was the obvious suspect, since it now does real work inside
`aggregateOuraRawSamples`. **Measured and cleared:** with the refit stubbed out the same files take
5.50 s and 6.11 s — indistinguishable. The slowness predates it.

CLAUDE.md already tells sessions to re-run these alone before believing a failure, and notes this
produced four false alarms in a single session. The honest fix is a longer timeout for genuinely
heavy rollup tests rather than a standing instruction to disbelieve CI. Filed as **Q-85**.
