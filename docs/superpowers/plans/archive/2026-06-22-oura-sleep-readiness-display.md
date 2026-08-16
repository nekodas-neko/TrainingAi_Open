# Oura Sleep Data Display + Blended Readiness Score

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface all Oura sleep metrics in the health UI, blend Oura's readiness score with our ACWR signal, wire `externalReadiness` for AI periodization, and add the `sleep_time` recommended bedtime endpoint.

**Architecture:** All Oura sleep data is already stored in the DB (migrations 085–089). The gaps are entirely display + blending. The blended score adds only our unique ACWR and temperature deviation signals to Oura's score — no double-counting. The `sleep_time` endpoint is the only new Oura API integration needed.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM, PostgreSQL, Tailwind CSS v4

---

## File Map

| File | Change |
|------|--------|
| `lib/data/postgres/migrations/090_oura_sleep_time.sql` | Create — new columns on `oura_daily` |
| `lib/oura/types.ts` | Modify — add `OuraSleepTime` interface |
| `lib/oura/client.ts` | Modify — add `fetchSleepTime()` |
| `lib/data/repository.ts` | Modify — extend `OuraDailyRow` with 4 new fields |
| `lib/data/postgres/schema.ts` | Modify — extend `ouraDaily` table definition |
| `app/api/oura/sync/route.ts` | Modify — add `sleep_time` to parallel fetch + daily map |
| `lib/types/body.ts` | Modify — extend `SleepSession` with enriched Oura fields |
| `lib/data/postgres/adapter.ts` | Modify — `listSleepSessions` returns enriched fields |
| `app/api/sleep-sessions/route.ts` | Modify — extend `SleepRow` + response with all Oura fields |
| `app/api/readiness-score/route.ts` | Modify — blended score formula + Oura fields in response |
| `lib/ai-periodization/signals.ts` | Modify — wire `externalReadiness` from Oura |
| `app/health/health-content.tsx` | Modify — `SleepRow`, sleep card, Oura chips |
| `app/api/morning-briefing/route.ts` | Modify — add Oura context to AI prompt |

---

## Task 1: `sleep_time` Oura Endpoint

### Files
- Create: `lib/data/postgres/migrations/090_oura_sleep_time.sql`
- Modify: `lib/oura/types.ts`
- Modify: `lib/oura/client.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/schema.ts`
- Modify: `app/api/oura/sync/route.ts`

- [ ] **Step 1.1: Create migration**

Create `lib/data/postgres/migrations/090_oura_sleep_time.sql`:
```sql
-- Oura sleep_time endpoint: recommended bedtime window + status
ALTER TABLE oura_daily
  ADD COLUMN IF NOT EXISTS recommended_bedtime_start INTEGER,   -- minutes from midnight UTC
  ADD COLUMN IF NOT EXISTS recommended_bedtime_end   INTEGER,   -- minutes from midnight UTC
  ADD COLUMN IF NOT EXISTS sleep_time_status         TEXT,      -- 'optimal'|'slightly_early'|'slightly_late'|'early'|'late'
  ADD COLUMN IF NOT EXISTS sleep_time_recommendation TEXT;      -- 'improve_efficiency'|'earlier_bedtime'|'later_bedtime'|'earlier_wake_up_time'|'later_wake_up_time'|'follow_optimal_bedtime'|'no_recommendation'
```

- [ ] **Step 1.2: Add `OuraSleepTime` type to `lib/oura/types.ts`**

Append to the end of `lib/oura/types.ts`, before the closing of the file:
```typescript
// GET /v2/usercollection/sleep_time
// Scope: daily — recommended bedtime window based on chronotype
export interface OuraSleepTime {
  id: string
  day: string  // YYYY-MM-DD
  optimal_bedtime: {
    day_tz: number      // day of week (0=Sun, 1=Mon, …)
    end_offset: number  // minutes from midnight UTC for bedtime end
    start_offset: number  // minutes from midnight UTC for bedtime start
  } | null
  recommendation: 'improve_efficiency' | 'earlier_bedtime' | 'later_bedtime' | 'earlier_wake_up_time' | 'later_wake_up_time' | 'follow_optimal_bedtime' | 'no_recommendation' | null
  status: 'optimal' | 'slightly_early' | 'slightly_late' | 'early' | 'late' | null
}
```

- [ ] **Step 1.3: Add `fetchSleepTime()` to `lib/oura/client.ts`**

In `lib/oura/client.ts`, add the import at the top:
```typescript
import type {
  // ... existing imports ...
  OuraSleepTime,
} from './types'
```

Add after `fetchDailyResilience`:
```typescript
export async function fetchSleepTime(
  token: string, startDate: string, endDate: string,
): Promise<OuraSleepTime[]> {
  return ouraGetAll<OuraSleepTime>(token, '/v2/usercollection/sleep_time', { start_date: startDate, end_date: endDate })
    .catch(() => [])
}
```

- [ ] **Step 1.4: Extend `OuraDailyRow` in `lib/data/repository.ts`**

In `lib/data/repository.ts`, find the `OuraDailyRow` interface (around line 381) and add 4 new fields after `resilienceContributors`:
```typescript
export interface OuraDailyRow {
  // ... existing fields unchanged ...
  resilienceLevel?: string | null
  resilienceContributors?: Record<string, number | null> | null
  // sleep_time endpoint
  recommendedBedtimeStart?: number | null   // minutes from midnight UTC
  recommendedBedtimeEnd?: number | null     // minutes from midnight UTC
  sleepTimeStatus?: string | null
  sleepTimeRecommendation?: string | null
}
```

- [ ] **Step 1.5: Extend `ouraDaily` schema in `lib/data/postgres/schema.ts`**

In `lib/data/postgres/schema.ts`, inside the `ouraDaily = pgTable('oura_daily', {` definition, add after `resilienceContributors`:
```typescript
  // sleep_time endpoint (migration 090)
  recommendedBedtimeStart: integer('recommended_bedtime_start'),
  recommendedBedtimeEnd:   integer('recommended_bedtime_end'),
  sleepTimeStatus:         text('sleep_time_status'),
  sleepTimeRecommendation: text('sleep_time_recommendation'),
```

- [ ] **Step 1.6: Update `app/api/oura/sync/route.ts`**

a) Add `fetchSleepTime` to the import:
```typescript
import {
  fetchDailyReadiness,
  fetchDailySleep,
  fetchSleepSessions,
  fetchDailyActivity,
  fetchSpO2Daily,
  fetchDailyStress,
  fetchVo2Max,
  fetchDailyCardiovascularAge,
  fetchDailyResilience,
  fetchSleepTime,
  refreshAccessToken,
} from "@/lib/oura/client"
```

b) Add `sleepTime` to the parallel fetch destructure (after `resilience`):
```typescript
const [readiness, dailySleep, sleepSessions, activity, spo2, stress, vo2max, cardioAge, resilience, sleepTime] = await Promise.all([
  safeFetch('daily_readiness',          fetchDailyReadiness(token, startDate, endDate)),
  safeFetch('daily_sleep',              fetchDailySleep(token, startDate, endDate)),
  safeFetch('sleep',                    fetchSleepSessions(token, startDate, endDate)),
  safeFetch('daily_activity',           fetchDailyActivity(token, startDate, endDate)),
  safeFetch('daily_spo2',               fetchSpO2Daily(token, startDate, endDate)),
  safeFetch('daily_stress',             fetchDailyStress(token, startDate, endDate)),
  safeFetch('vO2_max',                  fetchVo2Max(token, startDate, endDate)),
  safeFetch('daily_cardiovascular_age', fetchDailyCardiovascularAge(token, startDate, endDate)),
  safeFetch('daily_resilience',         fetchDailyResilience(token, startDate, endDate)),
  safeFetch('sleep_time',               fetchSleepTime(token, startDate, endDate)),
])
```

c) Add a merge loop after the resilience loop:
```typescript
for (const st of sleepTime) {
  dailyMap.set(st.day, {
    ...dailyMap.get(st.day),
    date:                    st.day,
    recommendedBedtimeStart: st.optimal_bedtime?.start_offset ?? undefined,
    recommendedBedtimeEnd:   st.optimal_bedtime?.end_offset   ?? undefined,
    sleepTimeStatus:         st.status         ?? undefined,
    sleepTimeRecommendation: st.recommendation  ?? undefined,
  })
}
```

d) Add `sleepTimeDays` to the success response:
```typescript
return NextResponse.json({
  success: true,
  synced: {
    // ... existing fields ...
    resilienceDays:   resilience.length,
    sleepTimeDays:    sleepTime.length,
    bodyMetricRows:   bodyMetricsRows.length,
  },
  // ...
})
```

- [ ] **Step 1.7: Verify migration runs**

```bash
pnpm db:local
```

Expected: "Applying migrations... [090_oura_sleep_time.sql] done" (or "already applied" if re-run).

- [ ] **Step 1.8: Commit**

```bash
git add lib/data/postgres/migrations/090_oura_sleep_time.sql \
        lib/oura/types.ts lib/oura/client.ts \
        lib/data/repository.ts lib/data/postgres/schema.ts \
        app/api/oura/sync/route.ts
git commit -m "feat(oura): add sleep_time endpoint for recommended bedtime window"
```

---

## Task 2: Extend Sleep-Sessions API with Enriched Oura Fields

### Files
- Modify: `lib/types/body.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `app/api/sleep-sessions/route.ts`

- [ ] **Step 2.1: Extend `SleepSession` type in `lib/types/body.ts`**

Find the `SleepSession` interface (around line 53) and add Oura enriched fields:
```typescript
export interface SleepSession {
  id: string
  userId: string
  date: string           // YYYY-MM-DD (wake-up date)
  sleepStart: Date
  sleepEnd: Date
  durationHours?: number
  deepSleepHours?: number
  remSleepHours?: number
  lightSleepHours?: number
  awakHours?: number
  createdAt: Date
  // Oura Ring enriched fields (from migration 085/088)
  efficiency?: number | null         // 0-100 %
  onsetLatencySec?: number | null    // seconds to fall asleep
  averageHrvMs?: number | null       // rMSSD during sleep (ms)
  avgHeartRate?: number | null       // bpm
  lowestHeartRate?: number | null    // bpm (proxy for resting HR)
  restlessPeriods?: number | null
  sleepScore?: number | null         // 0-100 from Oura daily_sleep
  respiratoryRate?: number | null    // breaths/min
}
```

- [ ] **Step 2.2: Update `listSleepSessions` in `lib/data/postgres/adapter.ts`**

Find the `listSleepSessions` method (around line 2330) and update the `rows.map` to return enriched fields:
```typescript
return rows.map(r => ({
  id: r.id, userId: r.userId, date: r.date,
  sleepStart:      r.sleepStart,
  sleepEnd:        r.sleepEnd,
  durationHours:   r.durationHours   ?? undefined,
  deepSleepHours:  r.deepSleepHours  ?? undefined,
  remSleepHours:   r.remSleepHours   ?? undefined,
  lightSleepHours: r.lightSleepHours ?? undefined,
  awakHours:       r.awakHours       ?? undefined,
  createdAt:       r.createdAt,
  efficiency:      r.efficiency      ?? undefined,
  onsetLatencySec: r.onsetLatencySec ?? undefined,
  averageHrvMs:    r.averageHrvMs    ?? undefined,
  avgHeartRate:    r.avgHeartRate    ?? undefined,
  lowestHeartRate: r.lowestHeartRate ?? undefined,
  restlessPeriods: r.restlessPeriods ?? undefined,
  sleepScore:      r.sleepScore      ?? undefined,
  respiratoryRate: r.respiratoryRate ?? undefined,
}))
```

- [ ] **Step 2.3: Update `app/api/sleep-sessions/route.ts`**

Replace the entire file content:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepositoryAsync } from "@/lib/data";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ } from "@/lib/date-utils";

// Samsung Health splits sleep sessions that span midnight into two records
// with the same wake-up `date`. Merge them by summing additive durations and
// keeping first non-null for enriched Oura fields (Oura sessions are never split).
function mergeByDate(rows: Array<{
  date: string;
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
  efficiency: number | null;
  onsetLatencySec: number | null;
  averageHrvMs: number | null;
  avgHeartRate: number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  sleepScore: number | null;
  respiratoryRate: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
}>) {
  const map = new Map<string, typeof rows[number]>();
  for (const r of rows) {
    const existing = map.get(r.date);
    if (!existing) { map.set(r.date, { ...r }); continue; }
    const add = (a: number | null, b: number | null) =>
      a != null && b != null ? +(a + b).toFixed(2) : (a ?? b);
    existing.durationHours   = add(existing.durationHours,   r.durationHours);
    existing.deepSleepHours  = add(existing.deepSleepHours,  r.deepSleepHours);
    existing.remSleepHours   = add(existing.remSleepHours,   r.remSleepHours);
    existing.lightSleepHours = add(existing.lightSleepHours, r.lightSleepHours);
    existing.awakHours       = add(existing.awakHours,       r.awakHours);
    // Non-additive: take first non-null (Oura sessions are never split so this
    // only matters for Samsung Health splits which won't have Oura fields)
    existing.efficiency      = existing.efficiency      ?? r.efficiency;
    existing.onsetLatencySec = existing.onsetLatencySec ?? r.onsetLatencySec;
    existing.averageHrvMs    = existing.averageHrvMs    ?? r.averageHrvMs;
    existing.avgHeartRate    = existing.avgHeartRate    ?? r.avgHeartRate;
    existing.lowestHeartRate = existing.lowestHeartRate ?? r.lowestHeartRate;
    existing.restlessPeriods = existing.restlessPeriods ?? r.restlessPeriods;
    existing.sleepScore      = existing.sleepScore      ?? r.sleepScore;
    existing.respiratoryRate = existing.respiratoryRate ?? r.respiratoryRate;
    // Earliest start, latest end
    if (r.sleepStart && (!existing.sleepStart || r.sleepStart < existing.sleepStart)) {
      existing.sleepStart = r.sleepStart;
    }
    if (r.sleepEnd && (!existing.sleepEnd || r.sleepEnd > existing.sleepEnd)) {
      existing.sleepEnd = r.sleepEnd;
    }
  }
  return [...map.values()];
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tz = session.user.timezone ?? DEFAULT_TZ;
  const now = new Date();
  const to   = formatInTimeZone(now, tz, "yyyy-MM-dd");
  const from = formatInTimeZone(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), tz, "yyyy-MM-dd");

  const repo = await getRepositoryAsync();
  const rows = await repo.listSleepSessions(session.user.id, from, to);

  const merged = mergeByDate(rows.map(r => ({
    date:            r.date,
    durationHours:   r.durationHours   ?? null,
    deepSleepHours:  r.deepSleepHours  ?? null,
    remSleepHours:   r.remSleepHours   ?? null,
    lightSleepHours: r.lightSleepHours ?? null,
    awakHours:       r.awakHours       ?? null,
    efficiency:      r.efficiency      ?? null,
    onsetLatencySec: r.onsetLatencySec ?? null,
    averageHrvMs:    r.averageHrvMs    ?? null,
    avgHeartRate:    r.avgHeartRate    ?? null,
    lowestHeartRate: r.lowestHeartRate ?? null,
    restlessPeriods: r.restlessPeriods ?? null,
    sleepScore:      r.sleepScore      ?? null,
    respiratoryRate: r.respiratoryRate ?? null,
    sleepStart:      r.sleepStart.toISOString(),
    sleepEnd:        r.sleepEnd.toISOString(),
  })));

  return NextResponse.json(merged);
}
```

- [ ] **Step 2.4: Commit**

```bash
git add lib/types/body.ts lib/data/postgres/adapter.ts app/api/sleep-sessions/route.ts
git commit -m "feat: extend sleep-sessions API with enriched Oura metrics"
```

---

## Task 3: Blended Readiness Score + externalReadiness Wire-up

### Files
- Modify: `app/api/readiness-score/route.ts`
- Modify: `lib/ai-periodization/signals.ts`

- [ ] **Step 3.1: Update `ReadinessScoreResponse` interface and route**

Replace `app/api/readiness-score/route.ts` entirely:

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { getCurrentPhase } from '@/lib/phase-engine'

export interface ReadinessScoreResponse {
  score: number
  label: 'High' | 'Moderate' | 'Low'
  components: {
    sleep: number   // 0–40 (custom signal — kept for fallback + ACWR display)
    hrv: number     // 0–30
    rhr: number     // 0–20
    load: number    // 0–10
  }
  hasSufficientData: boolean
  earlyDeloadRecommended: boolean
  source: 'oura+acwr' | 'oura' | 'custom' | 'none'
  // Oura fields — null when no Oura data available
  ouraScore: number | null
  temperatureDeviation: number | null
  daySummary: string | null
  resilienceLevel: string | null
  sleepScore: number | null
  vo2Max: number | null
  vascularAge: number | null
  stressHigh: number | null
  recoveryHigh: number | null
  recommendedBedtimeStart: number | null
  recommendedBedtimeEnd: number | null
  sleepTimeStatus: string | null
}

function computeBlendedScore(
  ouraScore: number,
  acwr: number | null,
  tempDev: number | null,
): { score: number; source: 'oura+acwr' | 'oura' } {
  let modifier = 0
  let source: 'oura+acwr' | 'oura' = 'oura'

  if (acwr != null) {
    source = 'oura+acwr'
    if (acwr >= 0.8 && acwr <= 1.3) modifier += 3
    else if (acwr > 1.3 && acwr <= 1.5) modifier -= Math.round(6 * (acwr - 1.3) / 0.2)
    else if (acwr > 1.5) modifier -= 15
    else if (acwr < 0.6) modifier -= 5
  }

  const raw = ouraScore + modifier
  const absDev = tempDev != null ? Math.abs(tempDev) : 0

  let score: number
  if (tempDev != null && absDev > 1.0) {
    score = Math.min(40, Math.max(0, raw))
  } else if (tempDev != null && absDev > 0.5) {
    score = Math.max(0, Math.min(100, raw - 20))
  } else if (tempDev != null && absDev > 0.3) {
    score = Math.max(0, Math.min(100, raw - 10))
  } else {
    score = Math.max(0, Math.min(100, raw))
  }

  return { score, source }
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:readiness-score`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const from28dDate = new Date(todayMid.getTime() - 28 * 86_400_000)
  const from28dIso  = toAestDay(from28dDate, tz)
  const from7dIso   = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)

  const [bodyMetrics, sleepSessions, recentSessions, ouraRows] = await Promise.all([
    repo.listBodyMetrics(userId, from28dIso, todayIso),
    repo.listSleepSessions(userId, from28dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, from28dDate),
    repo.getOuraDaily(userId, todayIso, todayIso),
  ])

  const ouraToday = ouraRows[0] ?? null

  // ── Custom signals (always computed — used as fallback + for ACWR/earlyDeload) ──

  const sortedSleep = [...sleepSessions].sort(
    (a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime()
  )
  const lastSleep  = sortedSleep[0]
  const sleepHours = lastSleep?.durationHours ?? null
  const sleepScore = sleepHours != null ? Math.min(40, Math.round((sleepHours / 8) * 40)) : 0

  const hrvRows       = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)
  const recentHrvRows = bodyMetrics.filter(m => m.date >= from7dIso && m.hrvMs != null && m.hrvMs > 0)
  const baselineHrv   = hrvRows.length >= 5
    ? hrvRows.reduce((s, m) => s + m.hrvMs!, 0) / hrvRows.length
    : null
  const recentHrv = recentHrvRows.length
    ? recentHrvRows.reduce((s, m) => s + m.hrvMs!, 0) / recentHrvRows.length
    : null
  const hrvScore = baselineHrv && recentHrv
    ? Math.max(0, Math.min(30, Math.round(30 * (recentHrv / baselineHrv))))
    : 0

  const rhrRows       = bodyMetrics.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const recentRhrRows = bodyMetrics.filter(m => m.date >= from7dIso && m.restingHeartRate != null && m.restingHeartRate > 0)
  const baselineRhr   = rhrRows.length >= 5
    ? rhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / rhrRows.length
    : null
  const recentRhr = recentRhrRows.length
    ? recentRhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / recentRhrRows.length
    : null
  const rhrScore = baselineRhr && recentRhr
    ? Math.max(0, Math.min(20, Math.round(20 * (baselineRhr / recentRhr))))
    : 0

  const from7dDate = new Date(todayMid.getTime() - 7 * 86_400_000)
  let acuteLoad = 0, chronicLoad = 0
  let earliestSessionDate: Date | null = null
  for (const ws of recentSessions) {
    const vol = ws.exercises.reduce((s, ex) => s + (ex.volume ?? 0), 0)
    if (ws.startedAt >= from7dDate) acuteLoad += vol
    chronicLoad += vol
    if (!earliestSessionDate || ws.startedAt < earliestSessionDate) {
      earliestSessionDate = ws.startedAt
    }
  }
  const dataSpanMs = earliestSessionDate
    ? todayMid.getTime() - earliestSessionDate.getTime()
    : 28 * 86_400_000
  const dataSpanWeeks = Math.max(1, dataSpanMs / (7 * 86_400_000))
  const chronicAvg    = chronicLoad / dataSpanWeeks
  const acwr          = chronicAvg > 100 ? acuteLoad / chronicAvg : null
  const loadScore     = acwr != null
    ? acwr >= 0.8 && acwr <= 1.3 ? 10
      : acwr > 1.3 ? Math.max(0, Math.round(10 * (1.5 - acwr)))
      : Math.round(10 * acwr / 0.8)
    : 5

  // ── Score + source ──────────────────────────────────────────────────────────

  let score: number
  let source: ReadinessScoreResponse['source']

  if (ouraToday?.readinessScore != null) {
    const blended = computeBlendedScore(
      ouraToday.readinessScore,
      acwr,
      ouraToday.temperatureDeviation ?? null,
    )
    score  = blended.score
    source = blended.source
  } else {
    score  = sleepScore + hrvScore + rhrScore + loadScore
    source = bodyMetrics.length > 0 ? 'custom' : 'none'
  }

  const label: ReadinessScoreResponse['label'] =
    score >= 70 ? 'High' : score >= 45 ? 'Moderate' : 'Low'

  const hasSufficientData = ouraToday?.readinessScore != null ||
    (sleepHours != null && (baselineHrv != null || baselineRhr != null))

  // Early deload — only for automatic periodization, not already in deload
  let earlyDeloadRecommended = false
  const program = await repo.getActiveProgram(userId)
  if (program?.phaseMode === 'automatic') {
    const phaseList = program.startedAt ? await repo.listProgramPhases(program.id) : []
    let inDeloadPhase = false
    if (phaseList.length > 0 && program.sessionsPerCycle && program.startedAt) {
      const sessionsCount = await repo.countSessionsSinceStart(userId, program.id)
      const { phase } = getCurrentPhase(phaseList, program.sessionsPerCycle, sessionsCount)
      inDeloadPhase = phase.phaseType === 'deload'
    }
    if (!inDeloadPhase && (baselineHrv != null || ouraToday?.readinessScore != null) && acwr != null) {
      earlyDeloadRecommended = score < 45 && acwr > 1.2
    }
  }

  return NextResponse.json({
    score, label,
    components: { sleep: sleepScore, hrv: hrvScore, rhr: rhrScore, load: loadScore },
    hasSufficientData,
    earlyDeloadRecommended,
    source,
    ouraScore:               ouraToday?.readinessScore             ?? null,
    temperatureDeviation:    ouraToday?.temperatureDeviation        ?? null,
    daySummary:              ouraToday?.daySummary                  ?? null,
    resilienceLevel:         ouraToday?.resilienceLevel             ?? null,
    sleepScore:              ouraToday?.sleepScore                  ?? null,
    vo2Max:                  ouraToday?.vo2Max                      ?? null,
    vascularAge:             ouraToday?.vascularAge                 ?? null,
    stressHigh:              ouraToday?.stressHigh                  ?? null,
    recoveryHigh:            ouraToday?.recoveryHigh                ?? null,
    recommendedBedtimeStart: ouraToday?.recommendedBedtimeStart     ?? null,
    recommendedBedtimeEnd:   ouraToday?.recommendedBedtimeEnd       ?? null,
    sleepTimeStatus:         ouraToday?.sleepTimeStatus             ?? null,
  } satisfies ReadinessScoreResponse)
}
```

- [ ] **Step 3.2: Wire `externalReadiness` in `lib/ai-periodization/signals.ts`**

In `aggregateSignals`, near the top of the function, after the existing date variable setup, add a `getOuraDaily` call. Find the section that returns the signals object (around line 325–342) and make these changes:

a) Before the `return {` statement, add:
```typescript
// Fetch today's Oura readiness score for externalReadiness signal
const todayForOura = todayInTz(tz)
const ouraRows = await repo.getOuraDaily(userId, todayForOura, todayForOura)
const externalReadiness = ouraRows[0]?.readinessScore ?? null
```

b) Change the `externalReadiness` line in the return:
```typescript
externalReadiness,  // Oura readiness score (null when not connected)
```

- [ ] **Step 3.3: Start dev server and verify readiness score endpoint**

```bash
pnpm dev
```

In a new terminal:
```bash
curl -s http://localhost:3000/api/readiness-score \
  -H 'Cookie: <session-cookie>' | jq .
```

Expected: JSON with `source`, `ouraScore`, `temperatureDeviation`, `resilienceLevel` etc. (all null for test user since no Oura token). Verify `score` is between 0-100.

- [ ] **Step 3.4: Commit**

```bash
git add app/api/readiness-score/route.ts lib/ai-periodization/signals.ts
git commit -m "feat: blended readiness score with Oura + ACWR, wire externalReadiness"
```

---

## Task 4: Sleep Card Upgrade in Health Content

### Files
- Modify: `app/health/health-content.tsx`

- [ ] **Step 4.1: Update `SleepRow` interface in `health-content.tsx`**

Find the `SleepRow` interface (around line 64) and replace it:
```typescript
interface SleepRow {
  date: string;
  durationHours: number | null;
  deepSleepHours: number | null;
  remSleepHours: number | null;
  lightSleepHours: number | null;
  awakHours: number | null;
  efficiency: number | null;
  onsetLatencySec: number | null;
  averageHrvMs: number | null;
  avgHeartRate: number | null;
  lowestHeartRate: number | null;
  restlessPeriods: number | null;
  sleepScore: number | null;
  respiratoryRate: number | null;
  sleepStart: string | null;
  sleepEnd: string | null;
}
```

- [ ] **Step 4.2: Add readiness state to health-content.tsx**

a) Add the import for `ReadinessScoreResponse` near the other route type imports (around line 38):
```typescript
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'
```

b) Add state variable near the other `useState` calls (after `sleepRows`):
```typescript
const [readiness, setReadiness] = useState<ReadinessScoreResponse | null>(null)
```

c) Seed from cache in the `useLayoutEffect` block (after the `sleepRows` seed):
```typescript
const cached = readCacheSync<ReadinessScoreResponse>('readiness-score')
if (cached) setReadiness(cached)
```

d) Add the fetch inside `fetchMeta`'s `Promise.all` array (after the sleep-sessions cachedFetch):
```typescript
cachedFetch<ReadinessScoreResponse>(
  'readiness-score', '/api/readiness-score', TTL_MEDIUM,
  (data) => setReadiness(data),
),
```

- [ ] **Step 4.3: Upgrade sleep card UI**

Find the sleep card button (around line 681) and replace its content with an enriched version. The outer `<button>` wrapper stays the same; replace everything inside:

```tsx
<button
  onClick={() => setMetricSheet("sleep")}
  className="rounded-2xl p-4 relative overflow-hidden text-left transition active:scale-95"
  style={accentCardStyle('#8b5cf6')}
>
  <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full pointer-events-none" style={{ background: "#8b5cf6", filter: "blur(20px)", opacity: 0.2 }} />
  <div className="flex items-start justify-between mb-1">
    <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#8b5cf6" }}>Sleep</p>
    <div className="flex items-center gap-1.5">
      {lastSleep?.sleepScore != null && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,0.2)', color: '#8b5cf6' }}>
          {lastSleep.sleepScore}
        </span>
      )}
      <span className="text-[9px] text-muted-foreground opacity-60">↗</span>
    </div>
  </div>
  {metaLoading ? (
    <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
  ) : (
    <p className="text-2xl font-bold tabular-nums" style={{ color: "#8b5cf6" }}>
      {lastSleep?.durationHours != null ? `${lastSleep.durationHours.toFixed(1)}h` : "—"}
    </p>
  )}
  {lastSleep && (
    <div className="mt-1.5 space-y-1">
      <div className="flex gap-1 flex-wrap">
        {lastSleep.deepSleepHours  != null && <span className="text-[9px] rounded bg-indigo-500/20 text-indigo-400 px-1 py-0.5">Deep {lastSleep.deepSleepHours.toFixed(1)}h</span>}
        {lastSleep.remSleepHours   != null && <span className="text-[9px] rounded bg-violet-500/20 text-violet-400 px-1 py-0.5">REM {lastSleep.remSleepHours.toFixed(1)}h</span>}
        {lastSleep.lightSleepHours != null && <span className="text-[9px] rounded bg-slate-500/20 text-slate-400 px-1 py-0.5">Light {lastSleep.lightSleepHours.toFixed(1)}h</span>}
      </div>
      <div className="flex gap-1 flex-wrap">
        {lastSleep.efficiency      != null && <span className="text-[9px] rounded bg-emerald-500/20 text-emerald-400 px-1 py-0.5">{lastSleep.efficiency}% eff</span>}
        {lastSleep.onsetLatencySec != null && <span className="text-[9px] rounded bg-amber-500/20 text-amber-400 px-1 py-0.5">↓ {Math.round(lastSleep.onsetLatencySec / 60)}m</span>}
        {lastSleep.respiratoryRate != null && <span className="text-[9px] rounded bg-sky-500/20 text-sky-400 px-1 py-0.5">{lastSleep.respiratoryRate.toFixed(1)} br/m</span>}
      </div>
    </div>
  )}
</button>
```

- [ ] **Step 4.4: Add Oura health chips below the biometrics grid**

After the existing biometric grid and before the water intake section, add Oura health indicators. Find the closing `</div>` of the biometric grid (after the sleep + distance 2-column grid) and insert this block:

```tsx
{/* ── Oura Health Indicators ── */}
{readiness?.ouraScore != null && (
  <div className="flex flex-wrap gap-2">
    {readiness.temperatureDeviation != null && Math.abs(readiness.temperatureDeviation) >= 0.1 && (
      <span className={cn(
        "text-[10px] rounded-full px-2.5 py-1 font-medium border",
        Math.abs(readiness.temperatureDeviation) <= 0.3
          ? "border-green-500/30 bg-green-500/10 text-green-400"
          : Math.abs(readiness.temperatureDeviation) <= 0.5
            ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
      )}>
        Temp {readiness.temperatureDeviation > 0 ? '+' : ''}{readiness.temperatureDeviation.toFixed(1)}°C
      </span>
    )}
    {readiness.resilienceLevel && (
      <span className={cn(
        "text-[10px] rounded-full px-2.5 py-1 font-medium border",
        readiness.resilienceLevel === 'exceptional' || readiness.resilienceLevel === 'strong'
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : readiness.resilienceLevel === 'adequate'
            ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
      )}>
        {readiness.resilienceLevel.charAt(0).toUpperCase() + readiness.resilienceLevel.slice(1)} resilience
      </span>
    )}
    {readiness.daySummary && (
      <span className={cn(
        "text-[10px] rounded-full px-2.5 py-1 font-medium border",
        readiness.daySummary === 'restored'
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : readiness.daySummary === 'stressful'
            ? "border-red-500/30 bg-red-500/10 text-red-400"
            : "border-slate-500/30 bg-slate-500/10 text-slate-400"
      )}>
        {readiness.daySummary.charAt(0).toUpperCase() + readiness.daySummary.slice(1)} day
      </span>
    )}
    {readiness.vo2Max != null && (
      <span className="text-[10px] rounded-full px-2.5 py-1 font-medium border border-blue-500/30 bg-blue-500/10 text-blue-400">
        VO₂ {readiness.vo2Max.toFixed(1)}
      </span>
    )}
    {readiness.vascularAge != null && (
      <span className="text-[10px] rounded-full px-2.5 py-1 font-medium border border-purple-500/30 bg-purple-500/10 text-purple-400">
        Vascular age {readiness.vascularAge}
      </span>
    )}
    {readiness.sleepTimeStatus && readiness.sleepTimeStatus !== 'optimal' && readiness.recommendedBedtimeStart != null && (
      <span className="text-[10px] rounded-full px-2.5 py-1 font-medium border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
        Bedtime {
          (() => {
            const h = Math.floor(((readiness.recommendedBedtimeStart % 1440) + 1440) % 1440 / 60)
            const m = ((readiness.recommendedBedtimeStart % 1440) + 1440) % 1440 % 60
            return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
          })()
        }
      </span>
    )}
  </div>
)}
```

- [ ] **Step 4.5: Start dev server and test the health page body tab**

```bash
pnpm dev
```

Open `http://localhost:3000/health?tab=body`. Verify:
- Sleep card shows Deep/REM/Light chips, efficiency %, onset latency, respiratory rate (all show "—" or are absent if no Oura data in local DB)
- Sleep score badge appears in top-right of sleep card if available
- Oura health chips section renders if `ouraScore` is non-null; hidden otherwise

- [ ] **Step 4.6: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "feat: upgrade sleep card with enriched Oura metrics, add health indicator chips"
```

---

## Task 5: Morning Briefing Oura Context

### Files
- Modify: `app/api/morning-briefing/route.ts`

- [ ] **Step 5.1: Update `app/api/morning-briefing/route.ts`**

Add Oura data to the morning briefing AI prompt. Replace the file:

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'

export interface MorningBriefingResponse {
  briefing: string
  generatedAt: string
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`${userId}:morning-briefing`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepository()
  const tz = session.user.timezone ?? DEFAULT_TZ
  const todayIso    = todayInTz(tz)
  const todayMid    = todayMidnightUtc(tz)
  const yesterdayMs = todayMid.getTime() - 86_400_000
  const yesterdayIso = toAestDay(new Date(yesterdayMs), tz)
  const from7dIso   = toAestDay(new Date(todayMid.getTime() - 7 * 86_400_000), tz)
  const from2dIso   = toAestDay(new Date(yesterdayMs), tz)

  const [sleepSessions, bodyMetrics, recentSessions, foodSummary, ouraRows] = await Promise.all([
    repo.listSleepSessions(userId, from2dIso, todayIso),
    repo.listBodyMetrics(userId, from7dIso, todayIso),
    repo.getWorkoutSessionsFrom(userId, new Date(yesterdayMs)),
    repo.listFoodLogsSummary(userId, yesterdayIso, yesterdayIso),
    repo.getOuraDaily(userId, todayIso, todayIso),
  ])

  const ouraToday = ouraRows[0] ?? null

  // Last night's sleep
  const sortedSleep = [...sleepSessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
  const lastSleep = sortedSleep[0]
  const sleepStr = lastSleep?.durationHours != null
    ? `${lastSleep.durationHours.toFixed(1)}h sleep`
    : 'no sleep data'

  // Yesterday's training
  const yesterdayStart = new Date(yesterdayMs)
  const yesterdaySessions = recentSessions.filter(
    ws => ws.startedAt >= yesterdayStart && ws.startedAt < todayMid && ws.exercises.length > 0
  )
  const trainingStr = yesterdaySessions.length > 0
    ? `trained ${yesterdaySessions.map(ws => ws.sessionName).join(' + ')} yesterday (${
        Math.round(yesterdaySessions.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0))
      } kg volume)`
    : 'rest day yesterday'

  // Yesterday's steps
  const yesterdayMeta = bodyMetrics.find(m => m.date === yesterdayIso)
  const stepsStr = yesterdayMeta?.steps != null && yesterdayMeta.steps > 0
    ? `${yesterdayMeta.steps.toLocaleString()} steps`
    : null

  // Yesterday's nutrition
  const foodLog = foodSummary[0]
  const kcal    = foodLog?.calories ?? yesterdayMeta?.calories ?? null
  const protein = foodLog?.proteinG ?? yesterdayMeta?.proteinG ?? null
  const nutritionStr = kcal != null
    ? `${Math.round(kcal)} kcal${protein != null ? `, ${Math.round(protein)}g protein` : ''}`
    : null

  // HRV trend
  const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0).sort((a, b) => b.date.localeCompare(a.date))
  const hrvStr = hrvRows.length >= 3
    ? `HRV avg ${Math.round(hrvRows.reduce((s, m) => s + m.hrvMs!, 0) / hrvRows.length)} ms`
    : null

  // Oura context — add when available
  const ouraStr = ouraToday != null ? [
    ouraToday.readinessScore != null ? `Oura readiness ${ouraToday.readinessScore}/100` : null,
    ouraToday.sleepScore     != null ? `sleep score ${ouraToday.sleepScore}/100` : null,
    ouraToday.daySummary     != null ? `stress summary: ${ouraToday.daySummary}` : null,
    ouraToday.resilienceLevel != null ? `resilience: ${ouraToday.resilienceLevel}` : null,
    ouraToday.temperatureDeviation != null && Math.abs(ouraToday.temperatureDeviation) > 0.3
      ? `body temp deviation ${ouraToday.temperatureDeviation > 0 ? '+' : ''}${ouraToday.temperatureDeviation.toFixed(1)}°C`
      : null,
    lastSleep?.efficiency      != null ? `sleep efficiency ${lastSleep.efficiency}%`            : null,
    lastSleep?.averageHrvMs    != null ? `overnight HRV ${Math.round(lastSleep.averageHrvMs)} ms` : null,
    lastSleep?.respiratoryRate != null ? `respiratory rate ${lastSleep.respiratoryRate.toFixed(1)} br/min` : null,
  ].filter(Boolean).join(', ') : null

  const parts = [sleepStr, trainingStr, stepsStr, nutritionStr, hrvStr, ouraStr].filter(Boolean)
  const context = parts.join(' · ')

  const { text } = await generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt: `You are a concise personal training coach writing a morning briefing for an athlete. Summarise yesterday's key stats in 2–3 sentences. Be specific and positive. Use 1–2 relevant emojis. Do not use markdown or bullet points — plain sentences only.\n\nYesterday's data: ${context}`,
  })

  return NextResponse.json({
    briefing: text.trim(),
    generatedAt: new Date().toISOString(),
  } satisfies MorningBriefingResponse)
}
```

- [ ] **Step 5.2: Verify morning briefing still works**

```bash
curl -s http://localhost:3000/api/morning-briefing \
  -H 'Cookie: <session-cookie>' | jq .briefing
```

Expected: non-empty briefing text. No errors.

- [ ] **Step 5.3: Commit**

```bash
git add app/api/morning-briefing/route.ts
git commit -m "feat: add Oura context to morning briefing (readiness, sleep score, HRV, respiratory rate)"
```

---

## Task 6: Push Branch

- [ ] **Step 6.1: Run TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.2: Push**

```bash
git push -u origin claude/ai-rest-days-framework-3uni48
```

---

## Self-Review Checklist

### Spec Coverage
- [x] Blended readiness score: `oura.readinessScore + acwrModifier + tempModifier` — Task 3
- [x] ACWR modifier (+3 / graduated -6 / -15 / -5) — Task 3 `computeBlendedScore`
- [x] Temperature cap (0/−10/−20/clamp at 40) — Task 3 `computeBlendedScore`
- [x] Source field `'oura+acwr'|'oura'|'custom'|'none'` — Task 3
- [x] `externalReadiness` wired from Oura — Task 3
- [x] Sleep efficiency, onset latency, HRV, HR, respiratory rate, sleep score in API — Task 2
- [x] Sleep stage hours in API (already existed, kept) — Task 2
- [x] Sleep debt / regularity: NOT in this plan — requires computed aggregation endpoint (separate work)
- [x] Sleep card upgrade with efficiency/stages/score chips — Task 4
- [x] Body temp chip — Task 4
- [x] Resilience badge — Task 4
- [x] Stress/day summary badge — Task 4
- [x] VO₂ max chip — Task 4
- [x] Vascular age chip — Task 4
- [x] Recommended bedtime chip — Task 4
- [x] `sleep_time` migration + type + client + sync — Task 1
- [x] Morning briefing Oura context — Task 5

### Notes on Deferred Items
- **Sleep debt** (sum of `max(0, goalHours - actualHours)` over 7 days): requires knowing `sleepGoalHours` from user goals. Defer to a follow-up — add as a computed field in the sleep card once the goal is available in the response.
- **Sleep regularity** (std dev of `sleepStart` hour over 14 nights): needs access to `sleepStart` timestamps, which are now returned by Task 2. Could be computed client-side in `health-content.tsx` from the `sleepRows` array.
