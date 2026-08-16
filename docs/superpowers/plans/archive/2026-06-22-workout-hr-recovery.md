# Workout HR Recovery Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a workout completes, automatically fetch Oura Ring heartrate data for the session window and display a HR recovery chart on the done screen — showing the HR curve with vertical markers at each set's log timestamp, plus per-set HRR1 (heart rate recovery at 1 minute) stats.

**Architecture:** The Oura heartrate time series (1-min resolution) is fetched immediately when the workout completes (fire-and-forget, user sees the chart populate within seconds if the Oura app synced in the background during the session). If data isn't ready yet, a `daily_activity` webhook from Oura triggers a backfill. HR readings are stored in a new `oura_heartrate` table keyed by `(user_id, timestamp)`. The done screen fetches HR + set timestamps and renders a Chart.js line chart with vertical set markers.

**Tech Stack:** Next.js 15, Drizzle ORM, PostgreSQL, `react-chartjs-2` + `chart.js` (already installed), Oura v2 API (`/v2/usercollection/heartrate`), Zustand workout store.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `lib/data/postgres/migrations/090_oura_heartrate.sql` | Create | New `oura_heartrate` table + `hr_synced_at` column on `workout_sessions` |
| `lib/data/postgres/schema.ts` | Modify | Add Drizzle table def for `oura_heartrate` |
| `lib/data/repository.ts` | Modify | Add `upsertOuraHeartrate`, `getHrForWindow`, `getSetTimestampsForSession`, `markHrSynced` |
| `lib/data/postgres/adapter.ts` | Modify | Implement the four new repository methods |
| `lib/oura/get-token.ts` | Create | Shared helper: resolve + auto-refresh OAuth token for a user |
| `lib/oura/client.ts` | Modify | Add `fetchHeartrate(token, startDatetime, endDatetime)` |
| `lib/oura/hr-sync.ts` | Create | `syncHrForSession(userId, workoutSessionId, started_at, completed_at)` — fetch + store HR for a session window |
| `lib/workout/hr-analysis.ts` | Create | `analyseHrRecovery(hrReadings, setTimestamps)` — pure function returning per-set HRR1 stats |
| `app/api/oura/hr-sync/route.ts` | Create | `POST /api/oura/hr-sync` — called client-side after workout complete |
| `app/api/oura/webhook/route.ts` | Modify | On `daily_activity` event, backfill HR for unsynced sessions from that day |
| `components/workout/hr-recovery-chart.tsx` | Create | Chart.js line chart with set markers |
| `components/workout/done-screen.tsx` | Modify | Add `workoutSessionId` prop, fetch + render HR analysis card |
| `components/workout-screen.tsx` | Modify | Pass `workoutSessionId` to `DoneScreen` |

---

## Task 1: DB migration — oura_heartrate table

**Files:**
- Create: `lib/data/postgres/migrations/090_oura_heartrate.sql`

- [ ] **Create migration file**

```sql
-- 090_oura_heartrate.sql
CREATE TABLE IF NOT EXISTS oura_heartrate (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp   TIMESTAMPTZ NOT NULL,
  bpm         INTEGER     NOT NULL,
  source      TEXT,
  UNIQUE(user_id, timestamp)
);

CREATE INDEX IF NOT EXISTS oura_heartrate_user_ts ON oura_heartrate(user_id, timestamp);

ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS hr_synced_at TIMESTAMPTZ;
```

- [ ] **Apply migration to local dev DB**

```bash
pnpm db:local
```

Expected: `[local-db] Applying migrations... Done` with no errors.

- [ ] **Commit**

```bash
git add lib/data/postgres/migrations/090_oura_heartrate.sql
git commit -m "Add oura_heartrate table and hr_synced_at to workout_sessions"
```

---

## Task 2: Drizzle schema + repository interface + adapter

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Add Drizzle table definition to schema.ts**

Find the block where `ouraTokens` is defined (search for `oura_tokens`). Add after it:

```typescript
export const ouraHeartrate = pgTable('oura_heartrate', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  bpm:       integer('bpm').notNull(),
  source:    text('source'),
}, t => [uniqueIndex('oura_heartrate_user_ts_idx').on(t.userId, t.timestamp)])
```

Also add `hrSyncedAt` to the `workoutSessions` table definition. Find `completedAt` inside `workoutSessions` and add after it:

```typescript
hrSyncedAt: timestamp('hr_synced_at', { withTimezone: true }),
```

- [ ] **Add four methods to the repository interface in repository.ts**

Add inside the `// ── Oura Ring ──` section (after `upsertOuraSleep`):

```typescript
upsertOuraHeartrate(userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]): Promise<void>
getHrForWindow(userId: string, from: Date, to: Date): Promise<{ timestamp: Date; bpm: number }[]>
getSetTimestampsForSession(workoutSessionId: string): Promise<{ exerciseName: string; setNumber: number; loggedAt: Date }[]>
markHrSynced(workoutSessionId: string): Promise<void>
```

- [ ] **Implement the four methods in adapter.ts**

Find the end of the Oura section in adapter.ts (near `upsertOuraSleep`) and add:

```typescript
async upsertOuraHeartrate(userId: string, rows: { timestamp: Date; bpm: number; source: string | null }[]) {
  if (rows.length === 0) return
  const values = rows.map(r => ({ userId, timestamp: r.timestamp, bpm: r.bpm, source: r.source }))
  await this.db.insert(s.ouraHeartrate)
    .values(values)
    .onConflictDoNothing()
}

async getHrForWindow(userId: string, from: Date, to: Date) {
  return this.db
    .select({ timestamp: s.ouraHeartrate.timestamp, bpm: s.ouraHeartrate.bpm })
    .from(s.ouraHeartrate)
    .where(and(
      eq(s.ouraHeartrate.userId, userId),
      gte(s.ouraHeartrate.timestamp, from),
      lte(s.ouraHeartrate.timestamp, to),
    ))
    .orderBy(asc(s.ouraHeartrate.timestamp))
}

async getSetTimestampsForSession(workoutSessionId: string) {
  return this.db
    .select({
      exerciseName: s.exerciseLogs.exerciseName,
      setNumber:    s.setLogs.setNumber,
      loggedAt:     s.setLogs.loggedAt,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .where(eq(s.exerciseLogs.workoutSessionId, workoutSessionId))
    .orderBy(asc(s.setLogs.loggedAt))
}

async markHrSynced(workoutSessionId: string) {
  await this.db
    .update(s.workoutSessions)
    .set({ hrSyncedAt: new Date() })
    .where(eq(s.workoutSessions.id, workoutSessionId))
}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add lib/data/postgres/schema.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add oura_heartrate schema and repository methods"
```

---

## Task 3: Shared token helper + heartrate fetch

**Files:**
- Create: `lib/oura/get-token.ts`
- Modify: `lib/oura/client.ts`

- [ ] **Create `lib/oura/get-token.ts`**

```typescript
import { getRepositoryAsync } from '@/lib/data'
import { refreshAccessToken } from './client'

export async function getValidOuraToken(userId: string): Promise<string | null> {
  const repo = await getRepositoryAsync()
  const row = await repo.getOuraTokenRow(userId)
  if (!row) return null

  // Prefer OAuth token; fall back to legacy PAT
  if (!row.accessToken) return await repo.getOuraPat(userId)

  // Refresh if within 5 minutes of expiry
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const clientId     = process.env.OURA_CLIENT_ID
    const clientSecret = process.env.OURA_CLIENT_SECRET
    if (clientId && clientSecret && row.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(row.refreshToken, clientId, clientSecret)
        await repo.saveOuraOAuthTokens(userId, {
          accessToken:  refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt:    new Date(Date.now() + refreshed.expires_in * 1000),
          scope:        refreshed.scope,
          ouraUserId:   row.ouraUserId ?? refreshed.user_id,
        })
        return refreshed.access_token
      } catch {
        // Use existing token if refresh fails — it may still be valid
      }
    }
  }

  return row.accessToken
}
```

- [ ] **Add `fetchHeartrate` to `lib/oura/client.ts`**

Find the end of the data endpoints section (before the battery level functions) and add:

```typescript
export async function fetchHeartrate(
  token: string,
  startDatetime: string,
  endDatetime: string,
): Promise<{ timestamp: string; bpm: number; source: string }[]> {
  const url = new URL(`${OURA_BASE}/v2/usercollection/heartrate`)
  url.searchParams.set('start_datetime', startDatetime)
  url.searchParams.set('end_datetime', endDatetime)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Oura heartrate ${res.status}: ${body.slice(0, 150)}`)
  }
  const data = await res.json() as { data?: { timestamp: string; bpm: number; source: string }[] }
  return data.data ?? []
}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add lib/oura/get-token.ts lib/oura/client.ts
git commit -m "Add getValidOuraToken helper and fetchHeartrate client function"
```

---

## Task 4: HR sync utility

**Files:**
- Create: `lib/oura/hr-sync.ts`

- [ ] **Create `lib/oura/hr-sync.ts`**

```typescript
import { getRepositoryAsync } from '@/lib/data'
import { getValidOuraToken } from './get-token'
import { fetchHeartrate } from './client'

// Fetch and store Oura heartrate data for a workout session window.
// Adds a 10-minute buffer on each side to capture pre-workout baseline and post-set cooldown.
// Safe to call multiple times — upsert is idempotent.
export async function syncHrForSession(
  userId: string,
  workoutSessionId: string,
  startedAt: Date,
  completedAt: Date,
): Promise<number> {
  const token = await getValidOuraToken(userId)
  if (!token) return 0

  const from = new Date(startedAt.getTime()  - 10 * 60 * 1000)
  const to   = new Date(completedAt.getTime() + 10 * 60 * 1000)

  const readings = await fetchHeartrate(token, from.toISOString(), to.toISOString())
  if (readings.length === 0) return 0

  const repo = await getRepositoryAsync()
  await repo.upsertOuraHeartrate(userId, readings.map(r => ({
    timestamp: new Date(r.timestamp),
    bpm:       r.bpm,
    source:    r.source,
  })))
  await repo.markHrSynced(workoutSessionId)

  return readings.length
}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add lib/oura/hr-sync.ts
git commit -m "Add syncHrForSession utility"
```

---

## Task 5: Auto-trigger HR fetch on workout complete

**Files:**
- Create: `app/api/oura/hr-sync/route.ts`
- Modify: `app/api/complete-workout/route.ts`

- [ ] **Create `app/api/oura/hr-sync/route.ts`**

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { syncHrForSession } from '@/lib/oura/hr-sync'

// POST — fetch and store Oura HR data for a completed workout session.
// Body: { workoutSessionId: string }
// Called fire-and-forget from the done screen immediately after workout complete.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workoutSessionId } = await req.json() as { workoutSessionId?: string }
  if (!workoutSessionId) return NextResponse.json({ error: 'Missing workoutSessionId' }, { status: 400 })

  const repo = await getRepositoryAsync()
  // Verify this session belongs to the authenticated user
  const [ws] = await repo.getWorkoutSessionsFrom(session.user.id, new Date(0))
    .then(sessions => sessions.filter(s => s.id === workoutSessionId))
  if (!ws || !ws.completedAt) {
    return NextResponse.json({ error: 'Session not found or not completed' }, { status: 404 })
  }

  const count = await syncHrForSession(
    session.user.id,
    workoutSessionId,
    ws.startedAt,
    ws.completedAt,
  ).catch(err => {
    console.warn('[oura/hr-sync]', String(err).slice(0, 150))
    return 0
  })

  return NextResponse.json({ success: true, readings: count })
}
```

- [ ] **Trigger HR sync from `app/api/complete-workout/route.ts`** after the session is saved

Add this block after the `repo.completeWorkoutSession(...)` call (before the programSessionId block):

```typescript
  // Fire-and-forget: fetch Oura HR data for this session window.
  // Oura app likely synced in background during the session, so data may be ready now.
  const origin = req.nextUrl.origin
  fetch(`${origin}/api/oura/hr-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: req.headers.get('cookie') ?? '',
    },
    body: JSON.stringify({ workoutSessionId }),
  }).catch(() => {})
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add app/api/oura/hr-sync/route.ts app/api/complete-workout/route.ts
git commit -m "Auto-fetch Oura HR data when workout completes"
```

---

## Task 6: Webhook backfill on daily_activity

**Files:**
- Modify: `app/api/oura/webhook/route.ts`

When Oura sends a `daily_activity` webhook, it means the ring has synced today's data to Oura Cloud — ideal moment to backfill HR for any of today's sessions that don't have it yet.

- [ ] **Add `getUnSyncedSessionsForDay` to repository.ts**

```typescript
getUnsyncedHrSessionsForDay(userId: string, day: string): Promise<{ id: string; startedAt: Date; completedAt: Date }[]>
```

- [ ] **Implement it in adapter.ts**

```typescript
async getUnsyncedHrSessionsForDay(userId: string, day: string) {
  // day is YYYY-MM-DD; match sessions whose started_at falls on that calendar day (UTC)
  const from = new Date(`${day}T00:00:00Z`)
  const to   = new Date(`${day}T23:59:59Z`)
  return this.db
    .select({
      id:          s.workoutSessions.id,
      startedAt:   s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      isNotNull(s.workoutSessions.completedAt),
      isNull(s.workoutSessions.hrSyncedAt),
      gte(s.workoutSessions.startedAt, from),
      lte(s.workoutSessions.startedAt, to),
    ))
}
```

- [ ] **Add backfill call inside the `daily_activity` case in `webhook/route.ts`**

Inside `handleWebhookEvent`, find `case "daily_activity":` and add at the end of that block (after the existing `upsertBodyMetrics` call):

```typescript
      // Backfill HR for any sessions from this day that haven't been synced yet
      const unsynced = await repo.getUnsyncedHrSessionsForDay(userId, doc.day)
      for (const ws of unsynced) {
        if (!ws.completedAt) continue
        syncHrForSession(userId, ws.id, ws.startedAt, ws.completedAt).catch(() => {})
      }
```

Add the import at the top of `webhook/route.ts`:
```typescript
import { syncHrForSession } from '@/lib/oura/hr-sync'
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add app/api/oura/webhook/route.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Backfill HR on daily_activity webhook for sessions missing HR data"
```

---

## Task 7: HR analysis utility

**Files:**
- Create: `lib/workout/hr-analysis.ts`

Pure functions — no DB or API calls. Easy to reason about and test in isolation.

- [ ] **Create `lib/workout/hr-analysis.ts`**

```typescript
export interface HrReading {
  timestamp: Date
  bpm: number
}

export interface SetMarker {
  exerciseName: string
  setNumber: number
  loggedAt: Date
}

export interface SetHrStats {
  exerciseName: string
  setNumber: number
  loggedAt: Date
  peakBpm: number | null      // max HR in 90s before logged_at
  bpmAtLog: number | null     // nearest HR reading to logged_at
  hrr1: number | null         // bpmAtLog - bpm 60s later (drop = good recovery)
  adequate: boolean | null    // hrr1 >= 15 or bpmAtLog < 120 before next set
}

// Find the nearest HR reading within ±90 seconds of a target timestamp.
function nearestBpm(readings: HrReading[], target: Date, windowMs = 90_000): number | null {
  let best: HrReading | null = null
  let bestDiff = Infinity
  for (const r of readings) {
    const diff = Math.abs(r.timestamp.getTime() - target.getTime())
    if (diff < windowMs && diff < bestDiff) {
      best = r
      bestDiff = diff
    }
  }
  return best?.bpm ?? null
}

// Max HR in the window [target - windowMs, target + 30s]
function peakBpmBefore(readings: HrReading[], target: Date, windowMs = 90_000): number | null {
  const from = target.getTime() - windowMs
  const to   = target.getTime() + 30_000
  const inWindow = readings.filter(r => r.timestamp.getTime() >= from && r.timestamp.getTime() <= to)
  if (inWindow.length === 0) return null
  return Math.max(...inWindow.map(r => r.bpm))
}

export function analyseHrRecovery(
  readings: HrReading[],
  sets: SetMarker[],
): SetHrStats[] {
  return sets.map(set => {
    const bpmAtLog = nearestBpm(readings, set.loggedAt)
    const peakBpm  = peakBpmBefore(readings, set.loggedAt)

    // HRR1: bpm at log time vs bpm 60 seconds later
    const target60 = new Date(set.loggedAt.getTime() + 60_000)
    const bpm60 = nearestBpm(readings, target60, 45_000)
    const hrr1 = bpmAtLog != null && bpm60 != null ? bpmAtLog - bpm60 : null

    // Adequate rest: HR recovered >= 15 bpm in 60s, or was already below 120
    const adequate =
      bpmAtLog != null && bpmAtLog < 120
        ? true
        : hrr1 != null
          ? hrr1 >= 15
          : null

    return { ...set, peakBpm, bpmAtLog, hrr1, adequate }
  })
}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add lib/workout/hr-analysis.ts
git commit -m "Add HR recovery analysis utility"
```

---

## Task 8: HR Recovery chart component

**Files:**
- Create: `components/workout/hr-recovery-chart.tsx`

Uses `react-chartjs-2` (already installed). X axis is minutes elapsed since session start. Vertical lines at each set's `loggedAt` drawn via a custom Chart.js plugin (no extra dependencies).

- [ ] **Create `components/workout/hr-recovery-chart.tsx`**

```typescript
'use client'

import { useEffect, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  type Plugin,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import type { HrReading, SetMarker } from '@/lib/workout/hr-analysis'

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)

// Assign a consistent color per exercise name
const SET_COLORS = ['#f97316', '#3b82f6', '#a855f7', '#22c55e', '#ef4444', '#eab308']
function exerciseColor(name: string, allNames: string[]): string {
  const idx = allNames.indexOf(name)
  return SET_COLORS[idx % SET_COLORS.length]
}

interface Props {
  readings: HrReading[]
  sets: SetMarker[]
  sessionStartedAt: Date
}

export function HrRecoveryChart({ readings, sets, sessionStartedAt }: Props) {
  const chartRef = useRef<ChartJS<'line'>>(null)

  const origin = sessionStartedAt.getTime()
  const toMinutes = (d: Date) => (d.getTime() - origin) / 60_000

  const exerciseNames = [...new Set(sets.map(s => s.exerciseName))]

  // Build labels (minute marks) and data from HR readings
  const labels = readings.map(r => toMinutes(r.timestamp).toFixed(1))
  const bpms   = readings.map(r => r.bpm)

  // Custom plugin to draw vertical lines at set timestamps
  const setLinesPlugin: Plugin<'line'> = {
    id: 'setLines',
    afterDraw(chart) {
      const { ctx, scales } = chart
      for (const set of sets) {
        const xMin = toMinutes(set.loggedAt)
        const xPixel = scales.x.getPixelForValue(xMin)
        if (xPixel < scales.x.left || xPixel > scales.x.right) continue
        const color = exerciseColor(set.exerciseName, exerciseNames)
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.moveTo(xPixel, scales.y.top)
        ctx.lineTo(xPixel, scales.y.bottom)
        ctx.stroke()
        // Small label at top
        ctx.font = '9px system-ui'
        ctx.fillStyle = color
        ctx.fillText(`S${set.setNumber}`, xPixel + 2, scales.y.top + 10)
        ctx.restore()
      }
    },
  }

  const data: ChartData<'line'> = {
    labels,
    datasets: [{
      data:            bpms,
      borderColor:     'rgb(249 115 22)',
      backgroundColor: 'rgba(249 115 22 / 0.08)',
      fill:            true,
      tension:         0.3,
      pointRadius:     0,
      borderWidth:     2,
    }],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { tooltip: { enabled: false }, legend: { display: false } },
    scales: {
      x: {
        type:  'category',
        ticks: {
          maxTicksLimit: 6,
          color: 'rgb(156 163 175)',
          font:  { size: 9 },
          callback: (_, i) => `${Math.round(Number(labels[i]))}m`,
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      y: {
        ticks: { color: 'rgb(156 163 175)', font: { size: 9 }, maxTicksLimit: 5 },
        grid:  { color: 'rgba(255,255,255,0.04)' },
      },
    },
  }

  if (readings.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
        No HR data — will appear once Oura syncs
      </div>
    )
  }

  return (
    <div className="h-32 w-full">
      <Line ref={chartRef} data={data} options={options} plugins={[setLinesPlugin]} />
    </div>
  )
}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add components/workout/hr-recovery-chart.tsx
git commit -m "Add HR recovery chart component with set markers"
```

---

## Task 9: Wire into done screen

**Files:**
- Create: `app/api/oura/hr-data/route.ts`
- Modify: `components/workout/done-screen.tsx`
- Modify: `components/workout-screen.tsx`

- [ ] **Create `app/api/oura/hr-data/route.ts`** — returns HR readings + set stats for a session

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { analyseHrRecovery } from '@/lib/workout/hr-analysis'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workoutSessionId = req.nextUrl.searchParams.get('sessionId')
  if (!workoutSessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })

  const repo = await getRepositoryAsync()

  // Verify ownership
  const sessions = await repo.getWorkoutSessionsFrom(session.user.id, new Date(0))
  const ws = sessions.find(s => s.id === workoutSessionId)
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!ws.completedAt) return NextResponse.json({ ready: false })

  const from = new Date(ws.startedAt.getTime()  - 10 * 60 * 1000)
  const to   = new Date(ws.completedAt.getTime() + 10 * 60 * 1000)

  const [readings, sets] = await Promise.all([
    repo.getHrForWindow(session.user.id, from, to),
    repo.getSetTimestampsForSession(workoutSessionId),
  ])

  const stats = analyseHrRecovery(readings, sets.map(s => ({ ...s, loggedAt: new Date(s.loggedAt) })))

  return NextResponse.json({
    ready:      true,
    hasData:    readings.length > 0,
    startedAt:  ws.startedAt.toISOString(),
    readings:   readings.map(r => ({ timestamp: r.timestamp.toISOString(), bpm: r.bpm })),
    setStats:   stats.map(s => ({
      exerciseName: s.exerciseName,
      setNumber:    s.setNumber,
      loggedAt:     s.loggedAt.toISOString(),
      peakBpm:      s.peakBpm,
      bpmAtLog:     s.bpmAtLog,
      hrr1:         s.hrr1,
      adequate:     s.adequate,
    })),
  })
}
```

- [ ] **Add `workoutSessionId` prop to `DoneScreen`** and fetch + render HR card

In `components/workout/done-screen.tsx`:

Add `workoutSessionId?: string` to `DoneScreenProps` interface.

Add these imports at the top:
```typescript
import { useCallback, useState, useEffect } from 'react'  // merge with existing useState import
import { HrRecoveryChart } from './hr-recovery-chart'
import type { HrReading, SetMarker } from '@/lib/workout/hr-analysis'
```

Add `workoutSessionId` to the destructured props parameter.

Add state + fetch logic inside the component, after the existing `useState` calls:

```typescript
  interface HrData {
    hasData: boolean
    startedAt: string
    readings: { timestamp: string; bpm: number }[]
    setStats: {
      exerciseName: string; setNumber: number; loggedAt: string
      peakBpm: number | null; hrr1: number | null; adequate: boolean | null
    }[]
  }
  const [hrData, setHrData]     = useState<HrData | null>(null)
  const [hrLoading, setHrLoading] = useState(false)

  const loadHr = useCallback(async () => {
    if (!workoutSessionId) return
    setHrLoading(true)
    try {
      const res  = await fetch(`/api/oura/hr-data?sessionId=${workoutSessionId}`)
      const data = await res.json() as { ready?: boolean; hasData?: boolean } & Partial<HrData>
      if (data.ready && data.hasData) setHrData(data as HrData)
    } finally {
      setHrLoading(false)
    }
  }, [workoutSessionId])

  useEffect(() => { loadHr() }, [loadHr])
```

Add the HR card in the JSX, after the stats row (totalVolumeKg / totalSets section) and before the buttons. Place it inside the scrollable content area:

```tsx
      {/* HR Recovery */}
      {workoutSessionId && (
        <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">HR Recovery</p>
            <button
              onClick={loadHr}
              disabled={hrLoading}
              className="text-[10px] text-muted-foreground hover:text-foreground transition"
            >
              {hrLoading ? 'Loading…' : hrData ? 'Refresh' : 'Load'}
            </button>
          </div>

          {hrData ? (
            <>
              <HrRecoveryChart
                readings={hrData.readings.map(r => ({ timestamp: new Date(r.timestamp), bpm: r.bpm }))}
                sets={hrData.setStats.map(s => ({ exerciseName: s.exerciseName, setNumber: s.setNumber, loggedAt: new Date(s.loggedAt) }))}
                sessionStartedAt={new Date(hrData.startedAt)}
              />
              {/* Per-set HRR1 summary — only show exercises with stats */}
              <div className="space-y-1">
                {hrData.setStats.filter(s => s.hrr1 != null).slice(0, 6).map(s => (
                  <div key={`${s.exerciseName}-${s.setNumber}`} className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground truncate max-w-[55%]">{s.exerciseName} S{s.setNumber}</span>
                    <span className={s.adequate === false ? 'text-red-400' : s.adequate ? 'text-green-400' : 'text-muted-foreground'}>
                      {s.hrr1 != null ? `↓${s.hrr1} bpm/min` : '—'}
                      {s.adequate === true ? ' ✓' : s.adequate === false ? ' ✗' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              {hrLoading ? 'Fetching HR data from Oura…' : 'Tap Load — available once Oura ring syncs'}
            </p>
          )}
        </div>
      )}
```

- [ ] **Pass `workoutSessionId` to `DoneScreen` in `components/workout-screen.tsx`**

Find the `<DoneScreen` JSX block (around line 879) and add:
```tsx
        workoutSessionId={store.workoutSessionId ?? undefined}
```

- [ ] **TypeScript check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Commit**

```bash
git add app/api/oura/hr-data/route.ts components/workout/done-screen.tsx components/workout-screen.tsx
git commit -m "Wire HR recovery chart into done screen"
```

---

## Self-Review

**Spec coverage:**
- ✅ Auto-fetch HR on workout complete (Task 5)
- ✅ Webhook backfill when Oura data arrives (Task 6)
- ✅ HR stored per-user, per-timestamp (Task 1-2)
- ✅ HRR1 per set calculated (Task 7)
- ✅ Chart with set markers on done screen (Task 8-9)
- ✅ No user prompt to open Oura app
- ✅ Graceful empty state when data not yet available

**Type consistency check:**
- `HrReading` defined in Task 7, used in Tasks 8, 9 ✅
- `SetMarker` defined in Task 7, used in Tasks 8, 9 ✅
- `SetHrStats` defined in Task 7, returned by `analyseHrRecovery` in Task 9 ✅
- `upsertOuraHeartrate` signature matches adapter and caller in hr-sync.ts ✅
- `getHrForWindow` returns `{ timestamp: Date; bpm: number }[]` — matches chart props ✅
- `getSetTimestampsForSession` returns `{ exerciseName, setNumber, loggedAt: Date }[]` — matches `SetMarker` ✅

**Placeholder scan:** None found — all steps contain exact code.

**One gap addressed:** `getWorkoutSessionsFrom(userId, new Date(0))` is used in the hr-data route to verify ownership + get timestamps. This is O(n) but workout counts are small. Acceptable for now; a `getWorkoutSessionById(userId, id)` method would be cleaner if this causes issues at scale.
