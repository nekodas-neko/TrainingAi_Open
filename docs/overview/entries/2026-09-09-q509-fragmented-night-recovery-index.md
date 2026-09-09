# 2026-09-09 — a fragmented night is one night (Q-509's last buildable half)

**Branch:** `lane-a/q509-fragmented-night-recovery-index` · no migration · **latent fix, no stored
number moves.**

## The fix

The Recovery Index is *hours between the overnight HR minimum and waking*. On a night split into
several sleep windows, `run.ts` took `last.recoveryIndexHours` — the final window's own value, which
measures from the lowest point of the **last fragment** rather than of the night. On a 10pm–2am /
3am–7am night bottoming out at 1am, that reports the 3–7am segment's minimum: a number describing a
different sleep episode.

`nightRecoveryIndexHours` (`packages/shared/src/health/recovery-index.ts`, beside the estimator it
completes) takes the minimum across every window and the wake time from the last. The wake time is
unchanged; only the point it is measured **from** is corrected. Extracted rather than left inline
because the merge sits inside a 700-line function where the rule could not be tested at all.

## The entry's own measurement beside it was unsound, and that is the bigger finding

The entry said this was *"not the gap: fragmented nights average 2.719 h against 2.639 h for
single-window nights."* **That cannot be a measurement of this path**, because there are no
fragmented nights to average.

`groupSleepPeriods` applies three rules before a night has more than one window: drop
`duration_hours <= 0` (`recordsSleep`), keep only **night** windows (≥ `ALWAYS_NIGHT_MIN_HOURS`, or a
midpoint inside the 21:00–10:00 band), and merge two windows only across a gap ≤
`MAX_INTRA_NIGHT_GAP_HOURS`. Applying all three to production:

| measure | nights |
|---|---|
| BLE-era nights (from 2026-07-07) | **61** |
| fragmented under `groupSleepPeriods` | **0** |
| naive proxy — more than one `sleep_sessions` row on a date | 13 |

Every one of those 13 second rows is a **daytime nap** (midpoints 10.3–19.8 local), a zero-duration
row, or 4.96 h from the night. So the merge branch has never executed for this user; the quoted
averages are of something else.

**How the error surfaced, which is the reusable part.** I reached for the same naive proxy first,
and it predicted something checkable: if the stored value were the final fragment's own hours, it
would be bounded by that fragment's length. Production said otherwise — 11 of 12 "fragmented" nights
exceeded it, **and 2 of 52 single-window nights did too**, which is impossible if the code does what
I thought. The single-window counterexamples are what forced the re-read rather than a patch to the
proxy. Rows-per-date is not the rollup's fragmentation, and any future measurement of a
fragmented-night behaviour has to apply those three rules or it is measuring naps.

## What this does and does not close

It closes the one buildable item Q-509 had left. It does **not** touch the entry's headline (the
BLE-era refit landing at 3.31 h against a shipped anchor of 5), and both prohibitions stand
unchanged: **do not widen `MEDIAN_WINDOW`, do not move `RECOVERY_INDEX_OPTIMAL_HOURS`.** The entry
already said this fix was not the gap; what changed is the reason — not "too small to matter" but
"has never run".

Also re-measured while there: the BLE series is now **n = 64, mean 2.695 h** (the entry's last
figure was 2.653 at n = 57). Eight more nights, mean unmoved — an independent re-confirmation of the
2026-09-03 finding that the series is flat.

## Verification

10 cases in `packages/shared/src/health/__tests__/recovery-index.test.ts`. **5 of 5 real mutants
caught**, one control that survived as expected — and it survived because the guard genuinely was
redundant (an empty array filters to empty and the next guard already returns null), so it was
deleted rather than kept.

**Not exercised: production data, because there is none to exercise.** No stored
`recovery_index_hours` changes, on any of the 61 nights. The first night that genuinely fragments —
two night-band windows less than three hours apart — is the first time this code runs at all.
