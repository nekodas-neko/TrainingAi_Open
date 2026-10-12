# Health Connect: what it can give TrainingAI, and where each record could feed readiness

_Research note written 2026-10-12 for [`scoring-layers-and-data-inputs.md`](../architecture/scoring-layers-and-data-inputs.md) §6 and §9. Read-only research: nothing was run on a device, and no production data was used._

_Research, 2026-10-12. Read-only. Repo at `origin/main` `0e2df9995d`; the Health Connect files are the same on the checked-out branch. No device, APK or Health Connect grant was used, and no AI calls were made._

## Sources read

**Pinned code, read directly:**
- Plugin `@devmaxime/capacitor-health-connect@1.1.0`. `package.json:79` asks for `^1.1.0` and the lockfile pins `1.1.0`.
  - It is patched by `patches/@devmaxime__capacitor-health-connect.patch`.
  - The installed copy is `node_modules/@devmaxime/capacitor-health-connect/`, and I read these files from it: `android/build.gradle`, `AndroidHealthConnect.kt`, `AndroidHealthConnectPlugin.kt`, `RecordConverter.kt` and `dist/esm/definitions.d.ts`.
- Native SDK `androidx.health.connect:connect-client:1.1.0-alpha11`, as pinned in the plugin's `android/build.gradle`.
  - I read it from Google Maven's sources jar, `https://dl.google.com/android/maven2/androidx/health/connect/connect-client/1.1.0-alpha11/connect-client-1.1.0-alpha11-sources.jar`.
  - The files used were `impl/converters/datatype/RecordsTypeNameMap.kt`, `records/*.kt`, `permission/HealthPermission.kt` and `HealthConnectFeatures.kt`.

**App code:**
- `lib/health-connect-sync.ts`, `lib/health-connect-history-import.ts`, `components/health-connect-provider.tsx`
- `app/api/sync-health/route.ts`, `app/api/health-connect/ingest/route.ts` (the Tasker path), `app/api/training-stress/route.ts`
- `packages/shared/src/inputs/{cascade,adapters}.ts`
- `packages/shared/src/health/shadow-readiness/{model,assemble}.ts`, `lib/health/shadow-readiness-service.ts`
- `lib/data/postgres/slices/oura.ts`
- `android/app/src/main/AndroidManifest.xml`, `android/variables.gradle`

**Official documentation:**
- Records package: https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/package-summary
- Data types table: https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types
- Release notes: https://developer.android.com/jetpack/androidx/releases/health-connect
- Feature availability: https://developer.android.com/health-and-fitness/guides/health-connect/develop/feature-availability
- Reading data: https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data
- Skin temperature: https://developer.android.com/health-and-fitness/guides/health-connect/develop/skin-temperature
- Getting started: https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started
- Reference pages for `ActivityIntensityRecord`, `ExerciseSessionRecord`, `ExerciseSegment`, `MindfulnessSessionRecord`, `SkinTemperatureRecord`, `SleepSessionRecord`, `HeartRateVariabilityRmssdRecord` and `Vo2MaxRecord`, all under `https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/<Class>`.
- Samsung's mapping of Samsung Health data to Health Connect (published 2025-02-18): https://developer.samsung.com/health/blog/en/accessing-samsung-health-data-through-health-connect

## The short version

- **The app reads 12 record types today and requests one extra permission for history.** It parses steps, weight, exercise, sleep with stages, resting HR, body fat, nutrition, HRV, SpO₂, the HR series, active calories and step cadence. It also reads total calories and distance through daily totals (aggregates).
- **The pinned SDK supports more than the plugin can parse.** connect-client 1.1.0-alpha11 accepts 39 record-type names, and any of them can be requested and read through `readRecords`. The patched converter turns only 12 of them into JSON. Everything else comes back as a Kotlin `toString()` string.
  - That covers respiratory rate, skin temperature, VO₂ max, hydration, speed, power and distance records.
  - Each one needs a Kotlin converter branch in the patch and a new APK.
- **Four useful things need a newer SDK, not just a converter branch:** `ActivityIntensityRecord`, `MindfulnessSessionRecord`, `PlannedExerciseSessionRecord`, and RPE and lift weight on exercise sessions.
  - `ActivityIntensityRecord` gives moderate and vigorous minutes, which map directly onto WHO zone minutes.
  - `MindfulnessSessionRecord` is restricted and has no type name in alpha11.
  - `PlannedExerciseSessionRecord` exists in alpha11 but has no type name, so the plugin cannot request it.
  - RPE and lift weight (`ExerciseSegment.weight` and `setIndex`) arrive in 1.2.0-alpha06.
- **Health Connect cannot give these:**
  - beat-to-beat (RR) intervals;
  - any stress, Body Battery, readiness or sleep score;
  - sleep latency or efficiency as fields;
  - wear time;
  - MET.
- **It also gives no "taken during sleep" flag on HRV, respiratory rate or SpO₂ readings.** Every nightly value has to be windowed by our own sleep session.
- **I found 11 defects and stale statements that are not fixed (see §4).** The two that lose data:
  - Distance is never granted.
  - The daily total-calories value is read on the phone and then dropped by `/api/sync-health`.

---

## 1. What the pinned plugin can do

The plugin supports a record type at three levels:

| Level | What it means | Where it is decided |
|---|---|---|
| **Name** | The type can be requested in `requestPermissions` and read with `readRecords`. | The SDK's `RECORDS_TYPE_NAME_MAP` (`RecordsTypeNameMap.kt:63-105`) has 39 names. The plugin looks names up there (`AndroidHealthConnect.kt:59`, `:237`). |
| **Parsed** | The record comes back as JSON with named fields. | `RecordConverter.kt:29-194`, which after the patch has 12 branches: ExerciseSession, Steps, Weight, SleepSession, RestingHeartRate, BodyFat, Nutrition, HRV RMSSD, OxygenSaturation, HeartRate, ActiveCaloriesBurned and StepsCadence. |
| **Aggregate** | A server-side total or average from `aggregateRecords`. | `AndroidHealthConnect.kt:387-468` supports only Steps, Distance, TotalCaloriesBurned, ActiveCaloriesBurned and HeartRate (average, min and max). |

**Facts from the source that limit what we can do:**
- **A type with a name but no parser comes back as a string.** Its fallback is `else -> record.toString()` (`RecordConverter.kt:193`). In alpha11 every record class overrides `toString()` as `XRecord(field=value, …)`, so the values are in the string, but parsing that string is fragile. The repo's own guard, `lib/__tests__/la115-hc-record-converter.test.ts`, requires a converter branch for every type read.
- **One unknown name breaks the whole sync.** If any requested name is missing from the map, `requestPermissions` rejects the entire call with "Invalid records specified" (`AndroidHealthConnectPlugin.kt:73-77`). Adding `ActivityIntensity`, `MindfulnessSession` or `PlannedExerciseSession` to `HC_SYNC_READ_TYPES` on the pinned SDK would make every sync fail.
- **Daily buckets are fixed 24-hour steps.** `aggregateRecords` steps forward with `Duration.ofDays(1)` (`AndroidHealthConnect.kt:368-384`). That is the pattern the repo's date rules ban (never `now − N×86400000`). The daily buckets slip by an hour after a daylight-saving change. Brisbane has no DST, so the owner is unaffected.
- **The plugin does not expose `getFeatureStatus`, change tokens or background reads.** The sync runs only when the app opens (`components/health-connect-provider.tsx`).
- **The plugin still parses `Metadata` on every record.** That gives `id`, `dataOrigin` (the writing app's package), `lastModifiedTime`, `clientRecordId`, `clientRecordVersion`, `recordingMethod` (actively recorded, automatic or manual entry) and `device` (`manufacturer`, `model`, `type` such as WATCH or RING) (`RecordConverter.kt:209-243`).
- **Platform and SDK versions:**
  - The app has minSdk 26 and target 36 (`android/variables.gradle`).
  - The Health Connect SDK supports API 26 and up, and the Health Connect app needs Android 9 or later. From Android 14 Health Connect is part of the OS (get-started guide).
  - The S25 Ultra ships with Android 15.
  - In the pinned SDK, skin temperature, planned exercise, background reads and history reads need API 34 with SDK extension 13. Background and history reads can also come from Health Connect APK version 171302 (`HealthConnectFeatures.kt:88-104`).
- **History is limited to 30 days by default.** Without `READ_HEALTH_DATA_HISTORY`, reading data older than 30 days before the first grant fails (read-data guide). The plugin patch adds it as `HealthDataHistory` (`lib/health-connect-history-import.ts:121`).

**What the manifest declares** (`android/app/src/main/AndroidManifest.xml:156-193`):
- **Activity:** STEPS, DISTANCE, ACTIVE_CALORIES_BURNED, TOTAL_CALORIES_BURNED, FLOORS_CLIMBED, EXERCISE, ACTIVITY_INTENSITY, SPEED, POWER, VO2_MAX.
- **Heart and vitals:** HEART_RATE, RESTING_HEART_RATE, HEART_RATE_VARIABILITY, OXYGEN_SATURATION, RESPIRATORY_RATE, SKIN_TEMPERATURE, SLEEP.
- **Body and food:** WEIGHT, HEIGHT, BODY_FAT, BASAL_METABOLIC_RATE, NUTRITION, HYDRATION.
- **Access:** HEALTH_DATA_IN_BACKGROUND, HEALTH_DATA_HISTORY.

A type missing from the manifest cannot be granted. Not declared: body temperature, basal body temperature, lean mass, body water, bone mass, elevation, menstruation and the other cycle types, mindfulness, planned exercise, blood pressure, blood glucose, wheelchair pushes and exercise route.

**Requested at runtime:**
- `HC_SYNC_READ_TYPES` (`lib/health-connect-sync.ts:39-43`): Steps, Weight, ActivitySession, SleepSession, BodyFat, Nutrition, RestingHeartRate, OxygenSaturation, HeartRateSeries, TotalCaloriesBurned, HeartRateVariabilityRmssd, ActiveCaloriesBurned.
- `HealthDataHistory`, when the user taps "Import more history".
- `StepsCadenceSeries` is read under READ_STEPS and needs no request of its own.

---

## 2. Every record type and what it could feed

**Key to the "Pinned plugin" column:**
- **Parsed:** the type has a name and a converter branch.
- **Unparsed:** the name is accepted but no converter branch exists, so the record returns as a `toString()` string. It needs a Kotlin branch and a new APK.
- **No:** the pinned SDK has no type name for it; the cell says which version adds it.

**Key to the other columns:**
- **Shape** is the official record type: Instantaneous, Interval or Series. A Series holds `samples[]` of `{time, value}`.
- **Field names** are from the alpha11 sources.
- **Read today** cites `lib/health-connect-sync.ts` as `sync:` plus a line number, and `app/api/sync-health/route.ts` as `route:` plus a line number.

### 2.1 The requested types

| Record type (plugin name) | Key fields | Shape, resolution | Units | Pinned plugin | Read today | Our metric | Score it could feed (pillar) | Caveats |
|---|---|---|---|---|---|---|---|---|
| `HeartRateRecord` (`HeartRateSeries`) | `startTime`, `endTime`, `samples[{time, beatsPerMinute}]` | Series. The writer sets the sample rate. | bpm (whole numbers, 1–300) | Parsed (LA-115). Aggregate avg/min/max also available. | **Yes.** Every sample goes to `oura_heartrate` as `source='health_connect'` (sync:677-689, route:298-318). Also used for session average and max HR (sync:332-344). | `hr_per_min`; `hr_per_5min` (the overnight slice); `hr_per_sec` only if the writer records about one sample a second | **Activity:** WHO zone minutes 20. This works today: `computeDayZoneSeconds` reads `oura_heartrate` and drops sparse Health Connect hours (#2437). **Heart:** settling 15, HR recovery after sets 10 (needs dense HR around each set), daytime resting HR 10 (not built). **Sleep:** latency, which reads HR at sleep onset. | READ_HEART_RATE. Density is the writer's choice; Samsung says continuous HR from the watch reaches the phone in batches. The cascade route `health_connect_hr` ranks below the strap and the ring. |
| `HeartRateVariabilityRmssdRecord` (`HeartRateVariabilityRmssd`) | `time`, `heartRateVariabilityMillis` | Instantaneous. One value per writer window. | ms. Jetpack accepts 1–200; on Android 14+ the platform validates instead (1.1.0-beta02). | Parsed (LA-115) | **Yes.** Mean of readings between 00:00 and 08:00 in the user's timezone, stored as `body_metrics.hrvMs` (sync:574-592). The shadow model reads it through `night_hrv` (`assemble.ts:180`). | `hrv_per_night` | **Heart:** overnight HRV 35. Also the illness check (15% of it) and the proposed HRV-crash cap at 60. | RMSSD only. Each writer chooses its own window (one nightly value or many readings), so the normal must be learned per source, which is already the rule. The window is the clock, not the sleep session, so readings before midnight and after 08:00 are missed. Samsung's official mapping does not list HRV; unofficial guides say the Galaxy Watch writes it. Health Connect has the lowest rank in `mergeSet`. |
| `RestingHeartRateRecord` (`RestingHeartRate`) | `time`, `beatsPerMinute` | Instantaneous. Usually one a day. | bpm (whole numbers, 0–300) | Parsed | **Yes.** The writer's value is stored as-is, last one per local day, in `body_metrics.restingHeartRate` (sync:564-572). It feeds `night_rhr` (`assemble.ts:181`). | `rhr_per_night`, but only if the writer measures overnight | **Heart:** overnight resting HR 30 and the illness check. Daytime resting HR 10 (not built). | The definition is the writer's: often a daily resting value, not the overnight minimum. The field comment at sync:58 says "overnight min BPM (midnight–8am)", but no such calculation exists. A derived route that computes overnight RHR from the HR series inside `sleep_window` would be more consistent. |
| `RespiratoryRateRecord` (`RespiratoryRate`) | `time`, `rate` | Instantaneous | breaths/min (0–1000) | Unparsed | **No.** Declared in the manifest but not requested. | `breath_per_night` (new route into an existing metric) | **Body:** breathing rate 20, and 25% of the illness check. | Needs a converter branch `{time, rate}` and an APK. No sleep flag, so it must be windowed by the sleep session. Not in Samsung's official mapping. |
| `OxygenSaturationRecord` (`OxygenSaturation`) | `time`, `percentage` | Instantaneous | % (0–100) | Parsed (LA-115) | **Yes.** Mean of readings between 00:00 and 08:00, stored as `body_metrics.spo2Pct` (sync:594-612). Read by `body.spo2` (`assemble.ts:190`). | `spo2_per_night` | **Body:** SpO₂ 15 | Samsung writes "Blood oxygen" to it, which can mix daytime spot checks with sleep readings. Calibration is the writer's. Same clock-window problem as HRV. |
| `SkinTemperatureRecord` (`SkinTemperature`) | `startTime`, `endTime`, `deltas[{time, delta}]`, `baseline` (optional), `measurementLocation` (unknown, finger, toe or wrist) | An Interval record that holds a series of deltas. The docs table calls it Series. | °C deviation (±30); `baseline` in °C | Unparsed. Behind the feature flag `FEATURE_SKIN_TEMPERATURE`. | **No.** Declared in the manifest. | `temp_dev_per_night` | **Body:** temperature 25, 40% of the illness check, and the proposed fever cap at 40. | Each delta is measured against the writer's own baseline, and the baseline is optional, so the unit must learn a normal per source. It is not core temperature (skin-temperature guide). The pinned SDK gates it at API 34 with extension 13; support for older Android via the Health Connect app arrives in 1.2.0-alpha01. Unofficial guides say Galaxy Watch 6 and later write a nightly deviation. |
| `BodyTemperatureRecord` (`BodyTemperature`) | `time`, `temperature`, `measurementLocation` (armpit, finger, forehead, mouth, rectum, temporal artery, toe, ear, wrist, vagina) | Instantaneous spot reading | °C | Unparsed | No. Not declared. | **NEW:** `body_temp_per_reading` | **Body:** context that confirms a fever for the illness check, rather than a scored unit | Sparse. A thermometer reading can use the absolute 38 °C threshold with no baseline. |
| `BasalBodyTemperatureRecord` (`BasalBodyTemperature`) | `time`, `temperature`, `measurementLocation` | Instantaneous, taken at rest on waking | °C (0–100) | Unparsed | No. Not declared. | **NEW:** `bbt_per_morning` | **Body:** context for the menstrual cycle (row below) | Cycle-tracking category. Present only for users who log it. |
| `SleepSessionRecord` (`SleepSession`) | `startTime`, `endTime`, `title`, `notes`, `stages[{startTime, endTime, stage}]`. Stage codes: 0 unknown, 1 awake, 2 sleeping, 3 out of bed, 4 light, 5 deep, 6 REM, 7 awake in bed. | Interval. Stages are non-overlapping sub-intervals at the writer's resolution. | time | Parsed. Stages arrive as strings. | **Yes.** Stored in `sleep_sessions` with duration, deep/REM/light/awake hours and `sleepPhase5Min` (sync:634-675, route:262-295). | `sleep_window`, `sleep_stages_5min` | **Sleep:** duration 30, 7-night balance 15 and timing 15 come from the window; deep+REM share 10 from the stages. Efficiency 20 and latency 10 could be derived from the awake, awake-in-bed and out-of-bed stages, but they are not sent today. | The plugin maps "awake in bed" (7) to UNKNOWN (`RecordConverter.kt:460-470`). Sleeping (2) and unknown carry no stage, so a partly staged night gets no hypnogram. The session can mean time in bed or time asleep, depending on the writer. Samsung's mapping covers sessions and stages. |
| `StepsRecord` (`Steps`) | `startTime`, `endTime`, `count` | Interval. Written in batches no more often than once a minute (read-data guide). | count (1 to 1,000,000) | Parsed. Aggregate `COUNT_TOTAL` also available. | **Yes.** The daily total, which Health Connect de-duplicates across apps, goes to `body_metrics.steps` (sync:496-506). Each record goes to `health_connect_intervals` as `steps`, and training stress reads those per minute (`training-stress/route.ts:99`). | `steps_per_day`; steps per minute, which feeds `met_per_min` through `cadence_met` | **Activity:** yesterday's steps 35 (`assemble.ts:185`). Also training stress. | READ_STEPS. The docs say to use the aggregate for totals. Raw records are not de-duplicated across apps; we de-duplicate them when reading. Daily buckets have the DST slip from §1. |
| `DistanceRecord` (`Distance`) | `startTime`, `endTime`, `distance` | Interval | m | Aggregate `DISTANCE_TOTAL`; per-record reads are unparsed | **In effect, no.** The daily and per-session totals are requested only when Steps is granted (sync:509-517, :316-322). READ_DISTANCE itself is never requested, so Health Connect refuses each bucket, the plugin swallows the error, and the list comes back empty. | **NEW:** `distance_per_session`, `distance_per_day` | **Activity:** training load, if cardio counts (an open decision); block trend 15 (not built) | Declared in the manifest. `Distance` is a valid type name, so adding it to `HC_SYNC_READ_TYPES` is all the fix needs. |
| `ActiveCaloriesBurnedRecord` (`ActiveCaloriesBurned`) | `startTime`, `endTime`, `energy` | Interval | kcal | Parsed (#2462). Aggregate `ACTIVE_CALORIES_TOTAL` also available. | **Yes.** Each record goes to `health_connect_intervals` as `active_kcal`. The MET route `active_kcal_met` uses records of 15 minutes or less and needs the user's weight (`adapters.ts:97-116`, `training-stress/route.ts:98`). | `met_per_min` | **Activity:** training stress, then training load if cardio counts | Excludes basal energy (BMR). Samsung's official mapping does not list it; Samsung writes workout energy as total calories. |
| `TotalCaloriesBurnedRecord` (`TotalCaloriesBurned`) | `startTime`, `endTime`, `energy` | Interval | kcal | Aggregate `ENERGY_TOTAL`; per-record reads are unparsed | **Partly.** The daily total is read (sync:520-527) and sent as `caloriesBurned`, but `/api/sync-health` never writes it (route:199-216 has no `caloriesBurned`). The per-session total is saved to `activity_logs.calories_burned`. | **NEW:** `energy_out_per_day` | **Body:** fuel 20, as measured energy out against intake | Includes basal energy. |
| `ExerciseSessionRecord` (`ActivitySession`) | `startTime`, `endTime`, `exerciseType`, `title`, `notes`, `segments[{startTime, endTime, segmentType, repetitions}]`, `laps[{startTime, endTime, length}]`, `exerciseRouteResult`, `plannedExerciseSessionId` | Interval | — | Parsed. The plugin does not output the route. | **Yes.** Sessions go to `activity_logs`. The type is mapped to one of 11 slugs, otherwise `other`. Distance, calories and average/max HR are filled in from aggregates (sync:614-632, route:218-262). | **NEW:** `cardio_session_per_session` (type, minutes, HR load). It fills `volume_kg_per_session` only with 1.2.0-alpha06's segment `weight`, and only if the writer sets it. | **Activity:** training load 30, which today counts only strength volume logged in the app; zone minutes, through HR | READ_EXERCISE. 1.2.0-alpha06 adds `rateOfPerceivedExertion` on the session and `weight`, `setIndex` and `rateOfPerceivedExertion` on segments (`ExerciseSessionRecord` and `ExerciseSegment` reference pages). The route needs READ_EXERCISE_ROUTE and the user's consent per session. Sessions are de-duplicated by date and start time only. |
| `SpeedRecord` (`SpeedSeries`) | `samples[{time, speed}]` | Series | m/s | Unparsed. The SDK aggregates `SPEED_AVG/MIN/MAX` are not offered by the plugin. | No. Declared in the manifest. | **NEW:** `pace_per_session` | **Activity:** block trend, as pace at a given HR | Written by watches and bike computers. Samsung lists "Exercise speed". |
| `PowerRecord` (`PowerSeries`) | `samples[{time, power}]` | Series | W | Unparsed | No. Declared in the manifest. | **NEW:** `power_per_session` | **Activity:** training load for cycling or running power (needs an FTP) | Few writers. Samsung lists "Exercise power". |
| `StepsCadenceRecord` (`StepsCadenceSeries`) | `samples[{time, rate}]` | Series | steps/min (0–10,000) | Parsed (#2462) | **Stored but never read.** Rows go to `health_connect_intervals` as `cadence_spm`, but no code reads them back; training stress reads only `steps` and `active_kcal`. | `met_per_min`: the `cadence_met` route could use measured cadence instead of cadence computed from step counts | **Activity:** training stress | Read under READ_STEPS. |
| `CyclingPedalingCadenceRecord` (`CyclingPedalingCadenceSeries`) | `samples[{time, revolutionsPerMinute}]` | Series | rpm | Unparsed | No | **NEW:** `cycling_cadence_per_session` | **Activity:** context only | Read under READ_EXERCISE. |
| `Vo2MaxRecord` (`Vo2Max`) | `time`, `vo2MillilitersPerMinuteKilogram`, `measurementMethod` (other, metabolic cart, HR ratio, Cooper, multistage, Rockport) | Instantaneous. Sparse: one estimate per qualifying workout. | mL/kg/min | Unparsed | No. Declared in the manifest. | **NEW:** `vo2max_per_day` | **Activity:** block trend 15 (not built), or a fitness unit | Each writer has its own estimation method. Samsung lists "Exercise VO2max". |
| `WeightRecord` (`Weight`) | `time`, `weight` | Instantaneous | kg | Parsed | **Yes.** Last reading per day goes to `body_metrics.weightKg` (sync:529-536). The Tasker route `app/api/health-connect/ingest/route.ts` writes it too. | `weight_per_day` | **Body:** weight vs plan 10, through the energy balance | Lowest rank: manual beats scale, which beats ring, which beats Health Connect. |
| `BodyFatRecord` (`BodyFat`) | `time`, `percentage` | Instantaneous | % | Parsed (repo patch) | **Yes.** Stored in `body_metrics.bodyFatPct`. No score unit reads it. | **NEW:** `body_fat_per_day` | **Body:** composition trend | Bioimpedance scales are noisy and swing with hydration. |
| `LeanBodyMassRecord` (`LeanBodyMass`) | `time`, `mass` | Instantaneous | kg | Unparsed | No. Not declared. | **NEW:** `lean_mass_per_day` | **Body:** composition | Sparse. |
| `HydrationRecord` (`Hydration`) | `startTime`, `endTime`, `volume` | Interval, one per drink | L (up to 100) | Unparsed. The SDK's `VOLUME_TOTAL` is not offered by the plugin. | No. Declared in the manifest. | `water_per_day` (existing metric, `body_metrics.waterMl`) | **Body:** the hydration part of fuel 20 | Counts twice if the user also logs water in the app. |
| `NutritionRecord` (`Nutrition`) | `startTime`, `endTime`, `energy`, `protein`, `totalCarbohydrate`, `totalFat`, about 35 more nutrients (sugar, fibre, sodium, caffeine and others), `name`, `mealType` | Interval, one per meal or food | kcal, g | Parsed for energy, protein, carbs, fat and name only | **Yes.** Summed per day into `body_metrics.calories/proteinG/carbsG/fatG` (sync:548-562). The Tasker route writes these too. | `food_per_day` | **Body:** fuel 20. It does not reach fuel today: fuel reads the food log and needs an evening check-in marking the day fully logged (`shadow-readiness-service.ts:64-91`). | The plugin drops every other nutrient and `mealType`. Counts twice if the user also logs food in the app. |
| `MindfulnessSessionRecord` | `startTime`, `endTime`, `mindfulnessSessionType` (meditation, breathing, music, movement, unguided, other), `title`, `notes` | Interval | minutes | **No.** Restricted in alpha11 and absent from the name map. Public and experimental from 1.1.0-beta02; stable in 1.1.0. | No. Not declared. | **NEW:** `mindful_min_per_day` | **Body:** context for daytime stress, or a unit in a possible Health pillar | Behind `FEATURE_MINDFULNESS_SESSION`. The permission name changed in 1.1.0-rc02: the docs list `READ_MINDFULNESS`, while alpha11 has `READ_MINDFULNESS_SESSION`. Support for older Android arrives in 1.2.0-alpha01. |
| `MenstruationFlowRecord` (`Menstruation`) and `MenstruationPeriodRecord` (`MenstruationPeriod`). Related: ovulation test, cervical mucus, intermenstrual bleeding. | Flow: `time`, `flow` (unknown, light, medium, heavy). Period: `startTime`, `endTime`. | Flow is Instantaneous; period is Interval | — | Unparsed | No. Not declared. | **NEW:** `cycle_phase_per_day` | Context that adjusts the normals for Body temperature and Heart RHR and HRV | READ_MENSTRUATION. Only for users who log it. A sensitive category. |
| `PlannedExerciseSessionRecord` | `startTime`, `endTime`, `hasExplicitTime`, `exerciseType`, `completedExerciseSessionId`, `blocks[{repetitions, steps[{exerciseType, exercisePhase, completionGoal, performanceTargets, description}], description}]`, `title`, `notes` | Interval | — | **No.** The class exists in alpha11 but has no type name, so the plugin can neither request nor read it. | No. Not declared. | **NEW:** `plan_adherence_per_week` | **Activity:** block trend 15 (not built) | Behind `FEATURE_PLANNED_EXERCISE` (API 34 with extension 13 in the pinned SDK). Targets include weight, RPE, HR, power, speed and cadence. We could also write our own program to Health Connect. |
| `ActivityIntensityRecord` (not in the request list, but it matters) | `startTime`, `endTime`, `activityIntensityType` (0 moderate, 1 vigorous) | Interval | minutes | **No.** The reference page says "Added in 1.2.0-alpha06". The release notes add it for Android 14+ in 1.2.0-alpha01 and for the Health Connect app in 1.2.0-alpha03. | No. The manifest already declares READ_ACTIVITY_INTENSITY, which does nothing on the pinned SDK. | **NEW:** `intensity_min_per_day` | **Activity:** WHO zone minutes 20, as a direct route alongside HR zones | Behind `FEATURE_ACTIVITY_INTENSITY`. Aggregates: `MODERATE_DURATION_TOTAL`, `VIGOROUS_DURATION_TOTAL` and `INTENSITY_MINUTES_TOTAL`, which the docs call "weighted" without defining the weighting. |

### 2.2 The other types in the catalogue

None of these is read today.

| Type (plugin name) | Fields, shape, units | Pinned plugin | Manifest | Possible use |
|---|---|---|---|---|
| `FloorsClimbedRecord` (`FloorsClimbed`) | `floors` (decimal), Interval | Unparsed | declared | **NEW:** `floors_per_day`. Minor Activity input. |
| `ElevationGainedRecord` (`ElevationGained`) | `elevation` (m), Interval | Unparsed | not declared | Context for a session's load |
| `BasalMetabolicRateRecord` (`BasalMetabolicRate`) | `basalMetabolicRate` (kcal/day), Instantaneous; aggregate `BASAL_CALORIES_TOTAL` | Unparsed | declared | The energy target behind fuel |
| `HeightRecord` (`Height`) | `height` (m), Instantaneous | Unparsed | declared | Inputs to BMI and energy maths |
| `BodyWaterMassRecord`, `BoneMassRecord` | `mass` (kg), Instantaneous | Unparsed | not declared | Composition context |
| `BloodPressureRecord` (`BloodPressure`) | `systolic`, `diastolic` (mmHg), `bodyPosition`, `measurementLocation`, Instantaneous | Unparsed | not declared | A possible Health pillar. Can be baselined. |
| `BloodGlucoseRecord` (`BloodGlucose`) | `level` (mmol/L), `specimenSource`, `mealType`, `relationToMeal`, Instantaneous | Unparsed | not declared | A possible Nutrition or Health pillar. A continuous glucose monitor gives a dense series. |
| `WheelchairPushesRecord` (`WheelchairPushes`) | `count`, Interval | Unparsed | not declared | Stands in for steps for wheelchair users |
| `OvulationTestRecord`, `CervicalMucusRecord`, `IntermenstrualBleedingRecord`, `SexualActivityRecord` | Instantaneous | Unparsed | not declared | Cycle context only |
| Medical records (FHIR, `FEATURE_PERSONAL_HEALTH_RECORD`, 1.1.0-beta02 and later) | — | No | — | Out of scope |

### 2.3 Which apps write what

- **Samsung Health (official mapping, 2025-02-18):**
  - Writes: steps, blood glucose, blood oxygen, blood pressure, exercise session, exercise calories (as `TotalCaloriesBurnedRecord`), exercise distance, HR, power, speed, VO₂ max, nutrition, sleep sessions and stages, weight, body fat, BMR and height.
  - Does not list: HRV, respiratory rate, skin temperature, resting HR, active calories or hydration.
  - Also says: "continuous heart rate data from the Galaxy Watch is not sent to the Samsung Health application on the smartphone immediately".
  - Unofficial vendor guides claim Galaxy Watch 6 and later also write HRV and a nightly skin-temperature deviation. Neither is verified.
- **The owner:**
  - The manifest's comments say "Fitbit Air writes all of these" for the activity and vitals groups. That is the repo's own claim, not verified.
  - `docs/superpowers/plans/2026-08-02-health-connect-first-class-tier.md` says the owner has Health Connect switched off.
  - `docs/architecture/scoring-layers-and-data-inputs.md` §5 says the Health Connect path has never run on real data.

---

## 3. Metrics Health Connect makes possible that we do not score yet

| New metric | Records | Pillar | Can it have a learned normal? | Notes |
|---|---|---|---|---|
| `intensity_min_per_day` | `ActivityIntensityRecord` | Activity: WHO zone minutes, as a second route | Not needed: the unit is a fixed target (150 moderate or 75 vigorous minutes a week) | The cleanest route to zone minutes for users with no dense HR. Needs SDK 1.2.0-alpha06. |
| `vo2max_per_day` | `Vo2MaxRecord` | Activity: fitness or block trend | Yes, slowly, per source (sparse, and the method differs by writer). Published norms by age and sex could set the Level grade. | Unparsed today; needs a converter branch. |
| `body_fat_per_day`, `lean_mass_per_day` | `BodyFatRecord`, `LeanBodyMassRecord` | Body: composition, next to weight vs plan | Yes, per source, but as a trend: bioimpedance swings day to day | Body fat is already stored and nothing scores it. |
| `cycle_phase_per_day` (plus `bbt_per_morning`) | Menstruation flow and period, BBT, ovulation test | Context, not a unit | Yes: a personal cycle length and luteal shift | Would let the temperature, RHR and HRV normals expect the luteal rise instead of flagging it as illness. |
| `mindful_min_per_day` | `MindfulnessSessionRecord` | Body: daytime-stress context, or a possible Health pillar | Weakly. It is behaviour, not physiology, so it fits a fixed target better than a learned normal. | Needs SDK 1.1.0 or later. |
| `distance_per_session`, `pace_per_session` | Distance, Speed, ExerciseSession | Activity: training load (if cardio counts), block trend | Yes, per activity type: pace at a fixed HR tracks aerobic efficiency | Distance needs only the permission request. |
| `power_per_session`, `cycling_cadence_per_session` | PowerRecord, CyclingPedalingCadenceRecord | Activity: training load for cycling | Yes, once an FTP exists | Few writers. |
| `session_rpe_per_session` | `ExerciseSessionRecord.rateOfPerceivedExertion` (1.2.0-alpha06) | Activity: session-RPE load (RPE × minutes), counting strength and cardio together | Yes, through the same 7:28 acute-to-chronic ratio we already use | Writer-dependent. |
| `cardio_session_per_session` (HR-based load from the session's HR series) | ExerciseSession plus HeartRate | Activity: training load | Yes | Uses data we already store. Answers the open question "should training load count cardio". |
| `energy_out_per_day` | TotalCaloriesBurned (plus BMR) | Body: fuel energy balance | Yes | The value is read today and dropped on the server. |
| `bp_per_reading`, `glucose_per_reading` | BloodPressure, BloodGlucose | Possible Health or Nutrition pillars | Yes. A continuous glucose monitor allows variability measures. | Not declared in the manifest. |
| Derived routes into existing units | HeartRate within `sleep_window`; sleep stages | Heart: overnight RHR and settling. Sleep: efficiency and latency. | Already learned per source | Needs dense overnight HR, and stages that include awake time. |

---

## 4. Defects and stale statements found (not fixed; this task was read-only)

There is no matching GitHub issue for the distance permission. I searched issues for "Health Connect distance permission" and for the converter types.

1. **Distance is never granted.**
   - `Distance` is not in `HC_SYNC_READ_TYPES`, and the distance totals are requested whenever `Steps` is granted (`lib/health-connect-sync.ts:316-322`, `:509-517`).
   - Health Connect refuses each daily bucket. The plugin's per-bucket `catch` swallows it (`AndroidHealthConnect.kt:471-474`), so `distanceKm` stays empty for daily metrics and for sessions.
2. **The daily total-calories value is dropped on the server.**
   - The phone sends `dailyMetrics[].caloriesBurned` (`:520-527`), and `/api/sync-health` validates it (`route.ts:56`).
   - The write at `route.ts:199-216` never maps it. It maps `activeCalories` instead, which the phone never sends.
3. **Health Connect cadence is stored but never read.** No code reads the `cadence_spm` rows back out of `health_connect_intervals`.
4. **Health Connect nutrition never reaches fuel.** It lands in `body_metrics`, but the fuel unit reads the food log and the "fully logged" check-in.
5. **Two docs are stale.**
   - `docs/architecture/scoring-layers-and-data-inputs.md:207-210` and `docs/reviews/2026-09-16-health-connect-record-converter-gap.md` both say HRV, SpO₂ and the HR series come back as strings.
   - LA-115 (#1877, `1ffe00a3fa`) added those converter branches.
6. **A field comment is misleading.** `DailyMetric.restingHeartRate` (`:58`) says "overnight min BPM (midnight–8am)", but the code stores the writer's value unchanged.
7. **HRV and SpO₂ use a fixed clock window.** The 00:00–08:00 window ignores the sleep session, so sleep before midnight and after 08:00 is missed.
8. **The plugin's daily buckets are fixed 24-hour durations**, so they slip by an hour after a DST change (§1).
9. **The manifest declares `READ_ACTIVITY_INTENSITY`, which the pinned SDK cannot request.**
   - Requesting any name the SDK does not know fails the whole permission call (`AndroidHealthConnectPlugin.kt:73-77`).
   - That is a trap for anyone who later adds `ActivityIntensity`, `MindfulnessSession` or `PlannedExerciseSession` to the list.
10. **`android/capacitor.settings.gradle:45` points to a stale patch-hash path.** It names `81f94…`, while the installed copy is `56fc68…`. The file is generated and `npx cap sync` rewrites it, so this is cosmetic.
11. **The plugin relies on `RECORDS_TYPE_NAME_MAP`, an internal SDK API.** It is marked `@RestrictTo(LIBRARY)`. Before any SDK upgrade, check that the map still exists and that its names have not changed.

## 5. What Health Connect cannot give

- **Beat-to-beat (RR) intervals.** No such record type exists; `HeartRateRecord` holds bpm at timestamps.
  - So we cannot compute our own RMSSD.
  - HR recovery after sets (HRR60) needs a writer that records about once a second.
  - The strap's `rr_intervals` stays the only beat-to-beat source.
- **HRV other than RMSSD.** There is no SDNN and no frequency-domain HRV. Nothing guarantees an overnight series, and no flag marks a reading as taken during sleep.
- **Daily stress, stress minutes, Body Battery, readiness, sleep score or HRV status.** No record type exists for any of them, and Samsung's mapping has no stress type.
  - `stress_min_per_day`, and with it daytime stress (10 in Body), stays ring-only.
  - Mindfulness sessions are behaviour, not a stress measurement.
- **Sleep latency, efficiency or disturbances as fields.** They can be derived from stages only when the writer sends awake stages. The plugin also turns "awake in bed" into UNKNOWN.
- **Absolute nightly temperature.** Skin temperature comes as deltas against the writer's baseline, and the baseline is optional. Body temperature is a spot reading, not continuous.
- **Context on respiratory rate and SpO₂ readings.** Both are single timestamped readings with no sleep or rest flag.
- **Wear time.** Nothing reports when a device was not worn, so our low-wear exclusion cannot apply to Health Connect days. It could only be inferred from gaps in the HR samples.
- **MET per minute.** It has to be derived from active calories plus weight, or from cadence.
- **Strength detail.**
  - alpha11 gives a segment's type and rep count only. Weight, set index and RPE need 1.2.0-alpha06, and only if the writer fills them in.
  - So `volume_kg_per_session` effectively cannot come from Health Connect today.
- **Training load, strain, TRIMP or recovery time.** None is a record type.
- **Raw signals** (accelerometer, PPG, ECG). None.
- **Freshness.**
  - Data is only as fresh as the writing app's own sync to the phone.
  - Our plugin reads only when the app opens, with no background worker and no change tokens.
  - Data older than 30 days before the first grant needs READ_HEALTH_DATA_HISTORY.

## Not exercised

No device, no APK, no Health Connect provider, no permission grant, and no production data. Every claim comes from reading the pinned source, the repo and the docs. The writer-coverage claims rest on Samsung's 2025 blog post and on the repo's own manifest comments, and nothing confirms them on current app versions.
