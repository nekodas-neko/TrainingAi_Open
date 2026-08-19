# Zone minutes and movement-per-hour: coverage check

**Date:** 2026-08-19 · **Agent:** Tuning 🎶 · **Pillars:** `[activity]` `[heart-rate]` `[body]`
**Trigger:** the owner asked for this directly, and
[Q-521](../implementation-backlog.md) had deferred it — its closing caveat said *"zone minutes and
movement-per-hour were not pulled or coverage-checked… checking their coverage is the first
implementation step, given what `active_calories` shows."*

**Verdict: neither input is usable in its current form, and they fail in opposite directions.**
`moveHours` is pinned at the top of its range; `zoneMinutes` is pinned at the bottom. Both sit in
the Activity Score today (weights 12 and 10 of 100), and both are named in the owner's Body Battery
brief as drivers of drain. Building Q-521's exertion model on them as they stand would import two
constants dressed as measurements.

---

## 1. What was measured

Source: `claude_ro.oura_heartrate`, 60 days to 2026-08-19, **59 days with waking-hour data**
(07:00–21:59 Australia/Brisbane — the same half-open `[wakeHour, sleepHour)` window
`moveHoursGoal()` divides by). Profile constants taken from the app's own formulas, not from
memory: `hrMaxFromAge(33) = 187`, resting HR **53** (the observed recent range is 51–54),
`hrReserve = 134`. Rest boundary `HR_REST_THRESHOLD = 0.05` → **59.7 bpm**. Zone floors from
`ZONE_DEFS` → Z2 **133**, Z3 **147**, Z4 160, Z5 174.

Row-scope caveat as always: `claude_ro` is scoped to one user, so every count below is **the
owner's**, and one athlete's HR profile is exactly what a zone threshold is sensitive to.

---

## 2. `moveHours` — saturated: it counts wear, not movement

An hour counts as "moved" if **any** sample in it exceeds 59.7 bpm.

| month | days | waking hours with data | of those, "moved" | fraction |
|---|---|---|---|---|
| 2026-06 | 9 | 127 | 127 | **1.000** |
| 2026-07 | 31 | 456 | 456 | **1.000** |
| 2026-08 | 19 | 274 | 273 | **0.996** |

**Of 857 waking hours that had any HR data at all, 856 qualified as "moved".** One did not.

The contributor score is `clamp01(moveHours / 15) × 100`:

| contributor score | days |
|---|---|
| 100 | **48** |
| 93 | 5 |
| 87 | 2 |
| 80 | 2 |
| 53 | 2 |

**48 of 59 days score exactly 100; 55 of 59 score ≥ 93.** The remaining variance is not movement —
it is hours the ring was off the finger. A contributor whose only source of variance is missing data
is measuring wear time.

### This is Q-188 returning through the other side of the fraction

`hourly-movement.ts` carries its own comment about the last time this happened:

> *This function previously counted any hour in 0–23 while `moveHoursGoal()` divided by
> `sleepHour − sleepHour`… the contributor (weight 12) pinned at 100 no matter what the goal was set
> to — it could never carry information.*

Q-188 (2026-08-11) fixed the **denominator** — the window the goal measures. The **numerator** now
saturates on its own, for an unrelated reason: `HR_REST_THRESHOLD = 0.05` puts the rest boundary at
59.7 bpm, and the owner's waking HR is essentially never that low (ring p50 **69**, p90 **88**).
Same symptom, different half of the ratio, and the fix that closed the first one could not have
prevented the second. **This is the sixth instance of this session's recurring shape: the threshold
is right, the input is wrong.**

**Downstream of Q-515.** Q-515 recorded that the rest/active boundary fell ~3× as the owner got
fitter. This is the same boundary, and the same root cause, seen from the Activity Score instead of
from Body Battery. A `moveHours` fix that does not move off a fixed reserve fraction will re-saturate
the moment the owner's resting HR drops again.

---

## 3. `zoneMinutes` — floored: the zone floor is above where strength training lives

Same 59 days, computed the way the runtime computes it (`accumulateZoneSeconds` →
`activeMinutesFromZoneSeconds`, Z2 minutes + 2 × Z3+ minutes, `DEFAULT_MAX_GAP_SEC = 120`):

| | days |
|---|---|
| **0 active minutes** | **53** |
| 1–4 | 3 |
| 5–14 | 1 |
| ≥ 15 | 2 |

Mean **1.39 min/day** against `DEFAULT_ZONE_MINUTES_GOAL = 22` — a contributor pinned at **~6/100**.

**The reason is not sampling.** It is that the owner's training does not reach the zone floor:

| source | p50 bpm | p90 | p99 | max | % samples ≥ Z2 (133) | % ≥ Z3 (147) |
|---|---|---|---|---|---|---|
| `chest_strap` | 90 | 108 | **121** | 166 | **0.29%** | 0.11% |
| `ble` (ring) | 69 | 88 | 107 | 154 | 0.07% | 0.01% |

The chest strap is worn **for workouts**, samples at ~1 Hz, and its **99th percentile is 121 bpm** —
twelve beats below the Zone 2 floor. Zone 2 begins at 60% of heart-rate reserve; strength training
with rest periods does not sustain that. **This is Q-516 (`PEAK_BANDS` is calibrated for a heart-rate
range strength training never reaches) applied to `ZONE_DEFS`** — the same mismatch in a second
consumer of the same banding.

### The existing guard covers the wrong half of the calendar

`activity-score.ts:144` already suppresses the contributor when `zoneMinutes === 0 &&
strengthSessionToday`. Measured against completed workouts:

| | days | of those, 0 zone minutes | mean zone min |
|---|---|---|---|
| strength day | 44 | 40 | 0.91 |
| **non-strength day** | **15** | **13** | 2.80 |

So the guard fires on 40 of the 44 days it was written for — and on **13 of 15 non-strength days the
contributor fires at 0 anyway**, taking 10 points of weight off the score for a day where the metric
had nothing to say. Both group means are indistinguishable from zero; do not read the 2.80 vs 0.91
as an inversion at n = 15.

---

## 4. A third defect: the 120 s gap cap versus the ring's 300 s cadence

Independent of the two above, and it makes any zone number non-comparable across days.
`accumulateZoneSeconds` attributes each inter-sample interval to the earlier reading's zone,
**capped at `DEFAULT_MAX_GAP_SEC = 120`**. Measured inter-sample gaps:

| source | p50 gap | p90 gap | gaps over the 120 s cap | elapsed h | counted h | **kept** |
|---|---|---|---|---|---|---|
| `chest_strap` | **1.0 s** | 30.3 s | 0.2% | 102.2 | 86.1 | **84%** |
| `ble` (ring) | **300.0 s** | 300.0 s | **80.1%** | 1026.3 | 356.7 | **35%** |
| `awake` (Cloud era) | 34.0 s | 362.0 s | 32.3% | 217.7 | 70.3 | 32% |
| `rest` (Cloud era) | 300.0 s | 301.0 s | 99.6% | 348.1 | 58.0 | 17% |

**The ring samples on an exact 300 s cadence, so the cap truncates every one of its intervals to 120
s — a flat 60% haircut on all ring-measured time.** The comment above the constant says a ring
"samples ~1/min"; this ring samples 1/5 min. The same minute of the same effort is therefore worth
**0.4 min on a ring-only day and 0.84 min on a strap day** — a 2.4× device-driven difference, before
`activeMinutesFromZoneSeconds` doubles vigorous minutes and doubles the gap with it. Only **26 of 59
days** have strap data.

This does not explain the floor in §3 (the strap days are near-zero too), but it means that even
after the floor is fixed, zone minutes are **not comparable across days** until the cap is derived
from the actual source cadence rather than a fixed 120 s.

---

## 5. What this changes for Q-521

Q-521's brief proposes drain from "steps/movement, HR above rest, workout load and zone minutes".
Two of those four are the inputs measured here.

- **`moveHours` contributes no variance** — it would enter the drain model as a constant ≈ 1.0 and
  read, in code review, as a working movement term.
- **`zoneMinutes` is zero on 90% of days** — it would enter as a constant ≈ 0, and would activate
  only on the rare cardio day, silently switching the model's behaviour on exactly the days that
  look most like an outlier.
- **Steps remain the only movement input with real coverage** (all 51 days in Q-521's window),
  reinforcing that entry's `active_calories` caveat rather than relieving it.

**Recommendation: Q-521's first slice should use steps + workout load only**, and take movement
distribution and intensity from the fixed versions of these two inputs once Q-522 and Q-523 land.
Shipping the four-input model now would encode two constants as measurements, which is harder to
notice later than an input that is simply absent.

---

## 6. Filed

- **Q-522** — `moveHours` is saturated: 856 of 857 waking hours qualify, 48 of 59 days score 100.
- **Q-523** — `zoneMinutes` is floored: 53 of 59 days at 0, strap p99 121 bpm vs a 133 bpm Z2 floor;
  includes the 120 s cap versus 300 s cadence defect.
- **Q-521** gains a note pointing at both, and the "steps + workout load first" sequencing.

**Not measured, and deliberately:** whether a *lower* Zone 2 floor would produce a useful signal for
this athlete. That is a calibration proposal and needs a candidate threshold fitted against days the
owner would call "active", which needs the owner's labels, not more SQL. It is written into Q-523 as
the open question rather than guessed at here.
