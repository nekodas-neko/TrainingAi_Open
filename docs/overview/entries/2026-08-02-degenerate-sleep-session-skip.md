# 2026-08-02 — a bed period with no sleep in it could become "last night" (Q-10)

_Branch `fix/degenerate-sleep-session-skip` · PR #1006 · v1.250.8 · domain `sleep`_

Run-list item 11 of the [batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md).

## What was wrong

Production carries a `sleep_sessions` row with `duration_hours = 0.00`, `efficiency = 0` and all
stages zero — a bed period the recorder never resolved into sleep. `groupSleepPeriods` classified it
like any other window, so it could land as the most recent night. `computeSleepScore` then returns
null for it, and the readiness composite renormalises `previousNight` out of the score — a real
night's sleep, sitting right next to the dead row, stopped counting.

## What shipped

One filter in `packages/shared/src/health/sleep-night.ts`: `groupSleepPeriods` skips any window whose
`durationHours` is null or ≤ 0 before classifying it as night or nap. Every consumer of night
selection goes through this module (`readiness-score`, `body-battery`, `weekly-digest`,
`sleep-trend`, the score-audit, the admin calibration route, and the BLE rollup's direct
`groupSleepPeriods` call), so the fix is central by construction — verified by grep, not assumed.

## The bar is zero, not twenty minutes

The backlog entry asked for *"skip/floor sub-20-minute sessions in the night-selection path"*. That
would have been wrong twice over, and the run-1 handoff had already flagged it as worth thinking
about rather than doing mechanically.

`computeSleepScore` (`packages/shared/src/health/sleep-score.ts:283`) returns null for exactly one
condition — `duration == null || duration <= 0`. A 15-minute session scores perfectly happily, and
badly, which is the correct outcome. So of the nine sub-20-minute sessions the entry counted, only
the single zero-duration one can produce the null the fix is about. And a floor would have thrown
away genuine short windows: `groupSleepPeriods` merges those into fragmented nights on purpose, so a
20-minute floor would silently shorten real fragmented nights. Two of the five new tests exist to
hold that line — a 15-minute window still merges into its night and still counts toward its total.

## Verification

Five new tests in `packages/shared/src/health/__tests__/sleep-night.test.ts`. **Checked against the
un-fixed code:** removing the filter fails three of them (the zero-duration case, the null-duration
case, and the all-degenerate case) with `expected length 1 but got 2`. The other two pass either way
by design — they are the regression guard against a future floor, not evidence for this change.

**Reproduced end to end on the dev server**, which is the part worth keeping. Inserting one
`duration_hours = 0` row after the seed user's real 7.5 h night and calling `/api/readiness-score`:

| | `sleepScore` | `components.sleep` | `score` | `inputsMissing` |
|---|---|---|---|---|
| un-fixed | `null` | 0 | 49 | `sleep`, temperature, checkin |
| fixed | 82 | 33 | 54 | temperature, checkin |

That is the whole bug in one row — a real night's sleep renormalised out of readiness by a bed
period with no sleep in it. `/api/body-battery` follows readiness and returns to 54 with it.

Full local suite green (375 files / 2890 tests; `personal-records-reconcile-migration` deadlocked
once under parallel DB contention and passes alone — the documented flake). No native, safe-area or
device surface is touched; this is pure TypeScript in the shared package.
