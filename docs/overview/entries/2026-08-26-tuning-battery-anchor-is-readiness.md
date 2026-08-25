# 2026-08-26 — the Body Battery does not charge overnight; its morning value IS the readiness score

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner, on a 7:03 am Home screenshot reading Readiness 53 / Sleep 57 / Activity 63 / Battery 53:
*"everything is so low — battery starts at 57? I figured it should be much higher when waking up."*

**The battery has no overnight charge phase.** `walkBodyBattery` filters samples to
`tsMs >= wakeTime`, and `resolveAnchor` sets the starting value to the readiness score. So the number
on the screen at wake is a readiness score wearing a battery label — and anything that penalises
readiness lands directly on it. Today: `anchor = 53`, `anchor_source = 'readiness'`,
`readiness_score = 53`, `hr_sample_count = 0` (nothing walked yet).

**Most of the gap is the temperature penalty already queued.** Today's `temp_dev_c` is **+0.466**,
which trips the −10 arm, so readiness would read **63** and the battery would start there. Across the
35 days holding both a battery row and a deviation:

| | now | penalty removed |
|---|---|---|
| mean morning anchor | **64.8** | **76.8** |
| mornings ≥75 ("Charged") | **7/35** | **21/35** |

Conservative: the 6 days clamped at 40 by the >1.0 °C arm count as unchanged, because a clamp cannot
be reversed by adding the penalty back.

**Recorded as a pass test on TN-6 rather than filed as a new entry.** The fix for "the battery never
wakes up full" is the baseline fix already signed off; proposing overnight charging or an anchor
redesign would be a large change to a value Q-511 shows is load-bearing, aimed at a symptom that fix
removes. Re-measure after it lands — only then is the design question real.

**Not all of today is the model.** Overnight HRV read 53 against 60 two days earlier and resting HR
53.7 against 50.2, so `hrvBalance` 38 and `restingHeartRate` 42 are genuine. Two of nine readiness
contributors were still provisional at the time of the screenshot — `checkin` 50 (the Log Readiness
card was unanswered) and `recoveryIndex` 49.

**Sleep 57 is the calibration curve, not a bad night.** The weighted blend reconstructs to **73.15**
and `SCORE_CALIBRATION` maps that to exactly 57 — reproduced to the stored value. TN-5's uniform-gain
curve would display **≈63** for the same night.

**Not exercised:** no code ran — SQL against production plus source reading.
