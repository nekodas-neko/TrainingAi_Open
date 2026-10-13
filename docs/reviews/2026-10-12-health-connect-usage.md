# Health Connect: what we read, what we use, what we drop

_Read-only audit, 2026-10-12. Every cited repo file is identical to `origin/main` `0e2df9995d`; this was checked with `git diff`. No device, APK, grant, production query or AI call was used. It builds on [`2026-10-12-health-connect-fields.md`](2026-10-12-health-connect-fields.md), which maps what is available, and does not repeat that work. The new defects (N1–N7) are filed as #2828._

**Sources read directly:**
- The pinned plugin in `node_modules/@devmaxime/capacitor-health-connect/`: `RecordConverter.kt`, `AndroidHealthConnect.kt`, `AndroidHealthConnectPlugin.kt` and `definitions.d.ts`.
- The sources jars for connect-client `1.1.0-alpha11` (pinned), `1.1.0` (stable) and `1.2.0-alpha06` (newest alpha), all from Google Maven.
- The developer.android.com data-types table and release notes.

**Short forms used below:**
- `sync:` means `lib/health-connect-sync.ts`.
- `route:` means `app/api/sync-health/route.ts`.
- `rp:` means `lib/health/readiness-payload.ts`.

## Summary

Health Connect has 41 record type names in the current SDK (`1.2.0-alpha06`), plus exercise routes and medical records.

**What our pipeline touches:** 14 of the 41 names.
- **SCORED (7):** heart rate, HRV, resting HR, sleep, steps, exercise sessions and weight. They feed the live readiness and Activity scores, zone minutes and training stress.
- **SCORED, but only for ring users (1):** active calories. Its one consumer, training stress, is gated on readiness derived from the ring.
- **SHOWN only (3):** SpO₂, body fat and nutrition.
- **STORED-UNUSED (1):** step cadence.
- **DROPPED (1):** the daily total calories (#2818).
- **NOT-READ (1):** distance. The pipeline asks for it but never requests the permission (#2818).

**What sits unused:** 11 permissions are declared in the manifest but never requested. The pinned plugin cannot parse 9 of them. `ActivityIntensity` does not exist on the pinned SDK, and cycling cadence is already covered by the granted READ_EXERCISE. The remaining 16 or so types are not declared at all.

**Losses inside the types we do read:**
- Exercise sessions keep 4 of about 12 fields. Segments, laps, notes, the plan link, all provenance and about 60 of the roughly 70 exercise types are dropped.
- Nutrition keeps 4 of about 40 fields.
- HRV and SpO₂ are reduced to one clock-window mean per night.
- Only steps, active calories and cadence keep `dataOrigin` and device type.

**New defects (detail in Gaps §4):**
- (N1) An old-window "Import more history" wipes the permanent zone-minutes record beyond the 180-day HR retention.
- (N2) A Health Connect night's `durationHours` is time in bed, while the ring's is time asleep, and the sleep score treats it as time asleep.
- (N3) One over-long session title or a session longer than 24 h makes the schema reject the whole batch, and that wedges the entire sync silently.
- (N4) Exercise sessions are stored without provenance or record id, so they duplicate on edit and never delete.
- (N5–N7) Smaller ones.

## Legend

- **Manifest:** ✓ means declared, with its line in `android/app/src/main/AndroidManifest.xml`. ✗ means not declared.
- **Runtime:** ✓ means the type is in `HC_SYNC_READ_TYPES` (`sync:39-43`).
- **Plugin:**
  - **Parsed** means it has a branch in `RecordConverter.kt:29-192`.
  - **Agg** means the plugin offers an aggregate (`AndroidHealthConnect.kt:387-467`).
  - **String** means the type has a name but no converter branch, so the record comes back as `toString()` (`RecordConverter.kt:193`).
  - **No name** means the SDK's `RECORDS_TYPE_NAME_MAP` lacks it, so requesting it rejects the whole permission call (`AndroidHealthConnectPlugin.kt:73-77`).
- **Status** follows the brief's classes. `NOT-SUPPORTED (declared)` means the permission is declared but the plugin cannot parse the type.

## Record-by-record table

### Read by the pipeline today

| Record type (plugin name) | Key fields | Manifest | Runtime | Plugin | Sync reads | Server stores | Used by | Status |
|---|---|---|---|---|---|---|---|---|
| `HeartRateRecord` (`HeartRateSeries`) | `samples[{time, beatsPerMinute}]` | ✓ :171 | ✓ | Parsed. Agg avg/min/max exists but is unused. | Every sample, newest first, capped at 200k per sync (`sync:682-689`). Per session: sample mean and max (`sync:332-344`). | `oura_heartrate` (bpm, `source='health_connect'`; a ring or strap row wins at read time, `mergeHrSources`); `activity_logs.avg_hr/max_hr` | Zone minutes (`slices/oura.ts:1177`, sparse HC hours dropped) feed the live Activity score and shadow WHO minutes. Also `/api/hr-profile` (zone anchors), `/api/oura/hr-day` and `/api/oura/hr-window` charts, cardio-trends and `connected-sources` | **SCORED** |
| `HeartRateVariabilityRmssdRecord` | `time`, `heartRateVariabilityMillis` | ✓ :173 | ✓ | Parsed | Mean of readings 00:00–08:00 local (`sync:575-592`) | `body_metrics.hrv_ms` (rank 1, lowest) | Live readiness generic composite and illness radar for users with no ring summary (`rp:451-461`, `rp:615-684`). Shadow `heart.overnight_hrv` (`assemble.ts:180`). Coach (`lib/ai-chat/tools.ts:106`). RHR/HRV/SpO₂ card | **SCORED** |
| `RestingHeartRateRecord` | `time`, `beatsPerMinute` | ✓ :172 | ✓ | Parsed | Last reading per local day (`sync:565-572`) | `body_metrics.resting_heart_rate` | Live readiness (`rp:463-472`, `:616`). Training stress RHR (`restingHrForDay`). Shadow `overnight_rhr` (`assemble.ts:181`). Coach | **SCORED** |
| `OxygenSaturationRecord` | `time`, `percentage` | ✓ :174 | ✓ | Parsed | Mean of readings 00:00–08:00 (`sync:595-612`) | `body_metrics.spo2_pct` | RHR/HRV/SpO₂ card. `spo2Trend` in the AI-periodization prompt (`ai-periodization/signals.ts:548`). Coach (`tools.ts:107`). Shadow `body.spo2`, which is shown nowhere | **SHOWN** |
| `SleepSessionRecord` | `start/end`, `stages[{start,end,stage}]`, `title`, `notes` | ✓ :179 | ✓ | Parsed. Stage 7 (awake in bed) becomes UNKNOWN (`RecordConverter.kt:460-470`). | Span, deep/REM/light/awake hours, 5-minute hypnogram (`sync:636-675`) | `sleep_sessions` (`duration_hours`, stage hours, `sleep_phase_5_min`), rank-merged (`adapter.ts:3012`) | Live sleep score and readiness. Shadow sleep units (`assemble.ts:174-180`). Coach (`tools.ts:88`) | **SCORED** |
| `StepsRecord` (`Steps`) | `start/end`, `count` | ✓ :159 | ✓ | Parsed + Agg | Daily aggregate (`sync:496-506`) and every record (`sync:706-707`) | `body_metrics.steps`; `health_connect_intervals` kind `steps`, with `data_origin` and `device_type` | Live Activity score (`rp:528`, `:549`). Shadow `yesterday_movement` (`assemble.ts:185`). Training stress via `steps/min` → `cadence_met` (`app/api/training-stress/route.ts:126-129`). Step banks. Coach | **SCORED** |
| `ActiveCaloriesBurnedRecord` | `start/end`, `energy` | ✓ :161 | ✓ | Parsed. Agg exists but is never called. | Every record (`sync:710`) | `health_connect_intervals` kind `active_kcal`. No daily total is ever sent. | Training stress `active_kcal_met` only (`training-stress/route.ts:98`, `:119-121`). That score is gated on readiness from the ring (`:104`; `training-stress.ts:105`) | **SCORED\*** (ring users only) |
| `ExerciseSessionRecord` (`ActivitySession`) | `exerciseType`, `title`, `notes`, `segments[]`, `laps[]`, route, `plannedExerciseSessionId` | ✓ :164 | ✓ | Parsed. The plugin does not emit the route. | `startTime`, `endTime`, `exerciseType`, `title` only (`sync:616-632`) | `activity_logs`: one of 10 slugs, title, HH:MM start/end, duration, calories, avg/max HR. No source column. | Training stress compendium MET. `/api/cardio-week`, `/api/cardio-trends`, `/api/day-timeline`. Activity detail sheet | **SCORED** (MET) / SHOWN |
| `WeightRecord` | `time`, `weight` | ✓ :182 | ✓ | Parsed | Last reading per day (`sync:530-536`) | `body_metrics.weight_kg` | Shadow `weight_vs_plan`. Training stress kcal→MET weight (`training-stress/route.ts:112`). Nutrition-goal baseline. Coach. Weight-trend card | **SCORED** |
| `BodyFatRecord` | `time`, `percentage` | ✓ :184 | ✓ | Parsed (repo patch) | Last reading per day (`sync:539-545`) | `body_metrics.body_fat_pct` | Weight-trend card, `/api/body-metadata`. Katch-McArdle baseline in `/api/nutrition-goals/recommend` (`route.ts:135-137`, `:247-250`) | **SHOWN** |
| `NutritionRecord` | `energy`, `protein`, `totalCarbohydrate`, `totalFat`, 33 more nutrients, `name`, `mealType` | ✓ :188 | ✓ | Parsed: 4 macros and `name` only (`RecordConverter.kt:114-127`) | Per-day sums of the 4 macros (`sync:548-562`) | `body_metrics.calories/protein_g/carbs_g/fat_g` | `/api/day-log` and `/api/body-metadata` screens. Energy balance against 1RM in `/api/health-trends` (`route.ts:427`). It does **not** reach fuel | **SHOWN** |
| `StepsCadenceRecord` (`StepsCadenceSeries`) | `samples[{time, rate}]` | READ_STEPS | Through `Steps` | Parsed | Every sample (`sync:708`) | `health_connect_intervals` kind `cadence_spm` | Nothing reads it | **STORED-UNUSED** |
| `TotalCaloriesBurnedRecord` | `start/end`, `energy` | ✓ :162 | ✓ | Agg only; records come back as strings | Daily aggregate (`sync:520-527`); per-session aggregate (`sync:324-330`) | Daily: none, because `route:199-216` never maps `caloriesBurned` (#2818). Session: `activity_logs.calories_burned` | Session value on the activity screens | **DROPPED** (daily) / SHOWN (session) |
| `DistanceRecord` | `start/end`, `distance` | ✓ :160 | ✗ | Agg only | Requested only under the `Steps` grant, then refused; the plugin swallows the error (`sync:316-322`, `:509-517`) | Never filled: `body_metrics.distance_km`, `activity_logs.distance_km`. Tasker's ingest path can write `distanceKm`. | — | **NOT-READ** (broken, #2818) |

### Declared in the manifest, never requested

| Record type | Key fields | Manifest | Runtime | Plugin | Sync / Server / Used | Status |
|---|---|---|---|---|---|---|
| `FloorsClimbedRecord` | `floors` | ✓ :163 | ✗ | String | — | NOT-SUPPORTED (declared) |
| `SpeedRecord` (`SpeedSeries`) | `samples[{time, speed m/s}]` | ✓ :166 | ✗ | String; `SPEED_AVG` is not exposed | — (`activity_logs.avg_pace_sec_per_km` exists and is never filled from Health Connect) | NOT-SUPPORTED (declared) |
| `PowerRecord` (`PowerSeries`) | `samples[{time, power W}]` | ✓ :167 | ✗ | String | — | NOT-SUPPORTED (declared) |
| `Vo2MaxRecord` | `vo2MillilitersPerMinuteKilogram`, `measurementMethod` | ✓ :168 | ✗ | String | — | NOT-SUPPORTED (declared) |
| `RespiratoryRateRecord` | `time`, `rate` | ✓ :175 | ✗ | String | — | NOT-SUPPORTED (declared) |
| `SkinTemperatureRecord` | `deltas[{time, delta}]`, `baseline?`, `measurementLocation` | ✓ :176 | ✗ | String; needs `FEATURE_SKIN_TEMPERATURE` | — | NOT-SUPPORTED (declared) |
| `HeightRecord` | `height` | ✓ :183 | ✗ | String | — (`users.height_cm` comes from the profile) | NOT-SUPPORTED (declared) |
| `BasalMetabolicRateRecord` | `basalMetabolicRate` | ✓ :185 | ✗ | String | — (`body_metrics.bmr_kcal` exists and only the scale fills it) | NOT-SUPPORTED (declared) |
| `HydrationRecord` | `volume` | ✓ :189 | ✗ | String | — (`body_metrics.water_ml` exists) | NOT-SUPPORTED (declared) |
| `CyclingPedalingCadenceRecord` | `samples[{time, revolutionsPerMinute}]` | Covered by READ_EXERCISE, **already granted** | ✗ | String | — | NOT-SUPPORTED (converter branch only) |
| `ActivityIntensityRecord` | `activityIntensityType` (moderate or vigorous) | ✓ :165 | ✗ | **No name.** The class is absent in alpha11. Added in 1.2.0-alpha01 (Android 14+) and alpha03 (Health Connect APK); named in alpha06. | — | NOT-SUPPORTED (SDK) |

### Not declared

| Record type | Key fields | Plugin (alpha11) | Status |
|---|---|---|---|
| `ElevationGainedRecord` | `elevation` (m) | String | NOT-DECLARED. `activity_logs.elevation_gain_m` exists. |
| Exercise route (READ_EXERCISE_ROUTE) | `route.locations[{time, lat, lon, alt}]` | The plugin omits it | NOT-DECLARED |
| `BloodPressureRecord` | `systolic`, `diastolic`, `bodyPosition`, `measurementLocation` | String | NOT-DECLARED |
| `BloodGlucoseRecord` | `level`, `specimenSource`, `mealType`, `relationToMeal` | String | NOT-DECLARED |
| `BodyTemperatureRecord`, `BasalBodyTemperatureRecord` | `temperature`, `measurementLocation` | String | NOT-DECLARED |
| `LeanBodyMassRecord`, `BodyWaterMassRecord`, `BoneMassRecord` | `mass` | String | NOT-DECLARED. `fat_free_mass_kg` and `bone_mass_kg` exist and only the scale fills them. |
| `WheelchairPushesRecord` | `count` | String | NOT-DECLARED |
| Menstruation flow and period, ovulation test, cervical mucus, intermenstrual bleeding, sexual activity | `flow`, `result`, … | String | NOT-DECLARED |
| `MindfulnessSessionRecord` | `mindfulnessSessionType`, `title`, `notes` | **No name** in alpha11, although the class exists. **Named from 1.1.0 stable**, as an experimental opt-in with permission `READ_MINDFULNESS`. | NOT-DECLARED + NOT-SUPPORTED (SDK) |
| `PlannedExerciseSessionRecord` | `blocks[{steps[{completionGoal, performanceTargets}]}]`, `completedExerciseSessionId` | **No name in alpha11 or in 1.2.0-alpha06** | NOT-DECLARED + NOT-SUPPORTED. Needs plugin code, not just an SDK bump. |
| Medical records (FHIR, 1.1.0-beta02 and later) | — | No | Out of scope |

**What a newer SDK unlocks, all verified in the sources jars:**
- connect-client **1.1.0** adds the `MindfulnessSession` name.
- **1.2.0-alpha06** adds the `ActivityIntensity` name.
- 1.2.0-alpha06 also adds `ExerciseSegment.weight`, `setIndex` and `rateOfPerceivedExertion`, and `ExerciseSessionRecord.rateOfPerceivedExertion`.
  - The release notes say the new exercise fields came in 1.2.0-alpha03.
  - None of them exists in 1.1.0.

## Field-level losses inside the types we read

- **Exercise session** (`sync:619-629`; the converter emits everything at `RecordConverter.kt:31-56`):
  - **Type granularity.** About 70 exercise types collapse to 10 slugs (`sync:80-92`).
    - Strength training, weightlifting, calisthenics, rowing, elliptical, stair climbing and others all become `other`.
    - `RUNNING_TREADMILL` becomes `run`, although a `treadmill` slug exists (migration `094_treadmill.sql`).
    - `exerciseTypeId` is dropped.
  - **Dropped fields:** `notes`; `segments[]` (segment type and reps, the only strength-set detail alpha11 has); `laps[]` (length per lap, the raw material for splits and best efforts); `plannedExerciseSessionId`; zone offsets.
  - **Dropped metadata:** `dataOrigin`, device, `recordingMethod`.
  - **Columns we never fill from Health Connect:** `activity_logs.steps`, `avg_pace_sec_per_km`, `elevation_gain_m` and `cadence_spm`. All of them already exist (`packages/shared/src/types/body.ts:62-77`).
- **Heart rate:**
  - The writer's origin and device are dropped for every sample.
  - Two Health Connect writers at the same instant collapse to the last one (`collapseOnConflict`, `slices/oura.ts:755`).
  - Session average and max are over all writers' samples in the window, weighted by sample count rather than time (`sync:332-344`).
- **HRV and SpO₂:**
  - All readings collapse to one mean for 00:00–08:00. Readings outside it are discarded, including any daytime HRV (#2819).
  - Readings are count-weighted, so a writer that writes more often dominates.
- **Resting HR:** the last value of the day wins; earlier ones are discarded.
- **Weight and body fat:**
  - The last value of the day wins.
  - `recordingMethod` (manual entry or device) is dropped, so a hand-typed Health Connect weight ranks the same as a scale's.
- **Sleep:**
  - Awake-in-bed (7), sleeping (2) and unknown arrive without a stage, so a partly staged night gets no hypnogram.
  - `title` and `notes` are dropped.
  - Efficiency and latency are never derived from the stages. `sleep-score.ts:443` skips efficiency when it is null.
  - `durationHours` has the wrong meaning (N2).
- **Nutrition:**
  - 33 micronutrients are dropped: fibre, sugar, sodium, caffeine, saturated fat and others.
  - `mealType`, `name` and meal timing are dropped, because records are summed per day.
- **All daily metrics:** `dataOrigin` is dropped, so `source_map` says only `health_connect`.
  - Two writers, such as Samsung and Fitbit, cannot be told apart.
  - So the rule "learn the normal per source" cannot apply inside Health Connect.
  - Only the interval rows keep `data_origin` and `device_type` (`route:342-345`).
- **Aggregates offered but unused:**
  - HeartRate avg/min/max.
  - The daily ActiveCaloriesBurned total. Because of this, `body_metrics.active_calories` is never filled from Health Connect. The Activity score's active-energy part (`activity-score.ts:136`, through `rp:529`/`:550`) and the health-insight coach (`app/api/ai/health-insight/route.ts:200`) get nothing. This is the downstream cost of #2818 item 2, which notes that the route maps `activeCalories` and the phone never sends it.

## Gaps

### 1. What we drop

- **Daily total calories** are read and then discarded by the route (#2818).
- **The daily active-calorie total** is never computed, although the permission is granted and the plugin aggregate exists (see above).
- **Distance** is never granted (#2818). Per-session distance, pace and the efficiency curve are therefore empty for Health Connect runs.
- **The field-level losses above.** The ones with the most scoring value are:
  - exercise type for strength sessions;
  - laps and segments;
  - nutrition micronutrients;
  - per-writer provenance.

### 2. What we store but never use (or use only where it changes nothing)

- **`health_connect_intervals.cadence_spm`:** no reader exists (#2818 side note).
- **`health_connect_intervals` steps and active kcal for a user with no ring.**
  - Training stress, their only reader, returns `no_readiness` unless `readinessSource === 'ble-derived'` (`training-stress/route.ts:104`; `training-stress.ts:105`).
  - So for a Health Connect-only user these rows never produce a number.
  - For a ring user they fill only the minutes the ring missed.
- **`body_metrics` nutrition** never reaches the fuel unit (#2818 side note). It is shown and feeds one correlation.
- **SpO₂ and body fat** are shown, put in a prompt, or used in a shadow model that is shown nowhere. No live score reads either.
- **Health Connect heart rate older than 180 days** that the history import uploads is deleted within 24 h by the retention prune (`slices/oura.ts:704`, `:776`). Before that, the upload invalidates the zone-minutes cache (N1).

### 3. What we cannot read

- **Declared but unparsed (9):** respiratory rate, skin temperature, VO₂ max, speed, power, floors, height, BMR and hydration. Each needs a Kotlin converter branch and a new APK.
- **Covered by an existing grant but unparsed:** cycling cadence.
- **SDK too old:**
  - `ActivityIntensity` needs 1.2.0-alpha06.
  - Mindfulness needs 1.1.0 or later.
  - Planned exercise needs plugin code, because no SDK release names it.
  - RPE and lift weight need 1.2.0-alpha06.
- **Not declared:** blood pressure, blood glucose, body and basal temperature, lean, water and bone mass, elevation, exercise route, the cycle-tracking types and wheelchair pushes.

### 4. Pipeline defects

**Already filed:**
- **#2818:** distance is never granted, and the daily total calories are dropped.
- **#2819:** HRV and SpO₂ use a 00:00–08:00 clock window; the RHR field comment is misleading; READ_ACTIVITY_INTENSITY is a trap on the pinned SDK.
- **#2502:** interval rows deleted at the source are never removed.

**New, with evidence.** Filed together as #2828.

**N1. A Health Connect history import past 180 days permanently erases the zone-minutes record. Severity: medium, latent.**
- **How it happens:**
  1. `upsertAggregatorHeartrate` deletes every cached `daily_zone_minutes` row from the earliest imported sample's day onward, with no upper bound and no retention guard (`lib/data/postgres/slices/oura.ts:745` → `:1219-1224`).
  2. A cached day older than `ZONE_HR_RETENTION_DAYS` (180) is documented as "the permanent record once HR thins", because its raw HR is already pruned (`:1208-1213`, `:1252`).
  3. "Import more history" walks back up to 3,650 days (`lib/health-connect-history-import.ts:23`), and `historyFrom` widens the route's past floor so those samples are accepted (`route:184-190`, `:308`).
- **Result:** importing a window from, say, 300 days ago deletes the ring user's frozen zone minutes for days 180–300. The next read (`:1256`) recomputes them from what is left: Health Connect samples until the daily prune, or nothing. It then caches zeros or a Health Connect-only split as the new permanent record.
- **Fix direction:** clamp the delete's `fromDay` to the retention cutoff, or skip the delete for days older than it.

**N2. A Health Connect night's `durationHours` is time in bed; everywhere else it means time asleep. Severity: medium; it affects scoring, so the fix needs a `type: tuning` note.**
- The phone sends `durationHours = (end − start)`, the session span including the awake and out-of-bed stages (`sync:645`, `:666`).
- The ring writes total sleep when it has phases (`lib/oura-ble/rollup/run.ts:497`).
- The sleep score treats the field as time asleep:
  - awake fraction = `awakHours / (durationHours + awakHours)` (`packages/shared/src/health/sleep-score.ts:407-408`);
  - `totalSleepHours` sums it (`packages/shared/src/health/sleep-night.ts:216-218`).
- **Result:** a staged Health Connect night overstates sleep and understates time awake, which feeds the duration, balance and awake terms.
- **Fix direction:** when the night has stages, send deep + REM + light as `durationHours` and keep the span only for unstaged nights. Health Connect has never run on real data, so no past days should move. Confirm with a `claude_ro` count of `sleep_sessions` rows sourced from Health Connect.

**N3. One out-of-range record makes the schema reject the whole batch and wedges the whole Health Connect sync, silently. Severity: medium.**
- **The bounds:** `/api/sync-health` checks item fields inside a single `safeParse` and returns 400 for the whole body (`route:160-163`). Those checks include:
  - exercise `title` at most 200 characters (`:70`);
  - `durationMin` at most 1,440 (`:74`);
  - sleep `durationHours` at most 24 (`:84`);
  - `sleepPhase5Min` at most 288 characters (`:91`).
- **No guard on the phone:** it sends the writer's title untruncated (`sync:624`) and sends any session length.
- **What one bad record blocks:**
  - On a 400 the phone throws (`sync:730`) before `onPosted` (`:734`), so `LAST_SYNC_KEY` is never set and the 30-day cold window repeats.
  - The heart-rate and interval uploads after it never run.
  - The provider swallows the error (`components/health-connect-provider.tsx:17`).
- **Triggers:** a workout left running past 24 h, a long custom title, or a broken sleep record. Any one blocks every Health Connect write for up to 30 days.
- **Contradiction:** the route's own comment promises per-record rejection "never a 400 for the batch" (`route:168-170`).

**N4. Health Connect exercise sessions have no provenance and no record id. Severity: low to medium.**
- `activity_logs` has no source column (`schema.ts`, activityLogs). The route de-duplicates on `date|HH:MM` start only (`route:231`, `:243`).
- **Consequences:**
  - A session whose start the writer later moves by a minute is stored twice.
  - A session deleted in Health Connect never leaves.
  - A walk logged in the app at 07:02 and the watch's 07:01 session both count, in cardio counts and in the training-stress compendium MET.
- This is the `activity_logs` sibling of #2502.

**N5. An untitled session is shown as a raw constant. Severity: cosmetic.**
- The plugin sends `title: ""` for a null title (`RecordConverter.kt:39`). The phone falls back to the `exerciseType` string (`sync:624`).
- So the activity sheet shows "EXERCISE_TYPE_STRENGTH_TRAINING" (`components/activity/activity-detail-sheet.tsx:138`; `components/health/day-detail/day-sections.tsx:289`).

**N6. Watch strength sessions never reach training load. Severity: low (scope).**
- They map to `other` (`sync:80-92`).
- Training load and ACWR read only `workout_sessions` (`assemble.ts:136-158`; `rp` `computeVolumeAcwr`).
- `other` is not cardio either (`collection/ladder.ts:349`).
- So a gym session logged on a watch counts only as compendium MET.

**N7. A pitfall for the #2818 fix. Severity: low.**
- The daily distance and total-calorie aggregates return 0 for empty days, and the phone writes them unconditionally (`sync:514-515`, `:525`). Steps skips zero (`sync:503`).
- Once Distance is granted, every day in the window is stamped `distance_km = 0` with source `health_connect`.

## Unused data with metric potential

Each idea names the Health Connect type it needs. An evidence pointer appears only where I checked it in code.

1. **Temperature and breathing for users with no ring.**
   - **What:** a nightly skin-temperature deviation, taken from `SkinTemperatureRecord.deltas` inside the Health Connect sleep session. Respiratory rate the same way. A `BodyTemperatureRecord` spot reading of 38 °C or more confirms a fever.
   - **Why:** today the generic readiness composite and illness radar hard-code `tempZ: null` and `breathZ: null` (`rp:640`, `rp:684`). A user without a ring therefore gets an illness check built on RHR and HRV alone, and loses the signals that carry 65% of it.
   - **Needs:** two converter branches. Both permissions are already declared.
2. **Aerobic efficiency (HR at pace) and cardiac drift for watch runs.**
   - **What:** compute pace from distance and moving time, or from `SpeedSeries`, plus HR over the same window from the same writer. Drift is the HR rise in the second half of a steady effort, a fatigue marker. Grade-adjust it with `ElevationGainedRecord` for hikes.
   - **Evidence:** `buildEfficiencyCurve` already exists (`packages/shared/src/health/cardio-trends.ts:46-53`). `activity_logs.avg_pace_sec_per_km` and `elevation_gain_m` exist (`types/body.ts:68-69`). Health Connect runs fill neither.
3. **Cycling load from power.**
   - **What:** normalized power and intensity factor from `PowerSeries`, cadence from `CyclingPedalingCadenceSeries`, and power-to-HR decoupling across a ride as an endurance and fatigue marker.
   - **Already in place:** READ_POWER is declared (`:167`), and cadence is covered by the READ_EXERCISE grant we already hold.
   - **Needs:** an FTP. It can be estimated from the best 20-minute power. Few apps write power.
4. **A measured VO₂ max anchor.**
   - **Why:** training stress uses a VO₂ max estimated from resting HR, age, sex, weight and height (`training-stress/route.ts:148-156`, where `measuredMaxHr: null`).
   - **What:** `Vo2MaxRecord` (declared, `:168`) gives a watch's per-workout estimate together with its `measurementMethod`. That is a fitness trend we have no other source for, and a cross-check on our estimate. It must be learned per writer.
5. **Glucose from a continuous monitor as a fuel measurement that needs no logging.**
   - **What:** overnight mean and lowest value, glycaemic variability (CV%), and dips after sessions, from dense `BloodGlucoseRecord` series. Continuous-glucose apps write these, with `relationToMeal`.
   - **Why:** fuel can only score after a "fully logged" check-in (prior review §2.1). A monitor gives a measured route instead.
   - **Needs:** a manifest entry and a converter branch. It is a sensitive category.
6. **A morning blood-pressure normal.**
   - **What:** a resting systolic and diastolic trend against the user's learned normal, as context for overreaching or illness, kept beside the fixed clinical thresholds.
   - **Who writes it:** Samsung Health writes blood pressure (Samsung mapping in the prior review §2.3).
   - **Needs:** a manifest entry and a converter branch.
7. **Cycle-phase context, to keep the illness radar from false alarms.**
   - **What:** menstruation period and flow, plus basal body temperature or ovulation tests, tell the model when to expect the luteal rise in temperature and resting HR and the dip in HRV. Without them, those days look like illness.
   - **Scope:** only for users who log this data. It is a sensitive category and needs a manifest entry.
8. **Whether mindfulness raises next-night HRV for this user.**
   - **What:** a personal correlation between mindfulness minutes and the next night's HRV.
   - **Evidence:** the correlation machinery already exists (`correlationInsight`, `app/api/health-trends/route.ts:146`, `:210`, `:290`).
   - **Needs:** the `MindfulnessSession` name exists from connect-client 1.1.0 stable (verified), so it needs that SDK bump and a manifest entry.
9. **Session-RPE load that counts cardio and strength on one scale.**
   - **What:** `ExerciseSessionRecord.rateOfPerceivedExertion` × minutes.
   - **Why:** the repo already derives session effort (`sessionEffort`, `health-trends/route.ts:164`) and runs ACWR. A run or class logged on a watch would finally count in training load, which today is strength volume only.
   - **Needs:** 1.2.0-alpha06 (verified in the sources jar), and the writer must fill the field.
10. **Plan adherence, plus writing our program back to Health Connect.**
    - **What:** `PlannedExerciseSessionRecord.completedExerciseSessionId` gives planned against done. Writing our sessions as planned workouts lets a watch guide the workout with HR, power or pace targets.
    - **Needs:** plugin code, because no SDK release names the type in `RECORDS_TYPE_NAME_MAP`.

## Not exercised

- No Health Connect provider, permission grant or APK was used.
- No real writer data. Per the brief, Health Connect has never run on real data, and production holds zero rows in `health_connect_intervals`.
- Which apps write which type rests on the prior review's sources and was not re-checked.
- N1 and N3 come from reading the code. Neither was reproduced against a database or a device.
