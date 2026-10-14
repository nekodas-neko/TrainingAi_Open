# Data we collect but don't use, and metrics we could build on it

_Read-only audit, 2026-10-12, for [`metric-links.md`](../architecture/metric-links.md), against `main` at `0e2df9995d` plus the docs branch. Consumers were traced by grep through
`lib/`, `app/`, `components/` and `packages/shared/src/`. Production fill comes from
all-time non-null counts through the owner-scoped read-only views, reported only as filled, sparse or empty. Nothing was run on a device, no
production query was made, and nothing in the repo was changed. Every citation was checked in PubMed
(E-utilities: esearch, esummary and efetch), and each claim below was read from the abstract._

## Summary

The scores read about a dozen scalars per night or day, and most of the richer data underneath is
either reduced to one number or only drawn on a chart. Five things stand out:

1. **The nightly shape of heart rate and temperature is thrown away.** The rollup finds the clock
   time of the overnight HR minimum every night, then discards it (`lib/oura-ble/rollup/run.ts:588`).
   The score built from that minimum, "settling" (4.5 shadow points, 9% of live readiness), is the
   hours from the minimum to wake. That is mostly the gap between body clock and alarm, so it partly
   re-scores timing and duration.
2. **The hypnogram only feeds the ribbon and a cycle count.**
3. **The stored chest-strap beats** produce one rest-window RMSSD on the workout recap, and nothing else.
4. **Per-set HR and timing on every logged set is shown on cards and never scored.** The one per-set
   column the shadow model reads, `hrr1_bpm`, is empty.
5. **Two stored series are read by nothing**: the SleepNet breathing-disturbance index and the
   scale's raw impedance.

Several columns are built and never filled. The morning check-in's recovery and sleep answers are
pre-filled, and so are almost all stored set RPEs, so they carry next to no information. Ten metric
ideas follow, each built on data already collected and ranked by value ÷ effort. The top two
(body-clock offset from the HR minimum, and cardiac cost of a set) need no new collection and can be
replayed on history straight away.

**How to read the fill column.** "Filled" means most rows have a value; "sparse" means some do;
"empty" means none. Counts include tombstoned rows. `oura_heartrate`, `oura_raw_samples`,
`oura_raw_packed` and `prescription_shadow` are not in the population counts. They are marked "not
measured", with the fill they have by design. **Status:** SCORED feeds readiness, sleep, activity,
illness or stress; "SCORED (planner)" means it drives an automatic training decision instead of a
health score. SHOWN is drawn but not scored. STORED-UNUSED has no reader. EMPTY has no values.

## 1. What we collect and who uses it

### Oura ring, direct over BLE

| Data | Filled? | Collected how | Used by | Status |
|---|---|---|---|---|
| `sleep_sessions.sleep_phase_5_min` (hypnogram) | filled | Our own stager in the rollup: SleepNet when inference runs, else the heuristic, over 0x72 motion, IBI, 0x5d HRV, 0x75 temperature and SpO₂, in 5-min epochs (`run.ts:340-470`) | Ribbon and cycle count (`components/health/hypnogram.tsx`, `sleepCycles()` in `packages/shared/src/health/hypnogram.ts`); header window (`lib/sleep/actual-window.ts`); up-sampled into the chronic-stress input, which is dormant | SHOWN |
| Stage hours (deep, REM, light, awake) | filled | Totals of the same stages | `sleep.deep_rem_share` (shadow); live sleep score and its awake-fraction cap (`sleep-score.ts`) | SCORED |
| `onset_latency_sec` | filled | First non-awake epoch | `sleep.latency`; live sleep score | SCORED |
| `restless_periods` | filled | BLE nights store `model.awakenings`; Cloud-era nights store Oura units | Left unscored on purpose: the two eras use different units (`sleep-score.ts:95`) | STORED-UNUSED |
| `respiratory_rate` / `breath_avg_rpm` | filled | Respiratory oscillation in the IBI series (`breathingFromIbi`) | `body.breathing_rate`; illness radar | SCORED |
| `recovery_index_hours` ("settling") | filled | Hours from the smoothed overnight HR minimum to wake (`recovery-index.ts`) | `heart.overnight_settling` (4.5 points); live readiness at 0.09 weight (`readiness-composite.ts:252`) | SCORED |
| **Clock time of the HR minimum** (`settledAt`, `lowestBpm`) | computed every night, never stored | `computeRecoveryIndex` | Dropped after hours-to-wake is taken (`run.ts:588`) | STORED-UNUSED |
| `oura_heartrate`, overnight 5-min curve | not measured (dense by design) | IBI in 5-min bins | Lowest bin is resting HR; the minimum gives settling; HR chart | SCORED (minimum only); curve SHOWN |
| `oura_heartrate`, daytime | not measured (dense by design) | 0x86 always-on HR plus IBI in 5-min bins; 15-s bins within ±10 min of a logged workout | Zone minutes (`daily_zone_minutes`, filled); body battery; hourly movement; stress | SCORED |
| Nightly skin temperature (`temp_mean_c`, `temp_dev_c`) | filled | 0x75 sleep temperature reduced to one value: the minimum of the stable-window maxima (`temperature-baseline.ts:34`) | `body.temperature`; illness radar; live readiness | SCORED |
| **Shape of the nightly temperature curve** (0x75, per frame) | raw only | as above | Nothing; reduced to the one value | STORED-UNUSED |
| Daytime temperature (0x46/0x69) | raw only | 98% of samples sit on a 0.5 °C grid (`run.ts:542`) | Admin device panel (`intraday-temp.ts`) | SHOWN (admin) |
| Per-5-min RMSSD (0x5d) | raw; chronic-stress stash | Ring firmware | Nightly median gives HRV; stager input | SCORED (median only) |
| `oura_daily_derived.bdi_derived` (SleepNet breathing disturbances per hour) | filled | By-product of the SleepNet staging pass | Admin dump console only (`sleepnet-dump-console.tsx`) | STORED-UNUSED |
| Gait features 0x7e/0x7f (`stride_frequency`) | raw | REAL_STEPS feature, now enabled | Step count; walk detection; ring cadence (`cadence.ts`) | SCORED (steps). **Never joined to HR** |
| MET (0x50) | raw | Activity frames | Training-stress gate; walk detection; `met_avg` | SCORED |
| Decoded but never rolled up: 0x59, 0x74 (ehr_acm_intensity), 0x84 (ambient), 0x81 (cva raw PPG), 0x87/0x88 (atlas bioimpedance), 0x6b, 0x6c, 0x49/0x4c/0x4f/0x58 (sleep summaries), 0x56 | raw archive only | Byte layouts match `open_oura`; field meanings are unvalidated | None (`rollup-consumed-tags.ts`) | STORED-UNUSED (frontier) |
| `stress_high_minutes`, `daytime_stress_scaled` | filled | Own daytime-HRV model over HR and temperature (`oura_daytime_hrv_model`, a single fitted row) | `body.daytime_stress` (2 points) | SCORED |
| `oura_daytime_stress_buckets` | filled | 30-min stress levels | Stress-day chart (`app/api/body-battery/stress-day`); admin comparison | SHOWN |
| `body_battery_daily` | filled | Walks forward from the readiness anchor (`lib/health/body-battery-day.ts`) | Live curve; admin recovery calibration | SHOWN |
| `resilience_*` | sparse | Own resilience model | Readiness payload band | SHOWN |
| `chronic_stress_score`, `training_load_ots`, `training_load_high`, derived `recovery_index_hours` | empty | Vendored models that need a full-history pass or are gated off | — | EMPTY |
| `oura_daily` (Oura Cloud era): `vo2_max`, `vascular_age`, `pulse_wave_velocity`, `resilience_level` | empty; the rest sparse | Oura Cloud, now gone for good | Legacy | EMPTY |

### Polar H10 chest strap

| Data | Filled? | Collected how | Used by | Status |
|---|---|---|---|---|
| `rr_intervals` | filled (90-day prune) | H10 RR. `/api/hr-ingest` places beats by walking backwards from the packet's receive time and drops implausible intervals. All-day mode has kept the beats contiguous since TN-51 (2026-09-20) | Rest-window RMSSD on the workout recap only (`compute-workout-hr.ts:64`, `app/api/oura/hr-data`) | SHOWN |
| `workout_hr_stats.workout_hrv_ms` | sparse | as above | Done screen | SHOWN |
| Strap HR, 1 Hz in workouts and one sample per 30 s otherwise (`oura_heartrate`, source `chest_strap`) | not measured | as above | Set HR stats; zones; HRR | SCORED |

### Renpho scale

| Data | Filled? | Collected how | Used by | Status |
|---|---|---|---|---|
| `scale_raw_samples`: impedance A and B | filled | Two big-endian 16-bit magnitudes per weigh-in (`ScaleProtocol.kt:91-93`). No reactance, so **phase angle cannot be computed** | Their average enters body fat only, through a 0.05 × impedance-index correction (`lib/scale-ble/composition.ts:125`) | STORED-UNUSED as a signal |
| Body-composition columns (`skeletal_muscle_pct` … `metabolic_age`) | half the rows (the scale era) | Mostly BMI-driven estimates, calibrated against DEXA | Body pages | SHOWN |
| `weight_kg` | filled | Scale, or typed | Weight vs plan; energy balance | SCORED |

### Workouts and sets

| Data | Filled? | Collected how | Used by | Status |
|---|---|---|---|---|
| `set_logs.set_time_sec` | filled | **Manual taps**: Start Set to Log Set (`components/workout-screen.tsx:1025,1078`). Includes walking up, unracking and bracing; the planner assumes 10 s of setup (`SET_SETUP_SEC`) | Seconds per rep and session time budget (`workout/time-profile.ts`, `time-audit.ts`, `ai-periodization/signals.ts:296`) | SCORED (planner) |
| `set_start_ms`, `set_end_ms` | filled | The same taps, as epoch ms | Set windows for HR stats; recap chart | SCORED (via set HR) |
| `rest_time_sec` | filled | Log Set to the next Start Set tap. The lifter chooses; there is no auto-start | "Rest discipline" trend (`workout/rest-adherence.ts`); time budget | SHOWN |
| `planned_rest_sec`, `planned_pct`, `planned_reps` | sparse (a bit under half) | Prescription snapshot taken at log time | Rest adherence; set HR rows | SHOWN |
| `planned_weight_kg` | sparse (new) | Snapshot | — | STORED-UNUSED |
| `rpe` | filled, **but almost all pre-fill** | The picker opens on the expected RPE. `rpe_source` exists only on a sparse set of recent rows, so older values can't be told apart from pre-fill | Expected-RPE drift and deload net (`ai-periodization/expected-rpe.ts`) | SCORED (planner) |
| `intensity_pct`, `exercise_logs.estimated_1rm` | filled | Computed | Prescription; PRs; HR buckets | SCORED (planner) |
| `time_to_complete`, `prep_time_sec`, `inter_exercise_rest_sec`, `warmup_ended_at` | filled, about half, about half, about half | Timers | Timing audit, then time budget | SCORED (planner) |
| `set_hr_stats`: peak, avg, end, drop at 30/60/90/120 s, trough, `sec_to_preset`, `%HRR`, `rest_adequate` | peak and avg about half; drop curve and `sec_to_preset` sparse; `source` sparse | HR around the set taps (`workout/set-hr-stats.ts`) | Exercise HR-trend card (`exercise-hr-trend.ts`); HR recovery profile; AI chat tool | SHOWN |
| `set_hr_stats.hrr1_bpm` | **empty** | Dense-HR HRR60 (`hrr60.ts`) | **Read by `heart.hr_recovery` in the shadow model, which therefore never scores** (#2824) | EMPTY (and read by a score) |
| `workout_sessions.session_rpe` | sparse | One-tap prompt on the done screen | Session-effort trend; daily energy | SHOWN |
| `workout_sessions.program_session_id`, `phase_id` | empty | — | — | EMPTY |
| `activity_logs`: `avg_hr`, `max_hr`, pace, `cadence_series`, splits | half (HR), sparse (series) | GPS plus HR | Pace-vs-HR scatter (`cardio-trends.ts`); `max_hr` feeds VO₂max (Uth–Sørensen) | SHOWN |
| `personal_records`, `fitness_tests` | filled / sparse; `fitness_tests.hrr1_bpm` empty | Logged | Performance overview | SHOWN |

### Logs

| Data | Filled? | Collected how | Used by | Status |
|---|---|---|---|---|
| `day_checkins.perceived_recovery`, `sleep_quality_feel` | filled, **but pre-filled** | The scale opens on a score-derived value. TN-57 found most rows were an untouched 3. The `*_touched` flags are always non-null, so the population counts can't separate the two | Shown to the AI prompt only when touched | SHOWN (carries little) |
| `vs_normal` (better / same / worse) | sparse | A real answer with no default | Check-in | SHOWN |
| `wake_mood`, `resting_soreness`, `motivation`, `journal`, and the evening items (`physical_tiredness`, `mental_drain`, `barely_moved`, `hydration`, `late_heavy_meal`) | sparse; retired in place | — | — | STORED-UNUSED |
| `food_logging_completed_at` | sparse | "Done logging today" tap | Gates the fuel score | SCORED (gate) |
| `mood_logs` (energy, sleep quality, body state, sore muscles) | filled | Pre-workout sheet. Energy is a required answer, so it is genuine | Energy drives prescription autoregulation (`ai-dynamic.ts:356`); the validation target in the 2026-10-12 history test | SCORED (planner) |
| `food_logs` (`logged_at`, `meal_type_id`) | filled | **`logged_at` defaults to the time of entry, not the time of eating** (`schema.ts:893`) | Energy balance and fuel; "Meals vs sleep" trend (`app/api/health-trends/route.ts:360`) | SCORED / SHOWN |
| `supplement_logs` (`amount`, `taken_at`) | sparse | Logged doses, including injections | Dose note on flagged readiness days (`dose-context.ts`); dose-vitals card; maintenance caveat | SHOWN. No caffeine is evidently logged |
| `injuries` | sparse; **`resolved_date` empty** | Logged | Active injuries go into the prescription prompt. `resolved_date` is null on every row, so every injury reads as active (`lib/coach/domains/injury.ts:49`) | SCORED (planner) |
| `measured_rmr`, `dexa_scans` | sparse; DEXA has 3 of 38 columns | Typed | Energy budget; body-fat calibration | SCORED |
| `blood_analytes`, `oura_tags`, `health_connect_intervals`, `apple_health_samples`, `body_metrics` girths | empty | — | — | EMPTY |
| `prescription_shadow` | not measured | Written on every generation | Export only | STORED-UNUSED |
| `colmi_readings` | filled | Colmi ring, comparison only | Admin comparison | SHOWN (admin) |

## 2. Gaps

### Collected, but no score uses it

1. **The clock time of the HR minimum is computed and thrown away**, and **settling partly
   double-counts.** `hoursToSettle = wake − settledAt` (`recovery-index.ts:44`). The overnight HR
   minimum mostly follows the body clock: wearable studies extract a circadian rhythm in HR that runs
   apart from sleep-wake and activity (Bowman 2021; Kim 2023). So hours-to-wake rises with a later wake
   and falls on an alarm-shortened night. It partly re-scores timing (4.5 points) and duration (9
   points), against the count-once rule in `metric-links.md` §3. The 2026-10-12 evidence note had
   already found no peer-reviewed validation for settling as a recovery marker.
2. **`bdi_derived`** is filled and read by nothing. Its only reader is an admin console.
3. **Hypnogram structure.** REM latency, wake bouts, how early the deep sleep comes, and stage
   transitions are never computed. Only stage totals, an awake-fraction cap and a displayed cycle
   count use it.
4. **The nightly temperature curve** is reduced to one number. Daytime temperature is too quantised
   to use as stored.
5. **`rr_intervals`** only gives one rest-window RMSSD per workout, and the 90-day prune erases
   anything not derived in time.
6. **Set timing.** `set_time_sec` only sets the session time budget, and rest is only shown as a
   session mean (rest discipline). Nothing reads a slowdown or a drift within a session.
7. **`set_hr_stats`** sits on cards and is never scored. Its sibling drop-curve columns are partly
   filled while `hrr1_bpm`, the column the score reads, is empty.
8. **Scale impedance** only moves a small correction term. Day-to-day changes in it are never read.
9. **Ring cadence and daytime HR** are both captured all day and never joined.
10. **Unrolled ring tags**: bioimpedance 0x88, raw cardiovascular PPG 0x81, ambient 0x84 and EHR
    intensity 0x74. Their field meanings are unvalidated upstream. This is the frontier, not a quick
    win.
11. **`prescription_shadow`** is written on every generation and never read. **`restless_periods`**
    is stored and left unscored on purpose (two eras, two units).

### Built, but never filled

- `set_hr_stats.hrr1_bpm`, so the shadow's `heart.hr_recovery` always drops out (#2824).
- `oura_daily_derived`: `chronic_stress_score` (needs a hand-triggered full-history pass),
  `training_load_ots`, `training_load_high`, `recovery_index_hours`.
- `workout_sessions.program_session_id` and `phase_id`.
- `sleep_sessions.sleep_score` and `manual_sleep_start`.
- `fitness_tests.hrr1_bpm`.
- `oura_daily` Cloud fields (`vo2_max`, `vascular_age`, `pulse_wave_velocity`, `resilience`).
- `body_metrics` girths; 35 of DEXA's 38 columns; `blood_analytes`; `oura_tags`; Health Connect and
  Apple tables.
- `injuries.resolved_date`. The injury sheet can resolve an injury (`components/health/injury-sheet.tsx`), but no row
  has been resolved, so every logged injury reads as active in the prescription prompt. This is a data
  state, not a code defect.

### Pre-filled, so they carry nothing

- **Morning check-in recovery and sleep feel**: an untouched seeded value (TN-57). Only `vs_normal`
  and the pre-workout energy are real answers, and both are sparse or narrow.
- **Set RPE**: the picker's pre-fill. Only recent rows record `rpe_source`. Any history analysis that
  treats RPE as a rating (and any validation of ideas 2, 6 or 7 below against RPE) has to use the
  `rated` rows only.
- **`food_logs.logged_at`** isn't pre-filled, but it records when the entry was made. As a meal
  time it is only as good as the habit of logging while eating. The meal-timing trend uses it as the
  meal time (#2829).

## 3. Innovative metric ideas

These avoid what `docs/architecture/metric-links.md` already covers (D1–D15, A1–A7, the check-in,
session RPE, the deficit guard, prescription against performance). Each uses data already collected.
Ranked by value ÷ effort.

### 1. Body-clock offset from the HR minimum (and a settling score that stops double-counting)

- **Formula.**
  - `t_min` = clock time of the minimum of the 3-point rolling median of the night's 5-min HR bins.
    `computeRecoveryIndex` already computes it; it only needs storing.
  - Clock shift = `t_min` − its 28-night median.
  - Behaviour shift = mid-sleep − its 28-night median.
  - **Desync = behaviour shift − clock shift**, in minutes: how far tonight's sleep moved away from
    the body's own timing.
  - Settling replacement (a tuning proposal): residual = `hoursToSettle` − what wake time relative to
    `t_min`'s normal predicts.
- **Data.** `oura_heartrate` overnight bins and the sleep window. Optionally the 0x75 temperature
  curve's plateau time as a second marker.
- **Why it's new.** Today's timing score measures behaviour (mid-sleep). This measures the body,
  separates the two, and removes a hidden double count from two scores (shadow and live).
- **Research.** HR carries a circadian rhythm distinct from sleep-wake and activity, extractable
  from consumer wearables: Bowman 2021, PMID 34568865, doi:10.1016/j.crmeth.2021.100058; Kim 2023,
  PMID 37608712, doi:10.1098/rsif.2023.0030. The HR phase and an activity-based DLMO estimate can
  desynchronise in real life: Huang 2021, PMID 34870267, doi:10.3389/fdgth.2021.727504. Wrist-skin
  temperature phase correlates with DLMO (R = 0.756): Bonmati-Carrion 2014, PMID 24164100,
  doi:10.3109/07420528.2013.820740.
- **Data-quality caveat.**
  - Alcohol, late meals and late hard sessions push the minimum later (masking). Read those nights
    with the explain links, never as clock moves.
  - 5-min bins give about 5-min resolution.
  - 0x75 only fires while asleep, and 0x46/0x69 sit on a 0.5 °C grid, so the evening temperature
    rise used in the DLMO studies can't be seen yet.
  - It needs about two weeks of nights before it means anything.

### 2. Cardiac cost of a set, read together with recovery

- **Formula.**
  - Per strap-covered working set: `cost = (avg_bpm − RHR_today) ÷ (HRmax − RHR_today)` (%HRR during
    the set).
  - Expected cost = the person's median for the same `exercise_id` × 10-point `intensity_pct` band ×
    reps ±1 × set number, over the previous 90 days, needing at least 5 matches.
  - Session **cost residual** = median(cost − expected). Pair it with the **recovery residual**,
    median(`drop_60s` − expected), and read the two together:
    - higher cost, slower recovery: strain (sleep loss, heat, dehydration, illness);
    - lower cost, slower recovery: the blunted-HR pattern of functional overreaching;
    - lower cost, faster recovery: getting fitter.
- **Data.** `set_hr_stats` (peak, avg, drop_60s, source), `set_logs.intensity_pct`, reps, set
  number, nightly RHR.
- **Why it's new.** It turns every lifting session into a submaximal "fixed workload" test, which
  endurance monitoring relies on. Nothing in the app compares a set's HR with that set's own normal.
- **Research.** HR at a fixed submaximal workload and HR recovery are practical markers of training
  status: Buchheit 2014, PMID 24578692, doi:10.3389/fphys.2014.00073. A systematic review found
  (sub)maximal HR and HR recovery reflect functional overreaching, while HRV did not: Roete 2021, PMID
  34108275, doi:10.1123/ijspp.2021-0024. The pressor response climbs as a set nears failure:
  MacDougall 1985, PMID 3980383, doi:10.1152/jappl.1985.58.3.785.
- **Data-quality caveat.**
  - Use strap sets only: the ring's optical HR through grip and Valsalva isn't trustworthy, and
    `source` is sparse, so coverage has to be counted first.
  - Avg and peak are about half filled.
  - The direction is ambiguous on its own (lower HR can mean fitter or overreached), which is why
    it's read with recovery.
  - Set length varies with tap timing.

### 3. HRV measured in deep sleep only

- **Formula.** `HRV_deep` = median of the 5-min RMSSD values (0x5d) in deep-staged epochs, skipping
  the first epoch after each transition. It needs at least 3 epochs, else null. Compare ln(HRV_deep)
  with its 30-night normal, as the overnight HRV score does today. A stager-free variant follows
  Herzig: take the first ≥10-min stretch where lag-1 R-R autocorrelation runs low (IBI already
  decoded).
- **Data.** 0x5d per-epoch RMSSD and the hypnogram. Both are already together in the rollup's
  chronic-stress stash (`hrvItems`, `sleepPhase30Sec`).
- **Why it's new.** Whole-night HRV mixes physiology with how the night was staged: a REM-heavy
  night reads lower. Measuring in one stable state gives the largest single score (10.5 points) a
  cleaner signal.
- **Research.** Over 3 nights of PSG in 15 men, HF power was reproducible in slow-wave sleep, LF and
  LF/HF were not, and an R-R-only algorithm placed 87% of picked segments inside SWS: Herzig 2017,
  PMID 29367845, doi:10.3389/fphys.2017.01100.
- **Data-quality caveat.**
  - **Circularity**: the stagers use HRV and IBI as inputs, so deep epochs are partly chosen for high
    HRV, biasing the level up. The day-to-day change is what counts, and the stager-free variant
    avoids the problem.
  - Short-deep nights go null.
  - Gate 4 (duplicate) applies: if its correlation with whole-night HRV is above 0.8, it replaces
    that score rather than adding to it.

### 4. Sleep-architecture signature: deep front-loading, REM latency, wake bouts

- **Formula.**
  - **Front-load ratio** = deep epochs in the first third of the sleep period ÷ all deep epochs.
  - **REM latency** = (first REM epoch − onset epoch) × 5 min.
  - **Wake bouts** = runs of ≥ 2 awake epochs between onset and final wake, plus the longest bout.
  - **Transitions per hour.**
  - Each is compared with a 30-night normal. An "alcohol-like" pattern is flagged as explain-only
    when REM latency is above normal + 2 SD, front-loading is above normal, and the second half has
    more wake bouts than the first.
- **Data.** `sleep_phase_5_min`; the window from `sleep_sessions`.
- **Why it's new.** Continuity, not just the awake total, decides how restorative a night is. The
  signature can also prompt "anything unusual last night?" on a night nobody tagged.
- **Research.**
  - SWS homeostasis (deep sleep front-loaded and dissipating across the night): Borbély 2016, PMID
    26762182, doi:10.1111/jsr.12371.
  - Forced awakenings cut SWS and positive mood more than the same sleep restriction, mediated by
    SWS: Finan 2015, PMID 26085289, doi:10.5665/sleep.5154.
  - Fragmentation reduces recuperation: Levine 1987, PMID 3432859; Stepanski 2002, PMID 12003157,
    doi:10.1093/sleep/25.3.268.
  - Alcohol delays the first REM period at all doses and raises first-half SWS: Ebrahim 2013, PMID
    23347102, doi:10.1111/acer.12006.
- **Data-quality caveat.**
  - 5-min epochs make brief arousals invisible.
  - The stage source changes by night (SleepNet or the heuristic fallback), so tag and baseline per
    stager.
  - Our stager under-reads REM on sparse-beat nights (`docs/sleep-system.md`).
  - Even Oura's full model reaches only 79% four-stage accuracy against PSG: Altini 2021, PMID
    34201861, doi:10.3390/s21134302.
  - Score front-loading and REM latency at most. Leave fragmentation to the existing awake cap so it
    isn't counted twice.

### 5. Breathing disturbances per kilogram

- **Formula.** Over 90 days, the % change in 28-night median `bdi_derived` against the % change in
  the 28-day median weight. Show it beside the expected slope (about −26% per −10% body weight) as
  long-term Body context, not a daily score.
- **Data.** `oura_daily_derived.bdi_derived` (filled, unread) and `body_metrics.weight_kg`.
- **Why it's new.** It turns weight change into a physiological payoff the person can see, from a
  column nobody reads.
- **Research.** Over 4 years, 10% weight loss predicted a 26% drop in AHI and 10% gain a 32% rise:
  Peppard 2000, PMID 11122588, doi:10.1001/jama.284.23.3015.
- **Data-quality caveat.**
  - BDI comes from SleepNet's apnoea head. It isn't AHI and hasn't been validated against PSG for
    this ring.
  - It is null on heuristic-fallback nights, and sleeping position, alcohol and congestion move it.
  - It must never be worded as a diagnosis.

### 6. Rep-pace drift: a velocity-loss proxy from tap timing

- **Formula.**
  - `spr` = (`set_time_sec` − 10) ÷ reps, per set.
  - **Within-session drift** = slope of `spr` across same-load sets of one exercise ÷ the first set's
    `spr`.
  - **Readiness form** = first working set's `spr` ÷ the median for the same exercise × load band ×
    reps.
  - **Feasibility gate first**: if the within-exercise CV of `spr` at a fixed load and rep count is
    above about 15%, drop the idea.
- **Data.** `set_time_sec`, `set_start_ms` and `set_end_ms` (all filled), reps, `intensity_pct`.
- **Why it's new.** It aims at velocity-based fatigue monitoring without a VBT device, using
  timestamps we already store for time budgeting.
- **Research.** Velocity loss within a set tracks lactate (r = 0.93–0.97) and fatigue: Sánchez-Medina
  2011, PMID 21311352, doi:10.1249/MSS.0b013e318213f880; González-Badillo 2017, PMID 28192832,
  doi:10.1055/s-0042-120324. Velocity loss maps to reps in reserve: Rodríguez-Rosell 2020, PMID
  31045753, doi:10.1519/JSC.0000000000002881.
- **Data-quality caveat.** Probably the weakest signal here.
  - Times are manual taps, and setup (walk up, unrack, brace) is inside the timer and varies by
    seconds.
  - Controlled eccentrics hide concentric slowing.
  - A slowdown of 1–3 s across a set may sit under the noise, hence the gate.
  - RPE can't validate it (pre-filled), so validate against reps short of plan.

### 7. Rest surplus: rest taken against the time HR needed

- **Formula.**
  - Per set: `surplus = rest_time_sec − sec_to_preset`, where the HR reached its preset.
  - Session median surplus against normal.
  - **Rest creep** = slope of `rest_time_sec ÷ planned_rest_sec` over set index within an exercise.
  - Reading: a positive surplus with normal HR means the limiter isn't cardiovascular (neuromuscular,
    or distraction). A negative surplus means the next set starts before HR recovers; expect a rep
    shortfall.
- **Data.** `set_logs.rest_time_sec` (filled), `planned_rest_sec` (sparse),
  `set_hr_stats.sec_to_preset` (sparse).
- **Why it's new.** Rest discipline today asks whether the plan was obeyed. This asks whether the rest
  matched what the body needed.
- **Research.** Self-selected rest varied between sessions and tracked power output while fatigue
  and effort ratings stayed stable: Ibbott 2019, PMID 30866743, doi:10.1177/0031512519835976. The
  evidence is weak.
- **Data-quality caveat.**
  - Rest includes changing plates and the phone.
  - `sec_to_preset` is sparse and depends on the preset target.
  - Ring-only sets have poor HR.
  - Supersets interleave rests.

### 8. Water-adjusted weight from raw impedance

- **Formula.**
  - Z̄ = mean(A, B) per weigh-in. Index `II = height² ÷ Z̄`.
  - ΔII = today − its 7-day median.
  - Label a weight move "likely water" when |Δweight| is above 0.5 kg and ΔII moves the same way.
  - Learn k in Δweight ≈ k·ΔII per person, then show weight with k·ΔII removed beside the D15
    smoothed weight.
  - If A and B turn out to be two frequencies, log(A ÷ B) is a candidate fluid-distribution index.
- **Data.** `scale_raw_samples.decoded` / `raw_hex` (filled).
- **Why it's new.** It uses the scale's real measurement to explain day-to-day weight noise. Today
  that measurement barely reaches any output.
- **Research.** Impedance falls as total body water rises, and BIA is sensitive to hydration, skin
  temperature and recent intake: Kyle 2004, PMID 15380917, doi:10.1016/j.clnu.2004.06.004.
- **Data-quality caveat.**
  - Foot-to-foot BIA mostly measures the legs, and foot moisture, time of day and drinks move it.
  - Readings below 200 Ω are no-contact and are already rejected.
  - What A and B mean is unconfirmed; a capture test is needed.
  - No reactance means no phase angle.

### 9. Aerobic threshold from strap beats (DFA-α1)

- **Formula.**
  - DFA α1 (box sizes 4–16 beats) over 2-min windows, stepping 20 s, on contiguous strap RR during
    steady cardio, skipping windows with more than 5% missing beats.
  - HRVT1 = the HR where a linear fit of α1 on HR crosses 0.75. Use it to set the top of zone 2 in
    place of the % of HRmax in `hr-zones.ts`.
  - Second output: α1 at a fixed HR across a long session (durability).
- **Data.** `rr_intervals` (filled, chest strap); activity windows from `activity_logs`.
- **Why it's new.** It gives a personal threshold without a lab, from beats we already store and
  discard after 90 days.
- **Research.**
  - α1 = 0.75 matched VT1 (HR 154 vs 152 bpm; ICC 0.96 for HR): Rogers 2020, PMID 33519504,
    doi:10.3389/fphys.2020.596567.
  - 1–6% missed beats bias α1 but leave HRVT within 1 bpm: Rogers 2021, PMID 33530473,
    doi:10.3390/s21030821.
  - The H10 detected 99.4% of RR intervals correctly even at high intensity: Gilgen-Ammann 2019, PMID
    31004219, doi:10.1007/s00421-019-04142-5.
  - Review: Rogers 2026, PMID 42847804, doi:10.1249/JES.0000000000000401.
- **Data-quality caveat.**
  - Not valid for lifting (no steady state, Valsalva).
  - It needs cardio done in the strap with intensity that rises. How many runs had the strap on is
    unknown.
  - Beats are placed backwards from the packet time, and implausible beats are dropped, not
    corrected, so gaps must be detected.
  - Derive within 90 days or the beats are gone.

### 10. Everyday walking HR at a fixed cadence (fitness with no workout)

- **Formula.**
  - Find bouts of at least 6 min where ring cadence (`stride_frequency` × 60) holds at 100–125 spm
    with CV under 5%.
  - HR = median of the last 3 min.
  - Fit HR = a + b·(cadence − 110) per person over 60 days.
  - Daily value = the bouts' median HR adjusted to 110 spm. A slow decline means fitter; a jump
    against its normal points to fatigue, heat or illness. It could feed VO₂max in place of
    Uth–Sørensen's HRmax/HRrest ratio.
- **Data.** 0x7e/0x7f gait windows (about every 30 s), 0x86 and IBI HR, walk detection from MET.
- **Why it's new.** It is a passive daily fitness reading from ordinary walking. The app only plots
  pace against HR for logged runs.
- **Research.** Free-living HR while walking at a set speed raised VO₂max prediction R² from 0.65 to
  0.77: Altini 2016, PMID 26940653, doi:10.1152/japplphysiol.00519.2015. Free-living wearable data
  predicted fitness (r = 0.82) and its change: Spathis 2022, PMID 36460766,
  doi:10.1038/s41746-022-00719-1. Submaximal HR as a training-status marker: Buchheit 2014 (as in
  idea 2).
- **Data-quality caveat.**
  - Cadence isn't speed: stride, hills, stairs and carried load change it.
  - Optical finger HR suffers during arm swing.
  - The density of the 0x86 always-on HR samples is unknown.
  - The gait decoder's units are still provisional (D-2).
  - It must be computed in the rollup from raw frames: a 7-day hot window, or a redecode from the
    packed archive.
  - The most work of the ten.

### Ranking

| Rank | Idea | Value | Effort | New collection? |
|---|---|---|---|---|
| 1 | Body-clock offset and the settling fix | high: new marker, and removes a double count | very low: store `settledAt` | no |
| 2 | Cardiac cost of a set, with recovery | high for a lifter | low to moderate: one pure function over `set_hr_stats` | no |
| 3 | HRV in deep sleep only | high: the biggest score | low: in the rollup | no |
| 4 | Sleep-architecture signature | medium | low: pure function on the hypnogram | no |
| 5 | Breathing disturbances per kg | medium, long-term | very low | no |
| 6 | Rep-pace drift | uncertain; the test is cheap | very low | no |
| 7 | Rest surplus | medium-low | low; sparse data | no |
| 8 | Water-adjusted weight | medium | low to moderate; needs a capture test for A and B | no |
| 9 | DFA-α1 threshold | high if cardio is done in the strap | moderate | no; derive before the 90-day prune |
| 10 | Walking HR at cadence | high | high: a rollup join of raw gait and HR | no |

Every idea that would move a score is a `type: tuning` proposal that passes the five gates in
`metric-links.md` §4. Ideas 4 and 5 start as explain or context, never as points. None of them has
been exercised on a device, on native SQLite or on production data.
