---
name: Oura Ring v2 API
description: Use when working on any Oura Ring integration — API endpoints, data types, webhook setup, OAuth2 flow, or DB schema. Covers the full Oura v2 API spec (openapi v1.42).
version: 1.0.0
---

# Oura Ring v2 API Reference

Full spec: `.claude/skills/oura-api/references/openapi-v1.42.json` (the version Oura's docs page loaded on 18 Oct 2026). The previous pin, `openapi-v1.34.json`, is kept beside it for diffs.

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
| `daily` | Daily summaries of sleep, activity and readiness. Stress is not named under any scope; Oura accepts it under `daily` |
| `heartrate` | Time series heart rate for Gen 3 users |
| `workout` | Workout summaries |
| `tag` | User tags |
| `session` | Guided and unguided sessions in the Oura app |
| `spo2` | SpO2 average recorded during sleep (v1.34 spelled it `spo2Daily`; Oura drops that name silently) |
| `heart_health` | "Heart health data": cardiovascular age and VO2 max. New in v1.42 |

Our app requests: `personal daily heartrate workout session spo2 heart_health` (`lib/oura/cloud/config.ts` → `OURA_SCOPES`). A grant stored under the old name says `spo2Daily`; `grantedOuraScopes` reads it as `spo2`. The spec maps no route to a scope (every operation just lists `OAuth2`), so the per-route scopes below are inferred from the scope descriptions and from what Oura refused (#3026): Oura refused resilience, cardiovascular age and VO2 max under `daily`. Resilience under `heart_health` is a guess, since no other scope is left for it.

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
(**Note**: `short_sleep` is NOT a valid type per spec v1.34 or v1.42)

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
| average_hrv | integer\|null | unit and method not in the spec ("Average heart rate variability during sleep") |
| average_breath | number\|null | breaths/min (respiratory rate) |
| restless_periods | integer\|null | count |
| low_battery_alert | boolean | ring was low battery during sleep |
| sleep_algorithm_version | string\|null | |
| sleep_analysis_reason | string\|null | why this version of the sleep was created or updated |
| period | integer | eCore sleep period identifier |
| ring_id | string\|null | encrypted ring identifier |
| heart_rate | PublicSample\|null | overnight HR series (`interval`, `items[]`, `timestamp`); interval not in spec |
| hrv | PublicSample\|null | overnight HRV series; items may be null; interval and unit not in spec |
| sleep_phase_5_min | string\|null | 1 char per 5 min: `1` deep, `2` light, `3` REM, `4` awake |
| sleep_phase_30_sec | string\|null | 1 char per 30 s, same codes |
| app_sleep_phase_5_min | string\|null | hypnogram as the app shows it; spec says it "will be removed in the future" |
| movement_30_sec | string\|null | 1 char per 30 s: `1` no motion, `2` restless, `3` tossing and turning, `4` active |
| readiness | object\|null | `score`, `contributors`, `temperature_deviation`, `temperature_trend_deviation` for this sleep period |
| readiness_score_delta, sleep_score_delta | integer\|null | effect of this period on the readiness / sleep score |

`PublicSample` = `{ interval: number (seconds between items), items: (number\|null)[], timestamp }`. The spec has no response examples, so the interval of the sleep HR and HRV series is **not known** — one sandbox call (`/v2/sandbox/usercollection/...`) would settle it.

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
| sedentary_met_minutes | integer | |
| met | PublicSample | MET series for the day; interval not in spec (settle with a sandbox call before relying on it as per-minute) |
| class_5_min | string\|null | 1 char per 5 min: `0` non-wear, `1` rest, `2` inactive, `3` low, `4` medium, `5` high |
| meters_to_target | integer | metres remaining to target |
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
Auth: Bearer · Scope: `spo2` · Params: `start_date`, `end_date`

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
Auth: Bearer · Scope: `heart_health` (a guess, #3026) · Params: `start_date`, `end_date`

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
Auth: Bearer · Scope: `heart_health` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| vascular_age | integer\|null | predicted vascular age, years [18, 100] |
| pulse_wave_velocity | number\|null | m/s, derived from vascular age |

---

### GET /v2/usercollection/vO2_max
(**Note**: capital O — path is `vO2_max` not `vo2_max`)
Auth: Bearer · Scope: `heart_health` · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| timestamp | string | ISO 8601 |
| vo2_max | integer | unit not in the spec; the ring-generation requirement is not in the spec either |

---

### GET /v2/usercollection/heartrate
Time-series, provided at **5-minute increments** (spec, Heart Rate Routes). It is not per-minute.
Auth: Bearer · Scope: `heartrate` · Params: `start_datetime`, `end_datetime`, `latest`

| Field | Type | Notes |
|---|---|---|
| bpm | integer | |
| source | string | `'awake' \| 'workout' \| 'rest' \| 'sleep' \| 'live' \| 'session'` |
| timestamp | string | ISO 8601 UTC |
| timestamp_unix | integer | ms |

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

`color` enum: `'brushed_silver' | 'glossy_black' | 'glossy_gold' | 'glossy_white' | 'rose' | 'silver' | 'stealth_black' | 'titanium' | 'cloud' | 'petal' | 'midnight' | 'tide'` 
`design` enum: `'heritage' | 'balance' | 'balance_diamond' | 'horizon' | 'ceramic'`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| color | string\|null | see enum |
| design | string\|null | see enum |
| firmware_version | string\|null | |
| hardware_type | string\|null | enum `gen1 \| gen2 \| gen2m \| gen3 \| gen4 \| or5` — v1.42 added `or5` (Ring 5; v1.34 had no value for it); still parse leniently |
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
| source | string | `'manual' \| 'autodetected' \| 'confirmed' \| 'workout_heart_rate' \| 'live_third_party_heart_rate' \| 'live_oura_heart_rate'` (the last two new in v1.42) |

---

### GET /v2/usercollection/session
Guided and unguided sessions. Auth: Bearer · Scope: `session` · Params: `start_date`, `end_date`

`type` enum: `'breathing' | 'meditation' | 'nap' | 'relaxation' | 'rest' | 'body_status'`
`mood` enum: `'bad' | 'worse' | 'same' | 'good' | 'great'` (user-selected)

| Field | Type | Notes |
|---|---|---|
| id | string | |
| day | string | YYYY-MM-DD |
| start_datetime, end_datetime | string | ISO 8601 |
| type | string | see enum above |
| mood | string\|null | see enum above |
| heart_rate | PublicSample\|null | interval not in spec |
| heart_rate_variability | PublicSample\|null | interval and unit not in spec |
| motion_count | PublicSample\|null | |

---

### GET /v2/usercollection/enhanced_tag
Lifestyle tags. Auth: Bearer · Scope: `tag` (inferred) · Params: `start_date`, `end_date`. Replaces the deprecated `tag` route.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| tag_type_code | string\|null | `null` for text-only tags, `custom` for custom types; the codes are not listed in the spec |
| custom_name | string\|null | name when `tag_type_code` is `custom` |
| start_time | string | tag time, or start of a tag with duration |
| end_time | string\|null | `null` when there is no duration |
| start_day | string | YYYY-MM-DD |
| end_day | string\|null | |
| comment | string\|null | free text |

---

### GET /v2/usercollection/rest_mode_period
Rest mode the user turned on. Auth: Bearer · Scope: not stated in the spec · Params: `start_date`, `end_date`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| start_day | string | YYYY-MM-DD |
| start_time | string\|null | |
| end_day | string\|null | |
| end_time | string\|null | |
| episodes | array | each `{ tags: string[], timestamp }` |

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
From the spec's "Webhook Subscription Routes" description (it has no schema for the body):
```json
{
  "event_type": "update",
  "data_type": "sleep",
  "object_id": "12345abc",
  "event_time": "2023-01-01T08:00:00+00:00",
  "user_id": "user123"
}
```
`object_id` names the document; fetch it with `GET /v2/usercollection/{path}/{object_id}`
(`vo2_max` → path `vO2_max`). `user_id` is Oura's user id → `oura_tokens.oura_user_id`.

### Verification (GET to callback URL)
Oura sends `GET {callback_url}?verification_token={token}&challenge={random}` when a subscription is
created → answer **JSON** `{ "challenge": "<the challenge>" }` if the token is ours, 401 otherwise.

### HMAC signature
Headers `x-oura-signature` and `x-oura-timestamp`. The signature is HMAC-SHA256 keyed with the app's
**client secret** over `timestamp + JSON body`, as **upper-case hex**:
`createHmac('sha256', CLIENT_SECRET).update(timestamp + body).digest('hex').toUpperCase()`.
(An older version of this skill said a per-subscription `signing_key`; the spec says client secret.)
Our check: `lib/oura/cloud/webhook.ts` → `verifyOuraSignature` (constant-time, stale timestamps refused).

### Delivery
Answer within 10 s with a 2xx. Oura retries a failed delivery (4xx, 5xx, timeout) about ten times
over an hour. **A 410 cancels the subscription**, so never answer 410.

### App webhook setup
Subscriptions are created and renewed by `lib/oura/cloud/subscriptions.ts` (`ensureOuraWebhookSubscriptions`),
run every 12 h in production (`lib/oura/cloud/renewal.ts`) and as the agent job `oura-webhook-subscriptions`.
Renew with `PUT /v2/webhook/subscription/renew/{id}`; a 403 there means it no longer exists.

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

All upserts are written as source `oura_cloud` and merge per field by `source-rank.ts` (`lib/data/health-source.ts` → `mergeSet`): a null keeps the stored value, and the ring's BLE values and manual entries outrank `oura_cloud`. The writer is `lib/oura/cloud/ingest.ts` (#2859).

## oura_tokens table columns
`user_id` (PK), `personal_access_token` (legacy, unused), `access_token`, `refresh_token` (both AES-256-GCM ciphertext since #2858, `lib/oura/cloud/token-cipher.ts`), `expires_at`, `scope`, `oura_user_id` (UNIQUE — used to route webhook events to DB user), `webhook_signing_key` (legacy, unused: events are signed with the client secret)

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
