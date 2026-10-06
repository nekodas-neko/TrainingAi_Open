# Threshold inventory: every constant that turns a measurement into a score, band, label, gate or recommendation

Read-only inventory of `main` as checked out on 2026-10-06. Starting points were
`docs/architecture/scoring-structure.md` and `docs/architecture/component-references.md`. After
those, I grepped `packages/shared/src/`, `lib/` and `app/api/` for `const UPPER_CASE = <number|table>`
and read the score, gate and prescription functions by hand to find inline literals. Paths are
relative to the repo root, and line numbers are where the value is defined.

**Categories**
- **LEARNED**: should come from the person's own distribution (their percentile or baseline).
- **GUARDED**: a personal value clamped inside a research range.
- **CONSTANT**: a physiological or research constant that should be the same for everyone.
- **MODEL**: an implementation or statistics parameter. It is tuned centrally, not per person.

**GAP** in the Why column means the value is fixed today but fits some people badly, so it should
be LEARNED or GUARDED. **Already personal** means the code already derives that part per person.

Pure plumbing is left out: BLE byte layouts, cache TTLs, rate limits, retention windows, UI colours
and signal-processing plausibility clamps. The one exception is a single CONSTANT row for the
physiological plausibility bounds.

---

## Sleep

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| Sleep score | `SLEEP_WEIGHTS` packages/shared/src/health/sleep-score.ts:23 | total 24, restfulness 9, efficiency 9, REM 10, deep 10, latency 6, timing 6, schedule 8, HRV 14, HR 14 (of 110) | How much each component counts | MODEL | Weights express how strong the evidence is for each component, not something personal. component-references proposes demoting REM, deep and timing and raising schedule, and that change belongs to central tuning. |
| Sleep score | `TOTAL_SLEEP` curve sleep-score.ts:62 | 6h→46, 7h→62, 7.5h→70, 8h→77, 9h→92, 10h→100 | Duration sub-score | GUARDED | **GAP.** The curve keeps rising until 10 h. Research (AASM/SRS) says ≥7 h, and individual sleep need varies from about 7 to 9 h. A personal plateau should sit between 7 and 9 h, with 7 h as the floor that scores about 70. Today someone who needs 7.5 h is capped near 70. |
| Sleep score | `EFFICIENCY` curve sleep-score.ts:64 | 85%→50, 90%→68, 94%→85, 98%→100 | Efficiency sub-score | CONSTANT | NSF puts "good" at ≥85%, and that line should hold for everyone. The curve is harsher than the research, though: it gives 85% a score of 50 where it should be about 70. That is a re-anchoring job, not personalisation. |
| Sleep score | `REM` curve sleep-score.ts:66 | 1.1h→50, 2h→82, 3h→100 | REM sub-score | LEARNED | **GAP.** There is no consensus on how much REM marks good sleep (NSF 2017), and ring staging adds error. An absolute 3 h target suits few people. It should be scored against the person's own REM distribution. |
| Sleep score | `DEEP` curve sleep-score.ts:67 | 0.7h→50, 1.1h→77, 2h→100 | Deep sub-score | LEARNED | **GAP.** Slow-wave sleep falls steeply with age, so a 2 h target is out of reach for most adults over 50, who lose up to 10 points structurally. It should be scored against the person's own baseline. |
| Sleep score | `LATENCY` U-curve sleep-score.ts:70 | 0 min→50, 10→85, 14→90, 20→78, 28→62, 40→42 | Sleep-onset sub-score | CONSTANT | NSF says ≤30 min is good (≤15 min is the clearest band), and that holds for everyone. The fast-onset penalty (0 min scores 50) has no research support. If it is kept, it should be a LEARNED "fast for you" sleep-debt flag. |
| Sleep score | `TIMING` curve sleep-score.ts:73 + `IDEAL_MIDPOINT_HOUR` sleep-score.ts:161 | midpoint 03:00→95, 1.5h off→66, 3.5h off→28 | Circadian timing sub-score | LEARNED | **GAP.** A fixed 03:00 midpoint is one chronotype. An early bird sleeping 22:00–06:00 (midpoint 02:00) and a late type sleeping 01:00–09:00 (05:00) both lose points every night. It should use the person's habitual midpoint, or be folded into schedule. |
| Sleep score | `HRV_RATIO` curve sleep-score.ts:77 | ratio to own 14-night median: 0.85→42, 1.0→70, 1.2→93, 1.35→100 | Overnight HRV sub-score | MODEL | The baseline is already personal. **GAP:** the slope is a fixed ratio rather than σ-scaled, so someone whose night-to-night HRV CV is 25% saturates far more often than someone at 8%. The spread should be LEARNED, as a z-score, like readiness does. |
| Sleep score | `HR_RATIO` curve sleep-score.ts:82 | 0.85→100, 1.0→70, 1.08→40, 1.30→4 | Overnight HR sub-score | MODEL | Same as HRV: the baseline is already personal, but the fixed-ratio slope ignores each person's own spread. **GAP (spread).** |
| Sleep score | `SCHEDULE_DEV` curve sleep-score.ts:94 | 0h off habit→100, 1.2h→70, 2.5h→40, 4h→15 | Bed/wake regularity vs own habit | CONSTANT | The habit is already LEARNED. How much deviation to tolerate is a regularity question (Windred 2024) and should be the same for everyone. |
| Sleep score | `AWAKE_PENALTY` sleep-score.ts:111 | awake fraction 5%→−4, 10%→−10, 20%→−22, 35%→−38 | Restfulness deduction | CONSTANT | Anchored to the NSF WASO marker (≤20 min awake is good). |
| Sleep score | `AWAKE_FRAGMENTATION_CAP` sleep-score.ts:128 | cap 100 at ≤1σ of own awake fraction, 72 at 2σ, 32 at 3σ, 15 at 4σ | Caps a fragmented night | MODEL | The input is already personal (own mean and SD). The σ anchors are a statistics choice. |
| Sleep score | `SCORE_CALIBRATION` sleep-score.ts:156 | blend 50→41, 78→70, 85.6→91, 93→100 | Stretches the weighted blend over 0–100 | LEARNED | **GAP.** It was fitted to the owner's own nights (scoring-structure.md says so). Another sleeper's blend distribution sits elsewhere, so their bands land in the wrong place. It needs either a per-person refit or a central multi-user fit with research anchors. |
| Sleep score | `RESTFULNESS_FALLBACK_BASE` sleep-score.ts:163 | 72 | Restfulness base when there is no efficiency reading | MODEL | Fallback value only. |
| Sleep score | `SLEEP_HRV_/HR_/SCHEDULE_MIN_NIGHTS` sleep-score.ts:170-175 | 7 nights | When baseline components switch on | MODEL | Maturity gate. |
| Sleep score | `SLEEP_AUTONOMIC_BASELINE_WINDOW_NIGHTS` sleep-score.ts:196 | 14 | HRV/HR baseline window | MODEL | Window length. |
| Sleep score | `SLEEP_AWAKE_FRACTION_BASELINE_MIN_NIGHTS` sleep-score.ts:203 | 14 | When the fragmentation cap activates | MODEL | Maturity gate. |
| Sleep score | `SLEEP_COVERAGE_LOW_MISSING_WEIGHT` sleep-score.ts:290 | 28 (HR + HRV) | Coverage label full, partial or low | MODEL | Display of coverage. |
| Sleep night | `MAIN_SLEEP_MIN_HOURS` sleep-score.ts:210 vs `MIN_MAIN_SLEEP_H` lib/sleep/primary-sleep.ts:5 | 4 h vs 3 h | Main sleep or nap | MODEL | Two different values for a near-identical concept, so worth checking. Someone who often sleeps less than 4 h (a shift worker) gets no baseline nights. |
| Sleep night | `NIGHT_BAND_START_HOUR`/`END_HOUR`, `ALWAYS_NIGHT_MIN_HOURS`, `MAX_INTRA_NIGHT_GAP_HOURS` packages/shared/src/health/sleep-night.ts:35-51 | 21:00–10:00 band, ≥4 h always counts as night, 3 h gap | Which sleep counts as "the night" | LEARNED | **GAP.** A fixed band excludes shift workers and extreme chronotypes. It should come from the person's habitual sleep window, with the ≥4 h rule as a guard. |
| Sleep verdict | `VERDICT_BASELINE_NIGHTS`, `VERDICT_IQR_MULTIPLIER` packages/shared/src/health/sleep-verdict.ts:48,69 | 28 nights, 1.0×IQR fences | Poor / normal / good verdict | MODEL | Already personal: own p25/p75 fences. |
| Sleep staging | `WAKE_HR_DELTA`, `WAKE_MOVE_MULT`, `DEEP_Z`, `REM_Z`, weights packages/shared/src/health/sleep-staging.ts:42-182 | 18 bpm, 2×, z 1.0, z 0.35, … | Epoch → stage | MODEL | Most cutoffs are per-night z-scores, so they are already relative. `WAKE_HR_DELTA = 18 bpm` is absolute, and a person with low HR reactivity may be under-detected as awake. This is a candidate to become LEARNED. |
| Sleep trend | `ratioTrend` packages/shared/src/health/sleep-trend.ts:13-18 | last 3 nights ÷ prior 7 | Feeds `lowSleep < 0.85` in the session picker | MODEL | Already self-relative. |
| Readiness (legacy fallback) | sleep component lib/health/readiness-payload.ts:409 | `sleepHours / 8 × 40` | Fallback sleep points when there is no sleep score | GUARDED | **GAP (minor).** An 8 h target for everyone, and it is fallback only. |

## Heart

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| HR max | `hrMaxFromAge` packages/shared/src/health/hr-zones.ts:10 | 220 − age, or 190 when age is unknown | Max HR for zones, reserve and battery when nothing has been observed | LEARNED | Already personal once `resolveMaxHr` has a reliable observed max (hr-profile.ts, 90-day window). The age formula has an SD of about ±10–12 bpm. The 190 fallback is the same for everyone. |
| HR reserve | `hrReserve` floor hr-zones.ts:16 | max(30, max − rest) | Guards a collapsed reserve | MODEL | Safety floor. |
| HR zones | `ZONE_DEFS` hr-zones.ts:45 | Karvonen lower bounds 0 / 0.60 / 0.70 / 0.80 / 0.90 of HRR | Zone 1–5 edges, used by run prescriptions and zone minutes | GUARDED | The convention works for the population, but individual LT1/LT2 land anywhere from about 55% to 85% HRR. With a field test (talk test, HRR-at-threshold) the edges could be personalised inside the convention's range. Low priority. |
| Active minutes | `MODERATE_INTENSITY_FRAC` hr-zones.ts:71 | 0.40 HRR | Where moderate activity starts (WHO minutes) | CONSTANT | ACSM definition (40–59% HRR). |
| Active minutes | vigorous floor = zone 3 packages/shared/src/health/zone-minutes.ts:96 | 0.70 HRR | Minutes counted ×2 | CONSTANT | **Inconsistency, not personalisation.** ACSM puts vigorous at ≥60% HRR, which is the zone 2 floor. Minutes between 60% and 70% HRR are counted once when the guideline would count them twice. |
| Rest / move | `HR_REST_THRESHOLD` hr-zones.ts:23 | 0.05 of HRR | Body Battery charge-or-drain line, and the Activity score's "moved this hour" | LEARNED | **GAP (big).** Awake seated HR sits at a different reserve fraction per person (0.05–0.10 for the owner, according to the code comment). Someone whose seated HR is 8% of reserve never charges and is always "moving". It should be a percentile of the person's own waking seated HR. This is TN-2's open question. |
| Walk target | `WALK_FAST_BAND_PCT_OF_MAX` hr-zones.ts:137 | 60–70% of HRmax | Guided-walk fast block band | GUARDED | It was moved from 0.70 HRR because the owner hit it on 0 of 44 blocks. Whether a target is reachable depends on fitness and age, so it should be personal inside the 60–70% range. |
| Resting HR | `RESTING_HR_DEFAULT` packages/shared/src/health/hr-profile.ts:48 and `DEFAULT_RESTING_HR` packages/shared/src/running/fitness-snapshot.ts:18 | 60 bpm | Fallback resting HR | MODEL | Fallback only, but **defined twice**. |
| Resting HR | `RESTING_HR_WINDOW_DAYS` / `OBSERVED_WINDOW_DAYS` hr-profile.ts:7,47 | 28 / 90 days | Baseline windows | MODEL | Window lengths. |
| Resting HR | `CORROBORATION`, `MIN_RELIABLE_SAMPLES` packages/shared/src/health/observed-hr.ts:45-47 | 5 readings, 60 samples | When an observed max or peak is trusted | MODEL | Statistics gate. |
| Resting HR cue | packages/shared/src/health/resting-hr-cue.ts:37-40 | Δ ≤ −2 / ≤ +2 / ≤ +5 / > +5 bpm vs usual | Colour of the "vs usual" RHR chip | LEARNED | **GAP.** These are absolute bpm, but day-to-day RHR SD ranges from about 1 to 4 bpm between people. It should be σ of the person's own RHR, as readiness already does. |
| HR recovery | `ADEQUATE_HRR1_BPM` packages/shared/src/workout/hr-analysis.ts:85 | 15 bpm in 60 s | "Adequate rest" between sets | GUARDED | The clinical abnormal cutoff is about 12 bpm (Cole 1999). Between sets, HRR depends on fitness, age and the HR being recovered from. It should be a personal median clamped at ≥12. |
| HR recovery | `PEAK_BANDS`, `LOW_SIGNAL_MAX_BPM` packages/shared/src/health/hr-recovery-profile.ts:50-61 | <90, 90–104, 105–119, 120–149, 150+ bpm; low signal <105 | Buckets recovery episodes by starting HR | LEARNED | **GAP.** These are absolute bpm. For someone with HRmax 160 the band 150+ means near-max, and for someone with HRmax 200 it means moderate. It should use %HRR bands. |
| HRV | `rmssd.ts` `MIN_BEATS`, `ARTIFACT_RATIO` packages/shared/src/health/rmssd.ts:6-7 | 30 beats, 20% | Valid rMSSD window | MODEL | Signal-quality gate. |
| Plausibility | `HR_PLAUSIBLE_*`, `PLAUSIBLE_*_BPM`, `IBI_LO/HI`, `SPO2_MIN/MAX`, `PLAUSIBLE_BODY_FAT_PCT` (night-vitals.ts:34, observed-hr.ts:41, tachogram.ts:11, spo2-variability.ts:25, body-composition.ts:86) | 30/35–150/220 bpm, IBI 300–2000 ms, SpO2 70–100, BF 4–60% | Rejects impossible readings | CONSTANT | Physiological limits. |
| VO2max | `deriveVo2Max` packages/shared/src/health/vo2max.ts:41,49 + `PA_R_BY_ACTIVITY` :13 | Uth 15.3 × HRmax/RHR; Jackson non-exercise regression; clamp 10–100 | VO2max estimate | CONSTANT | Published regressions. The inputs are personal. |
| HRV frequency | `LF_LO..HF_HI`, `LFHF_MAX` packages/shared/src/health/hrv-frequency.ts:19-21 | 0.04–0.15 / 0.15–0.40 Hz, clip 20 | LF/HF for staging | CONSTANT | Task Force 1996 bands. |

## Activity, including training load

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| Activity score | `W_STEPS`…`W_STRENGTH_VOL` packages/shared/src/health/activity-score.ts:20-25 | steps 18, active energy 15, zone min 10, move hours 12, strength frequency 25, strength volume 20 | Component weights | MODEL | Central. component-references suggests demoting active energy because it double-counts movement. |
| Activity score | `STRENGTH_FREQ_CURVE` activity-score.ts:69 | ratio 0.34→50, 0.67→80, 1.0→100 | Sessions ÷ goal → sub-score | MODEL | The curve shape is central. The goal it divides by is the gap (next rows). |
| Activity score | `ACWR_TAPER_START` (= highMax) / `ACWR_TAPER_SPAN` / `MAX_TAPER` activity-score.ts:29-31 | starts at ACWR 1.5, ramps over 0.5, at most −15% | Over-exertion taper | MODEL | The span and depth are central. The start inherits ACWR_THRESHOLDS, which is GUARDED (below). |
| Goals | `DEFAULT_STEP_GOAL` packages/shared/src/health/daily-goals.ts:15 | 8,000 | Step goal when there is no profile level and no user goal | GUARDED | **GAP.** It is the same for everyone. Paluch 2022: the benefit plateaus at 6–8k for people 60 and over and 8–10k under 60. It should be age-anchored inside that range, and could move toward the person's own sustained level (for example their p60) within the range. |
| Goals | `STEP_GOAL_BY_ACTIVITY` packages/shared/src/nutrition/goal-recommendation.ts:37 | sedentary 7,000, light 8,500, moderate 10,000, active and extra active 12,000 | Derived step goal | GUARDED | **GAP.** It is keyed on the self-reported activity level and ignores age and measured history. 12,000 is above the mortality plateau for every age. |
| Goals | step-goal clamp goal-recommendation.ts:327-332 | 3,000–20,000 | Guard on a step goal suggested by AI | GUARDED | This is the guard range itself. Reasonable. |
| Goals | `DEFAULT_ACTIVE_ENERGY_GOAL` / `ACTIVE_ENERGY_BMR_FRACTION` daily-goals.ts:16-18 | 400 kcal fallback / 0.24 × BMR | Active-energy goal | GUARDED | Already personal (scales with BMR). The fallback of 400 is the same for everyone. |
| Goals | `DEFAULT_ZONE_MINUTES_GOAL` daily-goals.ts:20 | 22 min/day | Zone-minutes goal | CONSTANT | WHO 150 min/wk ÷ 7. It could become GUARDED, between 22 and 43 min (150–300), for someone whose goal is fitness. |
| Goals | `DEFAULT_STRENGTH_FREQ_GOAL` daily-goals.ts:42 | 5 sessions per rolling 7 days | Strength-frequency target, which also multiplies the volume target | GUARDED | **GAP (big).** It was set at the owner's measured 4.9/wk. A user on a 3-day program can never score above about 73 on the heaviest component (25 points), and their volume target is inflated too. It should come from the user's program sessions per week, with WHO's ≥2 as the floor. |
| Goals | `DEFAULT_SESSION_VOLUME_GOAL_KG` daily-goals.ts:61 | 5,200 kg per session (× 5 = 26,000/wk) | Strength-volume target (20 points) | GUARDED | **GAP (big).** This is the owner's own tonnage (8-week median 4,438, p75 6,782). A beginner, or a lighter lifter averaging 2,000 kg, scores about 40 for life. The code deliberately avoids a rolling own-median target, because a target that tracks what you lift moves every time you improve. The fix: anchor to the program's prescribed weekly tonnage, or a slow 90-day percentile clamped within a sane band, never the trailing median. |
| Goals | `moveHoursGoal` with `DEFAULT_WAKE_HOUR` 7 / `DEFAULT_SLEEP_HOUR` 22 packages/shared/src/health/hourly-movement.ts:21-22,79 | 15 waking hours | Move-hours goal (12 points) | LEARNED | **GAP.** The waking window is fixed at 07:00–22:00. The person's habitual wake and bed times already exist in the sleep-score schedule baseline. A late riser is penalised for hours they are asleep. |
| Movement | `MET_ACTIVE_THRESHOLD` packages/shared/src/health/daily-medians.ts:45 | 1.8 MET | Minute counts as active | CONSTANT | Light activity is ≥1.5 MET (Ainsworth). Population definition. |
| Zone minutes | `DEFAULT_MAX_GAP_SEC` zone-minutes.ts:16 and ×2 vigorous weighting zone-minutes.ts:105 | 120 s gap cap; vigorous ×2 | Integrating HR into minutes | MODEL / CONSTANT | The gap cap is a modelling choice. The ×2 weighting is the WHO rule. |
| ACWR | `ACWR_THRESHOLDS` packages/shared/src/ai-periodization/acwr.ts:106 | lowMax 0.8, optimalMax 1.3, elevatedMin 1.2, highMax 1.5 | ACWR band and label, emergency deload, activity taper, early-deload card, running gate | GUARDED | Gabbett's 0.8–1.3 / >1.5 are population ranges. Individual tolerance varies with training age. These could be personal within 0.8–1.5, for example by widening optimalMax for someone who has repeatedly tolerated 1.4 without readiness falling. |
| ACWR | `ACWR_BASELINE_DAYS`; `minSpanDays` / `minSessions` / `minChronicWeeklyLoadKg` acwr.ts:59 and acwr.ts:19 | 28 d; 21 d / 6 sessions / 100 kg | When ACWR is trusted | MODEL | Maturity gates. The acute 7-day and chronic 28-day windows are the standard definition. |
| Readiness (legacy) | ACWR modifier lib/health/readiness-payload.ts:287-290 | +3 inside 0.8–1.3; −6 per 0.2 above 1.3; −15 above 1.5; **−5 below 0.6** | Legacy blended score | MODEL | `0.6` is a fourth ACWR boundary hard-coded outside `ACWR_THRESHOLDS` (the Q-306 pattern). |
| Readiness (legacy) | load points readiness-payload.ts:533-536 | 10 inside the band, falling linearly outside it | Legacy custom score load component | MODEL | Fallback. |
| Training stress | OTS gate packages/shared/src/health/training-stress.ts:81-87; high threshold ×0.9 when readiness < 60 lib/oura-models/inference/ots.ts:166 | ≥720 min of MET grid, ≥360 valid minutes; vendor `highOtsThreshold` | Whether OTS is computed and when it reads "high" | MODEL | Vendor model port. |
| Energy | `SEDENTARY_MULTIPLIER` packages/shared/src/health/energy-baseline.ts:31 | 1.2 × BMR | Resting budget base on the formula path | GUARDED | A population NEAT factor. It is already superseded by the calibrated maintenance from adaptive TDEE once there is enough data, which is effectively LEARNED. |
| Energy | `STEP_BASE_CREDIT` energy-baseline.ts:61 | 3,000 steps credited out of the base | Steps counted from zero | MODEL | Accounting identity. The kcal value is already computed per person. |
| Energy | `WALKING_CADENCE_SPM` energy-baseline.ts:65 | 100 spm | Steps → walking minutes | CONSTANT | Tudor-Locke moderate-walking cadence. |
| Energy | `STEPS_PER_KM` energy-baseline.ts:69 | 1,300 (0.77 m stride) | Removes logged walk/run steps from the passive total | LEARNED | **GAP (minor).** Stride length scales with height and pace. It could be derived from height (about 0.41–0.45 × height) or from GPS walks. |
| Energy | `KJ_PER_KCAL`, MET tables packages/shared/src/health/workout-energy.ts:48-175, daily-energy.ts:30-42 | 4.184; MET by activity | Workout kcal | CONSTANT | Unit conversion and the compendium. |
| Running | `ZONE_WEIGHTS` packages/shared/src/running/zone-targets.ts:15; `GUIDELINE_MIN` :56 | e.g. polarized [.15,.65,.05,.10,.05]; 150 min/wk | Weekly per-zone minutes; guideline met | MODEL / CONSTANT | Training methodology. 150 is WHO. |
| Running | `WEEKLY_GROWTH`, `LONG_RUN_FRACTION`, `QUALITY_AFTER_EASY`, `MAX_HARD_PER_WEEK`, `DENSITY_GROWTH` packages/shared/src/running/frameworks/*.ts | 1.03–1.10/wk; 0.26–0.35; 4; 2; 1.03 | Run plan progression | MODEL | The 10% rule and framework definitions. Growth rate could become GUARDED (injury-prone or older runners at 5%). |
| Walking | `ZONE2_GAP_MET_MIN` / `ZONE2_GAP_LARGE_MIN` packages/shared/src/walking/recommend-walk-pattern.ts:51-53 | 15 / 45 min | Which walk pattern to recommend | MODEL | Decision thresholds on a personal quota. |
| Walking | `DEFAULT_CADENCE_TARGETS` lib/walk/walk-pacer.ts:66; `BAND_TOLERANCE` :42 | fast 120 / slow 95 spm; ±10% | Pacing cues on a guided walk | LEARNED | Fallback until `MIN_SEGMENTS_FOR_SPEED_TARGET` (3) of the person's own segments exist. Cadence at a given intensity depends on leg length. |
| Detection | `MIN_DISTANCE_M`, `MIN_AVG_SPEED_KMH`, `MIN_DURATION_SEC` lib/activity/detection-thresholds.ts:12-15 | 750 m, 2.5 km/h, 7 min | Auto-detecting a walk or run | MODEL | Detection gate. |

## Body: nutrition, weight, stress, temperature, illness

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| BMR | `mifflinStJeorBmr`, `SEX_OFFSET` packages/shared/src/nutrition/goal-recommendation.ts:182,89 | 10W + 6.25H − 5A + {+5, −161, −78} | BMR | CONSTANT | Published equation. A measured lean mass (Katch-McArdle) is already preferred when present. |
| Energy | `KCAL_PER_KG` packages/shared/src/nutrition/tdee-adaptation.ts:12 and `KCAL_PER_KG_LOCAL` packages/shared/src/nutrition/calorie-balance.ts:103 | 7,700 | Weight change ↔ energy | CONSTANT | **Defined twice**, which breaks the "one formula, one place" rule. |
| Macros | `KCAL_PER_G` packages/shared/src/nutrition/atwater.ts:15 | 4 / 4 / 9 | Macro kcal | CONSTANT | Atwater factors. |
| Calories | `CALORIE_ADJUSTMENT_BY_GOAL` goal-recommendation.ts:47 | lose −500, maintain 0, build +300, recomp −200 kcal | Calorie target offset | GUARDED | **GAP.** These are absolute kcal. A −500 deficit is 33% of a 1,500 kcal TDEE but 15% of 3,300. It should be a % of TDEE or a %-bodyweight-per-week rate, clamped. |
| Calories | `GOAL_RATE_KG_PER_WEEK` tdee-adaptation.ts:5 | −0.45 / 0 / +0.27 / −0.18 kg/wk | Target rate for adaptive calorie adjustment | GUARDED | **GAP.** These are absolute kg. Evidence-based loss is about 0.5–1% of bodyweight per week, which is 0.25 kg/wk for a 50 kg person and 0.6 kg/wk for 120 kg. |
| Calories | `DEADBAND_KG_PER_WEEK` / `MAX_ADJUST_KCAL` tdee-adaptation.ts:13-14 | 0.1 kg/wk / 200 kcal, rounded to 50 | When and how far adaptation moves the target | MODEL | Controller tuning. |
| Calories | calorie floor packages/shared/src/nutrition/calorie-balance.ts:273 and goal-recommendation.ts:280; ceiling goal-recommendation.ts:281 | max(1,200, BMR); 1.2 × baseline | Bounds on a recommended calorie target | GUARDED | 1,200 is the conventional female floor (about 1,500 for men). The floor is **written twice**. |
| Calories | `ON_TARGET_KCAL` / `OUTER_KCAL` calorie-balance.ts:35-36 | ±150 / ±400 kcal | "On target / under / well under" band | GUARDED | **GAP.** These are absolute kcal. ±150 is 10% of a 1,500 budget and 5% of 3,000. It should be a % of the budget. |
| Protein | `PROTEIN_G_PER_KG_BY_GOAL` goal-recommendation.ts:85; bounds :291-292 | 1.8 / 1.6 / 2.0 / 2.2 g/kg; clamp 1.0–2.5 | Protein target | GUARDED | Already per kg and inside the research range (Morton 2018, 1.6–2.2). **Gap (minor):** it uses total bodyweight even when lean mass is known, which overshoots for high body-fat users. |
| Protein | `PROTEIN_G_PER_KG_PER_MEAL` packages/shared/src/nutrition/meal-split.ts:41 | 0.4 g/kg/meal | Per-meal protein | CONSTANT | Schoenfeld & Aragon 2018. |
| Fat | `FAT_TARGET_CALORIE_FRACTION` / `FAT_MAX_…` / `FAT_G_PER_KG_FLOOR` goal-recommendation.ts:66-68 | 25% / 40% / 0.6 g/kg | Fat target | GUARDED | Personal (scales with calories and weight) inside a research range. |
| Carbs | `REST_DAY_CARB_REDUCTION` packages/shared/src/nutrition/rest-day-macros.ts:12 | −15% | Rest-day carbs | MODEL | Heuristic. |
| Hydration | water `weightKg × 33` + `WATER_BUMP_BY_ACTIVITY` goal-recommendation.ts:246,41; clamp :318-323; `DEFAULT_WATER_GOAL_ML` :35 | 33 ml/kg + 0–600; 1,500–6,000; fallback 2,500 | Water goal | GUARDED | Already per kg with a guard. The 2,500 fallback is the same for everyone. |
| Check-in prefill | `HYDRATION_ANCHOR_ML`, `STEPS_ANCHOR`, `LATE_MEAL_ANCHOR_MIN` packages/shared/src/nutrition/day-checkin-prefill.ts:14-16 | 2,500 ml, 12,000 steps, 300 min | Starting position of 1–5 evening sliders | MODEL | Deliberately kept as population anchors (PS-37). Note that 12,000 does not match the step goal, so "barely moved" can read 2 on a day the goal was met. |
| Adaptive TDEE | `DEFAULT_WINDOW_DAYS` … `MAX_MEASURED_MOVEMENT_RATIO` packages/shared/src/nutrition/adaptive-tdee.ts:23-72 | 14–28 d, ≥10 logged days, ≥4 weigh-ins, ≥70% logged, 1,000–6,000 plausible, 1.15 | When measured maintenance replaces the formula | MODEL | Data-sufficiency gates. The output is LEARNED. |
| Weight goal | `MIN/MAX_HEALTHY_RATE_KG_PER_WEEK` packages/shared/src/health/long-term-goal-progress.ts:108-109 | 0.25–1.0 kg/wk | "On track / too fast / too slow" | GUARDED | **GAP.** These are absolute. 1 kg/wk is 2% of bodyweight per week for a 50 kg person, which is too aggressive. It should be % of bodyweight. |
| Daytime stress | `STRESS_HIGH_LEVEL` / `RECOVERY_HIGH_LEVEL` packages/shared/src/health/daytime-stress-thresholds.ts:10-11 | −0.5 / +0.5 scaled level | High-stress and high-recovery buckets | MODEL | Already relative to personal saturation (vendor scaling). |
| Daytime stress | `STRESS_HIGH_DAY_THRESHOLD_MIN` daytime-stress-thresholds.ts:15 | 120 min/day | Stress-deload trigger (currently **unwired**, TN-34) | LEARNED | **GAP.** It fired on 83% of the owner's days. The code itself says to re-wire it "against this user's own distribution (a percentile, not a constant)". |
| Daytime stress | `neutralZoneHalfWidth`, saturation defaults lib/health/daytime-stress.ts:124,135-136 | 2/3/4 by night-HRV <40/<75; 35/46 | Stress intensity scaling | MODEL | Vendor model port (`stress_daytime_sensing_1_1_0`). Already keyed to the person's HRV baseline. |
| Resilience | band tables lib/health/stress-resilience.ts:228-260; plane fit `C_()` | sleep, stress and recovery 1–9 banding; vendor coefficients | Resilience level 1–5 | MODEL | Vendor port pinned to a golden vector. |
| Chronic stress | `CHRONIC_STRESS_WINDOW` / `_MIN_DAYS` / `TEMP_DEV_FEVER_LIMIT_C` packages/shared/src/health/chronic-stress-assembly.ts:21-30 | 31 / 21 d / 1.0 °C | Chronic-stress model input and fever exclusion | MODEL | Window and gate. The °C limit is absolute (see the temperature rows). |
| Illness | `ILLNESS_WEIGHTS`, `ILLNESS_Z_FULL`, `FEVER_TEMP_Z`, `ILLNESS_WATCH_SCORE`, `ILLNESS_ELEVATED_SCORE`, `READINESS_SUPPRESSION` packages/shared/src/health/illness-radar.ts:25-47 | temp .40 / breathing .25 / RHR .20 / HRV .15; full at 3σ; fever z ≥ 2.5; watch 40, elevated 65; −10 / −25 readiness | Illness flag and readiness penalty | MODEL | Already personal (z vs own baseline). The cutoffs are statistics choices. |
| Temperature | `TEMP_ALERT_THRESHOLD_C` / `TEMP_BASELINE_MIN_DAYS` packages/shared/src/ai-periodization/deload-constants.ts:70-75 | +0.5 °C / 30 days | Temperature deload alert | LEARNED | **GAP.** This is absolute °C. Nightly skin-temperature SD ranges from about 0.1 to 0.4 °C between people, so 0.5 °C is 1.2σ for one person and 5σ for another. It should be a z-score, as the illness radar already does. |
| Temperature | ladder in `computeBlendedScore` lib/health/readiness-payload.ts:302-309 | \|dev\| > 0.3 → −10, > 0.5 → −20, > 1.0 → cap at 40 | Legacy blended readiness | LEARNED | **GAP.** Absolute °C, same problem as above. |
| Temperature | `TEMP_CENTRED_MAX_ABS_MEAN_C` / `TEMP_CENTRED_MIN_NIGHTS` packages/shared/src/health/temperature-baseline-health.ts:24-31; `RANGE_THRESHOLD`, `MIN_WINDOWS` temperature-baseline.ts:16-17 | 0.15 °C / 10 nights; 2.5 °C / 4 windows | Whether the temperature baseline is trusted | MODEL | Health checks on the baseline itself. |
| Temperature | `SKIN_MIN_C` packages/shared/src/health/intraday-temp.ts:6 | 31 °C | Off-wrist rejection | CONSTANT | Physical limit. |
| SpO2 | `SPO2_COEFFS` lib/oura-ble/spo2.ts:16; `spo2_trend < 0.97` packages/shared/src/ai-periodization/prompt.ts:170 | R→SpO2 calibration; 3% relative drop | SpO2 value; rest-day hint | MODEL | Device calibration, and the trend is already self-relative. No absolute "SpO2 < 95%" rule exists in the code. |

## Readiness

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| Readiness | `READINESS_WEIGHTS` packages/shared/src/health/readiness-composite.ts:27 | RHR .167, previous night .178, HRV .167, temperature .111, sleep balance .111, previous-day activity .100, recovery index .100, activity balance .067 | Component weights | MODEL | Central. |
| Readiness | `BASELINE_MIN_NIGHTS` readiness-composite.ts:15 | 14 | When z-score components score | MODEL | Maturity gate. |
| Readiness | `Z_POINTS_PER_UNIT` readiness-composite.ts:117 | 33.3 points per σ (100 at +1.5σ) | z → points | MODEL | The z is already personal (own σ). The slope is a central calibration. |
| Readiness | `TAIL_BAND_POINTS` readiness-composite.ts:144 | 20 | Compressive tail width | MODEL | Statistics (TN-60). |
| Readiness | temperature closer-is-better readiness-composite.ts:183 | 100 − \|z\| × 66.7 | Temperature component | MODEL | Already personal z. |
| Readiness | `NEUTRAL` / `AWAITING_BASELINE` readiness-composite.ts:108-111 | 50 | Missing or immature input | MODEL | Gap in missing-data policy (#2067), not personalisation. |
| Readiness | `RECOVERY_INDEX_OPTIMAL_HOURS` readiness-composite.ts:224 | 5 h → 100, linear from 0 | Recovery-index component | LEARNED | **GAP.** Fitted to 15 of the owner's Cloud-era nights. A BLE refit lands at 3.31 h (#2260). No published norm exists, and it depends on sleep length and bedtime. It should be the person's own percentile. |
| Readiness | sleep balance via `baselineZ(sleepBaseline, …)` lib/health/readiness-payload.ts:619 | z of recent sleep vs own baseline | Sleep-balance component | GUARDED | Already personal, but it should measure debt against max(7 h, own norm). As written, a habitual 6 h sleeper is told they are "in balance" (component-references). |
| Readiness | personal-baseline EMA gains packages/shared/src/health/personal-baseline.ts:35-50 | shift 1 / 3 / 5 by age < 4 / 4–14 / > 14 days | How fast baselines adapt | MODEL | Vendor-style fixed-point EMA. |
| Readiness | `EARLY_DELOAD_SCORE_MAX` + `ACWR_THRESHOLDS.elevatedMin` lib/health/readiness-payload.ts:51-52 | readiness < 45 and ACWR ≥ 1.2 | Early-deload card | MODEL | Pairing rule. The readiness input is already personal. |
| Readiness (legacy) | custom score lib/health/readiness-payload.ts:407-433 | sleep 40, HRV 30 × recent/baseline, RHR 20 × baseline/recent, load 10; baseline needs ≥5 rows | Fallback score when the composite cannot run | MODEL | Fallback, and already ratio-to-self. |
| Bands | `scoreBand` packages/shared/src/health/score-band.ts:24-25 | High ≥ 70, Moderate ≥ 50 | Label and colour for every 0–100 score | MODEL | A display convention. Its meaning depends on each score's curves being right, so per-person drift shows up in the curves rather than here. |
| Rest-day guidance | packages/shared/src/health/rest-day-guidance.ts:29-57 | readiness ≥ 75 → active recovery, < 60 → full rest; sleep < 42; ≥3 rest days | Rest-day suggestion text | MODEL | Applies to an already-personal score. |

## Body Battery

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| Battery | `CHARGE_RATE` / `DRAIN_RATE` lib/health/body-battery-day.ts:78-79 | 0.120 points/min at rest; 0.080 points/min per unit of HRR above the threshold | Up and down slope of the battery | LEARNED | **GAP.** These were fitted (TN-55) so that the owner's typical day nets about 0 over 66 replayed days. A person who sits more or less, or has a different reserve, will trend to the floor or the ceiling. The *gain* can stay central (MODEL). The charge/drain *ratio* should be fitted per person to that balance condition. |
| Battery | `STRESS_DRAIN_RATE` body-battery-day.ts:89 | 0.020 points/min at full stress | Extra drain from daytime stress | MODEL | Deliberately de-weighted because the input is untrusted (TN-33). It is not a per-person value. |
| Battery | `REST_THRESHOLD = HR_REST_THRESHOLD` body-battery-day.ts:~65 | 0.05 HRR | Charge or drain boundary | LEARNED | **GAP.** See the Heart section. This is the TN-2 open question. |
| Battery | `GAP_HOLD_MIN` / `SAMPLE_CAP_MIN` body-battery-day.ts:80-81 | 30 / 7 min | Gaps in ring wear | MODEL | Integration hygiene. |
| Battery | `labelFor` body-battery-day.ts:103-105 | Charged ≥ 75, Good ≥ 50, Low ≥ 25, otherwise Drained | Label | MODEL | Display. |
| Battery | default anchor lib/health/body-battery-anchor.ts:52 | 50 | Wake level when there is no readiness or sleep score | MODEL | Fallback. |
| Battery | `MIN_HR_RESERVE_BPM` / `MIN_PEAK_DAYS` / `HR_PEAK_WINDOW_DAYS` packages/shared/src/health/body-battery-inputs.ts:14-21 | 60 bpm / 14 d / 90 d | When observed HRmax replaces the age formula | MODEL | Gates on a LEARNED HRmax (max of the person's own daily peaks). |
| Battery | `MIN_SAMPLES_PER_WAKING_HOUR` / `MIN_WAKING_MINUTES_TO_JUDGE` body-battery-inputs.ts:81-91 | 8/h / 60 min | "Not measured" flag | MODEL | Data-sufficiency gate. |

## Workouts and prescription

| Area | Constant (file:line) | Value | What it decides | Category | Why |
|---|---|---|---|---|---|
| Muscle recovery | τ in packages/shared/src/ai-periodization/muscle-recovery.ts:41-46 | τ = clamp(24 h × volume ÷ own typical volume, 16, 48); cap 168 h; pct = 1 − e^(−t/τ) | Per-muscle "% recovered" | LEARNED | **GAP.** The volume ratio is already self-relative, but the 24 h base and the 16–48 h clamp are the same for everyone. Recovery speed varies with training age, age and muscle group. `soreness-volume.ts` already pairs volume with next-day soreness, so τ could be fitted per person (GUARDED within 12–72 h). |
| Muscle recovery | `recoveryBand` packages/shared/src/health/recovery-band.ts:4-5 | recovered ≥ 80, partial ≥ 50 | Label and colour | MODEL | Display. |
| Soreness | `SORENESS_EXPECTED_WITHIN_HOURS` / `RECOVERED_PCT` packages/shared/src/checkin/suggested-soreness.ts:11-16 | 48 h / 85% | Which muscles are pre-suggested as sore | MODEL | It inherits the τ gap above. |
| Expected RPE | `repFactor` packages/shared/src/1rm.ts:18-21 (used by expected-rpe.ts) | mean of Epley (1 + r/30) and Brzycki (36/(37 − r)) | Reps at %1RM → expected RPE, and RPE → %1RM | LEARNED | **GAP.** Reps-to-failure at a given %1RM varies a lot between people (fibre type) and between lifts (squat vs leg press). `perExerciseRpeDelta` already measures the personal offset. A per-exercise personal curve, guarded by the formula, would stop autoregulation firing on someone whose normal is simply different. |
| Expected RPE | `EXPECTED_RPE_MIN` / `MAX`, null → 7 packages/shared/src/ai-periodization/expected-rpe.ts:35-58 | 5 / 10 / 7 | Clamp and default | MODEL | Bounds. |
| Autoregulation | `RPE_DEAD_BAND`, `BACKOFF_MIN/MAX_PCT`, `COMPLETION_FLOOR/CEIL`, `PCT_HARD_FLOOR` packages/shared/src/ai-periodization/autoregulation.ts:19-24 | ±1.5 RPE; 5–10% cut; 0.7 / 0.95; 40% | Load back-off and progression | MODEL | Controller tuning. The dead band could become LEARNED from the noise in the person's own RPE reports. |
| Emergency deload | packages/shared/src/ai-periodization/emergency-deload.ts:33-37 | ≥4 consecutive days of the same session type; < 36 h and ≥3 sore muscles; ACWR > 1.5; RPE trend > +2.0; rep completion < 0.7 | Forces the 2-set / 50% deload branch | MODEL | Rule set. The ACWR term inherits GUARDED. |
| Deload strength | `computeDeloadStrength` packages/shared/src/ai-periodization/ai-dynamic.ts:277-284 | ≥3 consecutive training days → deload suggested; readiness ≥ 70 soft, ≥ 50 recommended, else strong; missing readiness → 70 | Deload recommendation | GUARDED | **GAP.** "3 consecutive training days" is absolute. On a 5–6 day program that is a normal week, and it nags every week. It should be relative to the program's planned frequency. |
| Session picker | ai-dynamic.ts:119-125,166,313-317 | readiness < 60 or sleep trend < 0.85 → weights .55/.25/.20, otherwise .40/.35/.25; sore cap 40%, ×0.75; main 1.0 / aux 0.5; freshness = hours/48 | Which session to suggest | MODEL | Heuristic weights over already-personal inputs. |
| Session picker | `hrvTrend < 0.85` ai-dynamic.ts:~370 | 15% below the recent ratio | HRV warning | MODEL | Already self-relative. A σ version would be better for people with very variable HRV. |
| LLM rules | rest-day rule packages/shared/src/ai-periodization/prompt.ts:168-171 | sleep trend < 0.75 and HRV trend < 0.75; external readiness < 40; SpO2 trend < 0.97; temp z ≥ 2.5 | When the LLM may recommend a rest day | MODEL | Rules over self-relative trends. These are prompt text, so no deterministic test pins them. |
| LLM rules | phase floors prompt.ts:131-134 and `FLOORS` packages/shared/src/ai-periodization/transition-rationale.ts:21 | accumulation → intensification after ≥4 sessions with RPE Δ ≤ +0.3, etc. | Phase transitions | MODEL | Methodology. |
| Deload prescription | `DELOAD_LOWER_PCT`, `DELOAD_REPS`, `DELOAD_SETS`, `DELOAD_REST` packages/shared/src/ai-periodization/deload-constants.ts:4-23 | 40–55% by goal; 4–15 reps; 2 sets; 120 s | What a deload session looks like | MODEL | Methodology. |
| Volume | `MUSCLE_LANDMARKS` / `DEFAULT_LANDMARKS` packages/shared/src/ai-periodization/volume-targets.ts:17-41 | e.g. chest MEV 8 / MAV 16 / MRV 22 sets/wk | Weekly set targets per muscle | GUARDED | **GAP.** Israetel's landmarks are explicitly individual. MRV in particular varies about 2× between people. The target should be learned from the soreness and performance response, clamped inside the published ranges. |
| Volume | `GOAL_MULTIPLIER`, `PHASE_VOLUME_MULTIPLIER` volume-targets.ts:46-69 | strength 0.65 … hypertrophy 1.0; deload 0.5 | Volume scaling | MODEL | Methodology. |
| Load ranges | `COMPOUND`, `SECONDARY`, `ACCESSORY_SPEC` packages/shared/src/ai-periodization/goal-ranges.ts:18-79 | strength 70–92.5% at 1–8 reps; accessory RPE 7.5–8.5 | Prescribed %1RM, reps, RPE | MODEL | Methodology (it inherits the `repFactor` gap). |
| Phase guards | `ACCUMULATION_CEILING` 6, `INTENSIFICATION_CEILING` 5, `REALISATION_CEILING` 2, `DELOAD_FLOOR` 2 packages/shared/src/ai-periodization/phase-guards.ts:29-99 | sessions | Phase length bounds | MODEL | Methodology. |
| Confidence | `LOW_CONFIDENCE_THRESHOLD` / `COLD_START_CONFIDENCE_BASE` packages/shared/src/ai-periodization/confidence.ts:3,34 | 0.4 / 0.3 | Low-confidence banner | MODEL | Meta. |
| Running gate | `READINESS_REST` / `READINESS_SOFTEN` packages/shared/src/running/recovery-gate.ts:27-28 | < 50 rest, < 65 soften | Gate on a run prescription | MODEL | Applies to an already-personal score. |
| Running gate | `HEAVY_LEG_VOLUME_KG` / `LEG_INTERFERENCE_HOURS` recovery-gate.ts:25-26 | 3,000 kg / 24 h | Downgrades a hard run after heavy legs | LEARNED | **GAP.** This is absolute tonnage. It never triggers for a light lifter and always triggers for a heavy one. It should be relative to the person's own leg-session median (for example > p60). |
| Running gate | `SHORT_SLEEP_HOURS` recovery-gate.ts:29 | 5.5 h | Softens the run | GUARDED | It could become max(5.5, own norm − 1.5 h). Low priority. |
| Running gate | `HIGH_MONOTONY` / `HARD_RUN_SPACING_HOURS` recovery-gate.ts:34-36 | 2.0 / 24 h | Softens or blocks a hard run | CONSTANT | Foster 1998 monotony, and 80/20 spacing. |
| Duration model | `SECONDS_PER_REP`, `SET_SETUP_SEC`, `WARMUP_FRACTION`, `TRANSITION_SEC_*` packages/shared/src/workout/duration-model.ts:13-221 | 4 s, 10 s, 15%, 240/120/60 s | Session time budget | LEARNED | Already learned from measured per-exercise times once there are `MIN_TRUSTED_SAMPLES` (5) / `WARMUP_LEARN_MIN_SESSIONS` (8) samples. These are fallbacks. |
| Plateau | `PLATEAU_MIN_POINTS`, `PLATEAU_MIN_SPAN_DAYS`, `PLATEAU_PCT_PER_WEEK` packages/shared/src/health/strength-projection.ts:27-29 | 4 points, 21 d, 0.2%/wk | 1RM plateau flag | MODEL | Statistics. The expected rate of progress depends on training age, so this could become GUARDED later. |
| Bodyweight | `BODYWEIGHT_LOAD_DEFAULT` packages/shared/src/workout/bodyweight-load.ts:76 | 0.65 × BW | Bodyweight exercise tonnage | CONSTANT | Biomechanical fraction. |
| UI gate | `ouraReadiness < 70` app/session-select/components/deload-explanation.tsx:31 | 70 | Deload explanation copy | MODEL | **Note:** a threshold living in a component (logic in the surface), and 70 here does not match the < 60 / < 50 used elsewhere. |

---

## Counts per category

| Category | Rows |
|---|---|
| LEARNED | 21 |
| GUARDED | 25 |
| CONSTANT | 20 |
| MODEL | 75 |
| **Total** | **141** |

Rows that name two categories ("MODEL / CONSTANT") are counted under the first.

**30 of the 46 LEARNED and GUARDED rows carry a GAP** (18 LEARNED, 12 GUARDED): a value fixed
today that should vary per person. Two MODEL rows also flag a personal-spread gap: the sleep HRV and
HR ratio slopes. The others are already personal (HRmax, the sleep habit baseline, adaptive TDEE, the
duration model) or are guard ranges working as intended.

## Top gaps: a fixed number that is clearly wrong for some people

1. **Strength volume target, 5,200 kg per session** (`daily-goals.ts:61`, 20 of 100 Activity
   points). This is the owner's own tonnage. A beginner or a lighter lifter is capped at about 40
   on this component for life. It should be anchored to the program's prescribed weekly tonnage,
   or a slow 90-day percentile clamped within a sane band, never the trailing median.
2. **Strength frequency goal, 5 per week** (`daily-goals.ts:42`, 25 points, and it multiplies the
   volume target). This is the owner's 4.9/wk. On a 3-day program the score caps near 73 and the
   volume target is inflated by 5/3. It should come from the program's sessions per week, with ≥2
   as the floor.
3. **Step goal, 8,000 by default, or 7,000–12,000 from self-reported activity level**
   (`daily-goals.ts:15`, `goal-recommendation.ts:37`). It is identical for a 25-year-old and a
   70-year-old. Paluch's plateau is 6–8k at 60+ and 8–10k under 60, and 12,000 exceeds it for
   every age. It should be GUARDED by age, nudged toward the person's sustained level.
4. **Rest/charge threshold, 0.05 HRR** (`hr-zones.ts:23`). It drives Body Battery charging and the
   Activity score's move hours. Awake seated HR sits at a person-specific fraction of reserve, so
   some people never charge and others always "move". It should be a percentile of the person's
   own waking seated HR (TN-2).
5. **Body Battery charge/drain rates** (`body-battery-day.ts:78-79`). They were fitted so the
   owner's typical day nets about 0. For anyone else the battery drifts to the floor or the
   ceiling. Fit the ratio per person to that balance condition and keep the gain central.
6. **Sleep `SCORE_CALIBRATION`** (`sleep-score.ts:156`). The stretch curve was fitted to the
   owner's nights, so another person's bands land in the wrong place. It needs a per-person or
   multi-user fit.
7. **Deep and REM absolute targets** (`sleep-score.ts:66-67`, 20 of 110 points). Deep sleep falls
   with age, so a 2 h target is out of reach for most people over 50. There is no consensus on
   REM. Both should score against the person's own baseline.
8. **Fixed circadian anchors** (`IDEAL_MIDPOINT_HOUR = 3` at `sleep-score.ts:161`; night band
   21:00–10:00 at `sleep-night.ts:35-37`; move-hours window 07:00–22:00 at
   `hourly-movement.ts:21-22`). These penalise early and late chronotypes and exclude shift workers
   outright. All three should use the person's habitual window, which the schedule baseline
   already computes.
9. **Recovery-index anchor, 5 h** (`readiness-composite.ts:224`). It was fitted to 15 of the
   owner's Cloud-era nights, and a BLE refit gives 3.31 h. It should be a personal percentile.
10. **Absolute temperature cutoffs** (`TEMP_ALERT_THRESHOLD_C = 0.5` at `deload-constants.ts:75`;
    the 0.3/0.5/1.0 °C ladder at `readiness-payload.ts:302-309`). Nightly temperature SD differs
    about 4× between people. They should be z-scores, as the illness radar already uses.
11. **Absolute energy and weight-rate numbers**: −500 / +300 kcal (`goal-recommendation.ts:47`),
    −0.45 kg/wk (`tdee-adaptation.ts:5`), the 0.25–1.0 kg/wk healthy band
    (`long-term-goal-progress.ts:108`), and the ±150/400 kcal on-target band
    (`calorie-balance.ts:35`). They should be % of TDEE or % of bodyweight, GUARDED.
12. **Other absolute-unit gates that should be self-relative**: `HEAVY_LEG_VOLUME_KG = 3000`
    (`recovery-gate.ts:25`), HR-recovery `PEAK_BANDS` in bpm (`hr-recovery-profile.ts:50`), the
    resting-HR cue at ±2/±5 bpm (`resting-hr-cue.ts:37`), and the "≥3 consecutive training days"
    deload trigger (`ai-dynamic.ts:277`).
13. **Training-response physiology**: the muscle-recovery τ of 16–48 h (`muscle-recovery.ts:43`),
    the Epley/Brzycki reps-at-%1RM curve (`1rm.ts:18`), and MEV/MAV/MRV landmarks
    (`volume-targets.ts:17`). All are individual by the literature's own account, and the app
    already logs what is needed to fit them (soreness pairs, RPE deltas).

## Inconsistencies found along the way (not tuning, but worth issues)

- `KCAL_PER_KG` is defined twice: `tdee-adaptation.ts:12` and `calorie-balance.ts:103`
  (`KCAL_PER_KG_LOCAL`).
- The 1,200 kcal floor is written twice: `calorie-balance.ts:273` and `goal-recommendation.ts:280`.
- The resting-HR fallback of 60 is defined twice: `hr-profile.ts:48` and `fitness-snapshot.ts:18`.
- The main-sleep minimum is 4 h in `sleep-score.ts:210` but 3 h in `lib/sleep/primary-sleep.ts:5`.
- `readiness-payload.ts:290` has an ACWR `< 0.6` boundary outside `ACWR_THRESHOLDS`.
- The vigorous-minute floor is the zone 3 edge (70% HRR, `zone-minutes.ts:96`), while ACSM's
  vigorous starts at 60% HRR.
- `deload-explanation.tsx:31` holds a readiness `< 70` threshold in a UI component.
