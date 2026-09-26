# Review sweep 64: reading DV's design gallery from the phone

**Date:** 2026-09-26 · **Agent:** Review · **Docs only.**
**Input:** RV-205/RV-206 results from device sweeps 4a/4b. The private gallery is
`https://claude.ai/artifact/6chic4wxSBEC6maezNXdGS`: 75 captures and a measurements table. The
device was the S25 on APK 1.465.52, web v1.465.66/67, gesture navigation. I read 28 captures at
source resolution; nothing was downloaded into the repo.

## What the phone showed that the web build could not

- **Streak contradiction (RV-216):** Home shows **111 days**, and More's best streak shows **49**.
  Two `computeStreak` functions disagree.
- **Raw keys on Sleep (RV-217):** `hrv`, `hr` and `schedule` appear as labels. `CONTRIBUTOR_KEYS`
  has no entry for them. Code-certain.
- **Four calorie numbers across two screens (RV-218):** the ring's denominator is 1,534, the
  explainer's goal and budget are 1,660 and 1,356, and Day's "burned" is 1,694. Also
  "205 workouts", which is 205 kcal, and a 7-day chart with five bars.
- **Day's workout card (RV-219):** a bodyweight lift reads "0 kg", and the exercise names
  truncate.
- **Home's header (RV-211, amended):** the weather and battery pills squeeze the date to "S…".
- **Corrections to sweep 63:**
  - The white button is the dialog primary, not a one-off (RV-212).
  - "Dumbbell" on the web build is an icon name rendered as text (RV-214).
- **Confirmed on the device:** RV-208's time, separator and XP formats; RV-212's red "Well
  under"; RV-213's four empty meal cards; RV-214's clipped recovery chips.

## DV's numbers, and what they settle

| Probe | Result | Consequence |
|---|---|---|
| P25 scroll | p95 8.4 ms at 120 Hz on four lists | Scrolling is not a problem. Nothing filed |
| P26 keyboard | inputs and buttons visible | RV-210 narrows to `enterKeyHint`, the "Go" key |
| P28 motion | no layout-property animations; 11 always-on background meteors; Workout still animating 1.5 s in | The width animations sweep 63 found are gone, since RV-207 shipped. The ambient animation is a battery and feel question for the owner, not a defect |
| P24 tap | only Add food's sheet is over 100 ms, at 118 ms | Tap latency is fine. The first-frame issue is pressed states, which RV-207 covers |
| P27 | 19 font sizes on screen, 46 text colours, 95 backgrounds | RV-209 stands |
| P33 reach | 7 primary controls in the top 30% | Segment tabs on Health and More, and Nutrition's day arrows. A layout change, so mockup-first if pursued. Not filed alone |

## The gallery's own faults (RV-220)

- **Health 01–04 are black, and 05 is the phone's home screen.** The app was backgrounded.
  Republish without it and guard the capture.
- **Several pushed screens never scrolled**, so their captures are byte-identical.
- **P32 painted from cache at every timepoint,** so a cold run is still owed.
