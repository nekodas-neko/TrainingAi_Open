# Base data, score reachability, and composite metrics

**Asked by the owner, 2026-09-15:** review the pillar diagram; establish what base data a usable
pillar system needs; look for new metrics formed by combining computed values; and settle scoring
for less-data vs more-data users — with one hard requirement: *"as long as with my current metrics I
have a way to get 100 score on pillars I am happy. It should be achievable."*

**That requirement is not met today, and the reason is not the design.** Section 2 is the finding.

---

## 1. Base data, reviewed against Health Connect

The owner supplied [Health Connect's data-type
list](https://developer.android.com/health-and-fitness/health-connect/data-types) with the right
caveat: *not all devices send all data*. Those are two different questions and the docs have been
conflating them.

### ⚠ This retires "skin temperature has no second source"

`docs/data-source-connector-guide.md` §5.6 and this session's own earlier audit classify skin
temperature as a hardware dependency with no substitute, costing readiness's temperature term (0.10)
and the illness radar's largest term (0.40). **Health Connect defines `SkinTemperatureRecord`** — a
series of skin-temperature deltas — and **`HeartRateVariabilityRmssdRecord`** for HRV.

So the ring-only list is a claim about *our read list and the user's device*, not about the platform.
Stated correctly: **Health Connect can carry every input our pillars need except beat-to-beat
intervals.** Whether a given watch writes any particular record is a separate, per-device question,
and the answer is often no — which is an argument for the inferred-contributor design (TN-38 task C),
not against reading the type.

### What we already read, and what we do not

`HC_SYNC_READ_TYPES` (`lib/health-connect-sync.ts`) reads **11** types: Steps, Weight, BodyFat,
Nutrition, SleepSession, RestingHeartRate, OxygenSaturation, HeartRateSeries, TotalCaloriesBurned,
ActivitySession, HeartRateVariabilityRmssd.

**Ten Health Connect types our pillars would use and we do not read:**

| record | feeds | note |
|---|---|---|
| `SkinTemperatureRecord` | readiness 0.10 · illness radar 0.40 | **the largest single gap** |
| `RespiratoryRateRecord` | illness radar 0.25 | |
| `ActiveCaloriesBurnedRecord` | activity 15/100 | we read *Total*, not *Active* |
| `Vo2MaxRecord` | cardio, progress markers | we compute our own; a device value is a cross-check |
| `DistanceRecord` | activity | |
| `HydrationRecord` | nutrition (water) | |
| `BasalMetabolicRateRecord` | energy balance | |
| `LeanBodyMassRecord` · `BoneMassRecord` · `BodyWaterMassRecord` | body composition | the scale supplies these for the owner; a HC user has no other route |

**Two defects found while reading that file**, both on the path a Health-Connect user depends on:

- **The overnight windows use the DEVICE timezone, not the user's.** `toLocalDate` resolves
  `Intl.DateTimeFormat().resolvedOptions().timeZone`, and the HRV and SpO₂ blocks filter on
  `d.getHours()` between 0 and 8 (lines 347, 369). This is the class CLAUDE.md bans. It is invisible
  while the device sits in the user's own zone and mis-attributes a night's HRV to the wrong day the
  moment it does not.
- **A stale comment says `SDNN` where the code reads rMSSD.** Line 51 documents `hrvMs` as *"mean
  overnight SDNN HRV"*; the read is `HeartRateVariabilityRmssd` → `heartRateVariabilityMillis`, which
  is rMSSD. The code is right and the comment is wrong — worth fixing precisely because this
  repository has already shipped an `Sdnn`-for-`Rmssd` mix-up once.

---

## 2. ⚠ The owner cannot score 100 on any pillar — and readiness has never reached 90

Measured over production, all days with a score:

| pillar | best ever | mean | days | days ≥ 90 |
|---|---:|---:|---:|---:|
| Sleep | **97** | 73 | 63 | 19 |
| Activity | **91** | 73 | 50 | 1 |
| **Readiness** | **87** | 64 | 62 | **0** |

**Sleep is fine by construction and rare in practice.** The final `SCORE_CALIBRATION` maps a blend of
93 to a displayed 100, and the theoretical maximum blend is 99.2 — so 100 is reachable. But an
*excellent* night (8.5 h, 94% efficiency, good stages, HRV 1.1× baseline) computes to a displayed
**94**, and the best night in 63 was 97. The ceiling is real, just steep. **No change recommended.**

**Readiness is the problem, and it is a stuck contributor rather than a curve.** On the best day
recorded (87), the contributors were:

| contributor | weight | that day | mean over 62 days | max ever |
|---|---:|---:|---:|---:|
| hrvBalance | .15 | 100 | — | 100 |
| sleepBalance | .10 | 100 | — | 100 |
| previousNight | .16 | 95 | — | — |
| restingHeartRate | .15 | 90 | — | — |
| checkin | .10 | 88 | — | 88 observed |
| activityBalance | .06 | 81 | 76 | 100 |
| **temperature** | **.10** | **78** | **76** | **96** |
| **recoveryIndex** | **.09** | **44** | **43** | 100 |

- **`temperature` has never reached 100 in 62 days** (max 96, mean 76). It is scored *closer-better*
  — 100 sits exactly at the personal baseline — so **a miscentred baseline makes 100 unreachable by
  construction.** That is TN-6 (baseline 0.36 °C too low, −16 pt on 89% of days) and BF-13 (the
  baseline EMA seeds at zero), both already queued. **This is the binding constraint on readiness.**
- **`recoveryIndex` averages 43** against a maximum of 100 — the second-largest drag, and not
  currently explained by any queued entry.
- **`checkin` is not a defect.** `CHECKIN_ENERGY_SCORE` maps `pumped → 100`; the owner's observed
  maximum is `good → 88` because he has never logged `pumped`. Honest self-report, not a cap.

**⛔ Do not re-tune the readiness curves to make 100 reachable.** The ceiling is caused by an input
that is wrong, and re-shaping a curve to compensate for a broken input is the "the threshold is
right, the input is wrong" mistake this pillar has now made five times. **Fix TN-6/BF-13, then
re-measure.**

### The rule this produces

**Every contributor must be able to reach 100 on a genuinely excellent input, or the pillar's ceiling
is silently below 100.** Two ways it breaks, and both exist here:

1. **The curve's maximum is below 100.** `LATENCY` peaks at 90 and `TIMING` at 95 in `sleep-score.ts`
   — harmless *only because* the final calibration compensates. Check the calibration before calling
   such a curve a bug.
2. **A closer-better contributor whose baseline is miscentred can never sit at its own optimum.**
   That is readiness's temperature term, and no calibration compensates for it.

---

## 3. Composite metrics — new fields from values we already compute

The owner asked whether combining two computed values yields anything new. Four candidates that are
**not already implemented** (checked: no `sleepDebt`, no autonomic-balance composite, no true-sleep
figure, no load-vs-readiness), ordered by value against cost. All four are pure functions over series
the app already produces, so none needs new data.

| composite | = | why it beats its parts | base-set safe? |
|---|---|---|---|
| **Autonomic balance** | resting-HR trend **+** HRV trend, agreeing | a single-signal move is noise; **both moving the same way is the signal.** The cheapest noise reduction available, and it is what readiness's two heaviest physiological terms are separately guessing at | needs an HR source |
| **Load vs readiness** | ACWR **×** readiness | *"training hard while recovering badly"* is the actual deload question. **This is what the deload engine should consult instead of the stress override it is losing (TN-34/TN-36)** | ✅ steps + logged workouts + check-in |
| **Sleep debt** | rolling (personal need − actual) over 14 days | one short night is noise, four in a row is a state. Cumulative and directly actionable | ✅ **duration only** |
| **True sleep time** | duration **×** efficiency | separates *"eight hours in bed"* from *"eight hours asleep"* — the single most common misreading of a sleep figure | needs efficiency |

**Sleep debt and load-vs-readiness both work on the base set** (bed/wake times, steps, logged
workouts, check-in), which makes them the two worth building first: they add value to exactly the
user who has least data.

**⛔ One rule for all of them:** a composite must state which of its parts were inferred rather than
measured, and — per TN-38 task C — **a composite containing an inferred part may not trigger an
action.** A composite is the easiest place to launder an estimate into something that looks measured.

---

## 4. Scoring, less data vs more — unchanged, with one addition

TN-38 task C already landed the design: every contributor always carries a value, measured where
possible and **conditionally** inferred where not, each flagged `measured | inferred` with an
uncertainty, and no inferred value may trigger an action. Gated on TN-39 validating the technique
where ground truth exists.

**What this review adds is the reachability rule from §2** — every contributor must be able to reach
100 on an excellent input, checked against the pillar's final calibration. Without it, the
inferred-contributor design would faithfully reproduce a ceiling nobody intended: the owner's
readiness is capped today not by missing sensors but by a contributor that cannot reach its own
optimum.

**The owner's requirement is satisfiable and is not satisfied today.** Sleep already meets it.
Activity is close. Readiness needs TN-6 and BF-13, which are queued — no new work, just priority.
