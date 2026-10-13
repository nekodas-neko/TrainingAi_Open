# Data gaps: what we collect, what we use, what we could build

_Summary written 2026-10-12 at the owner's request ("see what fields are being used and what aren't;
we should note the gaps"). It pulls together three read-only audits:_

- _[`2026-10-12-oura-api-usage.md`](2026-10-12-oura-api-usage.md): every Oura API v2 field, and what
  we do with the equivalent value today._
- _[`2026-10-12-health-connect-usage.md`](2026-10-12-health-connect-usage.md): every Health Connect
  record type, through our whole pipeline._
- _[`2026-10-12-collected-data-usage.md`](2026-10-12-collected-data-usage.md): what we already
  collect from the ring, chest strap, scale and logs, and which score reads it._

_Population was checked through the owner-scoped read-only views and is reported here only as
filled, sparse or empty. Nothing ran on a device. How metrics are allowed to link and count is in
[`metric-links.md`](../architecture/metric-links.md)._

## In one minute

- **The scores read about a dozen numbers a night.** Most of the richer data under them is reduced
  to one number, drawn on a chart, or thrown away after it is computed.
- **Some features read data that stopped updating in July.** The Oura Cloud columns froze at the
  07-07 re-key. The skin-temperature sparkline, the AI sleep insight and the coach's context still
  read them (#2827).
- **Health Connect is mostly untapped.** We touch 14 of its 41 record types. Strength sessions
  arrive as "other", nutrition keeps 4 of about 40 fields, and nothing keeps which app wrote what.
  It has also never run on real data. #2818, #2819 and #2828 cover the defects.
- **Several inputs carry no information** because they are pre-filled: the morning check-in's
  recovery and sleep answers, and most stored set RPEs. The meal-timing trend uses the time a meal
  was *logged* (#2829).
- **The best new metrics need no new collection.** Body-clock timing, the heart-rate cost of a set,
  and HRV in deep sleep are all built from data we already store.

## 1. The gaps

### Read from data that stopped updating
- The Skin Temperature sparkline, the temperature-vs-lifts trend, the AI sleep insight, the coach's
  "Today" line and recovery tool, the deload stress check, the readiness contributors fallback, the
  offline seed, and the heart-rate page's VO₂max and vascular-age tiles (#2827).

### Built, but never filled
- **Oura Cloud columns** that never held a value: VO₂max, vascular age, pulse-wave velocity,
  resilience.
- **No writer at all:** `oura_tags` (tags, sessions and rest mode) and `oura_workouts`.
- **Our own derived columns:**
  - `sleep_sessions.sleep_score`;
  - chronic stress;
  - the two training-load columns;
  - set-level HR recovery (#2824), which means the shadow model's HR recovery never scores.
- **Workout links:** `workout_sessions.program_session_id` and `phase_id`; `fitness_tests.hrr1_bpm`.
- **Health records:** most DEXA columns, the blood panel, body girths, and the Health Connect and
  Apple tables.

### Computed, then thrown away
- **The clock time of the overnight heart-rate minimum.** It is computed every night, and only the
  "hours to wake" is kept. That number is the settling score, which partly re-scores timing and
  duration.
- **The 30-second hypnogram and the 5-minute HRV series.** They are built per night, then discarded.

### Stored, but read by nothing
- **Breathing disturbances per hour** (SleepNet, `bdi_derived`). It is filled most nights.
- **Night perfusion index** (`oura_bucket`).
- **Raw scale impedance.** It only nudges body fat. There is no reactance, so phase angle is
  impossible.
- **Workout records:** `prescription_shadow`, and Health Connect step cadence.
- **Device and model internals:** ring battery and charging state (admin only), and the resilience
  components.
- **Chest-strap beats.** They give one rest-window HRV per workout, and are pruned after 90 days.

### Pre-filled, so they carry nothing
- **The morning check-in's recovery and sleep answers.** They open on a seeded value.
- **Set RPE before `rpe_source` existed.** It can't be told apart from the picker's pre-fill.
- **Meal time.** `food_logs.logged_at` is when the entry was made (#2829).

### Health Connect
- **What reaches us:** 14 of 41 types; 11 permissions declared but never requested; 9 types the
  pinned plugin can't parse.
- **Losses inside the types we read:** strength sessions become "other"; laps, segments and routes
  are dropped; nutrition keeps 4 of about 40 fields; the writing app is kept only on interval rows.
- **Defects:** a night's duration means time in bed, not asleep; one bad record blocks the whole
  sync; imports can erase zone-minute history (#2828, with #2818 and #2819).

### If we switched the ring to the Oura API (#2808)
- **What we would lose:**
  - absolute skin temperature (the illness radar's input);
  - settling;
  - 15-second workout heart rate;
  - the 30-minute daytime stress series;
  - live steps.
- **What would arrive with nowhere to land:** the API's 30-second sleep series, session biometrics
  and ring configuration.
- **Mismatches to handle:** day boundaries (04:00 in the API, midnight for us), units
  (`stress_high` is in seconds), and enum values.

## 2. New metrics from data we already have

Ranked by value for the effort. Which to card first is the owner's call in #2834. Each one that
would move a score is a `type: tuning` proposal and passes the five gates in
[`metric-links.md`](../architecture/metric-links.md) §4. Evidence is in the linked audits; every
citation there was checked in PubMed.

| # | Metric | Built from | Why it's new | Effort |
|---|---|---|---|---|
| 1 | **Body-clock offset**: tonight's heart-rate-minimum time against its normal, compared with how far sleep timing moved | the HR minimum (computed, discarded) and the sleep window | It measures the body clock rather than bedtime behaviour, and lets settling stop double-counting timing and duration | very low: store one value |
| 2 | **Heart-rate cost of a set**: %HRR during a set against that exercise, load and rep count's own normal, read together with HR recovery | `set_hr_stats`, `set_logs` | It turns every lifting session into a fixed-workload fitness check. Higher cost with slower recovery means strain; lower cost with slower recovery is the overreaching pattern | low |
| 3 | **HRV in deep sleep only** | per-5-min RMSSD and the hypnogram, already together in the rollup | It is a cleaner signal for the biggest single score: whole-night HRV moves with how the night was staged | low |
| 4 | **Sleep-architecture signature**: REM latency, how front-loaded deep sleep is, wake bouts | the 30-s hypnogram (built, discarded) and the 5-min hypnogram | The continuity and order of sleep, not just stage totals. Alcohol, for example, has a clear signature | low |
| 5 | **Charger-aware wear gate** | ring battery and charging state | Keeps short-wear days caused by charging in the baselines | low |
| 6 | **Night perfusion trend** | `oura_bucket.perfusion_index` | Peripheral vasoconstriction during sleep rises with cold, illness and alcohol; the Oura API has nothing like it | low (needs validation) |
| 7 | **Multi-night temperature slope** | nightly skin temperature | Catches a slow rise that a single-night threshold misses | low |
| 8 | **Breathing disturbances against weight** | `bdi_derived`, scale weight | A long-term, visible payoff of weight change. Context only, never a diagnosis | very low |
| 9 | **Water-adjusted weight** | raw scale impedance | Explains day-to-day weight noise with the scale's own measurement | low to moderate |
| 10 | **Aerobic threshold (DFA-α1)** | chest-strap beats during steady cardio | A personal zone-2 ceiling without a lab. It has to be derived before the 90-day prune | moderate |
| 11 | **Walking heart rate at a fixed cadence** | ring gait windows and daytime HR | A passive daily fitness reading from ordinary walking | high |
| 12 | **Temperature and breathing for users with no ring** | Health Connect skin temperature and respiratory rate (declared, unparsed) | The illness check for those users runs on HR and HRV only today | moderate (plugin work) |
| 13 | **HR at pace, cycling power, glucose, blood pressure, cycle phase** | Health Connect types we don't read | For other users' devices: aerobic efficiency, cycling load, measured fuel, cardiovascular strain, and phase-aware normals | moderate to high |
| 14 | **Rep-pace drift** | set timing taps | A velocity-loss proxy without a device. It must pass a noise check first, because the taps include set-up | very low to test |

## 3. Not checked

- No device, Health Connect provider or Oura API account was used.
- `oura_heartrate` and the raw ring tables were not in the population check.
- Nothing was rendered at 384 px.
- Health Connect defects N1 and N3 (#2828) were found by reading code, not reproduced.
