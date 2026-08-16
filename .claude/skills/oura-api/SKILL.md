---
name: Oura Ring v2 API
description: Use when working on any Oura Ring integration — API endpoints, data types, webhook setup, OAuth2 flow, or DB schema. Covers the full Oura v2 API spec (openapi v1.34).
version: 1.0.0
---

# Oura Ring v2 API Reference

Full spec: `.claude/skills/oura-api/references/openapi-v1.34.json`

## Auth

- **OAuth2 only** — PATs deprecated December 2025, no longer work
- Auth URL: `https://cloud.ouraring.com/oauth/authorize`
- Token URL: `https://api.ouraring.com/oauth/token`
- User data endpoints: `Authorization: Bearer {access_token}`
- **Webhook management endpoints: `x-client-id` + `x-client-secret` headers** (NOT Bearer token)

### OAuth2 Scopes

| Scope | Grants access to |
|---|---|
| `email` | User email |
| `personal` | Age, weight, height, sex |
| `daily` | Daily readiness, sleep, activity, stress, resilience, cardiovascular age, VO2 max |
| `heartrate` | Heart rate time series |
| `workout` | Workout summaries |
| `tag` | User tags |
| `session` | Guided/unguided sessions |
| `spo2Daily` | SpO2 average during sleep |

Our app requests: `daily heartrate spo2 workout personal session`

## Base URL

`https://api.ouraring.com`

## Pagination

All list endpoints: `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&next_token=...`
Time-series endpoints: `?start_datetime=ISO8601&end_datetime=ISO8601&next_token=...`
Follow `next_token` until null.

---

## Data Endpoints

### GET /v2/usercollection/personal_info
Auth: Bearer

| Field | Type | Notes |
|---|---|---|
| id | string | |
| age | integer\|null | |
| weight | number\|null | kg |
| height | number\|null | metres |
| biological_sex | string\|null | |
| email | string\|null | |

---

### GET /v2/usercollection/daily_readiness
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| score | integer\|null | 0–100 |
| temperature_deviation | number\|null | °C from baseline |
| temperature_trend_deviation | number\|null | °C multi-day trend |
| timestamp | string | ISO 8601 |
| contributors.activity_balance | integer\|null | 1–100 |
| contributors.body_temperature | integer\|null | 1–100 |
| contributors.hrv_balance | integer\|null | 1–100 |
| contributors.previous_day_activity | integer\|null | 1–100 |
| contributors.previous_night | integer\|null | 1–100 |
| contributors.recovery_index | integer\|null | 1–100 |
| contributors.resting_heart_rate | integer\|null | 1–100 |
| contributors.sleep_balance | integer\|null | 1–100 |
| contributors.sleep_regularity | integer\|null | 1–100 (newer field) |

---

### GET /v2/usercollection/daily_sleep
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| score | integer\|null | 0–100 |
| timestamp | string | ISO 8601 |
| contributors.deep_sleep | integer\|null | 1–100 |
| contributors.efficiency | integer\|null | 1–100 |
| contributors.latency | integer\|null | 1–100 |
| contributors.rem_sleep | integer\|null | 1–100 |
| contributors.restfulness | integer\|null | 1–100 |
| contributors.timing | integer\|null | 1–100 |
| contributors.total_sleep | integer\|null | 1–100 |

---

### GET /v2/usercollection/sleep
Individual sleep sessions (multiple per day possible: naps, main sleep, rest periods)
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

`type` enum: `'deleted' | 'sleep' | 'long_sleep' | 'late_nap' | 'rest'`
(**Note**: `short_sleep` is NOT a valid type per spec v1.34)

Filter for main sleep: `type === 'long_sleep' || type === 'sleep'`

| Field | Type | Notes |
|---|---|---|
| id | string | unique dedup key → `oura_id` in DB |
| day | string | YYYY-MM-DD of wake-up |
| bedtime_start | string | ISO 8601 |
| bedtime_end | string | ISO 8601 |
| type | string | see enum above |
| time_in_bed | integer | seconds |
| total_sleep_duration | integer\|null | seconds |
| awake_time | integer\|null | seconds |
| light_sleep_duration | integer\|null | seconds |
| deep_sleep_duration | integer\|null | seconds |
| rem_sleep_duration | integer\|null | seconds |
| efficiency | integer\|null | 1–100 |
| latency | integer\|null | seconds to fall asleep (= onset_latency) |
| average_heart_rate | number\|null | bpm (30-sec samples average) |
| lowest_heart_rate | integer\|null | bpm (best RHR proxy) |
| average_hrv | integer\|null | ms rMSSD |
| average_breath | number\|null | breaths/min (respiratory rate) |
| restless_periods | integer\|null | count |
| low_battery_alert | boolean | ring was low battery during sleep |
| sleep_algorithm_version | string\|null | |

---

### GET /v2/usercollection/daily_activity
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| score | integer\|null | 1–100 |
| active_calories | integer | kcal from activity |
| total_calories | integer | TDEE (active + resting) |
| steps | integer | |
| equivalent_walking_distance | integer | metres |
| high_activity_time | integer | seconds |
| medium_activity_time | integer | seconds |
| low_activity_time | integer | seconds |
| sedentary_time | integer | seconds |
| resting_time | integer | seconds |
| non_wear_time | integer | seconds |
| inactivity_alerts | integer | count |
| average_met_minutes | number | |
| high_activity_met_minutes | integer | |
| medium_activity_met_minutes | integer | |
| low_activity_met_minutes | integer | |
| target_calories | integer | daily target |
| target_meters | integer | daily target |
| contributors.meet_daily_targets | integer\|null | 1–100 |
| contributors.move_every_hour | integer\|null | 1–100 |
| contributors.recovery_time | integer\|null | 1–100 |
| contributors.stay_active | integer\|null | 1–100 |
| contributors.training_frequency | integer\|null | 1–100 |
| contributors.training_volume | integer\|null | 1–100 |

---

### GET /v2/usercollection/daily_spo2
(**NOT** `spo2_daily` — that path does not exist)
Auth: Bearer · Scope: `spo2Daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| breathing_disturbance_index | integer\|null | BDI from SpO2 drops [0, 100] |
| spo2_percentage.average | number\|null | % blood oxygen |

---

### GET /v2/usercollection/daily_stress
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

`day_summary` enum: `'restored' | 'normal' | 'stressful'`
(**Note**: NOT `'restorative'`, `'very_stressful'`, or `'passive'` — those aren't in the spec)

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| stress_high | integer\|null | **seconds** in high-stress zone |
| recovery_high | integer\|null | **seconds** in high-recovery zone |
| day_summary | string\|null | see enum above |

---

### GET /v2/usercollection/daily_resilience
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

`level` enum: `'limited' | 'adequate' | 'solid' | 'strong' | 'exceptional'`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| level | string\|null | see enum above |
| contributors.sleep_recovery | number | 0–100 |
| contributors.daytime_recovery | number | 0–100 |
| contributors.stress | number | 0–100 |

---

### GET /v2/usercollection/daily_cardiovascular_age
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| vascular_age | integer\|null | predicted vascular age, years [18, 100] |
| pulse_wave_velocity | number\|null | m/s, derived from vascular age |

---

### GET /v2/usercollection/vO2_max
(**Note**: capital O — path is `vO2_max` not `vo2_max`)
Auth: Bearer · Scope: `daily` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| timestamp | string | ISO 8601 |
| vo2_max | integer | ml/kg/min (Ring 4+ only) |

---

### GET /v2/usercollection/heartrate
Time-series, one sample per minute.
Auth: Bearer · Scope: `heartrate` · Params: `start_datetime`, `end_datetime`

| Field | Type | Notes |
|---|---|---|
| bpm | number | |
| source | string | `'awake' \| 'sleep' \| 'workout' \| 'rest' \| 'session'` |
| timestamp | string | ISO 8601 |

---

### GET /v2/usercollection/ring_battery_level
Time-series. Auth: Bearer · Params: `start_datetime`, `end_datetime`, `latest=true`

| Field | Type | Notes |
|---|---|---|
| timestamp | string | ISO 8601 |
| timestamp_unix | integer | ms |
| level | integer | 0–100 % |
| charging | boolean\|null | ring is actively charging |
| in_charger | boolean\|null | ring is in charger |

To get latest: `?latest=true` with a wide time range. Response may be `{ items: [] }` or `{ data: [] }` — handle both.

---

### GET /v2/usercollection/ring_configuration
Auth: Bearer · Returns list

`color` enum: `'brushed_silver' | 'glossy_black' | 'glossy_gold' | 'glossy_white' | 'rose' | 'silver' | 'stealth_black' | 'titanium' | 'cloud' | 'petal' | 'midnight' | 'tide'` (Ring 5 adds cloud/petal/midnight/tide)
`design` enum: `'heritage' | 'balance' | 'balance_diamond' | 'horizon' | 'ceramic'`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| color | string\|null | see enum |
| design | string\|null | see enum |
| firmware_version | string\|null | |
| hardware_type | string\|null | |
| size | integer\|null | US ring size |
| set_up_at | string\|null | ISO 8601 UTC |

---

### GET /v2/usercollection/workout
Auth: Bearer · Scope: `workout` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| activity | string | type of workout |
| start_datetime | string | ISO 8601 |
| end_datetime | string | ISO 8601 |
| calories | number\|null | kcal |
| distance | number\|null | metres |
| intensity | string | `'easy' \| 'moderate' \| 'hard'` |
| label | string\|null | user-defined |
| source | string | auto-detected or user-entered |

---

### GET /v2/usercollection/sleep_time
Auth: Bearer · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| optimal_bedtime | object\|null | start/end of optimal window |
| recommendation | string\|null | suggested action |
| status | string\|null | current sleep time status |

---

## Webhooks

### Architecture
- **App-level**, not per-user — one set of subscriptions covers all users
- Oura pushes events ~30 seconds after data syncs from the mobile app
- Payload is small (event type + document ID only) — **must fetch the document separately** using the user's access token

### Webhook management auth
Uses **client credentials** (not user Bearer token):
```
x-client-id: {OURA_CLIENT_ID}
x-client-secret: {OURA_CLIENT_SECRET}
Content-Type: application/json
```

### Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/v2/webhook/subscription` | List subscriptions |
| POST | `/v2/webhook/subscription` | Create subscription |
| GET | `/v2/webhook/subscription/{id}` | Get subscription |
| PUT | `/v2/webhook/subscription/{id}` | Update subscription |
| DELETE | `/v2/webhook/subscription/{id}` | Delete subscription |
| PUT | `/v2/webhook/subscription/renew/{id}` | Renew expiring subscription |

### Supported data_type values (webhook `ExtApiV2DataType`)
`tag`, `enhanced_tag`, `workout`, `session`, `sleep`, `daily_sleep`, `daily_readiness`, `daily_activity`, `daily_spo2`, `sleep_time`, `rest_mode_period`, `ring_configuration`, `daily_stress`, `daily_cardiovascular_age`, `daily_resilience`, `vo2_max`, `meal`

### Webhook event payload (POST to callback URL)
```json
{
  "event_type": "create",
  "data_type": "daily_readiness",
  "user_id": "<oura_user_id>",
  "id": "<document_id>",
  "operation_type": "create"
}
```

### Verification (GET to callback URL)
Oura sends `GET {callback_url}?verification_token={token}` → respond with the token as plaintext.

### HMAC signature
Oura signs POST bodies with HMAC-SHA256 using the `signing_key` returned from subscription creation.
Header: `x-oura-signature: sha256={hex_digest}`
Verify: `timingSafeEqual(Buffer.from(sig, 'hex'), createHmac('sha256', signingKey).update(rawBody).digest())`

### App webhook setup
Register once at deploy time via `POST /api/oura/webhooks` (admin-only route).
Subscriptions may expire — renew via `PUT /v2/webhook/subscription/renew/{id}`.

---

## TrainingAI DB Mapping

| Oura endpoint | DB table | Key fields |
|---|---|---|
| daily_readiness | `oura_daily` | readiness_score, temperature_deviation, readiness_contributors |
| daily_sleep | `oura_daily` | sleep_score, sleep_contributors |
| daily_activity | `oura_daily` | activity_score, active_calories, activity times |
| daily_stress | `oura_daily` | stress_high (seconds), recovery_high (seconds), day_summary |
| daily_cardiovascular_age | `oura_daily` | vascular_age, pulse_wave_velocity |
| daily_resilience | `oura_daily` | resilience_level, resilience_contributors |
| vO2_max | `oura_daily` | vo2_max |
| sleep | `sleep_sessions` | via oura_id UNIQUE; efficiency, onset_latency_sec, average_hrv_ms, avg_heart_rate, lowest_heart_rate, restless_periods, respiratory_rate |
| daily_spo2 | `body_metrics` | spo2_pct |
| sleep.average_hrv | `body_metrics` | hrv_ms |
| sleep.lowest_heart_rate | `body_metrics` | resting_heart_rate |
| daily_activity.active_calories | `body_metrics` | active_calories |

All upserts use `COALESCE(EXCLUDED.col, table.col)` — Oura data does NOT overwrite existing non-null values.

## oura_tokens table columns
`user_id` (PK), `personal_access_token` (legacy, unused), `access_token`, `refresh_token`, `expires_at`, `scope`, `oura_user_id` (UNIQUE — used to route webhook events to DB user), `webhook_signing_key`

---

## Known Gotchas

1. **Path is `daily_spo2`** not `spo2_daily` — the wrong name returns 404
2. **Path is `vO2_max`** (capital O) not `vo2_max`
3. **Webhook auth is client credentials** (`x-client-id`/`x-client-secret`), NOT user Bearer token
4. **Webhooks are app-level** — register once, covers all users; `user_id` in payload routes to the right user via `oura_tokens.oura_user_id`
5. **stress_high / recovery_high are in SECONDS** not minutes
6. **day_summary enum**: `'restored' | 'normal' | 'stressful'` only (not `'restorative'`, `'very_stressful'`, or `'passive'`)
7. **sleep type**: `'deleted' | 'sleep' | 'long_sleep' | 'late_nap' | 'rest'` (no `'short_sleep'`)
8. **PATs are dead** — deprecated December 2025, Oura returns errors for PAT auth
9. **ring_battery_level response shape**: may be `{ items: [] }` or `{ data: [] }` — handle both
10. **sleep.latency** is the same as onset_latency (seconds to fall asleep)
11. Subscriptions have an expiration — use `PUT /v2/webhook/subscription/renew/{id}` before they expire
