# Oura Ring v2 API — Data Reference

> What the ring can provide, what we currently sync, and what's available to add.

**Base URL:** `https://api.ouraring.com`  
**Auth:** `Authorization: Bearer {token}` (OAuth2 or PAT)  
**Pagination:** Follow `next_token` in list responses until null  
**Ring compatibility:** Fields marked **Ring 4+** require Oura Ring 4 or 5

---

## OAuth Scopes

| Scope | Covers |
|-------|--------|
| `daily` | daily_readiness, daily_sleep, sleep sessions, daily_activity, daily_stress, vO2_max, daily_cardiovascular_age, daily_resilience |
| `heartrate` | heartrate time series |
| `spo2` | daily_spo2 |
| `workout` | workout sessions |
| `personal` | personal_info |
| `session` | mindfulness/meditation sessions |
| `ring_configuration` | ring hardware info |

> **Bug fixed 2026-06-23:** Our OAuth flow was requesting `spo2Daily` (invalid) instead of `spo2`. Users who connected before this fix need to disconnect and reconnect to get SpO2 access.

---

## Currently Synced Endpoints

### 1. Sleep Sessions — `GET /v2/usercollection/sleep`
Scope: `daily` | Use `start_date` / `end_date`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `id` | string | Oura UUID — dedup key | `sleep_sessions.oura_id` |
| `day` | YYYY-MM-DD | Wake-up date | `sleep_sessions.date` |
| `bedtime_start` | ISO 8601 | When got into bed | `sleep_sessions.sleep_start` |
| `bedtime_end` | ISO 8601 | When got out of bed | `sleep_sessions.sleep_end` |
| `type` | enum | `long_sleep` \| `sleep` \| `short_sleep` \| `late_nap` \| `rest` \| `deleted` | filter — only `long_sleep` \| `sleep` synced |
| `total_sleep_duration` | seconds | Actual sleep time | `sleep_sessions.duration_hours` (÷3600) |
| `time_in_bed` | seconds | bedtime_end − bedtime_start | _not stored_ |
| `awake_time` | seconds | Time awake during night | `sleep_sessions.awak_hours` (÷3600) |
| `light_sleep_duration` | seconds | | `sleep_sessions.light_sleep_hours` (÷3600) |
| `deep_sleep_duration` | seconds | | `sleep_sessions.deep_sleep_hours` (÷3600) |
| `rem_sleep_duration` | seconds | | `sleep_sessions.rem_sleep_hours` (÷3600) |
| `efficiency` | 0–100 | total_sleep / time_in_bed % | `sleep_sessions.efficiency` |
| `latency` | seconds | Time to fall asleep (v2 field is `latency`, not `onset_latency`) | `sleep_sessions.onset_latency_sec` |
| `average_hrv` | ms rMSSD | HRV during sleep | `sleep_sessions.average_hrv_ms` → `body_metrics.hrv_ms` |
| `lowest_heart_rate` | bpm | Overnight minimum HR | `sleep_sessions.lowest_heart_rate` → `body_metrics.resting_heart_rate` |
| `average_heart_rate` | bpm | Mean HR during sleep | `sleep_sessions.avg_heart_rate` |
| `average_breath` | breaths/min | Respiratory rate | `sleep_sessions.respiratory_rate` |
| `restless_periods` | count | Movement events | `sleep_sessions.restless_periods` |
| `sleep_algorithm_version` | string | Oura firmware version | _not stored_ |

### 2. Daily Sleep Score — `GET /v2/usercollection/daily_sleep`
Scope: `daily`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `score` | 0–100 | Overall sleep score | `oura_daily.sleep_score` |
| `contributors.deep_sleep` | 0–100 | | `oura_daily.sleep_contributors` (JSONB) |
| `contributors.efficiency` | 0–100 | | ↑ |
| `contributors.latency` | 0–100 | Higher = fell asleep faster | ↑ |
| `contributors.rem_sleep` | 0–100 | | ↑ |
| `contributors.restfulness` | 0–100 | | ↑ |
| `contributors.timing` | 0–100 | Alignment with circadian rhythm | ↑ |
| `contributors.total_sleep` | 0–100 | | ↑ |

### 3. Daily Readiness — `GET /v2/usercollection/daily_readiness`
Scope: `daily`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `score` | 0–100 | Overall readiness score | `oura_daily.readiness_score` |
| `temperature_deviation` | °C | vs. personal baseline | `oura_daily.temperature_deviation` |
| `temperature_trend_deviation` | °C | Multi-day trend | `oura_daily.temperature_trend_deviation` |
| `contributors.activity_balance` | 0–100 | Recent training load | `oura_daily.readiness_contributors` (JSONB) |
| `contributors.body_temperature` | 0–100 | | ↑ |
| `contributors.hrv_balance` | 0–100 | HRV vs. 3-month trend | ↑ |
| `contributors.previous_day_activity` | 0–100 | | ↑ |
| `contributors.previous_night` | 0–100 | Last night's sleep | ↑ |
| `contributors.recovery_index` | 0–100 | Time to stabilise HR after last sleep | ↑ |
| `contributors.resting_heart_rate` | 0–100 | RHR vs. baseline | ↑ |
| `contributors.sleep_balance` | 0–100 | Recent sleep vs. need | ↑ |
| `contributors.sleep_regularity` | 0–100 | Consistency of sleep times | ↑ (new in v1.34) |

### 4. Daily Activity — `GET /v2/usercollection/daily_activity`
Scope: `daily`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `score` | 0–100 | | `oura_daily.activity_score` |
| `active_calories` | kcal | Calories from movement | `oura_daily.active_calories` → `body_metrics.active_calories` |
| `total_calories` | kcal | TDEE (active + resting) | `oura_daily.total_calories` |
| `steps` | count | | _available in API, not stored in body_metrics yet_ |
| `equivalent_walking_distance` | metres | Step equivalent | `oura_daily.equivalent_walking_distance` |
| `high_activity_time` | seconds | | `oura_daily.high_activity_time_sec` |
| `medium_activity_time` | seconds | | `oura_daily.medium_activity_time_sec` |
| `low_activity_time` | seconds | | `oura_daily.low_activity_time_sec` |
| `sedentary_time` | seconds | | `oura_daily.sedentary_time_sec` |
| `non_wear_time` | seconds | | `oura_daily.non_wear_time_sec` |
| `resting_time` | seconds | Time spent at rest | _not stored_ |
| `average_met_minutes` | | | _not stored_ |
| `contributors.meet_daily_targets` | 0–100 | | `oura_daily.activity_contributors` (JSONB) |
| `contributors.move_every_hour` | 0–100 | | ↑ |
| `contributors.recovery_time` | 0–100 | | ↑ |
| `contributors.stay_active` | 0–100 | | ↑ |
| `contributors.training_frequency` | 0–100 | | ↑ |
| `contributors.training_volume` | 0–100 | | ↑ |

### 5. SpO2 — `GET /v2/usercollection/daily_spo2`
Scope: `spo2`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `body_metrics.date` |
| `spo2_percentage.average` | % | Mean overnight SpO2 | `body_metrics.spo2_pct` |
| `breathing_disturbance_index` | 0–100 | SpO2 drop events | _not stored_ |

### 6. Heart Rate Time Series — `GET /v2/usercollection/heartrate`
Scope: `heartrate` | Use `start_datetime` / `end_datetime`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `bpm` | integer | 1-minute sample | `oura_heartrate.bpm` |
| `source` | enum | `awake` \| `sleep` \| `workout` \| `rest` \| `session` | `oura_heartrate.source` |
| `timestamp` | ISO 8601 | | `oura_heartrate.timestamp` |

> Used for post-workout HR recovery analysis. Fetched per session with ±10 min buffer.

### 7. Daily Stress — `GET /v2/usercollection/daily_stress`
Scope: `daily`

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `stress_high` | seconds | Time in high-stress zone (top HR quartile) | `oura_daily.stress_high` |
| `recovery_high` | seconds | Time in high-recovery zone (bottom HR quartile) | `oura_daily.recovery_high` |
| `day_summary` | enum | `restored` \| `normal` \| `stressful` | `oura_daily.day_summary` |

### 8. VO2 Max — `GET /v2/usercollection/vO2_max` (capital O)
Scope: `daily` | **Ring 4+**

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `vo2_max` | ml/kg/min | Estimated maximal oxygen uptake | `oura_daily.vo2_max` |

### 9. Cardiovascular Age — `GET /v2/usercollection/daily_cardiovascular_age`
Scope: `daily` | **Ring 4+**

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `vascular_age` | years | Predicted vascular age, range 18–100 | `oura_daily.vascular_age` |
| `pulse_wave_velocity` | m/s | Arterial stiffness proxy | `oura_daily.pulse_wave_velocity` |

### 10. Daily Resilience — `GET /v2/usercollection/daily_resilience`
Scope: `daily` | **Ring 4+**

| Field | Type | Notes | DB destination |
|-------|------|-------|----------------|
| `day` | YYYY-MM-DD | | `oura_daily.date` |
| `level` | enum | `exceptional` \| `strong` \| `adequate` \| `limited` \| `low` | `oura_daily.resilience_level` |
| `contributors.sleep_recovery` | 0–100 | | `oura_daily.resilience_contributors` (JSONB) |
| `contributors.daytime_recovery` | 0–100 | | ↑ |
| `contributors.stress` | 0–100 | | ↑ |

---

## Available But Not Yet Synced

### Ring Battery — `GET /v2/usercollection/ring_battery_level`
No scope required | Use `start_datetime` / `end_datetime` + `latest=true`

| Field | Type | Notes |
|-------|------|-------|
| `timestamp` | ISO 8601 | |
| `level` | 0–100 % | Battery percentage |
| `charging` | boolean | |
| `in_charger` | boolean | |

> Already implemented in `client.ts` (`fetchLatestBatteryLevel`, `fetchRingBatteryLevel`) — not displayed anywhere in app yet.

### Workouts — `GET /v2/usercollection/workout`
Scope: `workout`

| Field | Type | Notes |
|-------|------|-------|
| `day` | YYYY-MM-DD | |
| `activity` | string | e.g. "cycling", "running", "weight_training" |
| `calories` | kcal | |
| `start_datetime` | ISO 8601 | |
| `end_datetime` | ISO 8601 | |
| `distance` | metres | |
| `average_heart_rate` | bpm | |
| `max_heart_rate` | bpm | |
| `source` | string | "manual" \| "confirmed" \| "workout_heart_rate" |

> Not synced — could complement our own workout sessions with Oura-detected sessions.

### Personal Info — `GET /v2/usercollection/personal_info`
Scope: `personal`

| Field | Type | Notes |
|-------|------|-------|
| `age` | integer | |
| `weight` | kg | |
| `height` | metres | |
| `biological_sex` | string | |
| `email` | string | |

> Already implemented in `client.ts` (`fetchPersonalInfo`) — not used currently.

### Ring Configuration — `GET /v2/usercollection/ring_configuration`
No scope required

| Field | Type | Notes |
|-------|------|-------|
| `color` | string | Ring colour |
| `design` | string | e.g. "heritage", "horizon" |
| `firmware_version` | string | |
| `hardware_type` | string | e.g. "gen3", "gen4", "gen5" |
| `size` | integer | US ring size |
| `set_up_at` | ISO 8601 | When ring was first set up |

> Already implemented in `client.ts` (`fetchRingConfiguration`) — not used currently.

### Mindfulness Sessions — `GET /v2/usercollection/session`
Scope: `session`

| Field | Type | Notes |
|-------|------|-------|
| `day` | YYYY-MM-DD | |
| `start_datetime` | ISO 8601 | |
| `end_datetime` | ISO 8601 | |
| `type` | string | "breathing", "meditation", "nap", "relaxation", "rest", "body_status" |
| `mood` | string | Pre/post mood rating |
| `heart_rate` | time series | bpm during session |
| `heart_rate_variability` | time series | HRV during session |

---

## Data Flow Summary

```
Oura API → /api/oura/sync (POST) → DB tables
                │
                ├── sleep (long_sleep/sleep types only)
                │       └── sleep_sessions (duration, stages, HRV, HR, efficiency, etc.)
                │       └── body_metrics (hrv_ms, resting_heart_rate)  ← via sleepByDay
                │
                ├── daily_sleep + daily_readiness + daily_activity + daily_stress
                │   + vO2_max + daily_cardiovascular_age + daily_resilience
                │       └── oura_daily (scores + JSONB contributors, merged by date)
                │
                ├── daily_activity
                │       └── body_metrics (active_calories)
                │
                ├── daily_spo2
                │       └── body_metrics (spo2_pct)
                │
                └── heartrate (separate flow — /api/oura/hr-sync)
                        └── oura_heartrate (per-minute time series for workout windows)
```

## Webhook Data Types Supported

Oura pushes these event types to `/api/oura/webhook` in real time:

| data_type | Handler |
|-----------|---------|
| `daily_readiness` | → `upsertOuraDaily` (readiness fields) |
| `daily_sleep` | → `upsertOuraDaily` (sleep score) |
| `daily_activity` | → `upsertOuraDaily` + `upsertBodyMetrics` + HR backfill for sessions that day |
| `sleep` | → `upsertOuraSleep` + `upsertBodyMetrics` (HRV, RHR) |
| `daily_spo2` | subscribed but no handler yet |
| `daily_stress` | subscribed but no handler yet |
| `daily_cardiovascular_age` | subscribed but no handler yet |
| `daily_resilience` | subscribed but no handler yet |
| `vo2_max` | subscribed but no handler yet |

## Potential Future Additions

| Data | Endpoint | Why useful |
|------|----------|------------|
| Steps | `daily_activity.steps` | Already in the API response — just needs writing to `body_metrics.steps` |
| Breathing disturbance | `daily_spo2.breathing_disturbance_index` | Sleep apnea screening proxy |
| Oura workouts | `/v2/usercollection/workout` | Cross-reference with our logged sessions |
| Respiratory rate trend | `sleep.average_breath` per night (already stored, not displayed) | Recovery metric |
| Ring battery | `ring_battery_level` | Low battery warning in app |
| Temperature deviation | Already in `oura_daily` | Could surface on Health tab as fever/illness indicator |
