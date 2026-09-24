# 2026-09-24 — RV-172: the sync pull dropped columns `applyDelta` then wrote NULL over

**Lane A** · branch `lane-a/rv172-sync-delta-columns`

## The invariant, stated once

`applyDelta` writes `col = excluded.col` **unconditionally**. So a column it writes that the delta
select omits is not left alone — it is overwritten with NULL, on every pull, for ever. That is the
whole of this entry, and it is why three unrelated-looking symptoms turned out to be one bug.

## What shipped

**`supplement_logs` — the one that mattered.** The delta select and the pull mapper both omitted
`takenAt` and the vial triple (`vialStrengthMg`, `vialWaterMl`, `vialUnitsPerMl`), while the upsert
wrote all four from `excluded`. Every synced tick lost its time and its frozen dose on the next
pull, and a fresh install never had them. The vial triple is the **frozen** snapshot —
`frozenReconstitution` returns null unless all three are present — so history re-rendered against
whatever vial is current now. That is precisely the retroactive rewrite the freeze exists to
prevent, and LA-97's fix came back one layer up: a re-push rebuilds from the local row, finds the
triple null, and `logSupplement` re-stamps it from the current vial.

**`exercise_logs.exercise_deloaded`.** Q-131 added the pull mapper and left the SELECT alone, so
`Boolean(undefined)` wrote `0` over every synced row. Half fixed, for months. A mapper reading a
field nothing supplies is not a no-op.

**`food_items.updated_at`.** The mapper read `toIso(r.updatedAt)`; `toIso` is `String(v)` for a
non-Date, so the local row stored the literal string `"undefined"`, which sorts **above** every ISO
date under `updated_at DESC` and pinned those rows to the top of offline recent-foods.

## Two of the entry's claims did not survive checking

- **`food_items` has no `updated_at` server-side at all.** The entry read this as a dropped column;
  it is a mapper reading a field that has never existed. So the fix is to repoint at `createdAt`,
  not to add the column to the select. The test asserts the absence rather than assuming it — if
  `food_items` ever gains `updated_at`, it fails and says to repoint the mapper.
- **`prepTimeSec` is server-only.** The entry paired it with `exerciseDeloaded`. Nothing under
  `lib/local-store/` names it, so there is no local value to overwrite; sending it would be payload
  with no reader and would have looked like a fix while changing nothing. Deliberately left out,
  and a test pins it out.

## The general guard was written, then withdrawn

The entry asked for a check that diffs every delta select against its pull mapper. It was built
first and produced false positives — `1rm` splitting into `rm`, `_bpm`/`max_est` surviving as
phantom columns, and `INSERT INTO` tracking bleeding between statements so `supplements` inherited
`supplement_logs`' `taken_at`. A guard that cries wolf is worse than no guard, and this repo has
paid for that twice (the fetch-once scanner's over-count, the backlog parser mis-reading its own
entry). What shipped instead pins **the three regressions that actually happened**. The general
version is filed as **LA-137** with all four parsing traps written down.

## Two traps worth carrying

**The statement does not end at the next backtick.** The supplement upsert interpolates
`${isMeal ? ` … ` : ` … `}`, whose branches are themselves template literals — so the first
backtick after the `INSERT` is a *nested* one, and slicing there truncated the statement before
`taken_at`, the exact column the test exists to protect. It terminates on the backtick that opens
the params array instead, and scopes to `applyDeltaBody` rather than picking the first of the two
`excluded` upserts by position.

**A comment explaining a defect contains the defect.** The RV-172 note saying the mapper *used to*
read `toIso(r.updatedAt)` matched the test's search for exactly that, and failed a file the code
passed. Third time in one day (TN-66's prompt guard, RV-143's entry parser, this). The fix is to
strip `//` lines before matching — rewording around the guard does not generalise, because the next
comment will not know to.

## Verification

`tsc` clean · Custom Rules **78 of 78** · `lib/local-store` **200/200** · supplement/sync/food
adapter suites **109/109**. Mutation pass: 6 mutants, 5 killed (dropping `takenAt` or `vialWaterMl`
from the select, dropping it from the mapper, reverting the `food_items` field, dropping
`exerciseDeloaded`), 1 **deliberately equivalent control** survived correctly — swapping the order
of two vial column lines, which is not semantics.

**Not exercised:** none of this ran on the device. The failure is a pull-path overwrite in native
SQLite, which does not run in the sandbox (`getLocalStore` returns null), so the fix is verified at
source and by the server-side suites only. The symptom to look for on-device is a supplement tick
keeping its logged time and units figure across a sync, and offline recent-foods no longer leading
with a block of arbitrary rows.
