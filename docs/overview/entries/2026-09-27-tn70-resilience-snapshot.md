# TN-70 — capture the 30 published resilience rows before the prescribed pass deletes them

**Branch:** `lane-a/tn70-resilience-coverage` · **Lane A** · docs-only.

## What this session was for

TN-70 sat at the head of Lane A's READY list, so I picked it up to implement. Its one remaining
step was *"a wide pass [that] would fill history — that pass is the work, and it has not been
run"*. Re-verifying that against `main` before building it — which is the standing protocol, and
which has changed the shape of the work on five entries running now — turned up a reason not to
run it as written.

## The finding

**The pass would destroy the evidence TN-70 exists to explain.**

`upsertDailyDerived` resolves every column as `COALESCE(excluded.<col>, oura_daily_derived.<col>)`
(`lib/data/postgres/slices/oura.ts`), so a recomputed value wins wherever it is non-null. The wide
pass fills `night_hrv_baseline_ms` — which is the point of it — **and in the same statement
overwrites `resilience_level`, `resilience_granular` and the three daily indices on every day the
recompute publishes one.** TN-70's decisive question is *"do those 16 July days still come back as
5?"*. Running the pass answers it by deleting the before-value, so it can be asked exactly once,
and only if the before-values were recorded first.

Nothing in the entry said this, and the entry has now been picked up and re-derived three times.

## What shipped

- **[`docs/reviews/2026-09-27-tn70-resilience-snapshot.md`](../../reviews/2026-09-27-tn70-resilience-snapshot.md)**
  — the 30 rows, per day, read-only from production. Of **132** derived days spanning 2026-05-07 →
  09-27, exactly **30 carry a `resilience_level`**: the 16 July/August days and the 14 September
  ones the entry tabulates. That is the whole evidentiary base for this metric, and it is now
  recorded, so the pass is safe to run as far as the comparison goes.
- **TN-70 amended** with the overwrite hazard and a pointer to the snapshot, and moved to
  **`Gate: owner`** — the only blocker left is that the pass is a production write. It had been
  reading as startable, which is how it kept being picked up.
- **The readiness domain index** links the new doc.

## Two corrections to TN-70, from the capture

1. **`confidence` does not merely fail to separate the regimes — it spans the identical four values
   in both.** The entry reports means of 0.464 against 0.434. Both regimes draw from exactly
   `{0.357, 0.429, 0.500, 0.571}` = `{5,6,7,8}/14`. It is `validCount / 14` taking one of four
   values either side, carrying **no** distinguishing information. The means overstate it.
2. **The "switch is carried by `resilience_daily_sleep_recovery`" finding rests on 5 days against
   6, not 16 against 14.** Those three daily indices are NULL on the other 19 of the 30 rows. The
   mechanism is not overturned — it is still the only stored column that moves across the boundary
   — but the sample is a third of what the framing implies, which is why the recompute rather than
   further reading is what would settle it.

A third asymmetry is confirmed rather than corrected: `daytime_stress_coverage_min` is present on
0 of 16 July rows and 14 of 14 September ones, which is the column's age (#817, 2026-09-02).

## Deliberately not done

**The pass itself was not run.** It is a production write, which is the owner's call, and the ask
is now narrow enough to answer in one line — see TN-70's `Gate: owner`.

**No raw physiology was copied into the repo.** The snapshot holds the date and the resilience
columns only; no HRV intervals, heart rates or sleep timings.

## Verification

Docs-only, no code touched. `check-backlog-pointers` OK (539 entries), `check-doc-links` OK
(897 files), `check-index-doc-paths` OK (1235 paths), Custom Rules **80 of 80**.

**Not exercised:** nothing runtime — there is no code in this diff. Production was read, never
written.
