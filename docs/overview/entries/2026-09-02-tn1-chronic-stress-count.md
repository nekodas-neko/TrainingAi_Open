# 2026-09-02 — TN-1: the chronic-stress refusal now leaves a number behind

**Branch:** `claude/la-tn1-chronic-stress-count` · **Agent:** Implementation Lane A

`chronic_stress_score` has been NULL on every `oura_daily_derived` row since the model shipped — the
third dormant score, after the illness radar and resilience. Both gates countable from stored data
have been measured and both pass: a `fullHistory` pass built 43 summary rows against a threshold of
21, and 27 of 31 nights in the trailing window are complete at the summary level. That pass wrote 23
derived rows, scored illness on all 23, and chronic stress on **none**.

So the refusal is below the summary layer, in the granular one — and it was invisible by
construction. `computeNightIntermediates` runs on signals recomputed in memory by design ("no stored
intermediate that could drift"), and a night with no stash, or with an empty hypnogram, rMSSD series
or skin-temp run, contributes all-NaN and simply vanishes into a null score with no reason recorded.

`usableGranularNights` counts the nights in the model's own 31-night window that carry all three
series non-empty, and `oura_daily_derived.chronic_stress_granular_nights` persists it. Migrations
**258** (column) and **259** (regenerated `claude_ro` views — without which the number is invisible
to the audit endpoint that is the whole reason for it), local SQLite **v36**.

**The gate is untouched, deliberately.** `CHRONIC_STRESS_MIN_DAYS` does not move and nothing consults
the count. Relaxing a threshold before knowing its input distribution is the Q-504 mistake, and
Q-506 is the same class — there a two-point nudge would have hidden a biomarker whose baseline was
18.7× wrong. The count exists to make that question answerable, not to answer it.

**What the entry did not say, and it decided the shape of the change.** The step skipped the write
entirely on `score == null` — which is *always* — so the count had to be written on a path that
previously wrote nothing at all. The upsert COALESCEs, so writing the count alone can never clobber
a prior good score, and the existing `summaryRows.length < CHRONIC_STRESS_MIN_DAYS` early return
still keeps a routine incremental pass (window ~3 nights) from recording a meaningless one. NULL
therefore means *not evaluated*, never *zero usable nights*.

**One stale reference corrected:** the entry points at `adapter.ts:5706`; the chronic-stress step
moved to `lib/oura-ble/rollup/run.ts` when the rollup was extracted.

**⚠ This needs the owner to produce its number, and that is the whole remaining item.** Only a
hand-triggered `fullHistory` pass reaches the model, so until one runs the column stays NULL on
every row — the expected state, not a defect. When a number does appear: **≥ 21 with the score still
null puts the fault inside the vendored model**, and TN-1 has done its job by proving it; **< 21
names the granular stash as the constraint**, and what to do about it is Tuning's question and then
the owner's.

**Not exercised:** the device path. Local SQLite v36 is a plain ADD COLUMN, but it now lands behind
v35 and v34's table rebuild, so a device upgrading from v33 runs three migrations in one pass —
still unopened. No `fullHistory` pass was run, so the new column has never held a value anywhere.
