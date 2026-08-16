# AI-Chosen Rest Days — Framework

**Date:** 2026-06-22  
**Status:** Planning

---

## Core Mental Model

The program's session rotation already handles muscle recovery — a well-structured split (PPL, Upper/Lower, etc.) ensures 48h+ between same-muscle sessions by design. Rest days are therefore primarily for **CNS fatigue and life flexibility**, not muscle-specific recovery.

This means:
- The user trains whenever they can, takes breaks when life demands it
- The AI's job is to **pick the right session each day** and **flag when the body needs a breather**
- Rest days are user-owned and sporadic — not AI-scheduled on a fixed cadence
- The AI never blocks the user from training; it surfaces information and lets them decide

---

## Three Schedule Modes

```
Schedule.type: 'weekly' | 'rotation' | 'ai_dynamic'
```

| Mode | How it works |
|------|-------------|
| **Weekly** | Fixed day-of-week slots. No change required. |
| **Rotation** | N consecutive days then 1 mandatory rest. No change required. |
| **AI Dynamic** | AI picks the best session each day. Flags deload/rest when CNS signals warrant it. User decides whether to follow the recommendation. |

---

## AI Dynamic Mode — What the AI Does Each Day

### Step 1 — Which session?

Score every session in the program and recommend the best one:

```
sessionScore = (recoveryScore × 0.4) + (balanceScore × 0.35) + (freshnessScore × 0.25)
```

**`recoveryScore` (0–100):**  
Average muscle recovery % for the session's primary muscles. Source: `/api/muscle-recovery`. A session whose chest/triceps are at 95% scores higher than one whose quads are at 40%. This is what handles muscle collision prevention — Push and Upper naturally space themselves apart because chest/shoulders score low until 48h+ have passed.

**`balanceScore` (0–100):**  
How overdue is this session relative to the others? Sessions not done in a while score higher to prevent the same session dominating.

**`freshnessScore` (0–100):**  
Inverse of how recently this exact session was last done. Prevents back-to-back repeats unless the program only has one session.

The highest-scoring session is recommended. Session identity uses DB `id`, never session name.

---

### Step 2 — Flag intensity

Check consecutive training days and readiness signals to determine whether to flag deload/rest:

| Consecutive training days | Readiness | Recommendation |
|--------------------------|-----------|----------------|
| 1–3 | Any | Full session — no flag |
| 4+ | Oura ≥ 70 (or custom score ≥ 65) | Soft nudge only — "4 days in a row, consider a rest soon" |
| 4+ | Oura 50–69 (or custom 45–64) | **Deload or rest recommended** — paired suggestion prominent |
| 4+ | Oura < 50 (or custom < 45) | **Deload or rest strongly recommended** — shown first, full session de-emphasised |
| Any | Temperature deviation > +0.5°C | **Deload or rest recommended** regardless of consecutive days — body temp override |
| Any | Day summary = `'very_stressful'` | Same as above — Oura override |

**When Oura is connected:** `oura_daily.readiness_score` is the primary signal. The custom composite score (HRV + sleep hours + RHR + ACWR) acts as fallback when Oura data is unavailable for today.

**Deload and rest are always surfaced together** when flagged. Full session is always a third option — the user decides.

Temperature deviation and `day_summary` are early-warning overrides — they fire before day 4 if the body signals something is wrong, regardless of how fresh the training streak is.

---

### Step 3 — Streak warning

Separately from the training recommendation, check consecutive **rest days** and show the appropriate streak message:

| Consecutive rest days | Streak message |
|----------------------|----------------|
| 0 | No message |
| 1 | "Streak safe — day 1 of 2 rest days" |
| 2 | "Rest again tomorrow and your streak breaks" |
| 3+ | **Streak broken.** "Resting today breaks your streak" shown before the user confirms rest on day 3 |

The streak counter resets to 0 the moment any session (including deload) is logged.

---

## The Full Recommendation Response

```typescript
interface NextSessionRecommendation {
  isRestDay: false               // ai_dynamic never recommends rest outright —
                                 // it always recommends a session and lets the user choose rest
  session: ProgramSession        // best-scored session for today
  isDeload: boolean              // true when consecutive days >= 4 or signals poor
  reason: string                 // 1-sentence: why this session, or why deload flagged

  // CNS fatigue context
  consecutiveTrainingDays: number
  deloadOrRestRecommended: boolean   // true when isDeload = true, shown as paired choice
  deloadStrength: 'soft' | 'recommended' | 'strong'  // modulates UI prominence

  // Readiness source
  readinessScore: number | null       // Oura readiness_score if connected, else custom composite
  readinessSource: 'oura' | 'custom' | 'none'
  temperatureAlert: boolean           // true when oura temp_deviation > +0.5°C

  // Streak context
  consecutiveRestDays: number
  streakWarning: boolean         // true on day 2 rest
  streakBroken: boolean          // true on day 3+ rest
}
```

Note: `isRestDay` is always `false` in `ai_dynamic` mode. The AI always recommends a session. The user chooses whether to follow it, take a deload, or rest — that choice is recorded in `workout_sessions`.

---

## What the User Sees

### Normal day (days 1–3 in a row)

```
[ Legs Day ]
Quads 91% · Hamstrings 88% · Most overdue session
[ Start Workout ]
```

### Day 4+ in a row (deload/rest flagged)

```
[ Legs Day ]
4 sessions in a row — your CNS will benefit from a lighter day

[ Deload Session ]  [ Rest Day ]  [ Full Session →]
```

All three options always visible. Deload and rest are highlighted; full session is available but secondary.

### Day 2 rest (streak warning)

```
[ Rest Day ]
Streak safe — day 1 of 2 rest days    (day 1)
────────────────────────────────────────────────
Rest again tomorrow and your streak breaks    (day 2)
```

### Day 3 rest (streak break)

```
[ Resting today breaks your streak ]
[ Rest anyway ]   [ Train instead → ]
```

---

## Muscle Collision Prevention (Implicit)

No explicit collision detection needed. The `recoveryScore` handles it:

- After Push (Chest, Shoulders, Triceps), Upper (Chest, Shoulders, Back, Arms) scores low the next day — chest/shoulders are ~49% recovered at 24h using the heavy session model (tau=36h)
- After 48h those muscles are ~63%+ recovered → Upper scores high again
- Push → Pull is always safe (no shared muscles) and scores normally
- Legs → Lower collision is similarly handled

A valid week for a 5-session PPL+UL program falls out naturally from the scoring:

```
Mon: Push
Tue: Pull       ← no Push overlap ✓
Wed: Legs       ← no upper body overlap ✓
Thu: Upper      ← 48h+ since Push and Pull ✓
Fri: Lower      ← 48h+ since Legs ✓
[rest when life allows]
```

The user could equally do Mon rest, Tue–Sat train, or any other pattern — the scoring always picks the safest available session for that specific day.

---

## Program-Aware Session Frequency

The AI does not enforce a weekly session target. However, the config screen should surface realistic guidance based on the program structure:

| Program type | Practical max sessions/week | Natural rest days |
|-------------|----------------------------|-------------------|
| Full Body (1 session) | 3–4 (48h rule) | 3–4 |
| Upper/Lower (2 sessions) | 4 | 3 |
| PPL (3 sessions) | 6 | 1–2 |
| Upper/Lower x2 (4 sessions) | 5–6 | 1–2 |
| PPL + UL (5 sessions) | 5–6 | 1–2 |
| PPL x2 (6 sessions) | 6 | 1 |

If the user's program has fewer sessions, the AI should note this: *"With a 2-session program, the 48h recovery rule means ~4 sessions/week is the realistic ceiling."* Not a hard block — just context.

---

## Readiness Score — Blended Model

### The Overlap Problem

A straight weighted blend of both scores double-counts HRV, sleep, and RHR — those signals exist in both systems. The correct approach is to recognise what each score uniquely contributes:

| Signal | Our custom score | Oura score |
|--------|-----------------|------------|
| Sleep hours | ✅ (raw hours / 8h) | ✅ (quality: stages, efficiency, timing, 2-week consistency) |
| HRV | ✅ (7-day avg / 28-day baseline, Galaxy Watch) | ✅ (overnight rMSSD continuous, 3-month baseline) |
| RHR | ✅ (7-day avg / 28-day baseline) | ✅ (overnight lowest HR) |
| Training load (ACWR) | ✅ **unique** — from `exercise_logs` volume | ❌ Oura only sees steps/calories |
| Body temperature deviation | ❌ | ✅ **unique** — illness/overtraining early warning |
| Sleep quality (efficiency, latency, staging consistency) | ❌ | ✅ **unique** |
| 3-month HRV baseline | ❌ (28 days only) | ✅ more stable over bad training blocks |
| Recovery index (when in sleep HRV stabilised) | ❌ | ✅ **unique** |
| Resilience (long-term stress adaptation) | ❌ | ✅ **unique** |

**Design principle: Oura anchors the physiological base. Our ACWR adds training-load specificity Oura is blind to.**

---

### Blending Formula

```
When Oura connected AND oura_daily.readiness_score != null:

  base = oura.readinessScore                          // 0–100

  acwrModifier:
    acwr 0.8–1.3  → +3    (optimal sweet spot)
    acwr 1.3–1.5  → -(acwr - 1.3) × 30  (−0 to −6, graduated)
    acwr > 1.5    → −15   (overreaching zone)
    acwr < 0.6    → −5    (detraining, mild penalty)
    acwr null     → 0

  tempModifier (applied after acwr):
    deviation null or ≤ 0.3   →  0   (normal noise)
    deviation 0.3–0.5         → −10  (mild elevation — flag)
    deviation 0.5–1.0         → −20  (likely illness or overtraining)
    deviation > 1.0           → clamp final score to max 40

  blended = clamp(base + acwrModifier + tempModifier, 0, 100)
  source = 'oura+acwr'

When Oura not connected:
  blended = sleepScore + hrvScore + rhrScore + loadScore   // existing formula
  source = 'custom'
```

**Why not fold soreness into the blended score?** Soreness is session-specific — it matters for *which* session to pick, not for overall physiological readiness. It belongs in the session scoring step, not the readiness score.

**Day summary as label, not modifier.** `oura_daily.daySummary` ('restored' / 'stressful' / 'very_stressful') is already reflected in Oura's readiness_score. Applying it as an additional penalty would double-count it. Show it as a plain-English label in the UI.

---

### Updated `ReadinessScoreResponse`

```typescript
export interface ReadinessScoreResponse {
  score: number                          // blended 0–100
  label: 'High' | 'Moderate' | 'Low'
  source: 'oura+acwr' | 'oura' | 'custom' | 'none'
  ouraScore?: number | null              // raw Oura readiness_score before modifiers
  daySummary?: string | null             // 'restored' | 'stressful' | 'very_stressful' etc.
  temperatureDeviation?: number | null   // °C, shown as warning chip when elevated
  hasSufficientData: boolean
  earlyDeloadRecommended: boolean

  components: {
    // When source = 'oura+acwr' or 'oura':
    ouraHrvBalance?: number              // readiness_contributors.hrv_balance (0–100)
    ouraSleepQuality?: number            // readiness_contributors.previous_night (0–100)
    ouraSleepBalance?: number            // readiness_contributors.sleep_balance (0–100)
    ouraBodyTemp?: number                // readiness_contributors.body_temperature (0–100)
    ouraRestingHr?: number               // readiness_contributors.resting_heart_rate (0–100)
    ouraActivityBalance?: number         // readiness_contributors.activity_balance (0–100)
    trainingLoad?: number                // ACWR-derived 0–100 (present in both modes)

    // When source = 'custom':
    sleep?: number                       // 0–40
    hrv?: number                         // 0–30
    rhr?: number                         // 0–20
    load?: number                        // 0–10
  }
}
```

---

### Changes to `readiness-score/route.ts`

1. Add `getOuraDaily(userId, yesterday, today)` fetch alongside existing queries
2. If today's Oura row exists: compute blended score; populate Oura contributor fields
3. Populate `externalReadiness` in `signals.ts` aggregateSignals via the same query
4. Existing custom score calculation retained as fallback — no regression when Oura is disconnected

---

## Additional Oura Data to Surface in the App

The Oura integration stores far more than is currently displayed. Here's the full inventory of what's available vs what's shown:

### Sleep — Currently Showing vs Available

**Currently shown** (from Galaxy Watch / Health Connect):
- Total sleep hours
- Deep sleep hours
- REM hours

**Available from Oura `sleep_sessions`** (already stored in DB):

| Field | What it means | Display value |
|-------|--------------|---------------|
| `efficiency` | % of time in bed actually asleep (85%+ = good) | % badge on sleep card |
| `onsetLatencySec` | Seconds to fall asleep — high = stress/anxiety signal | "Fell asleep in Xm" |
| `averageHrvMs` | Continuous overnight rMSSD — more reliable than Galaxy Watch | Replaces `body_metrics.hrv_ms` when available |
| `lowestHeartRate` | Overnight lowest HR — better RHR proxy than Galaxy Watch | Replaces/supplements `resting_heart_rate` |
| `restlessPeriods` | Count of restless movement events | "X restless periods" in detail sheet |
| `respiratoryRate` | Breaths per minute (stored as `respiratory_rate`) | Normal 12–20; elevated = illness signal |
| `sleepScore` | Oura's per-session 0–100 quality score | Headline on sleep card when Oura connected |

**Available from `oura_daily`** (sleep contributors):

| Contributor | What it means |
|-------------|--------------|
| `deep_sleep` | 0–100 deep sleep quality score |
| `rem_sleep` | 0–100 REM quality score |
| `latency` | 0–100 sleep onset (higher = fell asleep faster) |
| `efficiency` | 0–100 |
| `restfulness` | 0–100 — low restlessness |
| `timing` | 0–100 — aligned with circadian rhythm |
| `total_sleep` | 0–100 — adequate duration |

**Proposed sleep card upgrade (when Oura connected):**
```
Sleep  8h 20m               [Oura: 84]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Deep 1h 45m · REM 2h 10m
Efficiency 91% · Fell asleep in 8m
HRV 54ms · RHR 48bpm · Resp 14.2/min
```

---

### Health Page — New Metrics to Add

**1. Body Temperature Deviation**
- Source: `oura_daily.temperature_deviation`
- Display: Small chip/badge on the health biometrics row: "+0.2°C" in amber if 0.3–0.5, red if >0.5
- When normal (≤0.3): not shown (no news is good news)
- Context: elevated temp before HRV drops = earliest illness/overtraining warning available

**2. Respiratory Rate**
- Source: `sleep_sessions.respiratory_rate`
- Display: Add to the HRV / SpO2 / RHR biometric pills row
- Normal range 12–20 breaths/min; elevated = illness, sleep apnoea, or high training load
- Already stored in DB (migration 088)

**3. Sleep Efficiency %**
- Source: `sleep_sessions.efficiency`
- Display: Alongside sleep hours on health page and sleep detail sheet
- 85%+ = good. Below 75% = poor quality regardless of duration.

**4. Resilience Level**
- Source: `oura_daily.resilience_level` ('exceptional' / 'strong' / 'adequate' / 'limited' / 'low')
- Source: `oura_daily.resilience_contributors` (sleep_recovery, daytime_recovery, stress each 0–100)
- Display: Badge on the readiness card — "Resilience: Strong"
- Meaning: long-term ability to handle stress. Doesn't fluctuate daily like readiness.

**5. Stress / Recovery Balance**
- Source: `oura_daily.stress_high` (minutes) + `oura_daily.recovery_high` (minutes)
- Display: Simple bar on health page showing today's stress vs recovery split
- Only visible when Oura connected; hidden when both are null

**6. VO₂ Max** (Ring 5 only)
- Source: `oura_daily.vo2_max`
- Display: Static metric on health page, updated when new data arrives
- Trend line over time is the useful view (not day-to-day value)
- Already stored in DB

**7. Cardiovascular / Vascular Age**
- Source: `oura_daily.vascular_age`
- Display: Interesting vanity metric — "Vascular age: 28" on health page
- Low priority but costs nothing to surface since it's already in DB

---

### Readiness Card Upgrade (Home + Overview)

**Currently:** Score number + label + components bar

**With Oura connected:**
```
Readiness          81  ●●●●●●●●○○
Oura · Restored

HRV Balance    ████████░░  85
Sleep Quality  ███████░░░  72
Body Temp      ██████████  98  ← no deviation
Resting HR     ████████░░  80
Training Load  ████████░░  78  ← our ACWR
```

**Temperature warning chip** (when deviation > 0.3°C):
```
⚠ Body temp +0.6°C above baseline
```
Shown prominently above the score when triggered — this is the most actionable signal.

---

### Morning Briefing Upgrade

`app/api/morning-briefing/route.ts` currently ingests: sleep (2d), body metrics (7d), workout sessions (2d), readiness recommendation.

**Add to context when Oura connected:**
- `oura_daily` for today: readiness_score, sleep_score, day_summary, temperature_deviation
- Last night's sleep session: efficiency, onset_latency, average_hrv, respiratory_rate

This gives Gemini the difference between "you slept 7.5h" and "you slept 7.5h but only 72% efficiency with 14 restless periods and elevated respiratory rate" — meaningfully better coaching context.

---

### Implementation Priority

| Item | Value | Effort | Priority | Notes |
|------|-------|--------|----------|-------|
| Blended readiness score (route update) | High | Medium | 1 | Core of the feature |
| Populate `externalReadiness` in signals.ts | High | Low | 1 | 1-line change once route is updated |
| Sleep card full Oura upgrade | High | Medium | 1 | Efficiency, stages %, onset latency, debt |
| Body temperature chip on health page | High | Low | 1 | Stored, just needs surfacing |
| Sleep debt calculation + display | High | Low | 1 | Computed from existing data, no new API |
| Sleep regularity / consistency | High | Low | 1 | Computed from sleep_start timestamps |
| Respiratory rate biometric pill | Medium | Low | 2 | Already stored |
| Resilience badge on readiness card | Medium | Low | 2 | Already stored |
| Oura readiness contributors breakdown | Medium | Medium | 2 | Expand readiness card |
| Stress/recovery balance bar | Medium | Medium | 2 | Already stored |
| Sleep timing window (sleep_time endpoint) | Medium | Medium | 2 | New endpoint + migration needed |
| Morning briefing Oura context | Medium | Low | 2 | Pass richer sleep context to Gemini |
| VO₂ max trend metric | Low | Low | 3 | Already stored |
| Vascular age metric | Low | Low | 3 | Already stored |
| SpO₂ disturbance index (apnoea proxy) | Low | Low | 3 | Already stored in oura_daily via spo2 |

---

## Sleep Data — Full Inventory and Display Plan

### What's Already Stored (but not displayed)

Every field below is already in the DB from the Oura sync. Nothing new needs to be fetched or stored — these are pure UI gaps.

**`sleep_sessions` table — per-night data:**

| Column | What it means | Currently shown? |
|--------|--------------|-----------------|
| `duration_hours` | Total sleep time | ✅ Yes |
| `deep_sleep_hours` | Deep sleep time | ✅ Yes |
| `rem_sleep_hours` | REM sleep time | ✅ Yes |
| `light_sleep_hours` | Light sleep time | ❌ Not shown |
| `awake_hours` | Time awake during night | ❌ Not shown |
| `efficiency` | % of time in bed actually asleep | ❌ Not shown |
| `onset_latency_sec` | Seconds to fall asleep | ❌ Not shown |
| `average_hrv_ms` | Continuous overnight rMSSD | ❌ Not shown (only body_metrics.hrv_ms shown) |
| `avg_heart_rate` | Average HR during sleep | ❌ Not shown |
| `lowest_heart_rate` | Overnight lowest HR (best RHR proxy) | ❌ Not shown directly |
| `restless_periods` | Count of restless movement events | ❌ Not shown |
| `respiratory_rate` | Breaths per minute | ❌ Not shown |
| `sleep_score` | Oura's per-session quality score (0-100) | ❌ Not shown |
| `sleep_start` / `sleep_end` | Actual bedtime and wake time | ❌ Not used for timing analysis |

**`oura_daily` — daily sleep score and contributors (stored in JSONB):**

| Field | What it means | Currently shown? |
|-------|--------------|-----------------|
| `sleep_score` | Oura's composite sleep quality (0-100) | ❌ Not shown |
| `sleep_contributors.deep_sleep` | Deep sleep quality (0-100) | ❌ Not shown |
| `sleep_contributors.rem_sleep` | REM quality (0-100) | ❌ Not shown |
| `sleep_contributors.efficiency` | Efficiency score (0-100) | ❌ Not shown |
| `sleep_contributors.latency` | Sleep onset score (0-100) | ❌ Not shown |
| `sleep_contributors.restfulness` | Restlessness (0-100) | ❌ Not shown |
| `sleep_contributors.timing` | Circadian alignment (0-100) | ❌ Not shown |
| `sleep_contributors.total_sleep` | Duration adequacy (0-100) | ❌ Not shown |
| `readiness_contributors.sleep_regularity` | Bedtime consistency (0-100) | ❌ Not shown |

---

### Computed Metrics (no new API calls — derived from data already in DB)

**Sleep Debt**

Oura doesn't expose a sleep debt field. Computed from `sleep_sessions`:

```
ideal = user's sleep_goal_hours (profile setting, defaults to 8)
nightly_deficit = max(0, ideal - actual_duration_hours)
7_day_debt  = sum of last 7 nights' deficits
```

Display: "Sleep debt: 2h 15m this week" — green = 0, amber = 1–3h, red > 3h.

**Sleep Cycles (estimated)**

Oura v2 does not expose hypnogram cycle boundaries. Estimated:

```
estimated_cycles = floor(total_sleep_hours / 1.5)
```

More useful is showing stage percentages alongside absolute times:
```
Deep   1h 45m   23%   (healthy: 15–25%)
REM    2h 05m   27%   (healthy: 20–25%)
Light  3h 30m   46%
Awake    22m     5%   (healthy: <10%)
```

**Sleep Regularity / Consistency**

From `sleep_sessions.sleep_start` over past 14 nights:

```
bedtime_hours[] = sleepStart.getHours() + sleepStart.getMinutes()/60
std_dev = stddev(bedtime_hours)
```

Display: "Bedtime varies ±Xm" — under 30m = consistent (green), 30–60m = moderate (amber), over 60m = irregular (red). Irregular bedtime timing is as harmful as insufficient sleep duration.

`oura_daily.readiness_contributors.sleep_regularity` (0-100) is already stored in the JSONB and can be read out directly as an alternative.

**Time in Bed vs Time Asleep**

```
time_in_bed_hours = (sleep_end - sleep_start) / 3600   (derivable from stored timestamps)
efficiency = time_asleep / time_in_bed × 100            (already stored)
```

Display: "9h in bed · 7h 40m asleep · 85% efficient"

---

### New API Endpoint to Add: `sleep_time`

Not currently being fetched. Returns Oura's chronotype-based recommended bedtime window:

```typescript
// New type for lib/oura/types.ts
interface OuraSleepTime {
  id: string
  day: string
  optimal_bedtime: {
    day_tz: number        // minutes from midnight, local time
    end_offset: number    // end of recommended window
    start_offset: number  // start of recommended window
  } | null
  recommendation: 'improve_efficiency' | 'earlier_bedtime' | 'later_bedtime' |
                  'earlier_wake_up_time' | 'later_wake_up_time' |
                  'follow_optimal_bedtime' | 'no_recommendation' | null
  status: 'optimal' | 'slightly_early' | 'slightly_late' | 'early' | 'late' | null
}
```

New columns on `oura_daily` (migration needed):
```sql
ALTER TABLE oura_daily
  ADD COLUMN IF NOT EXISTS recommended_bedtime_start INTEGER,  -- minutes from midnight
  ADD COLUMN IF NOT EXISTS recommended_bedtime_end   INTEGER,
  ADD COLUMN IF NOT EXISTS sleep_time_status         TEXT,
  ADD COLUMN IF NOT EXISTS sleep_time_recommendation TEXT;
```

Display: "Optimal bedtime: 10:30 – 11:00pm" on the sleep card and as an evening nudge.

---

### Proposed Sleep Card UI (When Oura Connected)

```
Sleep                                 [Oura: 84]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
11:02pm → 7:18am    9h 16m in bed
Asleep 7h 42m  ·  Efficiency 93%
Fell asleep in 6 min  ·  8 restless periods

Stages (≈ 5 cycles)
██████░░░░  Deep   1h 45m  23%
████████░░  REM    2h 05m  27%
██████████  Light  3h 30m  46%
█░░░░░░░░░  Awake    22m    5%

Overnight HRV 54ms  ·  RHR 48bpm  ·  Resp 14.2/min

Sleep debt this week:   45m    ✓
Bedtime consistency:   ±18m    ✓
Optimal bedtime:    10:30 – 11:00pm
```

Tapping `[Oura: 84]` opens a detail sheet with the 7 sleep contributor scores.

---

### What Oura Does NOT Expose (to set expectations)

| Request | Available? |
|---------|-----------|
| Cycle-by-cycle boundaries (hypnogram) | ❌ Not in v2 API |
| Per-stage HRV breakdown | ❌ Single overnight average only |
| Per-minute HR during sleep | Available via `heartrate` endpoint but high-frequency time-series — too heavy to store |
| Sleep apnoea detection | ❌ Not directly; SpO₂ disturbance index is the proxy |
| Dream detection | ❌ Not in API |
| Explicit sleep debt score | ❌ Must compute from duration history |

### Existing signals (no Oura)

| Data | Where it lives | Already used? |
|------|---------------|---------------|
| Per-muscle recovery % | `exercise_logs` → `muscle-recovery` route | Yes |
| ACWR | `exercise_logs` → `training-load` route | Yes |
| HRV / RHR (Galaxy Watch via Health Connect) | `body_metrics.hrv_ms` / `resting_heart_rate` | Yes |
| Sleep hours | `sleep_sessions` | Yes |
| Sore muscle groups | `mood_logs.body_sore_muscles` | Yes |
| Custom readiness score (0–100) | `readiness-score` route | Yes |
| Days since last session per type | `workout_sessions` | Yes |
| Consecutive training days | `workout_sessions` | Not yet |
| Consecutive rest days | `workout_sessions` | Not yet |

### Oura Ring signals (now deployed on main)

The Oura integration (migrations 083–089, `lib/oura/`, `app/api/oura/`) stores rich biometric data in `oura_daily` and `sleep_sessions`. This changes the readiness picture significantly:

| Data | Table / column | Value for this feature |
|------|---------------|----------------------|
| **Readiness score** | `oura_daily.readiness_score` (0–100) | Oura's own composite: HRV balance, sleep, body temp, activity balance, previous day load — far richer than our custom score |
| **Sleep score** | `oura_daily.sleep_score` (0–100) | Replaces raw sleep-hours heuristic |
| **Activity score** | `oura_daily.activity_score` (0–100) | How active the user was — high activity reduces tomorrow's readiness |
| **Temperature deviation** | `oura_daily.temperature_deviation` (°C) | Drift from personal baseline. > +0.5°C signals illness or overtraining — powerful standalone override |
| **Day summary** | `oura_daily.day_summary` | `'restored'` / `'restorative'` / `'stressful'` / `'very_stressful'` / `'passive'` — plain-English recovery state |
| **HRV balance contributor** | `oura_daily.readiness_contributors.hrv_balance` (0–100) | Granular HRV signal, already normalised to 0–100 |
| **Average HRV (rMSSD)** | `sleep_sessions.avg_hrv_ms` | Continuous overnight rMSSD — more reliable than Galaxy Watch spot readings |
| **Stress / recovery minutes** | `oura_daily.stress_high`, `oura_daily.recovery_high` | CNS load beyond just training |
| **Resilience** | `oura_daily` (migration 089) | Long-term stress resilience score |

### Integration point in existing code

`lib/ai-periodization/signals.ts` already has a hook:
```typescript
externalReadiness: null,  // populated when an external integration (e.g. Oura) is active
```
This is exactly where `oura_daily.readiness_score` should be fed in. When Oura is connected, this field should be populated before the prescription AI runs.

New computations needed: consecutive training days, consecutive rest days (simple backward count through `workout_sessions`), and reading `oura_daily` in `computeAiDynamicNextSession`.

---

## Database Schema Changes

### `schedules` table

```sql
ALTER TABLE schedules DROP CONSTRAINT schedules_type_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_type_check
  CHECK (type IN ('rotation', 'weekly', 'ai_dynamic'));
```

No new columns needed — `ai_dynamic` mode has no user-configurable parameters beyond enabling it.

### `workout_sessions` table — optional future addition

```sql
ALTER TABLE workout_sessions
  ADD COLUMN was_override boolean DEFAULT false,   -- user chose full session when deload was recommended
  ADD COLUMN intensity_mode text                   -- 'full' | 'deload' | null
    CHECK (intensity_mode IN ('full', 'deload'));
```

Not required for MVP — useful later for the AI to learn whether the user tends to ignore deload recommendations.

### TypeScript type

```typescript
export interface Schedule {
  id: string
  programId: string
  type: 'rotation' | 'weekly' | 'ai_dynamic'
  restAfterN?: number        // rotation only
  days?: ScheduleDay[]       // weekly only
  reminderEnabled?: boolean
  reminderTime?: string | null
}
```

---

## API Changes

### `GET /api/next-session`

Add `ai_dynamic` branch inside `getNextSession()`:

```typescript
if (schedule.type === 'ai_dynamic') {
  return computeAiDynamicNextSession(userId, sessions, history, signals)
}
```

`computeAiDynamicNextSession`:
1. Counts consecutive training days (backwards through `workout_sessions`)
2. Counts consecutive rest days (same)
3. Scores all sessions via the three-factor formula
4. Checks readiness signals (ACWR, HRV, soreness) to determine deload flag strength
5. Returns `NextSessionRecommendation` with `deloadOrRestRecommended` and streak fields

No new endpoint needed.

---

## Implementation Phases

### Phase 1 — Core
1. DB migration: add `ai_dynamic` to `schedules.type` constraint
2. Update `Schedule` TypeScript type
3. Implement `computeAiDynamicNextSession()` in `lib/data/postgres/adapter.ts`
4. Update `next-session` route to return consecutive day counts and deload flag
5. Schedule config UI — add AI Dynamic option

### Phase 2 — Home Screen
6. Home screen session card shows AI pick reasoning (session name + recovery % + overdue note)
7. Day 4+ card shows paired deload / rest / full session choices
8. Streak messaging (day 1 safe, day 2 warning, day 3 break confirmation)

### Phase 3 — Load Distribution (14+ days of data)
9. Session scoring gains look-ahead: factor in predicted recovery trajectory, not just today's snapshot
10. Heavier sessions biased toward peak readiness windows (high HRV, good sleep, low ACWR)

---

## Open Questions

1. **Partial session and streak** — does 1 set logged before abandoning count as a training day for streak purposes? Probably yes (the user showed up).

2. **Deload session selection** — when deload is recommended, does the AI pick a specific session at reduced intensity, or does the user pick from all sessions? Likely: AI recommends the same session it would have at full intensity, but the workout screen loads it in deload mode (reduced % via the prescription system).

3. **Phase interaction** — if the periodization engine outputs `rest_day_recommended`, does that override the "always recommend a session" rule? Yes — periodization prescription wins. Streak is a gamification nudge, not a clinical signal.
