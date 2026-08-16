# AI Dynamic Rest Days — Design Spec

**Date:** 2026-06-22  
**Status:** Approved

---

## Goal

When a program uses `phaseMode: 'ai_dynamic'`, the home screen recommends the best session to train each day and flags when deload or rest is warranted — based on consecutive training days, readiness signals, and muscle recovery. The user always decides; the AI surfaces information.

---

## Architecture

Four pieces:

| File | Role |
|------|------|
| `lib/ai-periodization/ai-dynamic.ts` | Pure scoring function — no DB calls, all data passed in |
| `lib/types/program.ts` | Extended `NextSessionRecommendation` with 7 new fields |
| `lib/data/postgres/adapter.ts` | `getNextSession()` gets an `ai_dynamic` branch; new DB queries for consecutive days |
| `app/session-select/` | Banner component (pre-mood) + RecommendationCard three-choice expansion |

---

## Session Scoring

`computeAiDynamicNextSession()` scores every session and returns the highest scorer:

```
sessionScore = (recoveryScore × 0.4) + (balanceScore × 0.35) + (freshnessScore × 0.25)
```

### recoveryScore (0–100)

Weighted mean of muscle recovery % across the session's muscles:

| Muscle role | Weight | Sore in mood log |
|-------------|--------|-----------------|
| Primary | 1.0 | Cap recovery contribution at 40 |
| Secondary | 0.5 | Multiply recovery contribution by 0.75 (~37% effective) |

Recovery % per muscle uses the same exponential decay formula as `/api/muscle-recovery`:
```
tau = volume >= 3000 ? 36 : 24   (hours)
pct = 100 × (1 - exp(-hoursAgo / tau))
```

Computed inline — no HTTP call to `/api/muscle-recovery`.

**Example:** Push session, quads fine, triceps sore (secondary):
- Chest at 85% → contributes 85 × 1.0 = 85
- Shoulders at 70% → contributes 70 × 1.0 = 70
- Triceps at 60%, sore → contributes (60 × 0.75) × 0.5 = 22.5 (weight 0.5)
- Weighted mean = (85 + 70 + 22.5) / (1.0 + 1.0 + 0.5) = 70.6

### balanceScore (0–100)

How overdue this session is relative to others. Sessions not done in a while score higher:
```
daysSinceDone = (now - lastDoneDate) / 86400000   (null → 30 days)
maxDays = max(daysSinceDone) across all sessions
balanceScore = (daysSinceDone / maxDays) × 100
```

### freshnessScore (0–100)

Inverse of recency — prevents back-to-back repeats:
```
hoursSinceDone = hours since this exact session was last done (null → 168)
freshnessScore = min(100, (hoursSinceDone / 48) × 100)
```

Caps at 100 after 48h — any session not done in 2+ days gets full freshness.

---

## Deload / Rest Trigger Conditions

### Objective triggers (fire before mood, drive the pre-mood banner)

| Condition | Deload strength |
|-----------|----------------|
| consecutiveTrainingDays >= 4, readiness >= 70 | `'soft'` — nudge only |
| consecutiveTrainingDays >= 4, readiness 50–69 | `'recommended'` |
| consecutiveTrainingDays >= 4, readiness < 50 | `'strong'` |
| temperatureDeviation > 0.5°C (any consecutive days) | `'recommended'` |
| daySummary = `'very_stressful'` (any consecutive days) | `'recommended'` |

When Oura is connected, `readinessScore` = blended Oura+ACWR score from `/api/readiness-score`.  
When Oura is disconnected, `readinessScore` = custom composite (HRV + sleep + RHR + load).

### Soreness-enhanced trigger (fires after mood, affects card display only)

If mood is logged and primary muscles for the recommended session are sore:
- `deloadOrRestRecommended` may be set even below 4 consecutive days
- Minimum threshold: readiness < 65 AND primary muscles sore

---

## Extended `NextSessionRecommendation`

```typescript
export interface NextSessionRecommendation {
  isRestDay: boolean
  session?: ProgramSession
  reason: string
  reminderEnabled?: boolean
  reminderTime?: string | null
  // New ai_dynamic fields — null/undefined for non-ai_dynamic programs
  deloadOrRestRecommended?: boolean
  deloadStrength?: 'soft' | 'recommended' | 'strong'
  consecutiveTrainingDays?: number
  consecutiveRestDays?: number
  streakWarning?: boolean    // true on day 2 consecutive rest
  streakBroken?: boolean     // true on day 3+ consecutive rest
  temperatureAlert?: boolean
}
```

All new fields are optional so existing weekly/rotation programs are unaffected.

---

## UI Flow

### Step 1 — Pre-mood banner (objective triggers only)

Shown above the mood check-in card when `consecutiveTrainingDays >= 4` OR `temperatureAlert`:

```
┌─────────────────────────────────────────────────────┐
│  ⚠  4 sessions in a row                             │
│  Rest or deload recommended today                    │
└─────────────────────────────────────────────────────┘
[ Daily Check-in card below, unchanged ]
```

- `'soft'` strength → amber chip, no icon
- `'recommended'` strength → amber banner with ⚠ icon  
- `'strong'` strength → red banner with ⚠ icon

Temperature alert adds: *"Body temp +0.6°C above baseline"*

### Step 2 — Mood check-in (unchanged)

User logs energy, soreness, sore muscles as today. No change to this flow.

### Step 3 — RecommendationCard (post-mood)

**Normal day (no deload flag):**
```
┌─────────────────────────────────────────────────────┐
│  Legs Day                                            │
│  Quads 91% · Hamstrings 88% · Most overdue          │
│                                                      │
│           [ Start Workout → ]                        │
└─────────────────────────────────────────────────────┘
```

**Deload/rest flagged:**
```
┌─────────────────────────────────────────────────────┐
│  Legs Day                                            │
│  Quads 91% · Hamstrings 88% · Most overdue          │
│  4 sessions in a row — CNS benefit from lighter day  │
│                                                      │
│  [ Deload ]   [ Rest Day ]   [ Full Session → ]      │
└─────────────────────────────────────────────────────┘
```

- `'soft'`: Full Session is primary CTA, Deload and Rest shown as secondary options
- `'recommended'`: Deload and Rest are prominent, Full Session is tertiary (smaller/muted)
- `'strong'`: Deload is primary, Rest is secondary, Full Session is small/muted with override label

### Override tracking

When user taps **Full Session** while `deloadOrRestRecommended` is true:
- `workout_sessions.was_override = true`
- `workout_sessions.intensity_mode = 'full'`

When user taps **Deload**:
- `workout_sessions.intensity_mode = 'deload'`
- Starts session in deload mode via existing prescription system

When user taps **Rest Day**:
- Logs rest entry (existing flow)
- Increments consecutive rest day counter

---

## Streak Mechanics (ai_dynamic only)

The existing StreakCard is unchanged. In `ai_dynamic` mode, a chip is added showing consecutive rest days:

| Consecutive rest days | Chip |
|---|---|
| 0 | Nothing |
| 1 | Grey: *"Day 1 of 2 rest days — streak safe"* |
| 2 | Amber: *"Rest again tomorrow and your streak breaks"* |
| 3+ | Red: *"Resting today breaks your streak"* |

Day 3+ also appears on the pre-mood banner so the user sees it before committing to rest.

---

## Database Changes

### `workout_sessions` — two new columns

```sql
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS was_override   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS intensity_mode TEXT
    CHECK (intensity_mode IN ('full', 'deload'));
```

`was_override = true` when user picked Full Session despite `deloadOrRestRecommended`.  
`intensity_mode` records what the user actually did — null for sessions started before this feature.

### No changes to `schedules` or `programs`

`phaseMode: 'ai_dynamic'` already exists on the `programs` table and TypeScript types. No schema migration needed for the trigger logic.

---

## What Is Not In Scope

- Session-level deload % configuration (uses existing prescription system as-is)
- Override pattern analysis / display (data collected now, surfaced in a future session)
- Phase 3 look-ahead scoring (predicting recovery trajectory — future session)
- Weekly session target enforcement (the AI nudges but never blocks)
