# Oura API v2 fields: what our app does with each one today

_Read-only audit, 2026-10-12, for [`metric-links.md`](../architecture/metric-links.md) and the field-usage gaps. Availability side: [`2026-10-12-oura-api-fields.md`](2026-10-12-oura-api-fields.md) (not
repeated here). Spec: `.claude/skills/oura-api/references/openapi-v1.34.json`, parsed with
`python3 -I`: 19 list routes under `/v2/usercollection/`, 203 leaf fields counting ids, days and
`PublicSample` sub-fields. "Filled" comes from all-time non-null counts of the owner's rows through the read-only views,
reported only as filled, sparse or empty. Nothing ran on a device._

## Summary

The ring is read over BLE, and the server rollup (`lib/oura-ble/rollup/run.ts`) fills our own
equivalents of most of the **sleep** route's physiology: durations, stages, efficiency, latency,
HRV, lowest and average HR, breathing rate and the 5-min hypnogram. It also fills **SpO₂**,
**steps**, **wear time** and the 5-min **heart-rate** series. These are the values that feed the
sleep score, the readiness composite, the illness radar and the shadow model. Almost everything
else in `oura_daily` is a Cloud-era column, frozen at the 2026-07-07 re-key: only a handful of early
rows are filled, and nothing has written them since. The only live writer of `oura_daily` is the wear
step (`run.ts:968`), and it sets `non_wear_time_sec` and nothing else. `oura_workouts` (a few early rows) and
`oura_tags` (empty) have no writer at all. Resilience, cardiovascular age and VO₂max columns have
never held a value. Rough split of the 203 API fields (hand count from the table below, not a
script): about 20 have a filled equivalent that is **scored**, about 15 are **shown** only, about 20
sit in frozen or unused columns, 8 map to an empty column, and about 60 have **nowhere to land**:
Oura's per-period readiness and contributor breakdowns, the 30-s and `PublicSample` series,
session biometrics, ring config. The rest are ids, day keys and profile fields. Six readers still
pull a frozen Cloud column where a live BLE value exists (§e). The worst case: the Sleep screen's
"Skin Temperature" sparkline and the AI sleep insight have been blank since July.

Legend. **SCORED** = feeds a live score (sleep, readiness, activity, illness suppression, or a
gate). **SCORED-shadow** = feeds only the shadow readiness model. **SHOWN** = displayed or given to
the coach, not scored. **STORED-UNUSED** = only its writer, the sync or an admin/debug screen reads
it. **EMPTY** = the column exists and has never held a value. **NOT-STORED** = the API has it and we
have no column. "frozen" = Cloud-era rows only, nothing writes it now. "sparse" = under ~25 % of
rows. "filled" = most rows.

## Field table

`ss` = `sleep_sessions`, `bm` = `body_metrics`, `od` = `oura_daily`, `ods` = `oura_daily_summary`,
`odd` = `oura_daily_derived`, `hr` = `oura_heartrate`.

| Endpoint | Field | Our column | Filled? | Read by | Status |
|---|---|---|---|---|---|
| sleep | `id` | `ss.oura_id` (`ble:<startDs>`) | filled | upsert/tombstone identity only | STORED-UNUSED (identity) |
| sleep | `day` | `ss.date` (local wake date) | filled | keys every night read (`sleep-night.ts`) | SCORED (key); see §e |
| sleep | `bedtime_start`, `bedtime_end` | `ss.sleep_start`, `ss.sleep_end` | filled | sleep score timing 6 + schedule 8 (`sleep-score.ts:448,466`); shadow `sleep.timing` | SCORED |
| sleep | `time_in_bed` | `ss.time_in_bed_hours` | filled | `score-audit/sleep.ts` (admin Day Review) only; multi-window nights recompute it | STORED-UNUSED |
| sleep | `total_sleep_duration` | `ss.duration_hours`, `ods.sleep_duration_hours` | filled | sleep score totalSleep 24; readiness `sleepBalanceZ` (`readiness-payload.ts:653`); shadow `sleep.duration`/`balance`; coach | SCORED |
| sleep | `deep_sleep_duration`, `rem_sleep_duration` | `ss.deep_sleep_hours`, `ss.rem_sleep_hours` (+ `ods` copies) | filled | sleep score deep 10, rem 10; shadow `sleep.deep_rem_share` | SCORED |
| sleep | `light_sleep_duration` | `ss.light_sleep_hours` | filled | sleep cards, `components/health/sleep-phase-trend-card.tsx`, home widget | SHOWN |
| sleep | `awake_time` | `ss.awake_hours` | filled | sleep score restfulness + fragmentation cap (`sleep-score.ts:473`) | SCORED |
| sleep | `efficiency` | `ss.efficiency`, `ods.sleep_efficiency` | filled | sleep score efficiency 9 + restfulness base; shadow `sleep.efficiency`; coach | SCORED |
| sleep | `latency` | `ss.onset_latency_sec`, `ods.sleep_latency_sec` | filled | sleep score latency 6; shadow `sleep.latency`; day-timeline "Fell asleep" | SCORED |
| sleep | `average_hrv` | `ss.average_hrv_ms`, `bm.hrv_ms`, `ods.hrv_avg_ms` | filled | sleep score hrv 14; readiness `hrvZ` + illness radar (`illness-radar.ts:160`); shadow `heart.overnight_hrv`; coach | SCORED |
| sleep | `hrv` (`interval`, `items`, `timestamp`) | none. `computeHrv5MinSeries` runs in memory (`run.ts:605`) | — | chronic-stress input, never persisted | NOT-STORED |
| sleep | `average_heart_rate` | `ss.avg_heart_rate`, `ods.rhr_avg_bpm` | filled | sleep score hr 14 (`sleep-score.ts:458`); health insight. `ods` copy: audit + chronic stress only | SCORED |
| sleep | `lowest_heart_rate` | `ss.lowest_heart_rate`, `bm.resting_heart_rate`, `ods.rhr_low_bpm` | filled | readiness `rhrZ`, illness radar, HR-zone profile (`resolveHrProfile`), shadow `heart.overnight_rhr`, coach | SCORED |
| sleep | `heart_rate` (`interval`, `items`, `timestamp`) | `hr` 5-min bins (180-day retention) | filled¹ | `recovery_index_hours` → readiness recovery-index contributor + shadow `heart.overnight_settling`; HR charts | SCORED |
| sleep | `average_breath` | `ss.respiratory_rate`, `ods.breath_avg_rpm` | filled | illness radar `breathZ` → readiness suppression; shadow `body.breathing_rate`; sleep sheet | SCORED |
| sleep | `restless_periods` | `ss.restless_periods`, `ods.restless_periods` | filled (BLE = awakenings) | `components/health-metric-sheet.tsx:214`; deliberately unscored (`sleep-score.ts:95`) | SHOWN |
| sleep | `sleep_phase_5_min` | `ss.sleep_phase_5_min` | filled | hypnogram (`sleep-content.tsx`, `day-sections.tsx`), `lib/sleep/actual-window.ts` | SHOWN |
| sleep | `sleep_phase_30_sec` | none. `sleepPhase30Sec` is built in memory (`run.ts:597`) | — | chronic stress (which outputs nothing) | NOT-STORED |
| sleep | `app_sleep_phase_5_min` | none | — | — | NOT-STORED (deprecated in spec) |
| sleep | `movement_30_sec` | none. Raw 0x72 `acm_mad` stays in `oura_raw_samples` | — | stager input only | NOT-STORED |
| sleep | `type`, `period` | none. `nightSessions` classifies night vs nap itself | — | — | NOT-STORED (we derive) |
| sleep | `readiness.score`, `readiness.contributors.*` (9), `readiness.temperature_deviation`, `readiness.temperature_trend_deviation` | none per period | — | — | NOT-STORED |
| sleep | `readiness_score_delta`, `sleep_score_delta` | none | — | — | NOT-STORED |
| sleep | `low_battery_alert` | none | — | — | NOT-STORED |
| sleep | `sleep_algorithm_version`, `sleep_analysis_reason`, `ring_id` | none (`odd.model_versions` covers our own models) | — | — | NOT-STORED |
| daily_sleep | `score` | `od.sleep_score` (Cloud), `ss.sleep_score`; own: `odd.sleep_score` | od sparse frozen; ss **empty**; odd ~60 % | Cloud: health-insight sleep headline (`health-insight/route.ts:144`), coach "Today" line (`ai-chat/context.ts:138`), `getRecoveryData` tool. Own: readiness payload, trends, day-timeline | SHOWN (Cloud frozen); ss EMPTY |
| daily_sleep | `contributors.{deep_sleep, efficiency, latency, rem_sleep, restfulness, timing, total_sleep}` | `od.sleep_contributors`; own: `odd.sleep_contributors` | sparse frozen / ~60 % | payload Cloud-first `?? own` (`readiness-payload.ts:972`); health-insight sleep (Cloud only) | SHOWN |
| daily_sleep | `id`, `day`, `timestamp` | `od.date` | — | key | — |
| daily_readiness | `score` | `od.readiness_score`; own: `odd.readiness_score` | sparse frozen / ~61 % | `live-readiness.ts` (pre-re-key days only); `readiness-breakdown.tsx` "Oura path"; `getRecoveryVsPerformance` tool | SHOWN (history) |
| daily_readiness | `contributors.*` (9) | `od.readiness_contributors` | sparse frozen | payload `readinessContributors` → `readiness-content.tsx`, `health-score-detail.tsx`; health-insight fallback | SHOWN (frozen) |
| daily_readiness | `temperature_deviation` | `od.temperature_deviation` (Cloud); own: `ods.temp_dev_c` | sparse frozen / filled | own: payload, shadow `body.temperature`, deload temp alert (`adapter.ts:2029`), coach, insight. Cloud: `/api/health/trends` sparkline, `/api/health-trends` temp correlation, `getRecoveryData` tool | SCORED-shadow (own); Cloud SHOWN (stale), see §e |
| daily_readiness | `temperature_trend_deviation` | `od.temperature_trend_deviation` | sparse frozen | nothing | STORED-UNUSED |
| daily_readiness | `id`, `day`, `timestamp` | `od.date` | — | key | — |
| daily_activity | `steps` | `bm.steps` | filled | activity score steps 18; shadow `activity.yesterday_movement`; daily energy; many cards | SCORED |
| daily_activity | `active_calories` | `bm.active_calories` (+ `od.active_calories`) | **sparse**: the ring writes none, Health Connect/Cloud only | activity score active-energy 15 (`activity-score.ts:21`, renormalised away when null); health insight | SCORED (mostly absent) |
| daily_activity | `total_calories`, `equivalent_walking_distance` | `od.total_calories`, `od.equivalent_walking_distance` | sparse frozen | nothing | STORED-UNUSED |
| daily_activity | `met` (`interval`, `items`, `timestamp`) | not stored per minute. Daily mean → `ods.met_avg`; per-minute grid rebuilt from raw at read (`resolveDayMetPerMinute`) | met_avg filled | `/api/training-stress` → OTS, which is always gated (`odd.training_load_ots` empty); chronic stress (empty); audit | STORED-UNUSED in effect |
| daily_activity | `class_5_min` | none | — | — | NOT-STORED |
| daily_activity | `high_/medium_/low_activity_time` | `od.*_activity_time_sec`; own equivalent: `daily_zone_minutes` (from HR) | frozen / filled | Cloud cols: nothing. Own: shadow `activity.zone_minutes_week`, activity score zone minutes 10 | STORED-UNUSED (Cloud); equivalent SCORED |
| daily_activity | `sedentary_time`, `resting_time` | `od.sedentary_time_sec`, `od.resting_time_sec` | sparse frozen | nothing | STORED-UNUSED |
| daily_activity | `non_wear_time` | `od.non_wear_time_sec` (BLE wear step) | filled | low-wear gate on HRV/RHR baselines (`readiness-payload.ts:451`), shadow exclusion, `isLowWearToday`, trends `wornHours`, `oura-section.tsx` | SCORED (gate) |
| daily_activity | `high_/medium_/low_activity_met_minutes`, `average_met_minutes` | `od.*_met_minutes`, `od.avg_met_minutes` | sparse frozen | nothing | STORED-UNUSED |
| daily_activity | `sedentary_met_minutes`, `inactivity_alerts` | none (own move-hours from HR, `intraday-hr-contributors.ts`) | — | — | NOT-STORED |
| daily_activity | `score` | `od.activity_score`; own: `odd.activity_score` | sparse frozen / ~52 % | Cloud: `getRecoveryData` tool, offline seed. Own: trends, day audit | SHOWN |
| daily_activity | `contributors.*` (6) | `od.activity_contributors` | sparse frozen | payload Cloud-first `?? own` (`readiness-payload.ts:976`) → `activity-content.tsx` | SHOWN (frozen) |
| daily_activity | `target_calories`, `target_meters`, `meters_to_target` | none (own goals: `getDailyGoals`) | — | — | NOT-STORED |
| daily_activity | `id`, `day`, `timestamp` | `od.date` | — | key | — |
| daily_spo2 | `spo2_percentage.average` | `bm.spo2_pct` (from raw R on Ring 5) | filled | shadow `body.spo2`; `rhr-hrv-spo2-card.tsx`; coach tool; `ai-periodization/signals.ts` | SCORED-shadow |
| daily_spo2 | `breathing_disturbance_index` | `od.breathing_disturbance_index` (Cloud); own: `odd.bdi_derived` | sparse frozen / ~65 % | nothing. `sleepnet-dump-console.tsx` (admin) prints it | STORED-UNUSED |
| daily_spo2 | `id`, `day` | `bm.date` | — | key | — |
| daily_stress | `stress_high` | `od.stress_high` (Cloud); own: `odd.stress_high_minutes` | frozen / ~54 % | own: shadow `body.daytime_stress`, payload `stressHigh`, weekly digest, `health-alerts.ts`, `body-battery-day.ts`, coach. Deload arm unwired (`ai-dynamic.ts:256`) | SCORED-shadow |
| daily_stress | `recovery_high` | `od.recovery_high`; own: `odd.recovery_high_minutes` | frozen / ~54 % | payload `recoveryHigh` only | SHOWN |
| daily_stress | `day_summary` | `od.day_summary` | sparse frozen | payload (gated off → always null); `ai-dynamic.ts:271` deload override via `adapter.ts:2053` | SHOWN (dead) |
| daily_resilience | `level` | `od.resilience_level` (text); own: `odd.resilience_level` (numeric 1–5) | **empty** / ~20 % | own: payload `ownResilience*`, coach tool | EMPTY (Cloud); own SHOWN |
| daily_resilience | `contributors.{sleep_recovery, daytime_recovery, stress}` | `od.resilience_contributors`; own: `odd.resilience_daily_{sleep_recovery, restorative_time, stress}` | **empty** / ~18 % | own: the rollup's level fit only | EMPTY / STORED-UNUSED |
| daily_cardiovascular_age | `vascular_age` | `od.vascular_age` | **empty** | heart-rate page tile (`app/health/heart-rate/page.tsx:200`) via `getLatestOuraCloudVitals` | EMPTY |
| daily_cardiovascular_age | `pulse_wave_velocity` | `od.pulse_wave_velocity` | **empty** | nothing | EMPTY |
| vO2_max | `vo2_max` | `od.vo2_max` (own sources: `fitness_tests.vo2max_est`, in-memory estimate in `/api/training-stress`) | **empty** | heart-rate page tile, payload `vo2Max` | EMPTY |
| vO2_max / cv_age / resilience / stress | `id`, `day`, `timestamp` | `od.date` | — | key | — |
| heartrate | `bpm`, `timestamp` | `hr.bpm`, `hr.timestamp` (5-min; 15-s inside workouts) | filled¹ | payload hrCurrent/Min/Max; zone minutes + move hours → activity score; `daily_zone_minutes` → shadow; Body Battery; `/api/oura/hr-day`, `hr-window` charts; set/workout HR stats; HR recovery profile | SCORED |
| heartrate | `source` | `hr.source` | filled, but holds `ble` / aggregator name | `hr-window-merge.ts` source precedence | mismatch (§e) |
| heartrate | `timestamp_unix` | none (redundant) | — | — | NOT-STORED |
| workout | `id`, `activity`, `day`, `start_datetime`, `end_datetime`, `calories`, `distance`, `intensity`, `source` | `oura_workouts.*` | a few rows, frozen, **no writer** | `/api/oura/workouts` → `exercise-detected-card.tsx`; day-timeline walks; `compute-hr-recovery-profile.ts` | SHOWN (frozen history) |
| workout | `label` | none | — | — | NOT-STORED |
| session | `type`, `mood`, `day`, `start_datetime`, `end_datetime`, `id` | `oura_tags` (`source='session'`) | **empty** | day-timeline tag events | EMPTY |
| session | `heart_rate`, `heart_rate_variability`, `motion_count` (each `interval`, `items`, `timestamp`) | none | — | — | NOT-STORED |
| enhanced_tag | `tag_type_code`, `custom_name`, `comment`, `start_time`, `end_time`, `start_day`, `end_day`, `id` | `oura_tags` | **empty** | day-timeline | EMPTY |
| tag | `day`, `text`, `tags`, `timestamp`, `id` | none | — | — | NOT-STORED (deprecated) |
| rest_mode_period | `start_day`, `start_time`, `end_day`, `end_time`, `id` | `oura_tags` (`source='rest_mode'`) | **empty** | day-timeline | EMPTY |
| rest_mode_period | `episodes[].tags`, `episodes[].timestamp` | none (closest: self-reported unwell → shadow exclusion) | — | — | NOT-STORED |
| sleep_time | `optimal_bedtime.start_offset`, `.end_offset` | `od.recommended_bedtime_start/_end` | sparse frozen | payload gated by `cloudDailyLive` → always null; `rest-day-card.tsx`, `health-score-detail.tsx` | SHOWN (dead) |
| sleep_time | `recommendation` | `od.sleep_time_recommendation` | sparse frozen | `/api/sleep-sessions` → `health-metric-sheet.tsx:148` label, old nights only | SHOWN (history) |
| sleep_time | `status` | `od.sleep_time_status` | sparse frozen | nothing | STORED-UNUSED |
| sleep_time | `optimal_bedtime.day_tz`, `id`, `day` | none | — | — | NOT-STORED |
| personal_info | `age`, `height`, `biological_sex`, `email`, `weight` | `users.date_of_birth`, `height_cm`, `sex`, `email`; `bm.weight_kg` (scale) | filled | goals, HR max, energy, VO₂max estimate | covered by our own sources |
| personal_info | `id` | none | — | — | NOT-STORED |
| ring_configuration | `hardware_type`, `firmware_version`, `set_up_at`, `color`, `design`, `size`, `id` | none. BLE decodes a firmware event (`decode.ts:602`) but doesn't keep it | — | — | NOT-STORED |
| ring_battery_level | `level`, `charging`, `timestamp` | `oura_ble_battery_poll.percent`, `.charging`, `.measured_at` (from BLE) | not measured | admin `link-stats` / battery analytics only | STORED-UNUSED |
| ring_battery_level | `in_charger`, `timestamp_unix` | none | — | — | NOT-STORED |

¹ `oura_heartrate` is not in `the population counts`. The rollup rewrites its last 14 days on every run
(`run.ts:922`) and keeps 180 days (`slices/oura.ts:704`).

**The phone sync** (`/api/sync/pull`, `adapter.ts:4940`) carries every column of `ss`, `bm`, `ods`
and `odd`, plus the `hr` delta. For `oura_daily` it carries only `readiness_score`, `sleep_score`,
`activity_score`, `temperature_deviation`, `active_calories` and `readiness_contributors`, the
six frozen Cloud columns, and **not** the one live column, `non_wear_time_sec`.

## Gaps

### a) API fields we would drop (NOT-STORED)

If #2808 started pulling the API tomorrow, these values would have nowhere to land:

- **Sleep series:** `sleep.hrv`, `sleep.sleep_phase_30_sec`, `sleep.movement_30_sec`. The rollup
  already builds a 30-s hypnogram and a 5-min HRV series for each night, then throws them away
  after the chronic-stress step (`run.ts:597`, `run.ts:605`).
- **Sleep provenance:** `type` (needed to drop `rest` and handle `late_nap`), `period`,
  `low_battery_alert`, `sleep_algorithm_version`, `sleep_analysis_reason`, `ring_id`.
- **Per-period readiness and score deltas** (`sleep.readiness.*`, `*_score_delta`). Oura-computed,
  low value.
- **Activity:** `met` per minute, `class_5_min`, `sedentary_met_minutes`, `inactivity_alerts`,
  `target_*`, `meters_to_target`.
- **Session biometrics:** `session.heart_rate`, `heart_rate_variability`, `motion_count`. This is
  the API's only daytime HRV outside sleep.
- **Context:** `rest_mode_period.episodes`, the deprecated `tag` route, `workout.label`,
  `sleep_time.optimal_bedtime.day_tz`.
- **Device:** all of `ring_configuration`, plus `ring_battery_level.in_charger`.

### b) STORED-UNUSED columns

Written (by Cloud before 07-07, or by the rollup now) and read only by their writer, the sync, or
an admin screen:

- `oura_daily`: `temperature_trend_deviation`, `total_calories`, `equivalent_walking_distance`,
  `high_/medium_/low_activity_time_sec`, `sedentary_time_sec`, `resting_time_sec`,
  `avg_met_minutes`, `high_/medium_/low_activity_met_minutes`, `breathing_disturbance_index`,
  `sleep_time_status`, `stress_high`, `recovery_high`. Every one is frozen. The stress pair is now
  read only by fallbacks that are gated off.
- `oura_daily_derived.bdi_derived`: ~65 % filled, our own SleepNet apnea-head output. No score,
  card or coach surface reads it.
- `oura_daily_derived.resilience_daily_*` and `resilience_granular`: written, then read only by the
  rollup's own level fit.
- `oura_daily_summary.rhr_avg_bpm`, `met_avg`, `restless_periods`, `sleep_efficiency`,
  `sleep_latency_sec`, `deep/rem_sleep_hours`: copies of `sleep_sessions` values, read only by the
  admin audit, `rederive-baselines` and the chronic-stress assembly, which has never produced a
  score.
- `sleep_sessions.time_in_bed_hours`: filled, read only by the admin Day Review audit.
- `oura_ble_battery_poll` (`percent`, `charging`): admin link-stats only.
- `oura_bucket.perfusion_index`, `skin_temp_c`, `motion_mad`: the device trend ladder's backup.
  Nothing on the server reads them (`slices/oura.ts:803` writes them, the local store syncs them).

### c) EMPTY columns, and why

| Column | Why it is empty |
|---|---|
| `oura_daily.vo2_max`, `vascular_age`, `pulse_wave_velocity`, `resilience_level`, `resilience_contributors` | Added for Cloud routes (migrations 088/089) that never returned data for this account before the re-key. Cloud-only, and nothing will write them now. The heart-rate page's VO₂max and vascular-age tiles can never render. |
| `sleep_sessions.sleep_score` | The API has no per-period sleep score (only `daily_sleep.score`). `upsertOuraSleep` maps the column, but no caller ever passes it. The day-timeline reads it first (`day-timeline/route.ts:122`) and always falls through. |
| `oura_tags` (whole table) | Built for `enhanced_tag`, `session` and `rest_mode_period` (migration 106). It has no writer and zero rows. The day-timeline's tag rendering (`day-timeline/route.ts:277`) is dead code. |
| `oura_daily_derived.training_load_ots`, `training_load_high` | Our own. `/api/training-stress` gates every day (`training_load_gate` is set on ~26 % of rows). |
| `oura_daily_derived.chronic_stress_score`, `chronic_stress_contributors`, `recovery_index_hours` | Our own: chronic stress refuses inside the vendored model (#2422). The derived recovery-index column is never written; the live value sits in `oura_daily_summary`. |
| `sleep_sessions.manual_sleep_start` | A user-entry field that has never been used. Not an Oura field. |

### d) Things we score that the API cannot fill

If the API replaced BLE (#2808), these scored or gating inputs would lose their source:

- **Absolute skin temperature** (`ods.temp_mean_c`). The readiness composite's temperature
  contributor and the illness radar take a z-score of the absolute nightly temperature against our
  own EMA baseline (`illness-radar.ts:161`). The API has only deviations from Oura's baseline, so
  the baseline would have to be rebuilt on a different quantity.
- **Recovery index / settling** (`ods.recovery_index_hours`). We derive it from our own 5-min
  overnight bins. The API's `sleep.heart_rate` interval is not in spec.
- **15-s workout HR bins** (`run.ts:856`) → set HR stats, HRR, workout HRV. The API has 5-min HR only
  and no HR on workouts.
- **Daytime stress series** (`oura_daytime_stress_buckets`, 30-min dHRV levels) and the
  `oura_daytime_hrv_model` behind it. These feed `stress_high_minutes` (shadow), Body Battery and
  resilience. The API gives two daily totals and a label.
- **Body Battery** (`body_battery_daily`): needs the intraday HR series. API HR is 5-min, which is
  probably enough, but Body Battery also anchors on our own readiness.
- **Per-sample SpO₂ variability** (stager `spo2Var` input) and **SleepNet BDI**: the API has one
  nightly average and its own BDI index.
- **Live steps** (`step_live_windows`) and same-day partial wear. The API activity day is
  04:00–04:00 and syncs in the background.
- **Our own hypnogram and onset latency**: the API would supply Oura's stager output, which is a
  different model from ours (SleepNet plus a heuristic fallback). Sleep-score baselines would
  shift.

### e) Mismatches

**Readers still on frozen Cloud columns where a live value exists.** These are bugs, filed
as #2827.

1. `/api/health/trends` sets `temperatureDeviation: oura?.temperatureDeviation`
   (`app/api/health/trends/route.ts:112`). It feeds the Sleep screen's "Skin Temperature" sparkline
   (`app/health/sleep/sleep-content.tsx:213`), which has been empty since 07-07 while
   `ods.temp_dev_c` is filled.
2. `/api/health-trends` `recovery-vs-strength&metric=temp` correlates lifts against
   `od.temperature_deviation` (`app/api/health-trends/route.ts:316`). It only ever sees about 15
   pre-re-key days.
3. The AI sleep insight reads `todayOura.sleepScore` and `sleepContributors`
   (`app/api/ai/health-insight/route.ts:144–159`) and never reads `odd.sleep_score`. The card always
   opens on duration with "Contributors: none".
4. The coach's always-on context prints `ouraToday.sleepScore` (`lib/ai-chat/context.ts:138`), so
   the "Today" line never carries a sleep score. The `getRecoveryData` tool hands the model
   `od.sleep_score`, `activity_score` and `temperature_deviation` (`lib/ai-chat/tools.ts:96`), and
   ignores `odd` scores and `ods.temp_dev_c`.
5. The readiness payload puts Cloud first for contributors (`readinessContributors`, and
   `sleepContributors`/`activityContributors` before falling back to our own,
   `readiness-payload.ts:970–976`). It works today only because the Cloud values are null.
6. The offline seed in `components/health/health-score-detail.tsx:156` reads the local `oura_daily`
   mirror (the frozen Cloud columns), not the local `oura_daily_derived` mirror. Offline before the
   first fetch, it seeds a score of 0.

**Units and semantics.**

- `restless_periods` holds two quantities. Cloud nights carry Oura's restless count (in the hundreds);
  BLE nights carry SleepNet awakenings (single digits). The sleep sheet shows both under one
  label (`sleep-score.ts:95` explains why the score dropped it).
- `stress_high` / `recovery_high`: the API is in **seconds**. The `od` schema comment says
  "minutes" (`schema.ts:1560`). `odd.*_minutes` are minutes, and the payload multiplies by 60.
- `day_summary`: the API enum is `restored | normal | stressful`. The schema comment lists
  `restorative`, `very_stressful` and `passive`, and the deload override fires only on
  `very_stressful` (`ai-dynamic.ts:271`), a value the API can never return.
- `resilience_level`: the API is a text enum `limited | adequate | solid | strong | exceptional`.
  The `od` comment lists `low` and leaves out `solid`, and our own `odd.resilience_level` is a
  number from 1 to 5.
- BDI: the API's `breathing_disturbance_index` is an integer index in [0, 100]. `odd.bdi_derived`
  is SleepNet's per-hour rate. They are not interchangeable.
- `vo2_max`: the API gives an integer with no unit in the spec. The schema says double, ml/kg/min.
- `heartrate.source`: the API value is an activity context (`awake`, `rest`, `sleep`, `workout`,
  `live`, `session`). Ours is a data origin (`ble`, a Health Connect name). Nothing could filter
  "resting" rows the way the API allows.
- `lowest_heart_rate`: the API computes it from 30-s samples. Ours is the lowest 5-min bin average
  (`night-vitals.ts`). `average_hrv` has no unit or method in the spec; ours is a median-gated
  rMSSD.
- **Day boundaries.** The API activity day (steps, non-wear, calories) runs from 04:00 to 04:00.
  Ours run from local midnight (`run.ts:965`), and today's non-wear counts only the elapsed hours.
  SpO₂ is keyed to the calendar day the sample fell on, so one night splits across two dates
  (`run.ts:752`). The API keys SpO₂ to the sleep day. The API's sleep `day` and `late_nap` rule
  (after 18:00 counts toward the next day) differ from our wake-date plus circadian classifier.
- `temperature_deviation`: Oura's baseline vs our EMA of `temp_mean_c` (baseline re-derive still
  pending, #2370). The API values are not comparable with our history.

## Unused data with metric potential

1. **Wear gate that knows about the charger.** From `oura_ble_battery_poll.charging` (stored,
   admin-only) and `ring-battery.ts` charge sessions. Split non-wear into charging and off-finger,
   so a day that is short only because of a charge isn't dropped from the HRV/RHR baselines. The
   ring needs charging every 2–2.5 days (#2467) against an 18 h wear floor (`wear-confidence.ts:5`).
2. **REM latency and cycle count.** From the 30-s hypnogram the rollup already builds and discards
   (`sleepPhase30Sec`, `run.ts:597`; API `sleep_phase_30_sec`). Time from onset to the first REM
   bout shortens with sleep debt and lengthens after alcohol. The 5-min string is too coarse to
   time it.
3. **Nightly breathing-disturbance trend.** From `odd.bdi_derived` (~65 % filled, read by nothing).
   A per-person z-score next to the SpO₂ z, as a context flag on nights after late meals or
   alcohol. It is physiological, already computed, and has a baseline.
4. **Nocturnal HR dip.** From `ods.rhr_avg_bpm` (sleeping mean, unused by live scores) against the
   daytime mean of `oura_heartrate`. Blunted day-to-night dipping is a stress and illness marker,
   and it is independent of the absolute-RHR z the composite already uses.
5. **Multi-night temperature slope.** Our version of `temperature_trend_deviation` (stored frozen,
   unused), built from `ods.temp_mean_c`. A 3-night slope catches a slow rise that a single-night z
   misses. It would be an extra illness-radar term, so it needs a `type: tuning` sign-off.
6. **Movement density in bed.** From raw 0x72 `acm_mad` (the API's `movement_30_sec`; we store
   only the raw frames). A continuous restlessness measure to replace `restless_periods`, which the
   sleep score dropped because the count is noise for this ring (`sleep-score.ts:121`).
7. **Longest sedentary bout.** From the per-minute MET grid (`resolveDayMetPerMinute`) that
   produces nothing today because OTS is gated (the API's `class_5_min`/`sedentary_time`). The
   HR-based move-hours contributor counts hours that had any movement; bout length is a separate
   cardiometabolic signal.
8. **Night perfusion index trend.** From `oura_bucket.perfusion_index` (stored, unread; decoded
   from 0x8b, `decode.ts:151`). Peripheral vasoconstriction during sleep rises with cold, illness
   and alcohol. The API has nothing like it.
9. **Our own bedtime window.** To replace the dead `recommended_bedtime_start/end` UI
   (`rest-day-card.tsx`, `health-score-detail.tsx`), learn the bedtime band that came before this
   person's best `odd.sleep_score` and overnight HRV, using `ss.sleep_start`.
10. **Daytime restorative ratio.** From `odd.recovery_high_minutes` (filled, shown only):
    recovery ÷ (stress + recovery) minutes. Treat it as unproven. TN-33 found the stress scalar
    dominated by night buckets (`ai-dynamic.ts:256`), so test the recovery half the same way before
    using it.

## Surfaces not exercised

Read from code and `the population counts` only. Not checked: the on-device SQLite mirror's contents, the
real fill of `oura_heartrate` and `oura_bucket` (neither is in `the population counts`), any rendered
screen at 384 px, and the actual Oura API responses (the `PublicSample` intervals are still unknown;
see the availability doc).
