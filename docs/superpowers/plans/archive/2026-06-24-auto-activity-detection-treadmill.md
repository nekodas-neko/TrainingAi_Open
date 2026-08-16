# Auto Activity Detection + Treadmill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add treadmill sessions with auto-calculated steps and Oura HR enrichment (Phase 1), then phone-native background walk/run detection with GPS capture and "Exercise Detected" review flow (Phase 2).

**Architecture:** Phase 1 extends the existing activity session flow — treadmill is a new non-GPS activity type; the done screen adds a distance field and computes steps from the user's height (already stored in `users.height_cm`) and pulls Oura HR from the already-existing `getHrForWindow` repo method for the session window. Phase 2 runs a second background GPS watcher in parallel to any active session, uses GPS speed heuristics (≥0.8 m/s sustained = moving, gap ≥3 min = stopped) to detect walks/runs, stores them in a Zustand persist store, and surfaces them as a review card; Oura's workout endpoint acts as a fallback for phone-absent days.

**Tech Stack:** Next.js 15, Capacitor (`@capacitor-community/background-geolocation`), Drizzle ORM + PostgreSQL, Zustand persist, Oura v2 API (`/v2/usercollection/workout` + `/v2/usercollection/heartrate`)

**Branch:** `claude/oura-auto-exercise-activity-ae3qce`

---

## Phase 1: Treadmill Session

### Task 1: DB Migration + Schema + Type Updates

**Files:**
- Create: `lib/data/postgres/migrations/094_treadmill.sql`
- Modify: `lib/data/postgres/schema.ts`
- Modify: `lib/types/body.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Write migration**

```sql
-- lib/data/postgres/migrations/094_treadmill.sql
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS steps INTEGER;

INSERT INTO activity_types (id, label, icon, is_distance_based, sort_order)
VALUES ('treadmill', 'Treadmill', 'PersonSimpleWalk', false, 9)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Apply migration to local dev DB**

```bash
pnpm db:local
```

Expected: `[local-db] Applying migrations... [local-db] Ready.` with no errors.

Verify:
```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" -c "\d activity_logs" | grep steps
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" -c "SELECT id FROM activity_types WHERE id='treadmill';"
```

Expected: `steps | integer` column present, and one row returned for treadmill.

- [ ] **Step 3: Add `steps` to Drizzle schema**

In `lib/data/postgres/schema.ts`, find the `activityLogs` table definition. The existing columns end with `elevationLossM`. Add `steps` immediately after `elevationLossM`:

```typescript
  elevationLossM:  doublePrecision('elevation_loss_m'),
  steps:           integer('steps'),
```

- [ ] **Step 4: Add `steps` to `ActivityLog` TypeScript type**

In `lib/types/body.ts`, find the `ActivityLog` interface. Add `steps` after `maxHr`:

```typescript
  avgHr?: number
  maxHr?: number
  steps?: number
```

- [ ] **Step 5: Add `steps` to `saveActivityLog` and `rowToActivityLog` in adapter**

In `lib/data/postgres/adapter.ts`, find `saveActivityLog` (around line 2112). In the `.values({...})` block, add `steps` after `maxHr`:

```typescript
        avgHr: log.avgHr ?? null, maxHr: log.maxHr ?? null,
        steps: log.steps ?? null,
```

In `rowToActivityLog` (a few lines below), add `steps` after `maxHr`:

```typescript
      avgHr: r.avgHr ?? undefined, maxHr: r.maxHr ?? undefined,
      steps: r.steps ?? undefined,
```

- [ ] **Step 6: Commit**

```bash
git add lib/data/postgres/migrations/094_treadmill.sql lib/data/postgres/schema.ts lib/types/body.ts lib/data/postgres/adapter.ts
git commit -m "Add steps column to activity_logs and treadmill activity type"
```

---

### Task 2: Steps Calculation Utility + Tests

**Files:**
- Create: `lib/activity/treadmill-utils.ts`
- Create: `lib/activity/__tests__/treadmill-utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/activity/__tests__/treadmill-utils.test.ts
import { calculateSteps } from '../treadmill-utils'

describe('calculateSteps', () => {
  it('calculates steps for 180cm person over 5km', () => {
    // stride = 1.80 * 0.415 = 0.747m, steps = 5000 / 0.747 ≈ 6693
    expect(calculateSteps(5, 180)).toBe(6693)
  })

  it('calculates steps for 165cm person over 3km', () => {
    // stride = 1.65 * 0.415 = 0.68475m, steps = 3000 / 0.68475 ≈ 4381
    expect(calculateSteps(3, 165)).toBe(4381)
  })

  it('returns 0 for zero distance', () => {
    expect(calculateSteps(0, 180)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test lib/activity/__tests__/treadmill-utils.test.ts
```

Expected: FAIL with `Cannot find module '../treadmill-utils'`

- [ ] **Step 3: Write implementation**

```typescript
// lib/activity/treadmill-utils.ts
export function calculateSteps(distanceKm: number, heightCm: number): number {
  if (distanceKm === 0) return 0
  const strideLengthM = (heightCm / 100) * 0.415
  return Math.round((distanceKm * 1000) / strideLengthM)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test lib/activity/__tests__/treadmill-utils.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/activity/treadmill-utils.ts lib/activity/__tests__/treadmill-utils.test.ts
git commit -m "Add calculateSteps utility for treadmill step estimation"
```

---

### Task 3: Oura HR Window API Endpoint

**Files:**
- Create: `app/api/oura/hr-window/route.ts`

`getHrForWindow(userId, from: Date, to: Date)` already exists in the repository — it queries `oura_heartrate` for all bpm samples in the window. This task wraps it in an HTTP endpoint.

- [ ] **Step 1: Write the endpoint**

```typescript
// app/api/oura/hr-window/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const start = req.nextUrl.searchParams.get('start')
  const end = req.nextUrl.searchParams.get('end')
  if (!start || !end) return NextResponse.json({ error: 'Missing start or end' }, { status: 400 })

  const startDate = new Date(start)
  const endDate = new Date(end)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
  }

  const repo = await getRepository()
  const samples = await repo.getHrForWindow(session.user.id, startDate, endDate)

  if (!samples.length) return NextResponse.json({ avgHr: null, maxHr: null })

  const avgHr = Math.round(samples.reduce((sum, s) => sum + s.bpm, 0) / samples.length)
  const maxHr = Math.max(...samples.map(s => s.bpm))

  return NextResponse.json({ avgHr, maxHr })
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
pnpm tsc --noEmit
```

Expected: no errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add app/api/oura/hr-window/route.ts
git commit -m "Add GET /api/oura/hr-window endpoint for activity HR enrichment"
```

---

### Task 4: Update Activity Logs API to Accept avgHr, maxHr, Steps

The `ActivityLogBody` Zod schema in `app/api/activity-logs/route.ts` currently rejects `avgHr`, `maxHr`, and `steps`. Add them so the done screen can send them.

**Files:**
- Modify: `app/api/activity-logs/route.ts`

- [ ] **Step 1: Add three fields to `ActivityLogBody`**

In `app/api/activity-logs/route.ts`, find `ActivityLogBody` (the `z.object(...)` at the top). After `elevationLossM`, add:

```typescript
  avgHr:           z.number().int().positive().optional(),
  maxHr:           z.number().int().positive().optional(),
  steps:           z.number().int().nonnegative().optional(),
```

- [ ] **Step 2: Verify type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors. The `saveActivityLog` call already spreads `body.data`, so the new fields flow through automatically.

- [ ] **Step 3: Commit**

```bash
git add app/api/activity-logs/route.ts
git commit -m "Accept avgHr, maxHr, steps in POST /api/activity-logs"
```

---

### Task 5: Treadmill Section in DoneActivityScreen

When `activityType === 'treadmill'`, the done screen must show a distance input field and, once distance is entered, display computed steps + Oura HR for the session window.

The component already has access to `activityType`, `startMs`, `endMs` from the store.

**Files:**
- Modify: `components/activity/done-activity-screen.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `done-activity-screen.tsx`, add:

```typescript
import { useEffect, useRef } from 'react'
import { calculateSteps } from '@/lib/activity/treadmill-utils'
```

Inside the `DoneActivityScreen` component, after the existing `useState` calls, add:

```typescript
  const [treadmillDistKm, setTreadmillDistKm] = useState('')
  const [treadmillMetrics, setTreadmillMetrics] = useState<{
    steps: number | null
    avgHr: number | null
    maxHr: number | null
  }>({ steps: null, avgHr: null, maxHr: null })
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const hrFetchedRef = useRef(false)
```

- [ ] **Step 2: Fetch user height and Oura HR on mount (treadmill only)**

Add this `useEffect` after the state declarations:

```typescript
  useEffect(() => {
    if (activityType !== 'treadmill') return
    fetch('/api/user/profile')
      .then(r => r.json())
      .then(data => setHeightCm(data.user?.heightCm ?? null))
      .catch(() => {})
  }, [activityType])
```

- [ ] **Step 3: Add handler to compute metrics when distance changes**

Add this function inside the component (before the return):

```typescript
  async function handleTreadmillDistanceChange(raw: string) {
    setTreadmillDistKm(raw)
    const km = parseFloat(raw)
    if (isNaN(km) || km <= 0) {
      setTreadmillMetrics({ steps: null, avgHr: null, maxHr: null })
      return
    }

    const steps = heightCm ? calculateSteps(km, heightCm) : null

    // Only fetch HR once per session
    let avgHr: number | null = null
    let maxHr: number | null = null
    if (!hrFetchedRef.current && startMs && endMs) {
      setLoadingMetrics(true)
      try {
        const res = await fetch(
          `/api/oura/hr-window?start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${encodeURIComponent(new Date(endMs).toISOString())}`
        )
        if (res.ok) {
          const data = await res.json()
          avgHr = data.avgHr
          maxHr = data.maxHr
          hrFetchedRef.current = true
        }
      } catch {}
      setLoadingMetrics(false)
    } else {
      avgHr = treadmillMetrics.avgHr
      maxHr = treadmillMetrics.maxHr
    }

    setTreadmillMetrics({ steps, avgHr, maxHr })
  }
```

- [ ] **Step 4: Add treadmill distance input UI**

In the JSX, after the existing metrics grid (`<div className="mb-4 grid grid-cols-3 ...">`) and before the elevation section, add:

```tsx
      {activityType === 'treadmill' && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Distance covered
          </p>
          <div className="flex items-center gap-2 rounded-xl border bg-muted/60 px-4 py-3">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="100"
              value={treadmillDistKm}
              onChange={e => handleTreadmillDistanceChange(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-lg tabular-nums focus:outline-none"
            />
            <span className="text-sm text-muted-foreground">km</span>
          </div>

          {!heightCm && treadmillDistKm && (
            <p className="mt-1 text-xs text-amber-400">
              Add your height in Profile to get step count.
            </p>
          )}

          {(treadmillMetrics.steps != null || treadmillMetrics.avgHr != null) && (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {treadmillMetrics.steps != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.steps.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">steps</p>
                </div>
              )}
              {treadmillMetrics.avgHr != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.avgHr}</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              )}
              {treadmillMetrics.maxHr != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.maxHr}</p>
                  <p className="text-[10px] text-muted-foreground">max bpm</p>
                </div>
              )}
            </div>
          )}
          {loadingMetrics && (
            <p className="mt-1 text-xs text-muted-foreground">Fetching HR from Oura…</p>
          )}
        </div>
      )}
```

- [ ] **Step 5: Include treadmill fields in both save paths**

In `handleSave`, before the `store.upsertActivityLog` call, add:

```typescript
    const treadmillDistKmParsed = activityType === 'treadmill' && treadmillDistKm
      ? (parseFloat(treadmillDistKm) || undefined)
      : undefined
    const saveDistanceKm = treadmillDistKmParsed ?? draftSummary.distanceKm ?? undefined
    const saveSteps = activityType === 'treadmill' ? treadmillMetrics.steps ?? undefined : undefined
    const saveAvgHr = activityType === 'treadmill' ? treadmillMetrics.avgHr ?? undefined : undefined
    const saveMaxHr = activityType === 'treadmill' ? treadmillMetrics.maxHr ?? undefined : undefined
```

In the SQLite path (`store.upsertActivityLog`), change:
```typescript
          distanceKm: draftSummary.distanceKm ?? null,
```
to:
```typescript
          distanceKm: saveDistanceKm ?? null,
```

In the API path (`fetch('/api/activity-logs', ...)`), add to the JSON body:
```typescript
          distanceKm: saveDistanceKm,
          avgHr: saveAvgHr,
          maxHr: saveMaxHr,
          steps: saveSteps,
```

Also change the existing `distanceKm: draftSummary.distanceKm,` line to `distanceKm: saveDistanceKm,` in the API path.

- [ ] **Step 6: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/activity/done-activity-screen.tsx
git commit -m "Add treadmill distance entry with computed steps and Oura HR on done screen"
```

---

### Task 6: Show Steps in ActivityDetailSheet

**Files:**
- Modify: `components/activity/activity-detail-sheet.tsx`

- [ ] **Step 1: Find the HR/calories section and add steps**

In `activity-detail-sheet.tsx`, find the block that conditionally renders HR/calories (around line 68). Add a steps chip alongside avgHr:

```tsx
              {log.steps != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-3 py-2 text-center">
                  <p className="text-lg font-bold tabular-nums">{log.steps.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">steps</p>
                </div>
              )}
```

Place this as the first item inside the HR/calories grid so the order is: steps, avg bpm, max bpm, calories.

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test treadmill flow**

```bash
pnpm dev
```

- Select Treadmill from the activity picker
- Start, run the timer for 30 seconds, finish
- Enter 2.0 km on the done screen
- Verify steps appear (e.g. for 175cm user: 2000 / (1.75 × 0.415) = 2000 / 0.726 ≈ 2754 steps)
- Save
- Open ActivityHistoryCard → tap the saved activity → verify steps show in the detail sheet

- [ ] **Step 4: Commit**

```bash
git add components/activity/activity-detail-sheet.tsx
git commit -m "Show steps in activity detail sheet"
```

---

## Phase 2: Auto Activity Detection

### Task 7: Auto-Detection Zustand Store

This store holds in-progress GPS session state and completed pending sessions (persisted to localStorage so they survive app restarts).

**Files:**
- Create: `lib/stores/auto-detection-store.ts`

- [ ] **Step 1: Write the store**

```typescript
// lib/stores/auto-detection-store.ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { computeTotalDistanceKm } from '@/lib/activity/activity-metrics'
import { encodeRoute, simplifyRoute } from '@/lib/activity/route-encoding'

export interface PendingSession {
  id: string
  startMs: number
  endMs: number
  routePolyline: string   // encoded; empty string if source === 'oura'
  distanceKm: number
  durationMin: number
  activityType: 'walk' | 'run'
  source: 'phone' | 'oura'
  ouraWorkoutId?: string
}

interface AutoDetectionState {
  isDetecting: boolean
  sessionStartMs: number | null
  sessionPoints: RoutePoint[]
  pendingSessions: PendingSession[]
}

interface AutoDetectionActions {
  setDetecting(v: boolean): void
  startSession(ms: number): void
  addPoint(point: RoutePoint): void
  endSession(): void
  dismissSession(id: string): void
  removeSession(id: string): void
  addOuraSession(session: Omit<PendingSession, 'id'>): void
}

// avg speed >= 2.08 m/s == 8 min/km (walk/run threshold from spec)
const RUN_SPEED_THRESHOLD_MS = 2.08
// Discard sessions shorter than 5 minutes
const MIN_DURATION_MS = 5 * 60 * 1000

export const useAutoDetectionStore = create<AutoDetectionState & AutoDetectionActions>()(
  persist(
    (set, get) => ({
      isDetecting: false,
      sessionStartMs: null,
      sessionPoints: [],
      pendingSessions: [],

      setDetecting: (v) => set({ isDetecting: v }),

      startSession: (ms) => set({ sessionStartMs: ms, sessionPoints: [] }),

      addPoint: (point) => set(s => ({ sessionPoints: [...s.sessionPoints, point] })),

      endSession: () => {
        const { sessionStartMs, sessionPoints } = get()
        if (!sessionStartMs || sessionPoints.length < 2) {
          set({ sessionStartMs: null, sessionPoints: [] })
          return
        }
        const endMs = sessionPoints[sessionPoints.length - 1].t
        if (endMs - sessionStartMs < MIN_DURATION_MS) {
          set({ sessionStartMs: null, sessionPoints: [] })
          return
        }

        const simplified = simplifyRoute(sessionPoints, 5)
        const distanceKm = computeTotalDistanceKm(sessionPoints)
        const durationMin = (endMs - sessionStartMs) / 60000
        const avgSpeedMs = distanceKm > 0
          ? (distanceKm * 1000) / ((endMs - sessionStartMs) / 1000)
          : 0
        const activityType: 'walk' | 'run' = avgSpeedMs >= RUN_SPEED_THRESHOLD_MS ? 'run' : 'walk'

        const session: PendingSession = {
          id: crypto.randomUUID(),
          startMs: sessionStartMs,
          endMs,
          routePolyline: encodeRoute(simplified),
          distanceKm,
          durationMin,
          activityType,
          source: 'phone',
        }

        set(s => ({
          pendingSessions: [...s.pendingSessions, session],
          sessionStartMs: null,
          sessionPoints: [],
        }))
      },

      dismissSession: (id) => set(s => ({
        pendingSessions: s.pendingSessions.filter(p => p.id !== id),
      })),

      removeSession: (id) => set(s => ({
        pendingSessions: s.pendingSessions.filter(p => p.id !== id),
      })),

      addOuraSession: (session) => set(s => ({
        pendingSessions: [
          ...s.pendingSessions,
          { ...session, id: crypto.randomUUID() },
        ],
      })),
    }),
    {
      name: 'auto-detection-store',
      storage: createJSONStorage(() => {
        if (typeof localStorage === 'undefined') return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
        return localStorage
      }),
    }
  )
)
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/stores/auto-detection-store.ts
git commit -m "Add auto-detection Zustand store for pending GPS sessions"
```

---

### Task 8: Auto-Detection GPS Service

Runs a second background GPS watcher (separate from the activity-tracking watcher). Uses speed heuristics to detect when a walk/run starts and ends.

**Files:**
- Create: `lib/activity/auto-detection-service.ts`

- [ ] **Step 1: Write the service**

```typescript
// lib/activity/auto-detection-service.ts
'use client'

import type { RoutePoint } from './route-encoding'
import { haversineDistanceKm } from './activity-metrics'
import { startGpsWatcher, type GpsWatcher } from './gps-tracking'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'

const MIN_MOVE_SPEED_MS = 0.8        // 2.9 km/h — below this = stationary noise
const SESSION_END_GAP_MS = 3 * 60 * 1000  // 3-min silence = session ended
const SPEED_BUFFER_SIZE = 5          // average speed over last N points

let watcher: GpsWatcher | null = null
let stallTimer: ReturnType<typeof setTimeout> | null = null
const recentPoints: RoutePoint[] = []

function avgSpeedMs(points: RoutePoint[]): number {
  if (points.length < 2) return 0
  let distM = 0
  let ms = 0
  for (let i = 1; i < points.length; i++) {
    distM += haversineDistanceKm(points[i - 1], points[i]) * 1000
    ms += points[i].t - points[i - 1].t
  }
  return ms > 0 ? distM / (ms / 1000) : 0
}

function onPoint(point: RoutePoint) {
  // Maintain rolling speed buffer
  recentPoints.push(point)
  if (recentPoints.length > SPEED_BUFFER_SIZE) recentPoints.shift()

  // Reset stall timer
  if (stallTimer) clearTimeout(stallTimer)
  stallTimer = setTimeout(() => {
    const store = useAutoDetectionStore.getState()
    if (store.sessionStartMs !== null) store.endSession()
  }, SESSION_END_GAP_MS)

  const speed = avgSpeedMs(recentPoints)
  const store = useAutoDetectionStore.getState()

  if (speed >= MIN_MOVE_SPEED_MS) {
    if (store.sessionStartMs === null) {
      store.startSession(point.t)
    }
    store.addPoint(point)
  } else if (store.sessionStartMs !== null) {
    // Still recording while slow — let stall timer decide when to end
    store.addPoint(point)
  }
}

export async function startAutoDetection(): Promise<void> {
  if (watcher) return  // already running

  const store = useAutoDetectionStore.getState()
  store.setDetecting(true)
  recentPoints.length = 0

  watcher = await startGpsWatcher(onPoint)
}

export async function stopAutoDetection(): Promise<void> {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  if (watcher) { await watcher.stop(); watcher = null }

  const store = useAutoDetectionStore.getState()
  store.setDetecting(false)
  if (store.sessionStartMs !== null) store.endSession()
}

export function isAutoDetectionRunning(): boolean {
  return watcher !== null
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/activity/auto-detection-service.ts
git commit -m "Add background GPS auto-detection service"
```

---

### Task 9: Start Service on App Launch

The service must start when the Capacitor app initialises and persist in the background. The root layout is the right integration point — it mounts once on native and stays mounted.

**Files:**
- Create: `components/auto-detection-provider.tsx`
- Modify: `app/layout.tsx` (or wherever the native Capacitor root wraps the app — check for a `providers.tsx` or similar)

- [ ] **Step 1: Write the provider**

```typescript
// components/auto-detection-provider.tsx
'use client'

import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { startAutoDetection, stopAutoDetection } from '@/lib/activity/auto-detection-service'

export function AutoDetectionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Only run on native — browser GPS is too unreliable for background use
    if (!Capacitor.isNativePlatform()) return

    startAutoDetection().catch(console.error)
    return () => { stopAutoDetection().catch(console.error) }
  }, [])

  return <>{children}</>
}
```

- [ ] **Step 2: Find the root layout / providers file**

```bash
grep -rn "Capacitor\|'use client'" app/layout.tsx app/providers.tsx 2>/dev/null | head -10
ls app/providers.tsx app/_providers.tsx 2>/dev/null
```

- [ ] **Step 3: Wrap app with AutoDetectionProvider**

In whatever file wraps the app at the root (e.g. `app/layout.tsx` or a separate providers file), import and add `AutoDetectionProvider`. It must be a client component, so if the root layout is a server component you'll need to add it to an existing client providers wrapper.

Example addition to a providers file:
```tsx
import { AutoDetectionProvider } from '@/components/auto-detection-provider'

// Inside the JSX:
<AutoDetectionProvider>
  {children}
</AutoDetectionProvider>
```

- [ ] **Step 4: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/auto-detection-provider.tsx app/layout.tsx  # adjust path as needed
git commit -m "Start auto-detection service on app launch (native only)"
```

---

### Task 10: Exercise Detected Card

Shown on the health/home screen when pending sessions exist. Shows the most recent pending session with Dismiss and Review actions.

**Files:**
- Create: `components/activity/exercise-detected-card.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/activity/exercise-detected-card.tsx
'use client'

import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'

function formatAgo(ms: number): string {
  const diffMin = Math.round((Date.now() - ms) / 60000)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.round(diffH / 24)}d ago`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  return `${h % 12 || 12}:${m}${ampm}`
}

interface Props {
  onReview: (sessionId: string) => void
}

export function ExerciseDetectedCard({ onReview }: Props) {
  const { pendingSessions, dismissSession } = useAutoDetectionStore(s => ({
    pendingSessions: s.pendingSessions,
    dismissSession: s.dismissSession,
  }))

  if (!pendingSessions.length) return null

  // Show the most recent unreviewed session
  const session = [...pendingSessions].sort((a, b) => b.startMs - a.startMs)[0]

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-brand/30 bg-brand/10">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold capitalize">
            {session.activityType === 'run' ? 'Run' : 'Walk'} detected
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTime(session.startMs)} · {Math.round(session.durationMin)} min · {session.distanceKm.toFixed(2)} km
            {pendingSessions.length > 1 && ` · +${pendingSessions.length - 1} more`}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 gap-2">
          <button
            onClick={() => dismissSession(session.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            Dismiss
          </button>
          <button
            onClick={() => onReview(session.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-black"
            style={{ background: 'var(--color-brand)' }}
          >
            Review
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/activity/exercise-detected-card.tsx
git commit -m "Add ExerciseDetectedCard for pending auto-detected sessions"
```

---

### Task 11: Exercise Review Sheet

Full-screen bottom sheet that shows the route map, Oura HR, and lets the user save or dismiss a detected session. Saves as a regular `activity_log`.

**Files:**
- Create: `components/activity/exercise-review-sheet.tsx`

- [ ] **Step 1: Write the component**

```typescript
// components/activity/exercise-review-sheet.tsx
'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { decodeRoute } from '@/lib/activity/route-encoding'
import { todayInTz } from '@/lib/date-utils'
import { invalidateCache } from '@/lib/sqlite/cache'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false }
)

function pad2(n: number) { return String(n).padStart(2, '0') }
function toHHMM(ms: number) {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

interface Props {
  sessionId: string | null
  onClose: () => void
}

export function ExerciseReviewSheet({ sessionId, onClose }: Props) {
  const { pendingSessions, removeSession } = useAutoDetectionStore(s => ({
    pendingSessions: s.pendingSessions,
    removeSession: s.removeSession,
  }))
  const session = pendingSessions.find(p => p.id === sessionId) ?? null

  const [saving, setSaving] = useState(false)
  const [activityType, setActivityType] = useState<'walk' | 'run'>('walk')
  const [hrData, setHrData] = useState<{ avgHr: number | null; maxHr: number | null }>({
    avgHr: null, maxHr: null,
  })

  useEffect(() => {
    if (!session) return
    setActivityType(session.activityType)
    setHrData({ avgHr: null, maxHr: null })

    const start = encodeURIComponent(new Date(session.startMs).toISOString())
    const end = encodeURIComponent(new Date(session.endMs).toISOString())
    fetch(`/api/oura/hr-window?start=${start}&end=${end}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setHrData({ avgHr: data.avgHr, maxHr: data.maxHr }) })
      .catch(() => {})
  }, [session?.id])

  async function handleSave() {
    if (!session) return
    setSaving(true)
    try {
      const date = new Date(session.startMs)
      const dateStr = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
      const label = activityType === 'run' ? 'Run' : 'Walk'
      const timeLabel = new Date(session.startMs).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })

      const res = await fetch('/api/activity-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateStr,
          activityType,
          title: `${label} at ${timeLabel}`,
          startTime: toHHMM(session.startMs),
          endTime: toHHMM(session.endMs),
          durationMin: session.durationMin,
          distanceKm: session.distanceKm,
          routePolyline: session.source === 'phone' ? session.routePolyline : undefined,
          avgHr: hrData.avgHr ?? undefined,
          maxHr: hrData.maxHr ?? undefined,
        }),
      })
      if (!res.ok) throw new Error()

      removeSession(session.id)
      await Promise.all([
        invalidateCache('activity-logs'),
        invalidateCache('weekly-stats'),
      ])
      toast.success('Activity saved')
      onClose()
    } catch {
      toast.error('Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  const routePoints = session?.routePolyline ? decodeRoute(session.routePolyline) : []

  return (
    <Sheet open={!!sessionId} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto rounded-t-2xl px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {session && (
          <>
            <SheetHeader className="mb-4 pt-4">
              <SheetTitle>
                {session.activityType === 'run' ? 'Run' : 'Walk'} Detected
              </SheetTitle>
            </SheetHeader>

            {/* Walk / Run toggle */}
            <div className="mb-4 flex gap-2">
              {(['walk', 'run'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setActivityType(t)}
                  className="flex-1 rounded-xl py-2 text-sm font-bold transition"
                  style={activityType === t
                    ? { background: 'var(--color-brand)', color: '#000' }
                    : { background: 'var(--color-muted)', opacity: 0.7 }}
                >
                  {t === 'walk' ? 'Walk' : 'Run'}
                </button>
              ))}
            </div>

            {/* Metrics */}
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                <p className="text-lg font-bold tabular-nums">{Math.round(session.durationMin)}</p>
                <p className="text-[10px] text-muted-foreground">min</p>
              </div>
              <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                <p className="text-lg font-bold tabular-nums">{session.distanceKm.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">km</p>
              </div>
              {hrData.avgHr != null ? (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{hrData.avgHr}</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              ) : (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-3 opacity-40">
                  <p className="text-lg font-bold">—</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              )}
            </div>

            {/* Route map */}
            {routePoints.length > 1 && (
              <ActivityRouteMap points={routePoints} className="mb-4 h-56 w-full" />
            )}
            {session.source === 'oura' && (
              <p className="mb-4 text-center text-xs text-muted-foreground">
                Route not available — phone wasn't tracking
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { removeSession(session.id); onClose() }}
                disabled={saving}
                className="flex-1 rounded-xl border py-3.5 text-sm font-bold transition disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl py-3.5 text-sm font-bold transition disabled:opacity-50"
                style={{ background: 'var(--color-brand)', color: '#000' }}
              >
                {saving ? 'Saving…' : `Save as ${activityType === 'run' ? 'Run' : 'Walk'}`}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Add `ExerciseDetectedCard` + `ExerciseReviewSheet` to the health screen**

Open `app/health/health-content.tsx`. Find where the activity section begins (look for `ActivityHistoryCard` or the training tab content).

Add state and import at the top of the file (if it's a client component):
```typescript
import { useState } from 'react'
import { ExerciseDetectedCard } from '@/components/activity/exercise-detected-card'
import { ExerciseReviewSheet } from '@/components/activity/exercise-review-sheet'
```

Inside the component:
```typescript
const [reviewingSessionId, setReviewingSessionId] = useState<string | null>(null)
```

In the JSX, near the top of the training tab (before other cards):
```tsx
<ExerciseDetectedCard onReview={id => setReviewingSessionId(id)} />
<ExerciseReviewSheet
  sessionId={reviewingSessionId}
  onClose={() => setReviewingSessionId(null)}
/>
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/activity/exercise-review-sheet.tsx app/health/health-content.tsx
git commit -m "Add exercise review sheet and integrate detected-session card in health screen"
```

---

### Task 12: Oura Workouts Fallback (Phone-Absent Days)

When the phone wasn't present during a walk, Oura Ring still detects it. This task syncs Oura's `workout` endpoint into a DB table and surfaces unreviewed walk/run entries as additional pending sessions.

**Files:**
- Create: `lib/data/postgres/migrations/095_oura_workouts.sql`
- Modify: `lib/oura/types.ts`
- Modify: `lib/oura/client.ts`
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Create: `app/api/oura/workouts/route.ts`
- Modify: `app/api/oura/sync/route.ts`
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Write migration**

```sql
-- lib/data/postgres/migrations/095_oura_workouts.sql
CREATE TABLE IF NOT EXISTS oura_workouts (
  id              TEXT          PRIMARY KEY,   -- Oura's own workout id
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day             DATE          NOT NULL,
  activity        TEXT          NOT NULL,
  start_datetime  TIMESTAMPTZ   NOT NULL,
  end_datetime    TIMESTAMPTZ   NOT NULL,
  calories        DOUBLE PRECISION,
  distance_m      DOUBLE PRECISION,
  intensity       TEXT,
  source          TEXT,
  reviewed        BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oura_workouts_user_day ON oura_workouts(user_id, day DESC);
```

- [ ] **Step 2: Apply migration**

```bash
pnpm db:local
```

Verify:
```bash
psql "postgresql://postgres:postgres@/trainingai_dev?host=/tmp&port=5433" -c "\d oura_workouts"
```

Expected: table with the columns above.

- [ ] **Step 3: Add `OuraWorkout` type**

In `lib/oura/types.ts`, add at the end:

```typescript
// GET /v2/usercollection/workout
// Scope: workout — auto-detected and manually logged workout sessions
export interface OuraWorkout {
  id: string
  day: string                              // YYYY-MM-DD
  activity: string                         // e.g. 'walking', 'running', 'weight_training'
  start_datetime: string                   // ISO 8601
  end_datetime: string                     // ISO 8601
  calories: number | null
  distance: number | null                  // metres
  intensity: 'easy' | 'moderate' | 'hard' | null
  label: string | null
  source: string | null                    // 'manual' | 'confirmed' | 'workout_heart_rate'
}
```

- [ ] **Step 4: Add `fetchOuraWorkouts` to Oura client**

In `lib/oura/client.ts`, find the pattern used by other `ouraGetAll` calls and add:

```typescript
export async function fetchOuraWorkouts(
  token: string,
  startDate: string,
  endDate: string
): Promise<OuraWorkout[]> {
  return ouraGetAll<OuraWorkout>(
    token,
    '/v2/usercollection/workout',
    { start_date: startDate, end_date: endDate }
  )
}
```

Also add `OuraWorkout` to the imports at the top of the file:
```typescript
import type { ..., OuraWorkout } from './types'
```

- [ ] **Step 5: Add repository methods**

In `lib/data/repository.ts`, add three method signatures (find the block with other Oura methods):

```typescript
  upsertOuraWorkouts(userId: string, workouts: OuraWorkout[]): Promise<void>
  getOuraWorkouts(userId: string, opts: { unreviewed?: boolean }): Promise<{
    id: string; day: string; activity: string; startDatetime: Date; endDatetime: Date;
    calories: number | null; distanceM: number | null; intensity: string | null;
    source: string | null; reviewed: boolean;
  }[]>
  markOuraWorkoutReviewed(userId: string, id: string): Promise<void>
```

Add the import for `OuraWorkout` at the top of `repository.ts`:
```typescript
import type { OuraWorkout } from '@/lib/oura/types'
```

- [ ] **Step 6: Implement repository methods in adapter**

In `lib/data/postgres/adapter.ts`, add:

```typescript
  async upsertOuraWorkouts(userId: string, workouts: OuraWorkout[]): Promise<void> {
    if (!workouts.length) return
    await this.db.insert(s.ouraWorkouts)
      .values(workouts.map(w => ({
        id: w.id,
        userId,
        day: w.day,
        activity: w.activity,
        startDatetime: new Date(w.start_datetime),
        endDatetime: new Date(w.end_datetime),
        calories: w.calories ?? null,
        distanceM: w.distance ?? null,
        intensity: w.intensity ?? null,
        source: w.source ?? null,
      })))
      .onConflictDoNothing()
  }

  async getOuraWorkouts(userId: string, opts: { unreviewed?: boolean }) {
    const conditions = [eq(s.ouraWorkouts.userId, userId)]
    if (opts.unreviewed) conditions.push(eq(s.ouraWorkouts.reviewed, false))
    const rows = await this.db.select().from(s.ouraWorkouts).where(and(...conditions))
      .orderBy(desc(s.ouraWorkouts.day))
    return rows.map(r => ({
      id: r.id, day: r.day, activity: r.activity,
      startDatetime: r.startDatetime, endDatetime: r.endDatetime,
      calories: r.calories, distanceM: r.distanceM,
      intensity: r.intensity, source: r.source, reviewed: r.reviewed,
    }))
  }

  async markOuraWorkoutReviewed(userId: string, id: string): Promise<void> {
    await this.db.update(s.ouraWorkouts)
      .set({ reviewed: true })
      .where(and(eq(s.ouraWorkouts.userId, userId), eq(s.ouraWorkouts.id, id)))
  }
```

Also add the Drizzle schema table definition in `lib/data/postgres/schema.ts`:

```typescript
export const ouraWorkouts = pgTable('oura_workouts', {
  id:             text('id').primaryKey(),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:            date('day', { mode: 'string' }).notNull(),
  activity:       text('activity').notNull(),
  startDatetime:  timestamp('start_datetime', { withTimezone: true }).notNull(),
  endDatetime:    timestamp('end_datetime', { withTimezone: true }).notNull(),
  calories:       doublePrecision('calories'),
  distanceM:      doublePrecision('distance_m'),
  intensity:      text('intensity'),
  source:         text('source'),
  reviewed:       boolean('reviewed').notNull().default(false),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

Import it at the top of `adapter.ts` alongside the other schema imports.

- [ ] **Step 7: Add workout fetch to Oura sync**

In `app/api/oura/sync/route.ts`, find the parallel fetch block (`Promise.all([...])`). Add `fetchOuraWorkouts` to the parallel calls:

```typescript
import { ..., fetchOuraWorkouts } from '@/lib/oura/client'

// Inside the Promise.all:
fetchOuraWorkouts(accessToken, startDate, endDate),
```

After the parallel fetch, add the upsert:

```typescript
// After existing upserts:
if (workoutsData.length > 0) {
  await repo.upsertOuraWorkouts(userId, workoutsData)
}
```

- [ ] **Step 8: Create `GET /api/oura/workouts` endpoint**

```typescript
// app/api/oura/workouts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

// Activities Oura classifies as walks or runs
const WALK_RUN_ACTIVITIES = new Set([
  'walking', 'running', 'walk', 'run', 'outdoor_walk', 'outdoor_run', 'treadmill_walking', 'treadmill_running',
])

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const unreviewed = req.nextUrl.searchParams.get('unreviewed') === 'true'
  const repo = await getRepository()
  const all = await repo.getOuraWorkouts(session.user.id, { unreviewed })
  const relevant = all.filter(w => WALK_RUN_ACTIVITIES.has(w.activity.toLowerCase()))

  return NextResponse.json(relevant)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id?: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const repo = await getRepository()
  await repo.markOuraWorkoutReviewed(session.user.id, id)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 9: Fetch Oura workouts on health screen and add to pending sessions**

In `app/health/health-content.tsx`, add a `useEffect` that fetches unreviewed Oura workouts once on mount and adds them to the auto-detection store as Oura fallback sessions (skipping any that already overlap a phone-detected session by time):

```typescript
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'

// Inside the health content component:
const addOuraSession = useAutoDetectionStore(s => s.addOuraSession)
const pendingSessions = useAutoDetectionStore(s => s.pendingSessions)

useEffect(() => {
  fetch('/api/oura/workouts?unreviewed=true')
    .then(r => r.ok ? r.json() : [])
    .then((workouts: Array<{
      id: string; activity: string; startDatetime: string; endDatetime: string;
      distanceM: number | null;
    }>) => {
      for (const w of workouts) {
        const startMs = new Date(w.startDatetime).getTime()
        const endMs = new Date(w.endDatetime).getTime()
        // Skip if we already have a phone-tracked session overlapping this window
        const alreadyCovered = pendingSessions.some(
          p => p.source === 'phone' && p.startMs < endMs && p.endMs > startMs
        )
        if (alreadyCovered) continue
        addOuraSession({
          startMs,
          endMs,
          routePolyline: '',
          distanceKm: w.distanceM ? w.distanceM / 1000 : 0,
          durationMin: (endMs - startMs) / 60000,
          activityType: w.activity.toLowerCase().includes('run') ? 'run' : 'walk',
          source: 'oura',
          ouraWorkoutId: w.id,
        })
      }
    })
    .catch(() => {})
}, [])
```

When the user saves or dismisses an Oura-sourced session in `ExerciseReviewSheet`, also call `PATCH /api/oura/workouts` to mark it reviewed so it doesn't reappear next time:

In `exercise-review-sheet.tsx`, in `handleSave` and the Dismiss handler, add for Oura sessions:
```typescript
if (session.source === 'oura' && session.ouraWorkoutId) {
  fetch('/api/oura/workouts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: session.ouraWorkoutId }),
  }).catch(() => {})
}
```

- [ ] **Step 10: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add \
  lib/data/postgres/migrations/095_oura_workouts.sql \
  lib/oura/types.ts \
  lib/oura/client.ts \
  lib/data/repository.ts \
  lib/data/postgres/adapter.ts \
  lib/data/postgres/schema.ts \
  app/api/oura/workouts/route.ts \
  app/api/oura/sync/route.ts \
  app/health/health-content.tsx \
  components/activity/exercise-review-sheet.tsx
git commit -m "Add Oura workout fallback: sync detected walks/runs and surface as pending sessions"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - ✅ Treadmill: timer session → distance entry → steps calc (Task 2, 5)
  - ✅ Treadmill: Oura HR for session window (Task 3, 5)
  - ✅ Steps from height × stride ratio (Task 2)
  - ✅ Height from `users.height_cm` via `/api/user/profile` (Task 5 — profile endpoint already returns `user.heightCm`)
  - ✅ Steps stored in `activity_logs.steps` not `body_metrics` (Task 1)
  - ✅ Phone-native Activity Recognition via GPS speed heuristics (Tasks 7, 8)
  - ✅ "Exercise Detected" card + review sheet (Tasks 10, 11)
  - ✅ Oura HR pulled for review window (Task 11)
  - ✅ Walk (≥8 min/km) vs run (<8 min/km) threshold applied (Task 7)
  - ✅ Oura Ring fallback for phone-absent days (Task 12)
  - ✅ No GPS for Oura fallback sessions (Task 12 — `routePolyline: ''` + "Route not available" message in sheet)
  - ✅ Background service only on native (Task 9 — `Capacitor.isNativePlatform()` guard)

- **Placeholder scan:** No TBDs or incomplete sections found.

- **Type consistency:**
  - `PendingSession.routePolyline` used as `string` throughout — empty string for Oura sessions, not `null` (keeps the type uniform; `decodeRoute('')` returns `[]`).
  - `calculateSteps` signature `(distanceKm: number, heightCm: number): number` consistent across Task 2 and Task 5.
  - `getHrForWindow` signature is `(userId: string, from: Date, to: Date)` — Task 3 passes `new Date(start)` correctly.

---

**Plan complete.** Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans skill, batch execution with checkpoints

Which approach?
