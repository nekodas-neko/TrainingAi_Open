# Oura Cloud API v2: health fields mapped to our readiness model

_Research note written 2026-10-12 for [`scoring-layers-and-data-inputs.md`](../architecture/scoring-layers-and-data-inputs.md) §6 and §9. Read-only research: nothing was run on a device, and no production data was used._

Source: `.claude/skills/oura-api/references/openapi-v1.34.json` (OpenAPI 3.1.0, 75 schemas), parsed
with `python3 -I`. `SKILL.md` was read too, but only the spec is cited below. Where the two disagree,
the spec wins; the disagreements are listed in §5.

## 0. Read first

- **Status in this repo.** CLAUDE.md and `docs/rules/oura-ble.md` still say "the Oura Cloud
  integration is gone for good". Issue **#2808** (open, blocked by the owner's 10-11 pause) reverses
  that and moves the ring to the Cloud API. This document is input to #2808. Nothing here can feed a
  score until #2808 lands and the ring is re-paired with the Oura app.
- **The spec never maps a route to a scope.** Every operation lists `OAuth2: []`. Scope notes below
  come from the scope descriptions in `components.securitySchemes.OAuth2`. A † means the scope comes
  from `SKILL.md` only; the spec's scope text does not name that data.
- **The spec requires a membership for every data route.** Each route's 403 says: "Usually means
  the user's subscription to Oura has expired and their data is not available via the API."
- **The spec has no response examples.** So the `interval` of every `PublicSample` series (sleep HR,
  sleep HRV, session series, daily MET) is **not in spec**. Only a real call, or a sandbox call
  (`/v2/sandbox/usercollection/...`), can tell us. #2808 depends on this: it says training load
  survives only "if MET comes per minute".
- **Day boundaries.** `PublicDailyActivity` is "a 24-hour period starting at 4 a.m.". Our days start
  at local midnight. A sleep of `type: late_nap` ("ended after sleep day change (6 pm)") counts
  toward the next day's scores.
- **Sync.** Sleep, readiness and sleep time update only after the user opens the Oura app.
  Activity, stress and heart rate sync in the background (spec, "Data Model & Concepts").

Legend: **OC** = **Oura-computed: do not feed our scores** (show for comparison only).

## 1. Field table

| Endpoint (schema) | Field | Shape / resolution | Units | What it measures | Our metric | Score → pillar | Notes |
|---|---|---|---|---|---|---|---|
| `sleep` (`PublicModifiedSleepModel`) | `bedtime_start`, `bedtime_end`, `day`, `type` | one per sleep period; several per day | ISO 8601 local; `type` enum `deleted, sleep, long_sleep, late_nap, rest` | Time in bed and the kind of period | `sleep_window` | Sleep: timing (mid-sleep) 15 | Scope `daily` (its text covers sleep summaries). `long_sleep` is over 3 h. `rest` means the user rejected the detection; drop it. User-initiated sync only. |
| `sleep` | `time_in_bed` | per period | s | Time in bed | `sleep_window` | Sleep: efficiency 20 (denominator) | Required field. |
| `sleep` | `total_sleep_duration` | per period | s | Total sleep time | `sleep_stages_5min` (sum) | Sleep: duration 30, 7-night balance 15 | Nullable. |
| `sleep` | `deep_sleep_duration`, `rem_sleep_duration`, `light_sleep_duration`, `awake_time` | per period | s | Time in each stage | `sleep_stages_5min` (sums); awake → NEW: `waso_per_night` | Sleep: deep+REM share 10 | Oura's own stager (`sleep_algorithm_version` `v1`/`v2`). |
| `sleep` | `sleep_phase_5_min` | string, 1 char per 5 min | `1` deep, `2` light, `3` REM, `4` awake | Hypnogram | `sleep_stages_5min` | Sleep: deep+REM 10, timing 15, latency 10 | Fills the metric directly. |
| `sleep` | `sleep_phase_30_sec` | string, 1 char per 30 s | same codes | Finer hypnogram | NEW: `sleep_stages_30s` | Sleep: latency 10, deep+REM 10 | Finer than our metric. |
| `sleep` | `app_sleep_phase_5_min` | string, 5 min | same codes | Hypnogram as the app shows it | — | — | Spec: "will be removed in the future". Don't adopt. |
| `sleep` | `efficiency` | per period | integer [1, 100] (%) | Ratio of sleep to time in bed | (we compute it from TST / TIB) | Sleep: efficiency 20 | An Oura ratio, not a score. Recompute it from the two durations so every source uses one definition. |
| `sleep` | `latency` | per period | s | Time to fall asleep after going to bed | (derive it from `sleep_window` + stages) | Sleep: latency 10 | Usable directly. |
| `sleep` | `average_hrv` | per period | integer; **unit and method not in spec** | Mean HRV during sleep | `hrv_per_night` | Heart: overnight HRV 35 | SKILL.md's "ms rMSSD" is not in the spec. #2808 notes the definition differs from ours. |
| `sleep` | `hrv` (`PublicSample`: `interval`, `items[]`, `timestamp`) | series per period; interval **not in spec** | unit not in spec | Overnight HRV curve | NEW: `hrv_per_5min_night` | Heart: HRV 35 (we aggregate it our own way) | Items may be null. Lets us keep our own nightly aggregation. |
| `sleep` | `lowest_heart_rate` | per period | bpm (integer) | Lowest HR in the period | `rhr_per_night` | Heart: overnight resting HR 30 | Spec: computed from 30-s samples by "ecore", unlike the app's minimum of 5-min aggregates. |
| `sleep` | `average_heart_rate` | per period | bpm | Mean sleeping HR (from 30-s samples) | NEW: `hr_avg_per_night` | Heart (context) | Spec: differs from the app's value. |
| `sleep` | `heart_rate` (`PublicSample`) | series per period; interval **not in spec** | bpm | Overnight HR curve | `hr_per_5min` (overnight) | Heart: settling 15 (time from the lowest HR to `bedtime_end`); resting HR 30 | This is the input for settling. |
| `sleep` | `average_breath` | per period | breaths/min | Breathing rate in sleep | `breath_per_night` | Body: breathing rate 20 | One average only; no series. |
| `sleep` | `restless_periods` | per period | count | Restless episodes | NEW: `restless_per_night` | Proposed Sleep: restfulness | Raw count we can baseline. |
| `sleep` | `movement_30_sec` | string, 1 char per 30 s | `1` still, `2` restless, `3` tossing and turning, `4` active | Movement in bed | NEW: `movement_30s_night` | Proposed Sleep: restfulness | Raw enough to baseline. |
| `sleep` | `readiness.temperature_deviation`, `readiness.temperature_trend_deviation` | per period | °C | Temperature deviation on that sleep | `temp_dev_per_night` | Body: temperature 25 | Same values as `daily_readiness`, but per period. |
| `sleep` | `readiness.score`, `readiness.contributors.*`, `readiness_score_delta`, `sleep_score_delta` | per period | [1, 100] / integer | Oura's readiness and its score deltas | — | — | **OC**. |
| `sleep` | `low_battery_alert`, `sleep_algorithm_version`, `sleep_analysis_reason`, `period`, `ring_id` | per period | bool / enum / string | Data quality and provenance | — (provenance) | Gate: flag low-battery nights; keep baselines per algorithm version | `ring_id` is encrypted. |
| `daily_sleep` (`PublicDailySleep`) | `score`; `contributors.{deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep}` | one per day | [1, 100] | Oura's sleep score | — | — | **OC**. Scope `daily`. |
| `daily_readiness` (`PublicDailyReadiness`) | `temperature_deviation` | one per day | °C | Skin-temperature deviation (the spec doesn't say from what baseline) | `temp_dev_per_night` | Body: temperature deviation 25 | A measurement, not a score, but measured against **Oura's** baseline. The API has no absolute temperature. Scope `daily`. |
| `daily_readiness` | `temperature_trend_deviation` | one per day | °C | Multi-day temperature trend | NEW: `temp_trend_dev_per_night` | Body: temperature 25 (secondary) | Same caveat. |
| `daily_readiness` | `score`; `contributors.{activity_balance, body_temperature, hrv_balance, previous_day_activity, previous_night, recovery_index, resting_heart_rate, sleep_balance, sleep_regularity}` | one per day | [1, 100] | Oura's readiness | — | — | **OC**. |
| `daily_activity` (`PublicDailyActivity`) | `steps` | one per day (04:00–04:00) | count | Steps | `steps_per_day` | Activity: yesterday's steps 35 | The day boundary is 4 a.m., not midnight. Background sync. Scope `daily`. |
| `daily_activity` | `met` (`PublicSample`) | series per day; interval **not in spec** | MET | Rate of energy spend | `met_per_min` (only if `met.interval` = 60) | Activity: training load 30, WHO zone minutes 20 | Required field. #2808's cardio load depends on its interval. |
| `daily_activity` | `class_5_min` | string, 1 char per 5 min | `0` non-wear, `1` rest, `2` inactive, `3` low, `4` medium, `5` high | Activity class | NEW: `activity_class_5min`, NEW: `wear_min_per_day` | Activity: WHO zone minutes 20; wear gate for every pillar | The catalogue already needs wear time (scoring-layers doc §5). |
| `daily_activity` | `high_activity_time`, `medium_activity_time`, `low_activity_time`, `sedentary_time`, `resting_time`, `non_wear_time` | one per day | s | Time in each class | NEW: `zone_min_per_day`, `sedentary_min_per_day`, `wear_min_per_day` | Activity: WHO zone minutes 20 (medium = moderate, high = vigorous) | The MET thresholds for each class are not in spec. |
| `daily_activity` | `high_/medium_/low_activity_met_minutes`, `sedentary_met_minutes`, `average_met_minutes` | one per day | MET-min | Activity volume | NEW: `met_min_per_day` | Activity: training load 30 (cardio side) | Fallback if `met` isn't per minute. |
| `daily_activity` | `active_calories`, `total_calories` | one per day | kcal | Energy spent | NEW: `kcal_out_per_day` | Body: fuel 20 (spend side of the energy target) | `body_metrics.active_calories` already exists. |
| `daily_activity` | `equivalent_walking_distance`, `inactivity_alerts` | one per day | m / count | Spend shown as walking distance; Oura's sit-too-long alerts | — | — | Low value. The alerts follow Oura's logic. |
| `daily_activity` | `score`; `contributors.{meet_daily_targets, move_every_hour, recovery_time, stay_active, training_frequency, training_volume}`; `target_calories`, `target_meters`, `meters_to_target` | one per day | [1, 100]; kcal; m | Oura's activity score and goals | — | — | **OC**. The targets are Oura's goals. |
| `heartrate` (`PublicHeartRateRow`) | `bpm`, `timestamp` (UTC), `timestamp_unix` (ms), `source` | one row per sample; "provided at **5-minute increments**" (Heart Rate Routes tag) | bpm (integer); `source` enum `awake, workout, rest, sleep, live, session` | HR across the whole day | `hr_per_5min` (rows with `source=sleep`); NEW: `hr_awake_per_5min` | Heart: settling 15; daytime resting HR 10 (not built), from the lowest `rest`/`awake` rows; workout HR (rough) | Scope `heartrate` ("Time series heart rate for Gen 3 users"). Takes `start_datetime`, `end_datetime`, `latest`. Background sync. Does **not** fill `hr_per_min` or `hr_per_sec`. |
| `daily_spo2` (`PublicDailySpO2`) | `spo2_percentage.average` (`PublicSpo2AggregatedValues`) | one per day | % | Average SpO₂ in sleep | `spo2_per_night` | Body: SpO₂ 15 | Scope `spo2Daily`. Tag text: "only available for users with a Gen 3 Oura Ring". Calibrated, unlike ours. |
| `daily_spo2` | `breathing_disturbance_index` | one per day | integer [0, 100] | Breathing disturbances, from detected SpO₂ drops | NEW: `bdi_per_night` | Proposed Body: breathing / SpO₂ | An algorithmic index, but physiological, and we can baseline it. |
| `daily_stress` (`PublicDailyStress`) | `stress_high` | one per day | **s** | Time in the high-stress zone ("top quartile of data") | `stress_min_per_day` (÷ 60) | Body: daytime stress minutes 10 | Scope `daily`†. Oura sets the zone. Background sync. |
| `daily_stress` | `recovery_high` | one per day | **s** | Time in the high-recovery zone ("bottom quartile") | NEW: `recovery_min_per_day` | Proposed Body: daytime recovery | Spec: stress and recovery never overlap. |
| `daily_stress` | `day_summary` | one per day | enum `restored, normal, stressful` | Oura's label for the day | — | — | **OC**. |
| `daily_resilience` (`DailyResilienceModel`) | `level` (required); `contributors.{sleep_recovery, daytime_recovery, stress}` | one per day | enum `limited…exceptional`; [0, 100] | Oura's resilience | — | — | **OC**. Scope `daily`†. Doesn't support field selection. |
| `daily_cardiovascular_age` (`PublicDailyCardiovascularAge`) | `vascular_age` | one per day | years [18, 100] | Predicted vascular age | NEW: `vascular_age` (display only) | none (long-term, not readiness) | **OC** (a model estimate). Scope `daily`†. |
| `daily_cardiovascular_age` | `pulse_wave_velocity` | one per day | m/s | Spec: "derived from vascular age, with possible offset added" | — | — | **OC**. Not a separate measurement. |
| `vO2_max` (`PublicVO2Max`) | `vo2_max`, `day`, `timestamp` | one per estimate | integer; **unit not in spec** | VO₂max estimate | NEW: `vo2max_estimate` | Possible input to Activity: block trend 15 (trend only; a tuning decision) | **OC estimate**. Scope `daily`†. The ring-generation requirement is not in spec. |
| `workout` (`PublicWorkout`) | `activity`, `start_datetime`, `end_datetime`, `intensity`, `calories`, `distance`, `source`, `label` | one per workout | ISO; kcal; m; `intensity` enum `easy, moderate, hard`; `source` enum `manual, autodetected, confirmed, workout_heart_rate` | Workout sessions | NEW: `cardio_session` (duration, kcal) | Activity: training load 30 (cardio, not counted today), WHO zone minutes 20 | Scope `workout`. **No HR fields.** `intensity` is Oura's label. |
| `session` (`PublicSession`) | `heart_rate`, `heart_rate_variability`, `motion_count` (each a `PublicSample`); `type`; `mood`; `start_datetime`, `end_datetime` | one per session; interval **not in spec** | bpm; HRV unit not in spec; count; `type` enum `breathing, meditation, nap, relaxation, rest, body_status` | HR and HRV during guided or unguided sessions | NEW: `session_hr`, `session_hrv` | Heart: daytime resting HR 10 (not built), from still sessions; proposed daytime HRV check | Scope `session`. `mood` is entered by the user. |
| `enhanced_tag` (`EnhancedTagModel`) | `tag_type_code`, `custom_name`, `start_time`, `end_time`, `start_day`, `end_day`, `comment` | one per tag | — | Lifestyle tags (habit, mood, environment) | NEW: `tag_event` | Context: explain a day, or keep it out of baselines | Scope `tag` (inferred). The tag codes aren't listed in the spec. No field selection. |
| `tag` (`TagModel`) | `day`, `text`, `tags[]`, `timestamp` | one per note | — | Old-style tags | — | — | Deprecated: "We recommend transitioning to Enhanced Tag". |
| `rest_mode_period` (`PublicRestModePeriod`) | `start_day`, `start_time`, `end_day`, `end_time`, `episodes[].{tags[], timestamp}` | one per period | — | Rest mode the user turned on (illness, recovery) | NEW: `rest_mode_per_day` | Context: pause load targets; keep the days out of baselines | Scope not in spec. |
| `sleep_time` (`PublicSleepTime`) | `optimal_bedtime.{day_tz, start_offset, end_offset}`, `recommendation`, `status` | one per day | s from midnight; enums | Oura's bedtime advice | — | — | **OC**. Scope not in spec. Syncs after sleep data. |
| `personal_info` (`PersonalInfoResponse`) | `weight`, `height`, `age`, `biological_sex` | one current document, **no date** | **units not in spec** | Profile | `weight_per_day` (only if we stamp the fetch date ourselves; weak) | Body: weight vs plan 10 (weak) | Scope `personal`. `id` needs no scope. |
| `ring_battery_level` (`PublicRingBatteryLevelRow`) | `level`, `charging`, `in_charger`, `timestamp`, `timestamp_unix` | one row per sample | % | Battery and charging | — | Data-quality gate: charging explains missing data | Scope not in spec. The response wraps rows in `data`. |
| `ring_configuration` (`PublicRingConfiguration`) | `hardware_type`, `firmware_version`, `set_up_at` | one per ring | enum `gen1, gen2, gen2m, gen3, gen4` | Device provenance | — | Baselines per ring | **The enum has no Ring 5 value**, and the owner wears a Ring 5. A strict parser could reject it. |

Not in the API: a `meal` route. `meal` appears only as a webhook `ExtApiV2DataType` value. No route
or schema in v1.34 returns meal data.

## 2. New metrics Oura could give us that we don't score yet

| Candidate (source) | Pillar | Cadence | Raw enough to baseline, or vendor score? |
|---|---|---|---|
| Resilience (`daily_resilience.level` + 3 contributors) | Heart / Body (capacity to recover) | per day | **Vendor score.** Display only. |
| Cardiovascular age (`vascular_age`, `pulse_wave_velocity`) | Heart (long-term, not daily readiness) | per day (changes slowly) | **Vendor estimate.** PWV is derived from vascular age, so it is not independent. Display only. |
| VO₂max (`vO2_max.vo2_max`) | Activity (the block trend 15 we haven't built) | per estimate (sparse) | **Vendor estimate.** Usable at most as a slow trend. Feeding it to a score needs a `type: tuning` sign-off. |
| SpO₂ breathing disturbance index (`daily_spo2.breathing_disturbance_index`) | Body (next to SpO₂ / breathing) | per night (one per day) | **Raw enough**: a physiological index on [0, 100] that we can baseline per person. |
| Daytime recovery (`daily_stress.recovery_high`) | Body (pairs with daytime stress) | per day | **Semi-raw**: seconds in a zone, but the zone is Oura's quartile of the user's own data. Can be baselined. `day_summary` is a vendor label. |
| Rest mode (`rest_mode_period`) | All pillars (a context flag) | per period → per day | **User state, not a measurement.** Use it to keep days out of baselines and to pause load targets. |
| Sleep time recommendation (`sleep_time`) | Sleep (timing) | per day | **Vendor recommendation.** Display only. |
| Restless periods and movement (`sleep.restless_periods`, `sleep.movement_30_sec`) | Sleep (restfulness, a new unit) | per night (count) and per 30 s | **Raw.** Can be baselined. |
| Finer hypnogram (`sleep.sleep_phase_30_sec`) | Sleep (latency, deep+REM) | 30-s string per night | **Raw-ish**: Oura's stager output, but at epoch level. |
| Overnight HRV series (`sleep.hrv`) | Heart (HRV 35, with our own aggregation) | series per night (interval not in spec) | **Raw.** Lets us keep our own nightly HRV definition. |
| Temperature trend (`temperature_trend_deviation`) | Body (temperature) | per day | **Semi-raw**: a deviation from Oura's baseline. No absolute temperature exists. |
| Wear time / activity class (`daily_activity.class_5_min`, `non_wear_time`) | Gate for every pillar; Activity | 5-min string, per day | **Raw.** Fills the "wear time" gap in the catalogue. |
| Sedentary time (`sedentary_time`, `inactivity_alerts`) | Activity | per day | Time is raw. The alerts follow Oura's logic. |
| Energy spent (`active_calories`, `total_calories`) | Body: fuel (spend side of the energy target) | per day | Model output, but in physical units (kcal). Usable as a target input. |
| Tags and enhanced tags (`enhanced_tag`) | Context (explains readiness swings: alcohol, illness) | per event | **User-entered.** Not a score input; use it to annotate days or keep them out of baselines. `tag` is deprecated. |
| Workouts (`workout`) | Activity: training load (cardio, which isn't counted today), WHO minutes | per event | Duration and kcal are raw enough. `intensity` is Oura's label. **No HR in the schema.** |
| Session biometrics (`session.heart_rate`, `heart_rate_variability`, `motion_count`) | Heart: daytime resting HR (not built); daytime HRV check | per event | **Raw** series. Sparse: only when the user runs a session. |

## 3. Gaps: our metrics the Oura API can't fill

- **`hr_per_sec`: none.** No field in any of the 75 schemas carries per-second HR.
- **`hr_per_min`: none.** The Heart Rate Routes tag says "Heart rate is provided at 5-minute
  increments", and `PublicHeartRateRow` has no interval field. `sleep.heart_rate` and
  `session.heart_rate` are `PublicSample` series whose interval is not in spec. (SKILL.md's "one
  sample per minute" contradicts the spec.)
- **Workout HR:** `PublicWorkout` has **no HR fields**. HR during a workout comes only from
  `heartrate` rows with `source=workout`, at that route's 5-min resolution.
- **Beat-to-beat (IBI / RR):** none. No IBI, RR, inter-beat or PPG field exists anywhere. HRV exists
  only as `sleep.average_hrv`, the `sleep.hrv` series and `session.heart_rate_variability`. The
  spec gives none of them a unit or method. There is no daytime HRV outside sessions.
- **HR recovery after sets (Heart, 10):** can't be computed from 5-min HR. It stays on the Polar H10.
- **`volume_kg_per_session`:** none. Workouts have no load, reps or sets.
- **`food_per_day`:** not in spec. `meal` is a webhook data type with no route or schema.
- **`water_per_day`:** none.
- **`weight_per_day`:** only `personal_info.weight`, one current value with no unit and no date. It
  can't make a per-day series. The scale stays the source.
- **Per-minute steps:** none. Steps come only as a daily total (04:00–04:00).
- **`met_per_min`:** only if `daily_activity.met.interval` turns out to be 60 s, which the spec
  doesn't state.
- **Absolute skin temperature, SpO₂ series, breathing-rate series:** none. Only the deviations, the
  nightly SpO₂ average with BDI, and the nightly breathing average.
- **Daytime resting HR and block trend** (both not built): the API has partial inputs (5-min
  `heartrate` rows with `source=rest`/`awake`, session HR, VO₂max), but no ready-made field.
- **Freshness:** sleep, readiness and sleep time exist only after the user opens the Oura app. Live
  ring HR is lost.

## 4. Scope summary (from `securitySchemes.OAuth2.scopes`)

`personal` (gender, age, height, weight) · `daily` ("Daily summaries of sleep, activity and
readiness") · `heartrate` ("Time series heart rate for Gen 3 users") · `workout` · `tag` · `session`
· `spo2Daily` ("SpO2 Average recorded during sleep") · `email`. Stress, resilience, cardiovascular
age and VO₂max are not named by any scope description. `SKILL.md` puts them under `daily`, but that
is not in spec. Sleep time, rest mode, ring configuration and battery have no scope in the spec.

## 5. Where SKILL.md disagrees with the spec (worth fixing before #2808 builds on it)

Filed as #2820.

1. Heart rate: SKILL.md says "one sample per minute". The spec says 5-minute increments, `bpm` is an
   integer, the row also has `timestamp_unix`, and `source` also allows `live`.
2. `average_hrv`: SKILL.md says "ms rMSSD". The spec gives no unit or method.
3. `vo2_max`: SKILL.md says "Ring 4+ only". That is not in spec.
4. Scopes: SKILL.md puts stress, resilience, cardiovascular age and VO₂max under `daily`, which the
   spec doesn't say. The app's scope string in SKILL.md uses `spo2`, but the spec's scope is
   `spo2Daily`.
5. Webhooks: the spec's payload is `event_type, data_type, object_id, event_time, user_id`, not
   `id` and `operation_type`. Verification answers JSON `{ "challenge": ... }` (with a `challenge`
   query parameter), not the plaintext token. The signature is an HMAC over `x-oura-timestamp` +
   body, keyed with the client secret, in upper-case hex. `WebhookSubscriptionModel` has no
   `signing_key` field.
6. SKILL.md leaves out these fields: sleep `heart_rate`, `hrv`, `sleep_phase_5_min`,
   `sleep_phase_30_sec`, `movement_30_sec`, `readiness`, `*_score_delta`; daily_activity `met`,
   `class_5_min`, `sedentary_met_minutes`, `meters_to_target`. It also leaves out the
   `session`, `enhanced_tag` and `rest_mode_period` schemas, and the workout `source` enum
   (`manual, autodetected, confirmed, workout_heart_rate`).
7. `personal_info` units (kg, metres) are not in spec. `daily_resilience.level` is required, not
   nullable.
