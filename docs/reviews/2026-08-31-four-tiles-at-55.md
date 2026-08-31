# "Everything is 55" — what today's Home screen is actually showing — 2026-08-31

*Tuning · production data pulled 2026-08-31 (device shows 06:43 Brisbane). Files **TN-18**.
Propose-only. Counts are the owner's account only (`claude_ro` is row-scoped).*

Owner, with a Home screenshot: Readiness **55**, Heart Rate **55**, Sleep **56**, Activity **56**,
Body Battery **55**. *"its jts all in the 55 region."*

Three separate things are going on, and only one of them is a defect.

---

## 1. The clustering is unusual, not the norm — today is the 2nd tightest day in 35

Across 35 days where all three scores exist:

| | readiness | sleep | activity |
|---|---|---|---|
| mean | 66.9 | 78.6 | 74.0 |
| sd | 13.0 | 19.4 | 7.9 |
| range | 29–87 | 15–97 | 51–91 |

**The three tiles normally sit 20 points apart** (mean spread 20.0, median 19.0, max 65). Only
**2 of 35 days** have all three within 3 points, and today is one of them. The recent days either
side make the point: 2026-08-30 read **73 / 69 / 64** and 2026-08-26 read **52 / 15 / 80**.

**So "everything is 55" is not a scoring collapse.** It is three numbers that each fell for their own
reason and happened to land together.

**And "Heart Rate 55" is not a score at all** — it is bpm, the 7-day average resting HR
(**TN-13**). Sharing a value with three 0–100 scores beside it is a coincidence of units, and it is a
good argument for TN-13's baseline-delta format on its own: "55 · +2 vs usual" could not be mistaken
for a fourth score.

---

## 2. But two of the five numbers are not independent readings, by construction

This is the part worth knowing, because it is permanent rather than about today.

**Readiness literally contains the sleep score and the activity score.** From today's stored
`readiness_contributors`:

- `previousNight.input = 56` — **that is the Sleep tile, passed straight through**, weight **0.16**
- `activityBalance.input = 56` — **that is the Activity tile**, weight **0.06**

So **22% of Readiness is the two tiles sitting next to it**. Measured over 46 days,
`corr(readiness, sleep)` = **+0.656**, against `corr(sleep, activity)` = **+0.139**.

**And Body Battery's morning value is the readiness score** (`resolveAnchor`; `walkBodyBattery`
filters to `tsMs >= wakeTime`, so nothing happens overnight). Measured: `corr(anchor, readiness)` =
**+0.838**, n = 47.

**Of the five numbers on that screen, two are independent measurements** (sleep, activity), one is a
weighted blend that contains both of them, one is that blend re-labelled, and one is in different
units. Nothing is wrong with any single number; the screen just reads as more corroboration than it
is. Recorded here rather than filed — the fix is presentational and belongs with TN-15's redesign.

---

## 3. Today's 55 is arithmetically correct and physiologically driven

Reproduced exactly from the stored contributors and `READINESS_WEIGHTS`:

`0.16×56 + 0.15×33 + 0.15×38 + 0.10×80 + 0.10×45 + 0.10×50 + 0.09×65 + 0.09×100 + 0.06×56` =
**55.3 → 55**, matching the stored value.

Against yesterday's 73, the −18 decomposes as:

| contributor | yesterday → today | weighted |
|---|---|---|
| **hrvBalance** | 100 → 38 | **−9.3** |
| **restingHeartRate** | 76 → 33 | **−6.5** |
| previousNight (sleep) | 69 → 56 | −2.1 |
| checkin (not yet logged) | 72 → 50 | −2.2 |
| prevDayActivity | 75 → 65 | −0.9 |
| others | | −1.9 |
| **recoveryIndex** | 44 → **100** | **+5.0** |

**Two real physiological inputs account for 15.8 of the 18 points**: overnight HRV **53 ms** against
71–72 the two nights before, and resting HR **63.7** against 59.0–59.2. Sleep duration was fine
(7.75 h). **The app is right today** — that is a genuinely lower morning, and the sleep score fell for
the same two reasons.

**⚠ Two caveats on that number, both already queued.** `recoveryIndex` scored **100** and is flagged
`provisional: true`, after **22** and **44** on the two previous days — it *lifted* today's readiness
by 5 points, and without it the tile reads ~50 (**Q-509**). And `checkin` is contributing the
placeholder 50 because it has not been logged, so **logging it will move the number after first
open** — which is exactly what **TN-9** exists to stop.

---

## 4. The defect: TN-6a shipped for one of its three consumers (TN-18)

**TN-6a is live** — `readiness-payload.ts:386` computes `tempLadderTrusted` from
`isTemperatureBaselineCentred(...)` and `computeBlendedScore` nulls the deviation when it is false,
making every arm of the ladder unreachable. That is why today carries **no** temperature penalty
despite a stored deviation of 0.519 °C, and the code comment says so.

**The deload banner was not gated.** `packages/shared/src/ai-periodization/ai-dynamic.ts:184` is
still a bare `temperatureDeviation != null && temperatureDeviation > TEMP_ALERT_THRESHOLD_C` with no
centred-baseline condition, and `grep` finds `isTemperatureBaselineCentred` in exactly one file.
TN-6a's own entry required all three consumers.

**The screenshot is the contradiction, in one frame.** For the same night:

| path | value used | verdict |
|---|---|---|
| readiness contributor | `tempZ` = **0.303** | scores **80/100** — temperature is fine |
| deload banner | `temp_dev_c` = **0.519 °C** | **"Body temp elevated — rest or deload recommended"** |

Both numbers are the same night off the same baseline object. The z is small **because the baseline
sd is inflated** — `temp_baseline_dev_x8` reads **1.714 °C** today against a true nightly sd of
~0.14 °C, so `0.519 / 1.714 = 0.303`, matching the stored contributor input to three decimals.
**This is Q-506's inflated-sd finding and TN-6's low-mean finding visible simultaneously**, failing in
opposite directions on one screen, which is what the TN-6 review predicted and could not show.

**The banner is the consumer the owner actually sees** — it is the one behind *"its often triggering
deload days"* — so TN-6a's protection landed on the path the owner does not read and skipped the one
they do. Filed as **TN-18**.

---

## Failure surfaces not exercised

No code ran — SQL against production plus source reading. No `pnpm dev`, no device, no APK. The
readiness arithmetic was reproduced by hand from stored contributors and matched the stored score;
**the ladder and banner were not executed**, so the claim is that the gate exists in one file and not
the other, not that the two paths were observed diverging at runtime. The owner's screenshot is the
observation.
