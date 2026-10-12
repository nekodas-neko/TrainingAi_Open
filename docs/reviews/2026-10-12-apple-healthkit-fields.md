# Apple HealthKit as a readiness source

_Research note written 2026-10-12 for [`scoring-layers-and-data-inputs.md`](../architecture/scoring-layers-and-data-inputs.md) §6 and §9. Read-only research: nothing was run on a device, and no production data was used._

_Research note, 2026-10-12. Read-only: nothing in the repo was changed. Written for the native
iPhone client (Expo / React Native) that jsboiss is building._

**How this was checked.**
- **Identifier names, units and minimum OS versions** come from Apple's developer documentation. I
  read each page through Apple's DocC JSON feed (`developer.apple.com/tutorials/data/documentation/healthkit/<page>.json`),
  which serves the same content as the human page at `developer.apple.com/documentation/healthkit/<page>`.
- **Apple Watch sampling rates** come from Apple's white paper
  [*Using Apple Watch to measure heart rate, calorimetry, and activity* (Nov 2024)](https://www.apple.com/health/pdf/Heart_Rate_Calorimetry_Activity_on_Apple_Watch_November_2024.pdf),
  from Apple Support pages, and from the Sept 2026 Apple Newsroom posts.
- **Anything marked _unverified_** I could not confirm on an Apple page.

---

## Key findings

1. **HealthKit's HRV has been SDNN only since iOS 11. iOS 27 adds
   `HKQuantityTypeIdentifier.heartRateVariabilityRMSSD`** (iOS 27.0 / watchOS 27.0), but Apple
   documents only its declaration.
   - Apple has not said whether Apple Watch writes it, or whether it is the "Recovery HRV" shown on
     Series 12 / Ultra 4. _Unverified._
   - On iOS ≤ 26, or on older watches, HRV is SDNN.
2. **We can compute our own rMSSD today.**
   - Apple Watch stores each HRV reading's beat-to-beat tachogram as an `HKHeartbeatSeriesSample`.
     The white paper says "SDNN is stored alongside the sequence of individual beat-to-beat
     measurements, used to calculate other HRV metrics".
   - We can feed those beats to `packages/shared/src/health/rmssd.ts`, so we get our own statistic
     and not Apple's SDNN.
   - Limit: the windows are short (≈1 min) and sparse.
3. **Overnight HRV is sparse.** The watch records a tachogram (a list of beat-to-beat intervals)
   only while the wearer is still:
   - by default, once every **4 h**;
   - every **2 h** with Irregular Rhythm Notifications on;
   - every **15 min** with AFib History on.

   Series 12 / Ultra 4 claim "as often as every five minutes". Nothing like Oura's 5-min rMSSD all
   night is available on older watches.
4. **Apple's `restingHeartRate` is an awake figure** (#2821). It is built from still periods
   **outside** sleep, and one value is published per day.
   - It fills our **daytime resting HR** unit, which is not built yet.
   - It does **not** fill overnight resting HR. That has to come from overnight `heartRate`
     samples, which the watch takes at most once per 5-min window.
   - The existing plan doc maps it straight onto `restingHeartRate`. That mapping should be
     revisited.
5. **Apple's own scores are not in HealthKit.** None of these appear in the HealthKit identifier
   indexes as of today:
   - Readiness (0–10, Series 12 / Ultra 4);
   - Sleep Score (0–100);
   - Training Load;
   - Vitals typical ranges.

   There is also no stress type at all.
6. **Wrist temperature is one absolute nightly value**, Series 8+ / Ultra only, readable from the
   first night. We compute the deviation against our own per-source normal.
7. **Sleep latency is not observable from Apple Watch data.** The watch writes `awake` only
   *between* sleep samples, and an `inBed` sample may have no stage samples at its start or end.
   This weakens latency (10) and efficiency (20).

---

## What the repo says about iOS, Expo and HealthKit

- **There is no iOS or Expo client code in this repo, and no HealthKit library.** `package.json`
  and `pnpm-lock.yaml` carry only the Android `@devmaxime/capacitor-health-connect`.
- **Server groundwork exists:**
  - `POST /api/sync-health` accepts `source: 'apple_health'` (`app/api/sync-health/route.ts:51`).
  - `HEALTH_SOURCES` includes `'apple_health'` at rank 1, the same tier as Health Connect
    (`packages/shared/src/health/source-rank.ts:16-22`). An aggregator row yields to any ring or
    strap row in `mergeHrSources` (`packages/shared/src/health/hr-window-merge.ts`).
  - Table `apple_health_samples` (migration `lib/data/postgres/migrations/202609280817_apple_health_samples.sql`,
    PR #1608 by jsboiss):
    - its key is `(user_id, sample_id)`;
    - its columns include `sample_type`, `quantity_value`/`quantity_unit` **or**
      `category_value`, `source_bundle_id`, `device_model` and `deleted_at`;
    - it fits HealthKit anchored queries, with their deletes;
    - nothing writes to it yet (`docs/data-residency.md`: "writer: none found").
  - iPhone sign-in (PR #2508, `app/mobile-signin/ios/page.tsx`).
- **Plans:**
  - `docs/superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md` (PS-46 / issue #2172). It was written for Capacitor and deferred by the owner on 2026-09-20.
    Its mapping table broadly agrees with this note. It differs on resting HR (see finding 4) and
    averages SDNN overnight.
  - The unmerged, closed PR #1593 (`codex/ios-backend-plan`) sequences the backend before the
    "Expo interface" (PS-48…PS-53). It warns: "Do not promise Zepp HRV, oxygen or respiratory
    coverage until actual records are observed". So the first iPhone user's data may be written by
    **Zepp (Amazfit)**, not Apple Watch.
  - `docs/architecture/scoring-layers-and-data-inputs.md` (2026-10-11) is the current overview for
    the native work.
- **Library: none named anywhere.** For reference I checked one candidate without adopting it:
  `@kingstinct/react-native-healthkit` **16.1.0**.
  - Published 2026-10-07, MIT licence.
  - Ships an Expo config plugin; does not work in Expo Go.
  - Peer dependencies: `react` ≥ 19, `react-native` ≥ 0.79, `react-native-nitro-modules` ≥ 0.35.
  - Its generated types list 122 quantity identifiers. These include `HeartRateVariabilityRMSSD`,
    `AppleSleepingWristTemperature`, `AppleSleepingBreathingDisturbances`, `PhysicalEffort`,
    `TimeInDaylight`, `HeartRateRecoveryOneMinute`, `WorkoutEffortScore` and
    `EstimatedWorkoutEffortScore`.
  - It has a HeartbeatSeries module (each beat is `{ timeSinceSeriesStart, precededByGap }`) and a
    StateOfMind module.
  - Its sleep enum is `inBed=0, asleepUnspecified=1, awake=2, asleepCore=3, asleepDeep=4, asleepREM=5`.
  - I found **no** support for the iOS 27 workout-zone API (`HKWorkoutZoneGroup`) in its source.
  - The older `react-native-health` was last published at 1.19.0 on 2024-10-15. I did not inspect it.

---

## 1. Type-by-type table

**Our ids.** Metric ids are as in the brief. "NEW: x" proposes a metric id that follows the rule
"id says cadence" (`docs/architecture/scoring-layers-and-data-inputs.md` §1).

**Origin tags.**
- **Measured:** Apple's sensor algorithm output, the closest HealthKit gets to raw.
- **Apple estimate:** a figure Apple derives from other data.
- **Logged:** entered by the user or by another app.

### 1a. Quantity types (`HKQuantityTypeIdentifier`)

| Identifier | What it measures | Shape and resolution on Apple Watch | Units | Min iOS / watchOS; device | Our metric | Score (pillar) it could feed | Caveats |
|---|---|---|---|---|---|---|---|
| [`heartRate`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartrate) | Instantaneous HR | Discrete samples (some are series). **Background:** one attempt per non-overlapping 5-min window, only while still, infrared PPG at night. **Workout / Heart Rate app:** one every 5 s. **Walking spot checks:** up to 1 min. **Breathe sessions:** one per minute. **Series 12 / Ultra 4 (watchOS 27):** "every five seconds, all day long" (Newsroom). Whether all of those land in HealthKit is _unverified_. | count/time (read as count/min = bpm) | iOS 8 / watchOS 2; motion-context metadata iOS 11 / watchOS 4; any Apple Watch | `hr_per_5min` (overnight, from samples in the sleep window); `hr_per_min` (workouts only; at rest at most one per 5 min); **not** `hr_per_sec` | Heart: overnight resting HR 30 and settling 15, both derived from the overnight curve; HR recovery after sets 10 (HRR60 from 5-s samples, if the lift is recorded as a watch workout). Activity: zone minutes 20. Body: daytime stress 10 (high HR in samples tagged `HKMetadataKeyHeartRateMotionContext = sedentary`, meaning still ≥ 5 min) | **Origin:** measured. Accuracy is preferred over availability, so gaps are normal. HealthKit **condenses** samples from first-party workouts a few months old into series and deletes the originals, so an anchored sync sees deletes. Ranks below ring and strap. |
| [`restingHeartRate`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/restingheartrate) | Apple's estimate of the lowest HR while **at rest and awake** | **One per day**, published at the end of the day. Built from the most inactive background readings, **excluding** Sleep Focus, Bedtime and sleep. Apple may delete and replace the current and previous day's sample. | count/time | iOS 11 / watchOS 4 | **NEW: `rhr_per_day`** (daytime). **Not** `rhr_per_night` | Heart: **daytime resting HR 10** (not built). Not overnight resting HR 30 | **Origin:** Apple estimate. Its definition differs from our overnight RHR, so it needs its own normal. Revisions arrive as deletes. |
| [`walkingHeartRateAverage`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/walkingheartrateaverage) | Average HR while walking | One per day, built from up-to-1-min walking spot checks and walking workouts. May be replaced for the current and previous day. Read-only: apps cannot save it. | count/time | iOS 11 / watchOS 4 | **NEW: `walking_hr_per_day`** | Heart, as a new unit (see §2) | **Origin:** Apple estimate. Moves with how much and how fast you walk, and with heat. |
| [`heartRateVariabilitySDNN`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilitysdnn) | **SDNN**: the standard deviation of normal-to-normal beat intervals in one tachogram | Discrete sample per tachogram, recorded only while still: every **4 h** by default, every **2 h** with Irregular Rhythm Notifications, every **15 min** with AFib History. Every Breathe session also produces one. **Series 12 / Ultra 4:** "as often as every five minutes" (Newsroom); which identifier gets those readings is _unverified_. | ms (time units) | iOS 11 / watchOS 4 | `hrv_per_night`, only under a **separate statistic tag and source** | Heart: overnight HRV 35 | **Origin:** Apple-computed statistic over measured beats; Apple tries to reject ectopic beats. **SDNN, not RMSSD:** it cannot share a baseline with Oura's rMSSD (`0x5d`) or Health Connect's RMSSD, and must never be averaged with them. Windows are ultra-short (≈1 min). Overnight coverage is ≈0–3 samples a night at the default cadence (my estimate from the 4 h cadence). Breathe-session samples are paced breathing, so drop them from passive baselines. Prefer computing rMSSD from the attached heartbeat series (row below in §1c). |
| [`heartRateVariabilityRMSSD`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartratevariabilityrmssd) | RMSSD (by its name) | Apple documents only the declaration: no description, no cadence. | _unverified_ (ms by analogy) | **iOS 27.0 / watchOS 27.0** | `hrv_per_night` | Heart: overnight HRV 35 | **Origin:** _unverified_. The Sept 2026 posts describe "Recovery HRV" (stress and recovery, against your baseline) and "overall HRV" on Series 12 / Ultra 4. Secondary sources say Apple has **not** mapped either to RMSSD or SDNN. Even when it is RMSSD, it is a different device and algorithm, so it keeps its own baseline (our rule: a new source restarts the normal). Read both types on day one and compare. |
| [`heartRateRecoveryOneMinute`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/heartraterecoveryoneminute) | Apple "cardio recovery": the drop in HR one minute after exercise | One per qualifying **user-started workout**. The watch keeps measuring for 3 min after the workout ends. The value is a **prediction** of 60-s recovery after submaximal exercise at 85% of predicted max HR, **capped at 55 bpm**, and always positive. | count (bpm drop) | iOS 16 / watchOS 9 | **NEW: `cardio_recovery_per_workout`** (not our per-set HRR60) | Heart: HR recovery 10, only as a separate rung or input with its own normal | **Origin:** Apple estimate, built to be robust to how hard the workout was. That makes it comparable between workouts, but it is not the raw drop our set-level HRR60 measures. Which workout types qualify is _unverified_. |
| [`respiratoryRate`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/respiratoryrate) | Breaths per minute | Recorded automatically on Apple Watch **during sleep** (since watchOS 8, per Apple's Watch User Guide). Several samples a night; the exact cadence is _unverified_. Not available under age 13. | count/time | iOS 8 / watchOS 2 for the type; sleep recording since watchOS 8 | `breath_per_night` (median of samples in the sleep window) | Body: breathing rate 20; illness check (25% of it) | **Origin:** measured, by Apple's algorithm; the method is not documented. Needs its own normal per source. |
| [`oxygenSaturation`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/oxygensaturation) | SpO₂ | Background readings are "periodic", usually while still. Number and spacing "will vary". During sleep only with Track Sleep on. The Health app can filter sleep readings. | percent (HealthKit stores a 0–1 fraction; general knowledge, check on device) | iOS 8 / watchOS 2 for the type; **Series 6+ and all Ultra, not SE**; age 18+ | `spo2_per_night` | Body: SpO₂ 15 | **Origin:** measured; Apple's processing is calibrated, unlike our raw ring estimate. **US watches bought on or after 18 Jan 2024 with part numbers ending LW/A or LS/A** compute it on the iPhone and show it only in Health. Whether third-party reads work the same is _unverified_. Sparse and irregular cadence. |
| [`appleSleepingWristTemperature`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applesleepingwristtemperature) | Wrist temperature during sleep | **One sample per night.** Both sensors read every 5 s while asleep; Apple corrects for environmental bias and stores one value for the night. Read-only. Readable from the **first** night; the Health app shows a relative value only after about 5 nights. | temperature (°C) | **iOS 16 / watchOS 9; Series 8+ and all Ultra**; Sleep Focus on, ≥ 4 h asleep | `temp_dev_per_night` (we subtract our own normal) | Body: temperature deviation 25; illness check (40% of it) | **Origin:** Apple estimate (aggregated and bias-corrected). The stored value is **absolute**; the deviation is ours to compute. A new watch shifts the baseline, so include the device model in the source key. Shifts in the luteal phase; Apple uses it for cycle estimates. No curve within the night. |
| [`bodyTemperature`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bodytemperature) | Body temperature (thermometer or manual entry) | Discrete, sparse. Apple Watch does not write it. | temperature | iOS 8 / watchOS 2 | none (a manual fever flag at most) | Body: the proposed fever red-flag cap only | **Origin:** logged. Not comparable to wrist temperature. |
| [`basalBodyTemperature`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalbodytemperature) | Waking (basal) temperature, for cycle tracking | Manual, at most daily | temperature | iOS 9 / watchOS 2 | NEW: an input to `cycle_phase_per_day` | Context for the Body and Heart baselines | **Origin:** logged. |
| [`vo2Max`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/vo2max) | Estimated VO₂max ("cardio fitness") | Sparse: written after an **outdoor walk, run or hike**. Needs flat ground (under 5% grade), good GPS and heart signal, HR at or above ≈130% of resting HR, ≥ 1 day of wear, and not the first workout. | ml/(kg·min) | iOS 11 / watchOS 4; Series 3+ | **NEW: `vo2max_per_day`** (sparse) | Activity: block trend 15 (not built), or a new fitness unit (see §2) | **Origin:** Apple estimate (a submaximal prediction). The range is 14–60 per the DocC page and 14–65 per [Apple Support](https://support.apple.com/en-us/108790). Health can **recalculate** past estimates and a medication toggle changes them, so expect revisions and deletes. |
| [`stepCount`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/stepcount) | Steps | Cumulative samples of varying length from **both iPhone and Watch**, which overlap; interval length is not documented. Use `HKStatisticsCollectionQuery` with a daily `cumulativeSum`, which merges the sources. | count | iOS 8 / watchOS 2; iPhone or Watch | `steps_per_day` (steps per minute only roughly, from the intervals) | Activity: yesterday's steps 35 | **Origin:** measured (pedometer). Summing raw samples double-counts. On iOS, background delivery for this type is capped at **hourly**. Condensed after months, as for heart rate. |
| [`distanceWalkingRunning`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/distancewalkingrunning) | Walking and running distance | Cumulative, from iPhone and Watch; condensed in old workouts | length (m) | iOS 8 / watchOS 2 | existing `dailyMetrics.distanceKm` | none directly | **Origin:** measured or estimated (stride calibration). |
| [`activeEnergyBurned`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned) | Energy above resting | Cumulative, frequent; recorded automatically on the watch | energy (kcal) | iOS 8 / watchOS 2 | existing `activeCalories`; the expenditure side of `food_per_day` balance | Body: fuel 20 (energy balance, spend side) | **Origin:** Apple estimate (activity-specific MET models × weight). Total = active + basal. Use `HKWorkout.statistics(for:)`, not the deprecated `totalEnergyBurned`. |
| [`basalEnergyBurned`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalenergyburned) | Resting energy | Cumulative | energy (kcal) | iOS 8 / watchOS 2 | the expenditure side (as above) | Body: fuel 20 | **Origin:** Apple estimate from weight, height, age, sex and wheelchair status. |
| [`appleExerciseTime`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/appleexercisetime) | Minutes at or above brisk-walk intensity | Cumulative, whole minutes. Accelerometer by default; HR and GPS during workout sessions. | time (min) | iOS 9.3 / watchOS 2.2 | NEW: `exercise_min_per_day` | Activity: WHO zone minutes 20, as a **fallback** rung only | **Origin:** Apple estimate. No moderate/vigorous split, so the vigorous ×2 rule cannot be applied. Apple's threshold, not our HR zones. |
| [`appleStandTime`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applestandtime) | Minutes standing | Cumulative | time (min) | iOS 13 / watchOS 6 | none | none (sedentary context only) | **Origin:** Apple estimate. See also `HKCategoryTypeIdentifier.appleStandHour`. |
| [`physicalEffort`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/physicaleffort) | Estimated energy rate of the task, excluding temperature, altitude and HR | Discrete, "estimated and recorded automatically by Apple Watch". Whether it is all-day or workouts only, and at what cadence, is _unverified_. | METs (`kcal/(kg·hr)` as an HKUnit string is _unverified_) | iOS 17 / watchOS 10 | `met_per_min`, if it proves dense enough | Activity: training load 30 (MET-minutes), via the `MET/min` input | **Origin:** Apple estimate from motion, not HR. Measure density on a device before using it. |
| [`runningPower`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/runningpower) | Running power | Discrete, during **outdoor running** workouts; condensed | power (W) | iOS 16 / watchOS 9; **SE and Series 6+** | none | Activity: training load 30, possibly, for runs | **Origin:** Apple estimate. |
| [`runningSpeed`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/runningspeed) | Running speed | Discrete, during outdoor runs; condensed | m/s | iOS 16 / watchOS 9 | none | none | **Origin:** measured (GPS and motion). |
| [`bodyMass`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bodymass) | Weight | Discrete, from scales or manual entry | mass (kg) | iOS 8 / watchOS 2 | `weight_per_day` | Body: weight vs plan 10 | **Origin:** logged or third-party scale. No Apple device measures it. Our scale and manual entries outrank it (`source-rank.ts`). |
| [`bodyFatPercentage`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bodyfatpercentage) | Body fat | Discrete | percent (0–1) | iOS 8 / watchOS 2 | existing `dailyMetrics.bodyFatPct` | none (context for weight vs plan) | **Origin:** logged or scale estimate. |
| [`leanBodyMass`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/leanbodymass) | Lean mass | Discrete | mass (kg) | iOS 8 / watchOS 2 | none | none (could size protein targets) | **Origin:** logged or scale estimate. |
| [`dietaryEnergyConsumed`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/dietaryenergyconsumed) | Food energy | Cumulative, per logged item | energy (kcal) | iOS 8 / watchOS 2 | `food_per_day` | Body: fuel 20 (energy) | **Origin:** logged by food apps. Apple writes none. Risk of **double counting** with our own food log, so pick one source per day. |
| [`dietaryProtein`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/dietaryprotein) | Protein | Cumulative | mass (g) | iOS 8 / watchOS 2 | `food_per_day` | Body: fuel 20 (protein) | As for energy. |
| [`dietaryWater`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/dietarywater) | Water | Cumulative | volume (mL) | iOS 9 / watchOS 2 | `water_per_day` | Body: fuel 20 (water) | As for energy. |
| [`dietaryCaffeine`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/dietarycaffeine) | Caffeine | Cumulative, timestamped per drink | mass (mg) | iOS 8 / watchOS 2 | **NEW: `caffeine_mg_per_day`** (plus time of last intake) | context for Sleep latency and efficiency (see §2) | **Origin:** logged only. |
| [`appleSleepingBreathingDisturbances`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/applesleepingbreathingdisturbances) | Breathing disturbances during sleep, from the accelerometer | Apple documents only the declaration. Apple Support: each night is classed "Elevated" or "Not Elevated"; notifications use 30-day windows with ≥ 10 nights. | _unverified_ (likely per night) | **iOS 18 / watchOS 11**; Series 9+, Ultra 2+, SE 3 (current Support page) | **NEW: `breathing_disturbances_per_night`** | Body, or Sleep, as a new trend unit or red flag (see §2) | **Origin:** Apple estimate. Not a diagnosis; built for 30-day trends. |
| [`timeInDaylight`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/timeindaylight) | Time spent in daylight | Cumulative, from the watch's ambient light sensor. Needs Motion Calibration & Distance on. | time (min) | iOS 17 / watchOS 10; model list _unverified_ | **NEW: `daylight_min_per_day`** | Sleep: timing context (see §2) | **Origin:** Apple estimate. |
| [`environmentalAudioExposure`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/environmentalaudioexposure) | Ambient sound level | Discrete LAeq samples, "can be automatically collected by an Apple Watch" (Noise app). Cadence _unverified_. | dB(A) sound pressure | iOS 13 / watchOS 6 | none | none (night-time noise as sleep-environment context, at most) | **Origin:** measured. Low value for readiness. |
| [`workoutEffortScore`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/workouteffortscore) / [`estimatedWorkoutEffortScore`](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/estimatedworkouteffortscore) | Perceived (user) and estimated (Apple) workout effort | One per workout, attached with `relateWorkoutEffortSample(_:with:activity:completion:)` and read with `HKWorkoutEffortRelationshipQuery` | the scale is undocumented; developers report 1–10, like CR-10 (_unverified_) | iOS 18 / watchOS 11 | NEW: `effort_per_session` | Activity: training load 30 (session-RPE × minutes, for **non-lifting** sessions, which our load ignores today) | **Origin:** logged or Apple estimate. An Apple engineer on the forums says estimates exist only for walking, running, hiking and cycling. |

### 1b. Category types (`HKCategoryTypeIdentifier`)

| Identifier | What it measures | Shape and resolution | Units / values | Min iOS / watchOS; device | Our metric | Score (pillar) | Caveats |
|---|---|---|---|---|---|---|---|
| [`sleepAnalysis`](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/sleepanalysis) | Time in bed and sleep stages | Interval samples, one value each. `inBed` samples overlap the stage samples; stage samples do not overlap each other. **Apple Watch writes `awake` only between two sleep samples**, and there may be no stage samples at the start or end of an `inBed`. Apple recommends `HKMetadataKeyTimeZone`. | `HKCategoryValueSleepAnalysis` (table below) | type iOS 8 / watchOS 2; stages iOS 16 / watchOS 9 | `sleep_window` (first to last asleep sample); `sleep_stages_5min` via the existing `intervalsToPhase5Min()` (`packages/shared/src/health/hypnogram.ts`), never a second reducer | Sleep: duration 30, 7-night balance 15, timing 15, deep+REM share 10. **Efficiency 20 is weak and latency 10 is not observable** (see Caveats) | **Origin:** Apple estimate (motion plus HR classifier). Several apps write sleep (iPhone, Watch, Oura's app, AutoSleep, Zepp…), so pick **one source per night** by `sourceRevision`. Stage proportions are Apple's own, so deep+REM share needs a per-source normal. Efficiency needs `inBed`, which may be absent or come from the iPhone. |
| [`mindfulSession`](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/mindfulsession) | Meditation or breathing session | Interval; value `notApplicable` | interval length = minutes | iOS 10 / watchOS 3 | **NEW: `mindful_min_per_day`** | Body: stress (behaviour), see §2 | **Origin:** logged (Mindfulness app or third-party apps). Breathe sessions also write HR per minute, an SDNN sample and a tachogram, so exclude those from passive HRV. |
| [`menstrualFlow`](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/menstrualflow) | Period days and flow | Interval or day samples; **must** carry [`HKMetadataKeyMenstrualCycleStart`](https://developer.apple.com/documentation/healthkit/hkmetadatakeymenstrualcyclestart), `true` on the first sample of a period | `HKCategoryValueMenstrualFlow` (unspecified, none, light, medium, heavy). **Deprecated iOS 18 / watchOS 11**, replaced by [`HKCategoryValueVaginalBleeding`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluevaginalbleeding) | iOS 9 / watchOS 2 | **NEW: `cycle_phase_per_day`** (cycle day and phase, from cycle starts) | Not scored. Partitions the Body temperature and breathing normals and the Heart HRV and RHR normals: "cycle-aware normal (per-phase baseline)", `docs/architecture/readiness-tree.md` row 9 | **Origin:** logged. Apple's retrospective ovulation estimates (from wrist temperature) and cycle predictions are **not** HealthKit types; no identifier exists in the index. |
| Cycle-tracking types | Context around the cycle | Mostly point or interval, user-logged | own value enums | `intermenstrualBleeding`, `ovulationTestResult`, `cervicalMucusQuality`, `sexualActivity`: iOS 9. `contraceptive`, `pregnancy`, `lactation`: iOS 14.3. `pregnancyTestResult`, `progesteroneTestResult`: iOS 15. **Cycle Deviation, read-only, system-written:** `infrequentMenstrualCycles`, `irregularMenstrualCycles`, `persistentIntermenstrualBleeding`, `prolongedMenstrualPeriods`: iOS 16. `bleedingDuringPregnancy`, `bleedingAfterPregnancy`: iOS 18 (per the [HealthKit updates](https://developer.apple.com/documentation/updates/healthkit) page). `menopausalState`, `bleedingAfterMenopause`: **iOS 27** | inputs to `cycle_phase_per_day`, plus flags | Pregnancy, lactation, contraception and menopause states should **switch** baselines and illness flags, never score them | **Origin:** logged, except Cycle Deviation. Sensitive data: read only what is used. |
| Heart events: [`highHeartRateEvent`](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/highheartrateevent), `lowHeartRateEvent`, `irregularHeartRhythmEvent`, [`lowCardioFitnessEvent`](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/lowcardiofitnessevent), `hypertensionEvent`; plus quantity `atrialFibrillationBurden` | Notifications that Apple Watch raised | Event samples. High and low HR events carry `HKMetadataKeyHeartRateEventThreshold`. Low cardio fitness is about once every 4 months. AFib burden is weekly. | `notApplicable` / enums / % | HR events iOS 12.2 / watchOS 5.2; low cardio fitness iOS 14.3; AFib burden iOS 16; **`hypertensionEvent` iOS 26.2** (no description yet) | none | Candidates for the **proposed red-flag caps**, never a unit | **Origin:** Apple estimate. Read-only. Medical features: show them, never gate an action on them. |

**`HKCategoryValueSleepAnalysis` values** ([enum](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)):

| Value | Raw* | Meaning (Apple) | Min iOS / watchOS | Our `sleepPhase5Min` code |
|---|---|---|---|---|
| [`inBed`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/inbed) | 0 | In bed | iOS 8 / watchOS 2 | none (sleep window and efficiency only) |
| [`asleepUnspecified`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleepunspecified) | 1 | Asleep, stage unknown | iOS 16 / watchOS 9 | counts as asleep, but **unstaged**: no code, and never fabricate one |
| [`asleep`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleep) (deprecated) | 1 | Renamed to `asleepUnspecified`; deprecated iOS 16 / watchOS 9 | iOS 8 / watchOS 2 | as `asleepUnspecified` (pre-2022 data) |
| [`awake`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/awake) | 2 | Awake | iOS 10 / watchOS 3 | `4` |
| [`asleepCore`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleepcore) | 3 | AASM stages N1 + N2 ("light or intermediate") | iOS 16 / watchOS 9 | `2` (light) |
| [`asleepDeep`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleepdeep) | 4 | AASM stage N3 | iOS 16 / watchOS 9 | `1` (deep) |
| [`asleepREM`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/asleeprem) | 5 | REM | iOS 16 / watchOS 9 | `3` (REM) |
| [`allAsleepValues`](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis/allasleepvalues) | set | `asleep`, `asleepCore`, `asleepDeep`, `asleepREM`, `asleepUnspecified` | iOS 16 / watchOS 9 | for "asleep" predicates |

\*Raw values come from `@kingstinct/react-native-healthkit` 16.1.0's generated enum. Apple's DocC
JSON does not show them, so they are not verified against an Apple page.

### 1c. Series, workout and State of Mind

| Type | What it measures | Shape and resolution | Units | Min iOS / watchOS | Our metric | Score (pillar) | Caveats |
|---|---|---|---|---|---|---|---|
| [`HKHeartbeatSeriesSample`](https://developer.apple.com/documentation/healthkit/hkheartbeatseriessample). Type: [`HKSeriesType.heartbeat()`](https://developer.apple.com/documentation/healthkit/hkseriestype/heartbeat()) / [`HKDataTypeIdentifierHeartbeatSeries`](https://developer.apple.com/documentation/healthkit/hkdatatypeidentifierheartbeatseries). Read with [`HKHeartbeatSeriesQuery(heartbeatSeries:dataHandler:)`](https://developer.apple.com/documentation/healthkit/hkheartbeatseriesquery) | Beat-to-beat timing: the tachogram behind each HRV sample | One series per tachogram, so the same cadence as the SDNN row (4 h, 2 h or 15 min while still, plus Breathe sessions). A tachogram needs ≥ 10 consecutive pulses; its length is about 1 min (_unverified_). The handler gets `timeSinceSeriesStart` (s), `precededByGap` and `done` for each beat. | seconds since series start | **iOS 13 / watchOS 6** | `hrv_per_night`, computed **by us**: beats into `RrBeat {atMs, rrMs}`, then `rmssd.ts`. `precededByGap` breaks a pair, which fits its adjacency rule | Heart: overnight HRV 35, with an rMSSD formula identical to the ring's code path | **Origin:** measured: PPG pulse-to-pulse timing, not ECG R-R. Windows are short and sparse, and `rmssd.ts` needs ≥ 30 beats. Still needs its own source baseline: a different sensor and window. Our best route to a comparable *statistic* on iOS ≤ 26. |
| [`HKWorkout`](https://developer.apple.com/documentation/healthkit/hkworkout), `HKObjectType.workoutType()` | One exercise session | One sample per workout with:<br>• `workoutActivityType` (`HKWorkoutActivityType`)<br>• `duration` and `workoutEvents`<br>• [`workoutActivities`](https://developer.apple.com/documentation/healthkit/hkworkoutactivity) (iOS 16) for multisport and intervals<br>• [`statistics(for:)`](https://developer.apple.com/documentation/healthkit/hkworkout/statistics(for:)) and [`allStatistics`](https://developer.apple.com/documentation/healthkit/hkworkout/allstatistics) (iOS 16 / watchOS 9): an [`HKStatistics`](https://developer.apple.com/documentation/healthkit/hkstatistics) per type, sum for energy and distance, min/avg/max for HR, power and speed<br>• **[`zoneGroupsByType`](https://developer.apple.com/documentation/healthkit/hkworkout/zonegroupsbytype) and `zoneGroup(for:)` (iOS 27):** HR and cycling-power zone setup plus time in each zone ([`HKWorkoutZoneGroup`](https://developer.apple.com/documentation/healthkit/hkworkoutzonegroup))<br>The samples behind a workout come from a predicate on that workout. | per statistic | iOS 8 / watchOS 2. `totalEnergyBurned` deprecated iOS 18 / watchOS 11; `totalDistance` marked deprecated at 27.2 in DocC metadata. Both point to `statistics(for:)` | existing `exerciseSessions[]`. **`volume_kg_per_session`: no**, because HealthKit has no sets, reps or load | Activity: training load 30 (duration × effort, or HR-based load from the HR samples); zone minutes 20 (compute **our** zones from HR samples, not Apple's zone setup). Heart: HR recovery after sets 10 (from 5-s HR in a strength workout, aligned to our logged set times) | **Origin:** measured and estimated. Map `HKWorkoutActivityType` onto `activity_types` with a fresh table (the existing plan says the same). Old first-party workouts get **condensed**. |
| [`HKStateOfMind`](https://developer.apple.com/documentation/healthkit/hkstateofmind), `HKObjectType.stateOfMindType()` | Self-reported mood or emotion | One sample per log:<br>• `kind`: `dailyMood` or `momentaryEmotion`<br>• `valence`: a Double from **−1 to +1** (WWDC24 session 10109; the DocC page has no description)<br>• `valenceClassification`: 7 classes, `veryUnpleasant` to `veryPleasant`<br>• `labels`: 38, e.g. `stressed`, `anxious`, `drained`, `calm`<br>• `associations`: 18, e.g. `work`, `fitness`, `health` | valence (unitless) | **iOS 18 / watchOS 11** | **NEW: `mood_valence_per_day`** (dailyMood) | Body: daytime stress 10, as a subjective complement (see §2) | **Origin:** logged, in the Health app on iPhone or on Apple Watch, or by third-party apps. Sparse, with reporting bias. Never let it gate an action. iOS 18 also added the PHQ-9 and GAD-7 questionnaire types (out of scope, highly sensitive). |

---

## 2. New metrics Apple makes possible

These are metrics we do not score today. "Baseline-able" means a per-person normal, in the sense of
`readiness-tree.md` (median of 30 valid days from the same source, at least 7 days needed).

| Proposed metric | HealthKit source | Pillar | Baseline-able? | How it would score | Notes |
|---|---|---|---|---|---|
| `vo2max_per_day` | `vo2Max` | **Activity**, as fitness. It fits "block trend 28:90" (not built) better than daily readiness | **Yes, as a slow trend.** Level graded against age and sex norms, like Apple's own Low to High classes for ages 20+ | Sweet spot or directional ↑ over weeks; never a day-to-day swing | Sparse: only after qualifying outdoor walks, runs and hikes. Apple can revise past values. |
| `walking_hr_per_day` | `walkingHeartRateAverage` | **Heart** (daytime) | **Yes**: one value a day, learned, directional ↓ | Directional ↓ against your own normal | Moves with walking volume, pace and heat. A daytime companion to overnight RHR. |
| `cardio_recovery_per_workout` | `heartRateRecoveryOneMinute` | **Heart**: HR recovery 10, as a second input next to per-set HRR60 | **Yes, per workout.** Apple normalises it for exertion, so workouts compare | Directional ↑ | A prediction, capped at 55 bpm. Only after user-started workouts. Not a substitute for HRR60 between sets. |
| `breathing_disturbances_per_night` | `appleSleepingBreathingDisturbances` | **Body**, with breathing rate (or Sleep) | **Yes, nightly.** Apple itself reasons over 30-day windows | Better as a 30-day trend and red flag than as a daily unit | iOS 18+, Series 9+ / Ultra 2+ / SE 3. Unit and cadence _unverified_. |
| `daylight_min_per_day` | `timeInDaylight` | **Sleep** (circadian timing context); Activity as a second choice | **Partly.** As a target (reach-target or sweet spot), not a learned normal: daylight is behaviour, not physiology | Reach target | Model coverage of the ambient light sensor _unverified_. |
| `mood_valence_per_day` (plus labels) | `HKStateOfMind` (`dailyMood`) | **Body**: daytime stress | **Yes, if logged most days**: learned normal of valence | Directional ↑ valence; the `stressed` and `anxious` labels as flags | Self-report. Sparse logging makes the normal unreliable. |
| `caffeine_mg_per_day` (plus last-intake time) | `dietaryCaffeine` | **Sleep** context (latency and efficiency); Body fuel as a second choice | **No, not as a scored unit.** Use it as an explanatory input ("late caffeine, 400 mg") | none (explains a score) | Logged only. Timestamp quality depends on the logging app. |
| `mindful_min_per_day` | `mindfulSession` | **Body**: stress (behaviour) | **As a habit count, yes; as physiology, no** | Reach target, at most | Breathe sessions give controlled HRV spot readings. Keep them out of the passive HRV normal. |
| `cycle_phase_per_day` | `menstrualFlow` + `HKMetadataKeyMenstrualCycleStart`; `basalBodyTemperature`; `ovulationTestResult`; Cycle Deviation types | **Context, no pillar.** It splits the normals for Body temperature and breathing, and Heart HRV and RHR (readiness-tree row 9) | **It *is* the baseline split**: a normal per phase, not a scored value | none: it changes what "normal" means | Apple's ovulation estimates are not exposed. Needs consistent logging. |

**Also enabled, inside units we already define:**
- `rhr_per_day` (from `restingHeartRate`) fills **Heart: daytime resting HR 10**, which is not
  built.
- `effort_per_session` (from `workoutEffortScore` / `estimatedWorkoutEffortScore`) lets **training
  load** count runs and cardio. Today it counts only logged strength volume.
- `exercise_min_per_day` (from `appleExerciseTime`) is a fallback rung for zone minutes.
- `heartRateVariabilityRMSSD` (iOS 27) is a possible direct rMSSD source once its behaviour is
  measured.

---

## 3. Gaps: what HealthKit cannot give

1. **No daily stress figure.**
   - HealthKit has no stress type.
   - Apple's own composites are not HealthKit types: Readiness (0–10; inputs are activity, training
     load, overnight vitals and HRV, and sleep score; needs 7 of the past 49 nights; Series 12 /
     Ultra 4 only), Sleep Score (0–100: duration 50, bedtime consistency 30, interruptions 20),
     Training Load, and Vitals typical ranges. None appears in the quantity or category identifier
     indexes on 2026-10-12. That is evidence of absence, not an Apple statement.
   - `stress_min_per_day` has to be **derived** from HR samples tagged `sedentary`. Before
     Series 12 those are 5-min samples with no HRV alongside, so expect a coarse figure.
2. **No continuous overnight HRV.**
   - SDNN tachograms are ≈1 min long, taken every 4 h by default (2 h with IRN, 15 min with AFib
     History) and only while still. That gives at most a few samples a night, against Oura's 5-min
     rMSSD all night.
   - Series 12 / Ultra 4 measure "as often as every five minutes", but **which type, and whether
     every reading is stored, is _unverified_**.
3. **No overnight resting HR and no settling (recovery index).**
   - Apple's RHR deliberately excludes sleep.
   - Both have to be derived from overnight background HR, at most one per 5 min, which matches our
     `hr_per_5min`.
4. **No per-second HR outside workouts, and no all-day beat-to-beat** (before Series 12).
   - Rest: one sample per 5 min. Workouts: one per 5 s. Beats: only inside tachograms.
   - `hr_per_sec` is unavailable unless a chest strap is recorded through a workout. How that
     strap's samples land in HealthKit is _unverified_.
5. **No sleep latency, and weak efficiency.**
   - The watch writes `awake` only between sleep samples.
   - `inBed` may be missing or come from another device or app. Latency (10) drops out, and
     efficiency (20) is only as good as the `inBed` source.
6. **No lifting detail.** `HKWorkout` has no sets, reps or load, so `volume_kg_per_session` stays
   with our own logs.
7. **No raw signals.**
   - There is no PPG, no accelerometer stream and no SpO₂ ratio in HealthKit. Every value is
     Apple's processed output.
   - High-rate Core Motion data exists only for an app's own watch workout session (HealthKit
     updates, June 2023). That is out of scope.
8. **Temperature is one absolute value per night**, with no curve within the night, and only on
   Series 8+ / Ultra.
9. **Sampling for SpO₂ and respiratory rate is undocumented.**
   - SpO₂ is missing on SE.
   - US LW/A and LS/A watches compute SpO₂ on the iPhone, and third-party reads are _unverified_.
10. **Food, water and weight come only from other apps or manual entry.** Apple devices produce
    none of them, and reading them risks double counting with our own logs.
11. **Permissions are opaque, and reads stop while the phone is locked.**
    - An app cannot tell a denied read from no data: it "simply appears as if there is no data"
      ([`authorizationStatus(for:)`](https://developer.apple.com/documentation/healthkit/hkhealthstore/authorizationstatus(for:))).
      PR #1593 says the same: "a permission switch is not data evidence".
    - The store is encrypted while the iPhone is locked, so background reads can fail
      ([Protecting user privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)).
    - Background delivery needs the `com.apple.developer.healthkit.background-delivery` entitlement,
      and some types are capped at hourly; `stepCount` is hourly on iOS
      ([`enableBackgroundDelivery`](https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:))).
12. **Data is revised after the fact.**
    - Resting HR and walking HR are replaced for the current and previous day.
    - Old workout samples get condensed.
    - VO₂max estimates can be recalculated.

    Sync has to handle deletes. `apple_health_samples.deleted_at` already allows for this.
13. **Other writers.**
    - Oura's app, Zepp, AutoSleep and others write the same identifiers.
    - Filter and rank by `sourceRevision` (the bundle id) and store it, as `source_bundle_id`
      already allows. PR #1593 expects Zepp data.

**Not exercised:** a real iPhone or Apple Watch, actual sample densities, and how the iOS 27 RMSSD
type behaves. Every cadence above is Apple's stated *attempt* rate or is marked _unverified_.

---

## Sources

**Apple developer documentation** (read 2026-10-12 through the DocC JSON of each page):
- [HKQuantityTypeIdentifier index](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier)
- [HKCategoryTypeIdentifier index](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier)
- [HKCategoryValueSleepAnalysis](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)
- [HKHeartbeatSeriesSample](https://developer.apple.com/documentation/healthkit/hkheartbeatseriessample),
  [HKHeartbeatSeriesQuery](https://developer.apple.com/documentation/healthkit/hkheartbeatseriesquery)
- [HKWorkout](https://developer.apple.com/documentation/healthkit/hkworkout),
  [HKWorkoutZoneGroup](https://developer.apple.com/documentation/healthkit/hkworkoutzonegroup)
- [HKStateOfMind](https://developer.apple.com/documentation/healthkit/hkstateofmind)
- [HealthKit updates](https://developer.apple.com/documentation/updates/healthkit)
- [Accessing condensed workout samples](https://developer.apple.com/documentation/healthkit/accessing-condensed-workout-samples)
- [Protecting user privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)
- The individual identifier pages linked in the tables.

**Apple white paper and video:**
- [Using Apple Watch to measure heart rate, calorimetry, and activity (Nov 2024, PDF)](https://www.apple.com/health/pdf/Heart_Rate_Calorimetry_Activity_on_Apple_Watch_November_2024.pdf):
  - background HR every 5 min;
  - workout HR every 5 s;
  - resting HR excludes sleep;
  - tachogram cadence of 4 h / 2 h / 15 min;
  - SDNN with beat-to-beat storage;
  - cardio recovery definition and 55 bpm cap.
- [WWDC24 session 10109, Explore wellbeing APIs in HealthKit](https://developer.apple.com/videos/play/wwdc2024/10109/):
  valence from −1 to +1, and the kinds.

**Apple Support:**
- [Monitor your heart rate](https://support.apple.com/en-us/120277)
- [Track your sleep / Sleep Score](https://support.apple.com/en-us/108906)
- [Vitals](https://support.apple.com/en-us/120142)
- [Readiness app](https://support.apple.com/guide/watch/readiness-flx4gnzby346/watchos)
- [Wrist temperature](https://support.apple.com/en-us/102674)
- [Blood Oxygen](https://support.apple.com/en-us/120358)
- [Sleep apnea notifications](https://support.apple.com/en-us/120031)
- [Cardio fitness](https://support.apple.com/en-us/108790)
- [Time in daylight](https://support.apple.com/guide/watch/see-time-in-daylight-apd3ab22534c/watchos)

**Apple Newsroom, Sept 2026:**
- [Apple Watch Series 12](https://www.apple.com/newsroom/2026/09/introducing-apple-watch-series-12-with-the-all-new-health-sensing-system/)
- [Health and fitness with Apple Intelligence](https://www.apple.com/newsroom/2026/09/apple-advances-health-and-fitness-capabilities-using-apple-intelligence/)

**Secondary sources** (used only for the "Apple has not mapped Recovery HRV to RMSSD" point):
- [Blake Crosley, Five-Second Heart Rate](https://blakecrosley.com/blog/five-second-heart-rate-healthkit)
- [Momentum, Series 12 / iOS 27 RMSSD](https://www.themomentum.ai/blog/apple-watch-series-12-ios-27-rmssd-healthkit)
- Apple Developer Forums on effort scores: [thread 764884](https://developer.apple.com/forums/thread/764884),
  [thread 765438](https://developer.apple.com/forums/thread/765438)

**Library:** `@kingstinct/react-native-healthkit` 16.1.0 from the npm registry (tarball inspected
locally).
