# Every metric the app records, and where the core/adjustment line could sit

**TN-38 task C.** The owner asked for every metric recorded, plus alternative definitions of "core"
with the reasoning for each, before setting the line. This is that inventory, measured against
production rather than read off the schema.

**Why the line matters.** Today a score renormalises its weighted mean over whichever contributors
are present (`sleep-score.ts:399`), so connecting a sensor changes the *denominator*. Two users' 78s
are computed from different weight sets, and the owner's own 78 today is not the same quantity as
his 78 next year on different hardware. Under `clamp(core + Σ adjustments)` the core is one quantity
everyone shares and an extra sensor contributes a signed delta.

---

## 1. Every metric currently recorded

Grouped by the cheapest device that can supply it. Coverage is the owner's last 60 days.

### Tier 0 — phone, scale and the user's own hands (no wearable)

| metric | table | coverage |
|---|---|---|
| body weight | `body_metrics.weight_kg` | 48/60 |
| body fat %, skeletal muscle %, visceral fat, body water %, bone mass, BMR, metabolic age | `body_metrics` (smart scale) | 48/60 |
| waist / chest / arm / thigh / hip / neck | `body_metrics.*_cm` | manual |
| calories, protein, carbs, fat, water | `body_metrics` (food log) | daily |
| workout sessions, sets, reps, load | `workout_sessions` · `set_logs` | every session |
| energy level, sleep quality, body state, sore muscles | `mood_logs` | check-in |
| steps, distance | `body_metrics.steps` · `distance_km` | 60/60 |
| bed/wake time | `sleep_sessions.manual_sleep_start` | manual fallback |

### Tier 1 — any basic wearable (watch, band, Health Connect)

| metric | table | coverage |
|---|---|---|
| resting heart rate | `body_metrics.resting_heart_rate` | 60/60 |
| sleep duration, time in bed | `sleep_sessions.duration_hours` · `time_in_bed_hours` | 71/71 |
| sleep efficiency | `sleep_sessions.efficiency` | 71/71 |
| onset latency | `sleep_sessions.onset_latency_sec` | 71/71 |
| overnight average / lowest HR | `sleep_sessions.avg_heart_rate` · `lowest_heart_rate` | 71/71 |
| intraday HR series → zone minutes, active calories, move hours | `oura_heartrate` | 74,860 strap + 12,673 ring / 45 d |
| sleep stages (REM / deep / light / awake) | `sleep_sessions.*_sleep_hours` | 71/71 |

⚠ **Stages are Tier 1 by availability and Tier 2 by trust.** Every consumer device reports them and
no two agree; the app's own stages come from SleepNet, our model, not from the ring.

### Tier 2 — ring, chest strap or premium wearable

| metric | table | coverage |
|---|---|---|
| overnight HRV (rMSSD) | `sleep_sessions.average_hrv_ms` · `body_metrics.hrv_ms` | 67/71 · 60/60 |
| SpO₂ | `body_metrics.spo2_pct` | 60/60 |
| respiratory rate | `sleep_sessions.respiratory_rate` | 71/71 |
| restless periods / restfulness | `sleep_sessions.restless_periods` | 71/71 |
| skin temperature deviation | derived, ring only | ring only |
| recovery index | `oura_daily_derived.recovery_index_hours` | ring only |
| daytime HRV, daytime stress, chronic stress, Body Battery, OTS, illness radar | `oura_daily_derived` | ring only, **no fallback branch** |

**`active_calories` reads 0 of 60** — it is derived at read time, not stored, which is worth knowing
before anyone treats the column as a source.

---

## 2. What each scored pillar is actually built from

Measured weights, not intentions.

| Sleep (sums to 110, renormalised) | | Readiness (sums to 1.00) | | Activity (sums to 100) | |
|---|---:|---|---:|---|---:|
| total sleep | 24 | previous night | .16 | strength frequency | 25 |
| HRV | 14 | resting HR | .15 | strength volume | 20 |
| overnight HR | 14 | HRV balance | .15 | steps | 18 |
| REM | 10 | temperature | .10 | active energy | 15 |
| deep | 10 | sleep balance | .10 | move hours | 12 |
| efficiency | 9 | check-in | .10 | zone minutes | 10 |
| restfulness | 9 | prev-day activity | .09 | | |
| schedule | 8 | recovery index | .09 | | |
| latency | 6 | activity balance | .06 | | |
| timing | 6 | | | | |

---

## 3. Three places the line could sit, and what each yields

Percentage = how much of the pillar's weight the **core** carries.

| | sleep | readiness | activity |
|---|---:|---:|---:|
| **A — phone only** | 35% | 35% | 63% |
| **B — phone + basic wearable** | **55%** | **66%** | **100%** |
| **C — B plus sleep stages** | 87% | 66% | 100% |

### The finding that should decide this

**The line barely matters for Activity, matters some for Readiness, and is the whole question for
Sleep.** Activity reaches 100% core on a basic wearable because its heaviest terms are logged
workouts and steps. Sleep is where the choice has teeth, because 48 of its 110 points sit in HRV,
stages and restfulness.

### A — phone only
**Core:** duration, bed/wake timing, schedule, steps, workouts, weight, check-in.
**For:** the most portable definition. Works for a friend with nothing but a phone, survives any
hardware change, and is the only option where the core never silently depends on a vendor's model.
**Against:** a 35% sleep core is close to "how long were you in bed". A user on a basic watch would
see two-thirds of their sleep score arrive as adjustments, which is the renormalisation problem
wearing a different hat — the number still moves for a reason unrelated to their body.

### B — phone + basic wearable ← recommended
**Core:** A, plus resting HR, sleep efficiency, overnight HR, zone minutes, active energy, move hours.
**For:** every one of these is something *any* wearable measures directly and reports consistently.
Resting HR and overnight HR are the two most device-agnostic recovery signals there are, and they
take readiness from 35% to 66% core. Activity reaches 100%.
**Against:** a phone-only user gets a thinner core than under A, so the app has to be explicit that
sleep and readiness are partial without a wearable.

### C — B plus sleep stages
**Core:** B, plus REM, deep, latency, restfulness.
**For:** an 87% sleep core, so the sleep number means something on a basic watch.
**Against:** **this is the one I would argue against.** Stage estimates differ wildly between
devices — the same night scores differently on different hardware — so putting them in the core
reintroduces exactly the incomparability the core is meant to remove. It also makes the core depend
on a vendored model rather than a measurement.

**Reversal cost:** moving an input from core to adjustment later re-scores history. The 2026-08-24
policy applies — stamp the model version and leave stored days alone — but it is still the
expensive-to-reverse decision in this entry, which is why it is the owner's.

---

## 4. What no line can fix

Chronic stress, resilience, daytime HRV, Body Battery, OTS and the illness radar read raw BLE frames
with **zero fallback branches**, and readiness's temperature term (0.10) passes null on every generic
path. These are not "normalise these" work — making them source-neutral means re-implementing
vendor models, which is a project rather than a task. Recorded here so it is not scoped as a task
later (TN-38 step D).
