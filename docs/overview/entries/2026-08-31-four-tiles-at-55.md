# 2026-08-31 — "everything is 55": three answers, one defect (TN-18)

**Tuning · docs-only.** Owner screenshot at 06:43 Brisbane — Readiness 55, Heart Rate 55, Sleep 56,
Activity 56, Body Battery 55. *"its jts all in the 55 region."*
Full working: [`docs/reviews/2026-08-31-four-tiles-at-55.md`](../../reviews/2026-08-31-four-tiles-at-55.md).

## The clustering is unusual, not a collapse

The three scores normally sit **20 points apart** (mean 20.0, median 19.0, max 65). Only **2 of 35
days** have all three within 3 points, and today is one of them — 2026-08-30 read 73/69/64 and
2026-08-26 read 52/15/80. **Heart Rate's 55 is bpm**, not a score: a coincidence of units, and an
argument for TN-13's baseline-delta format on its own.

## Today's number is correct, and the reason is physiological

Reproduced exactly from the stored contributors and `READINESS_WEIGHTS`: **55.3 → 55**. Against
yesterday's 73, **overnight HRV (53 ms vs 71–72) and resting HR (63.7 vs 59.0) account for 15.8 of
the 18-point drop**. Sleep duration was fine at 7.75 h. Two caveats, both queued: `recoveryIndex`
scored **100** flagged provisional after 22 and 44 the previous days, **lifting** readiness by 5
(Q-509); and `checkin` sits at the placeholder 50 until logged, so the number will move after first
open (TN-9).

## What is permanent: two of the five are not independent

`previousNight.input = 56` **is** the Sleep tile and `activityBalance.input = 56` **is** the Activity
tile — **22% of readiness is the two tiles beside it** (`corr(readiness, sleep)` = +0.656 against
`corr(sleep, activity)` = +0.139). Body Battery's morning anchor *is* the readiness score
(+0.838, n = 47). So the screen reads as more corroboration than it is. Recorded, not filed — the fix
is presentational and belongs with TN-15.

## The defect — TN-18

**TN-6a shipped and works**: `tempLadderTrusted` nulls the deviation, so today carries no temperature
penalty despite a stored 0.519 °C. **The deload banner was never gated** —
`ai-dynamic.ts:184` is still a bare `> TEMP_ALERT_THRESHOLD_C`, and `isTemperatureBaselineCentred`
appears in exactly one file, though TN-6a's entry required all three consumers.

**One frame holds both halves of the broken baseline**: the readiness contributor sees `tempZ` =
0.303 and scores temperature **80/100**, while the banner sees 0.519 °C and recommends a deload. The
z is small **because `temp_baseline_dev_x8` reads 1.714 °C** against a true nightly sd of ~0.14 —
`0.519 / 1.714 = 0.303`, matching the stored input to three decimals. **Q-506's inflated sd and
TN-6's low mean, failing in opposite directions, visible at once.** The banner is the surface behind
the owner's original *"its often triggering deload days"*, so the protection landed on the path they
never read.

## Verification

`pnpm check:rules` — **Ran 62 of 62 Custom Rules steps, all passed.** `check-backlog-pointers` OK.
**Failure surfaces not exercised: all of them.** No code ran — SQL against production plus source
reading; no `pnpm dev`, no device, no APK. **The ladder and banner were not executed** — the claim is
that the gate exists in one file and not the other, plus the owner's screenshot as the observation.
