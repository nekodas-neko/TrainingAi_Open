# Getting fitter shrank the rest boundary by 3×

**Date:** 2026-08-18 · **Branch:** `tuning/heart-rate-calibration` · **Agent:** Tuning 🎶
**Type:** docs-only — calibration evidence · **Filed as:** Q-515

First calibration review of the heart-rate pillar. `HR_REST_THRESHOLD` is the single rest/active
boundary shared by Body Battery's charge/drain and the Activity Score's "moved this hour" signal, so a
wrong value propagates into two pillars.

## What happened

Over 12,471 BLE ring samples in waking hours, joined per day to that day's own stored profile:

| month | resting HR | hr_max | boundary | median % of waking samples below it |
|---|---|---|---|---|
| 2026-07 | 62.9 | 187.0 | **69.1 bpm** | **26.5%** |
| 2026-08 | 54.4 | 171.2 | **60.2 bpm** | **8.2%** |

A 3.2× collapse in a month, at identical sample density.

## Every input behaved correctly

Resting HR fell because the owner got fitter. `hr_max` fell from 187 to 168 because the profile matured
from the age formula to a corroborated observed ceiling — the chest strap's max is 166 over 40,230
samples, so that is `resolveHrProfile` working as designed. Waking HR fell too, 77.5 → 73.3.

**The trap is a rate difference.** Resting HR fell 8.5 bpm; waking HR fell only 4.2. Resting HR is the
more responsive fitness marker, so a boundary pinned to it moves about twice as fast as the
distribution it is supposed to classify. The owner improved and was rewarded with less recovery credit.

## No fraction fixes it

Sweeping the constant, July vs August medians: 0.05 → 26.5/8.2, 0.08 → 38.5/22.7, 0.10 → 47.8/29.8,
0.12 → 59.6/35.2, 0.15 → 72.8/50.6. The gap narrows from 3.2× to 1.4× but never closes. Raising the
fraction opens the window at both ends without stabilising it.

**That is the fourth time today** the answer has been "the threshold is right, the input or the anchor
is wrong" — the illness radar, ACWR, RPE autoregulation, and now this.

## Two questions, and I only answered one

*Is the boundary stable?* No, and that is a defect regardless of taste — a classifier whose behaviour
changes 3× in a month because its subject improved is not measuring what it claims to.

*Is 8.2% the right level?* **Unknown, and I am not claiming otherwise.** That is ~1.2 hours of a
15-hour day, which is not obviously wrong, and whether Body Battery should charge more during daylight
is a product question. **Fix the stability alone** — raising the fraction at the same time makes the
two effects inseparable and neither verifiable afterwards.

## The recommendation, and the tempting wrong answer

Anchor the boundary to a slow-moving resting baseline — 90-day trailing, or a fixed offset re-derived
quarterly — so a month of fitness improvement cannot move the classifier under its own data.

The tempting alternative is a percentile of the owner's own recent *waking* HR. It self-calibrates to
the right distribution and is stable by construction — which is exactly the objection. Body Battery
charge would go near-constant, so a genuinely restful day could not read as one. The codebase already
names this "the treadmill" and removed it from the activity-goal volume lane. **A self-referential
boundary is fine for a pure classifier and wrong for anything feeding a score, and this one feeds two.**

## Not exercised

No code changed. `hr_max = 168` was **not traced to its source** — that it comes from a corroborated
observed ceiling is inferred from the numbers, not read out of the resolver. The 07:00–21:59 waking
window is this review's definition, not the app's, so the absolute percentages would shift under a
different one (the July-vs-August ratio would not — one definition throughout). **Body Battery was not
replayed**, so the link from boundary to charge is read from the route's structure rather than measured
through it. `PEAK_BANDS` and the Karvonen zone boundaries were not reviewed and remain open.

Q-272's "median 6.7% of waking samples" could not be reproduced — the same statistic now gives 15.0%
pooled over 42 days. **Not filed as an error there**; the month split suggests it was measured on
recent data alone, and the drift documented here explains the gap.

## Part 2: the peak bands were built for a heart-rate range lifting never reaches

`hr-recovery-profile.ts` justifies its bands as *"for stable per-bucket sample sizes"*. That is an
empirical claim, so I measured it. Over 208 episodes the owner's set-peaks run **59–132**, median 102,
p95 121.

| band | episodes | share | mean `drop_60s` |
|---|---|---|---|
| `<110` (spec: de-emphasise) | **149** | **71.6%** | **3.0** |
| `110–129` | 57 | 27.4% | **14.9** |
| `130–149` | 2 | 1.0% | 13.5 |
| `150–169` | 0 | 0% | — |
| `170+` | 0 | 0% | — |

The highest set-peak ever recorded is 132, so the top two bands are **structurally unreachable**. The
low-signal cutoff sits at the p75, so the profile de-emphasises three quarters of its own data. **One
usable bucket.**

The uncomfortable part: the de-emphasis is *right*. `drop_60s` averages 3.0 below 110 against 14.9
above, so the spec's "mostly measurement noise" holds. Re-banding recovers no hidden signal — peak HR
in a lifting set simply does not reach the range where HR recovery is informative. So the proposal is
re-band **and say so**: a four-bucket profile that averages noise looks like it is working, which is
worse than one honest bucket.

Also recorded: `coverage_ok` passes on only 212 of 691 rows (31%), so two thirds are discarded before
banding. Not diagnosed.
