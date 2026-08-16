> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Live Activity Tracking — GPS, Store & Live Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the live pre→active→done activity tracking flow: a new
`/activity` page with a Zustand store, GPS tracking (with background/screen-off
support via Capacitor), live distance/pace display, and a Leaflet route map.

**Architecture:** `lib/stores/activity-store.ts` is a persisted Zustand store
(mirroring `lib/stores/workout-store.ts`) holding the live session state and
raw GPS trace. `lib/activity/gps-tracking.ts` wraps
`@capacitor-community/background-geolocation` (native) with a
`navigator.geolocation` fallback (web/dev). `components/activity/activity-screen.tsx`
is the orchestrator (mirrors `components/workout-screen.tsx`), rendering
`pre-activity-screen.tsx` / `active-activity-screen.tsx` /
`done-activity-screen.tsx` based on `mode`. `activity-route-map.tsx` renders
the route with `react-leaflet`.

**Tech Stack:** Next.js 15 (App Router), React 19, Zustand persist middleware,
`@capacitor-community/background-geolocation`, `leaflet` + `react-leaflet`,
the pure helpers from `lib/activity/route-encoding.ts` and
`lib/activity/activity-metrics.ts` built in Plan 1.

---

This is **Plan 2 of 3** for `docs/superpowers/specs/2026-06-11-live-activity-tracking-design.md`
(Sections 1, 3 and 4). **Depends on Plan 1** (`docs/superpowers/plans/2026-06-11-activity-data-model-and-metrics.md`)
being implemented first — this plan imports `lib/activity/route-encoding.ts`
and `lib/activity/activity-metrics.ts`, and POSTs to the extended
`/api/activity-logs` endpoint. Plan 3 (calendar/history integration,
Sections 5-6) builds on this plan's `activity-route-map.tsx`.

## File Structure

| File | Status | Responsibility |
|------|--------|-----------------|
| `package.json` / `pnpm-lock.yaml` | Modify | Add `leaflet`, `react-leaflet`, `@types/leaflet`, `@capacitor-community/background-geolocation` |
| `android/app/src/main/AndroidManifest.xml` | Modify | Location + foreground service permissions |
| `components/activity/types.ts` | Create | `ActivityMode`, `ActivityDraftSummary` |
| `lib/activity/gps-tracking.ts` | Create | GPS watcher wrapper (native + web fallback) |
| `lib/stores/activity-store.ts` | Create | Persisted live-session state |
| `components/activity/activity-route-map.tsx` | Create | Leaflet route map (client-only) |
| `components/workout/log-activity-sheet.tsx` | Modify | Trim to type-picker only |
| `app/workout-select/workout-select-content.tsx` | Modify | Wire picker → `/activity` |
| `app/activity/page.tsx` | Create | Route entry, auth guard |
| `components/activity/activity-screen.tsx` | Create | Orchestrator |
| `components/activity/pre-activity-screen.tsx` | Create | Pre-start screen |
| `components/activity/active-activity-screen.tsx` | Create | Live tracking screen |
| `components/activity/done-activity-screen.tsx` | Create | Summary + save/discard |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install packages**

Run: `pnpm add leaflet react-leaflet @capacitor-community/background-geolocation && pnpm add -D @types/leaflet`

Expected: `package.json` gains `leaflet`, `react-leaflet`,
`@capacitor-community/background-geolocation` under `dependencies` and
`@types/leaflet` under `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add leaflet, react-leaflet and background-geolocation dependencies"
```

---

## Task 2: Android location & foreground-service permissions

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml:57-61`

- [ ] **Step 1: Add the new permissions**

In `android/app/src/main/AndroidManifest.xml`, after line 61
(`<uses-permission android:name="android.permission.VIBRATE" />`), add:

```xml
    <!-- Location — for live activity tracking (GPS route + pace) -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

- [ ] **Step 2: Verify the manifest is well-formed XML**

Run: `python3 -c "import xml.dom.minidom as m; m.parse('android/app/src/main/AndroidManifest.xml')" && echo OK`

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git commit -m "Add location and foreground service permissions for activity tracking"
```

---

## Task 3: `components/activity/types.ts`

**Files:**
- Create: `components/activity/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
import type { Split, PacePoint } from '@/lib/activity/activity-metrics'

export type ActivityMode = 'pre' | 'active' | 'done'

export interface ActivityDraftSummary {
  durationMin: number
  distanceKm?: number
  routePolyline?: string
  splits?: Split[]
  bestEfforts?: Record<string, number>
  paceSeries?: PacePoint[]
  avgPaceSecPerKm?: number
  elevationGainM?: number
  elevationLossM?: number
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors (this file has no consumers yet, so it should just
compile cleanly).

- [ ] **Step 3: Commit**

```bash
git add components/activity/types.ts
git commit -m "Add activity mode and draft summary types"
```

---

## Task 4: `lib/activity/gps-tracking.ts` — GPS watcher wrapper

**Files:**
- Create: `lib/activity/gps-tracking.ts`

- [ ] **Step 1: Implement the watcher wrapper**

```ts
import type { RoutePoint } from './route-encoding'

export interface GpsWatcher {
  stop: () => Promise<void>
}

/**
 * Starts watching GPS position. On native (Capacitor) platforms this uses
 * @capacitor-community/background-geolocation, which keeps reporting
 * locations with the screen off via an Android foreground service. In the
 * browser (web/dev) it falls back to navigator.geolocation.watchPosition,
 * which only works while the tab is foregrounded.
 */
export async function startGpsWatcher(onPoint: (point: RoutePoint) => void): Promise<GpsWatcher> {
  const { Capacitor } = await import('@capacitor/core')

  if (Capacitor.isNativePlatform()) {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Tracking your activity',
        backgroundTitle: 'TrainingAI',
        requestPermissions: true,
        distanceFilter: 5,
      },
      (location, error) => {
        if (error || !location) return
        onPoint({
          lat: location.latitude,
          lng: location.longitude,
          ele: location.altitude ?? undefined,
          t: location.time ?? Date.now(),
        })
      },
    )
    return { stop: () => BackgroundGeolocation.removeWatcher({ id }) }
  }

  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { stop: async () => {} }
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => onPoint({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      ele: pos.coords.altitude ?? undefined,
      t: pos.timestamp,
    }),
    () => {},
    { enableHighAccuracy: true },
  )
  return { stop: async () => navigator.geolocation.clearWatch(watchId) }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors. (`@capacitor-community/background-geolocation` types
resolve from the package installed in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add lib/activity/gps-tracking.ts
git commit -m "Add GPS watcher wrapper with background and web fallback"
```

---

## Task 5: `lib/stores/activity-store.ts`

**Files:**
- Create: `lib/stores/activity-store.ts`

- [ ] **Step 1: Implement the store**

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ActivityMode, ActivityDraftSummary } from '@/components/activity/types'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { simplifyRoute, encodeRoute } from '@/lib/activity/route-encoding'
import {
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeAvgPaceSecPerKm,
} from '@/lib/activity/activity-metrics'

interface ActivityState {
  activitySessionId: string
  activityType: string | null
  activityLabel: string
  activityIcon: string
  isDistanceBased: boolean
  title: string
  mode: ActivityMode
  isPaused: boolean

  startMs: number | null
  endMs: number | null
  pauseStartMs: number | null
  accumulatedPauseMs: number

  rawPoints: RoutePoint[]
  distanceKm: number
  currentPaceSecPerKm: number | null

  draftSummary: ActivityDraftSummary | null
}

interface ActivityActions {
  startActivity: (typeId: string, label: string, icon: string, isDistanceBased: boolean) => void
  setTitle: (title: string) => void
  begin: () => void
  pause: () => void
  resume: () => void
  appendPoint: (point: RoutePoint) => void
  finish: () => void
  resetSession: () => void
}

export type ActivityStore = ActivityState & ActivityActions

const ROUTE_SIMPLIFY_TOLERANCE_M = 5

const INITIAL_STATE: ActivityState = {
  activitySessionId: '',
  activityType: null,
  activityLabel: '',
  activityIcon: '',
  isDistanceBased: false,
  title: '',
  mode: 'pre',
  isPaused: false,
  startMs: null,
  endMs: null,
  pauseStartMs: null,
  accumulatedPauseMs: 0,
  rawPoints: [],
  distanceKm: 0,
  currentPaceSecPerKm: null,
  draftSummary: null,
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      startActivity: (typeId, label, icon, isDistanceBased) => set({
        ...INITIAL_STATE,
        activitySessionId: crypto.randomUUID(),
        activityType: typeId,
        activityLabel: label,
        activityIcon: icon,
        isDistanceBased,
        title: label,
        mode: 'pre',
      }),

      setTitle: (title) => set({ title }),

      begin: () => set({ mode: 'active', startMs: Date.now() }),

      pause: () => set({ isPaused: true, pauseStartMs: Date.now() }),

      resume: () => set((s) => ({
        isPaused: false,
        pauseStartMs: null,
        accumulatedPauseMs: s.accumulatedPauseMs + (s.pauseStartMs ? Date.now() - s.pauseStartMs : 0),
      })),

      appendPoint: (point) => set((s) => {
        const rawPoints = [...s.rawPoints, point]
        const distanceKm = computeTotalDistanceKm(rawPoints)
        const activeMs = s.startMs ? Date.now() - s.startMs - s.accumulatedPauseMs : 0
        return {
          rawPoints,
          distanceKm,
          currentPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, activeMs / 1000) ?? null,
        }
      }),

      finish: () => {
        const s = get()
        const endMs = Date.now()
        const activeMs = (s.startMs ? endMs - s.startMs : 0) - s.accumulatedPauseMs
        const durationMin = Math.round((activeMs / 60000) * 10) / 10

        let draftSummary: ActivityDraftSummary = { durationMin }

        if (s.isDistanceBased && s.rawPoints.length >= 2) {
          const distanceKm = computeTotalDistanceKm(s.rawPoints)
          const simplified = simplifyRoute(s.rawPoints, ROUTE_SIMPLIFY_TOLERANCE_M)
          const { gainM, lossM } = computeElevationChange(s.rawPoints)
          draftSummary = {
            ...draftSummary,
            distanceKm: Math.round(distanceKm * 100) / 100,
            routePolyline: encodeRoute(simplified),
            splits: computeSplits(s.rawPoints),
            bestEfforts: computeBestEfforts(s.rawPoints),
            paceSeries: computePaceSeries(s.rawPoints),
            avgPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, activeMs / 1000) ?? undefined,
            elevationGainM: gainM,
            elevationLossM: lossM,
          }
        }

        set({ mode: 'done', endMs, draftSummary })
      },

      resetSession: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: 'ta_activity_state',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/stores/activity-store.ts
git commit -m "Add persisted activity tracking store"
```

---

## Task 6: `components/activity/activity-route-map.tsx` — Leaflet route map

**Files:**
- Create: `components/activity/activity-route-map.tsx`

- [ ] **Step 1: Implement the map component**

```tsx
'use client'

import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface LatLng {
  lat: number
  lng: number
}

interface ActivityRouteMapProps {
  points: LatLng[]
  className?: string
}

export function ActivityRouteMap({ points, className }: ActivityRouteMapProps) {
  if (points.length === 0) return null

  const positions: [number, number][] = points.map(p => [p.lat, p.lng])
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...positions.map(p => p[0])), Math.min(...positions.map(p => p[1]))],
    [Math.max(...positions.map(p => p[0])), Math.max(...positions.map(p => p[1]))],
  ]

  return (
    <div className={className}>
      <MapContainer bounds={bounds} boundsOptions={{ padding: [20, 20] }} className="h-full w-full rounded-xl" scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline positions={positions} pathOptions={{ color: 'var(--color-brand)', weight: 4 }} />
        <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
        <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
      </MapContainer>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

> **Note for consuming components (Tasks 9, 10, and Plan 3):** Leaflet
> accesses `window`/`document` at module-load time, which breaks Next.js
> SSR. Always import this component with `next/dynamic` and `ssr: false`:
> ```ts
> import dynamic from 'next/dynamic'
> const ActivityRouteMap = dynamic(
>   () => import('@/components/activity/activity-route-map').then(m => m.ActivityRouteMap),
>   { ssr: false },
> )
> ```

- [ ] **Step 3: Commit**

```bash
git add components/activity/activity-route-map.tsx
git commit -m "Add Leaflet route map component for activity tracking"
```

---

## Task 7: Trim `log-activity-sheet.tsx` to a type picker

**Files:**
- Modify: `components/workout/log-activity-sheet.tsx`
- Modify: `app/workout-select/workout-select-content.tsx`

- [ ] **Step 1: Replace the contents of `log-activity-sheet.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cachedFetch } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@/components/sync-provider'
import { getActivityIcon } from '@/lib/constants/activity-icons'
import { useActivityStore } from '@/lib/stores/activity-store'
import type { ActivityType } from '@/lib/types'

interface LogActivitySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogActivitySheet({ open, onOpenChange }: LogActivitySheetProps) {
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const router = useRouter()
  const startActivity = useActivityStore(s => s.startActivity)

  useEffect(() => {
    if (!open) return
    cachedFetch<{ activityTypes: ActivityType[] }>(
      'activity-types', '/api/activity-types', TTL_LONG,
      d => setActivityTypes(d?.activityTypes ?? []),
    ).catch(() => {})
  }, [open])

  function selectType(type: ActivityType) {
    startActivity(type.id, type.label, type.icon, type.isDistanceBased)
    onOpenChange(false)
    router.push('/activity')
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="mb-2">
          <SheetTitle className="text-left">Log Activity</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-5 gap-2 pb-4">
          {activityTypes.map(type => {
            const Icon = getActivityIcon(type.icon)
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => selectType(type)}
                className="flex flex-col items-center gap-1 rounded-xl border py-2.5 transition-all active:scale-95"
              >
                <Icon size={22} weight="regular" />
                <span className="text-[9px] font-medium leading-tight text-center">{type.label}</span>
              </button>
            )
          })}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Update the prop usage in `workout-select-content.tsx`**

The component no longer accepts an `onLogged` prop. In
`app/workout-select/workout-select-content.tsx`, find the
`<LogActivitySheet ... />` usage near the end of the file and confirm it
only passes `open` and `onOpenChange` (it currently does — no change needed
if so; remove an `onLogged` prop if present).

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add components/workout/log-activity-sheet.tsx app/workout-select/workout-select-content.tsx
git commit -m "Trim log-activity-sheet to a type picker that starts a live activity"
```

---

## Task 8: `/activity` route, orchestrator and pre-activity screen

**Files:**
- Create: `app/activity/page.tsx`
- Create: `components/activity/activity-screen.tsx`
- Create: `components/activity/pre-activity-screen.tsx`

- [ ] **Step 1: Create `app/activity/page.tsx`**

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ActivityScreen } from "@/components/activity/activity-screen";

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <div className="h-screen w-full">
      <ActivityScreen />
    </div>
  );
}
```

- [ ] **Step 2: Create `components/activity/pre-activity-screen.tsx`**

```tsx
'use client'

import { getActivityIcon } from '@/lib/constants/activity-icons'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useActivityStore } from '@/lib/stores/activity-store'

export function PreActivityScreen() {
  const { activityIcon, activityLabel, isDistanceBased, title, setTitle, begin } = useActivityStore()
  const Icon = getActivityIcon(activityIcon)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-2">
        <Icon size={48} weight="fill" style={{ color: 'var(--color-brand)' }} />
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{activityLabel}</span>
      </div>

      <div className="w-full max-w-xs space-y-1.5">
        <Label htmlFor="activity-title">Title</Label>
        <Input id="activity-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Activity name" />
      </div>

      {isDistanceBased && (
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Your route, distance and pace will be tracked using GPS, including
          while your screen is off.
        </p>
      )}

      <button
        type="button"
        onClick={begin}
        className="w-full max-w-xs rounded-xl py-3.5 text-sm font-bold transition hover:opacity-90 active:scale-95"
        style={{ background: 'var(--color-brand)', color: '#000' }}
      >
        Start
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `components/activity/activity-screen.tsx`**

```tsx
'use client'

import { useActivityStore } from '@/lib/stores/activity-store'
import { PreActivityScreen } from './pre-activity-screen'
import { ActiveActivityScreen } from './active-activity-screen'
import { DoneActivityScreen } from './done-activity-screen'

export function ActivityScreen() {
  const mode = useActivityStore(s => s.mode)

  if (mode === 'active') return <ActiveActivityScreen />
  if (mode === 'done') return <DoneActivityScreen />
  return <PreActivityScreen />
}
```

This references `ActiveActivityScreen` and `DoneActivityScreen`, created in
Tasks 9 and 10 — the project will not type-check until those exist, so defer
the type-check step to the end of Task 10.

- [ ] **Step 4: Commit**

```bash
git add app/activity/page.tsx components/activity/activity-screen.tsx components/activity/pre-activity-screen.tsx
git commit -m "Add activity route, orchestrator and pre-activity screen"
```

---

## Task 9: `components/activity/active-activity-screen.tsx`

**Files:**
- Create: `components/activity/active-activity-screen.tsx`

- [ ] **Step 1: Implement the live tracking screen**

```tsx
'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react'
import { useActivityStore } from '@/lib/stores/activity-store'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { formatTime } from '@/components/workout/utils'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

export function ActiveActivityScreen() {
  const {
    activityLabel, title, isDistanceBased, isPaused,
    startMs, accumulatedPauseMs, pauseStartMs,
    rawPoints, distanceKm, currentPaceSecPerKm,
    pause, resume, appendPoint, finish,
  } = useActivityStore()

  const [elapsedSec, setElapsedSec] = useState(0)

  // Elapsed time ticker — accounts for accumulated pause time.
  useEffect(() => {
    if (!startMs) return
    const tick = () => {
      const pauseMs = accumulatedPauseMs + (isPaused && pauseStartMs ? Date.now() - pauseStartMs : 0)
      setElapsedSec(Math.floor((Date.now() - startMs - pauseMs) / 1000))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startMs, accumulatedPauseMs, isPaused, pauseStartMs])

  // GPS watcher — only for distance-based activities, only while not paused.
  useEffect(() => {
    if (!isDistanceBased || isPaused) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useActivityStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => {
      cancelled = true
      watcher?.stop()
    }
    // appendPoint is stable (zustand action), read via getState() to avoid re-subscribing the watcher on every point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDistanceBased, isPaused])

  const paceLabel = currentPaceSecPerKm
    ? `${Math.floor(currentPaceSecPerKm / 60)}:${String(Math.round(currentPaceSecPerKm % 60)).padStart(2, '0')} /km`
    : '--:-- /km'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title || activityLabel}</span>
        <span className="text-6xl font-bold tabular-nums">{formatTime(elapsedSec)}</span>

        {isDistanceBased && (
          <div className="flex w-full max-w-xs justify-around text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">km</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{paceLabel}</p>
              <p className="text-xs text-muted-foreground">pace</p>
            </div>
          </div>
        )}

        {isDistanceBased && rawPoints.length > 1 && (
          <ActivityRouteMap points={rawPoints} className="h-48 w-full max-w-xs" />
        )}
      </div>

      <div className="flex gap-3 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={isPaused ? resume : pause}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-3.5 text-sm font-bold transition active:scale-95"
        >
          {isPaused ? <PlayIcon size={18} weight="fill" /> : <PauseIcon size={18} weight="fill" />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={finish}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition active:scale-95"
          style={{ background: 'var(--color-brand)', color: '#000' }}
        >
          <StopIcon size={18} weight="fill" />
          Finish
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: errors only about the still-missing `DoneActivityScreen` import in
`activity-screen.tsx` (resolved in Task 10).

- [ ] **Step 3: Commit**

```bash
git add components/activity/active-activity-screen.tsx
git commit -m "Add live activity tracking screen with timer, GPS and pace"
```

---

## Task 10: `components/activity/done-activity-screen.tsx`

**Files:**
- Create: `components/activity/done-activity-screen.tsx`

- [ ] **Step 1: Implement the done/summary screen**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { useActivityStore } from '@/lib/stores/activity-store'
import { decodeRoute } from '@/lib/activity/route-encoding'
import { todayInTz } from '@/lib/date-utils'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

function msToHHMM(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function DoneActivityScreen() {
  const router = useRouter()
  const { activityType, title, activityLabel, startMs, endMs, draftSummary, resetSession } = useActivityStore()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  if (!draftSummary) return null

  const routePoints = draftSummary.routePolyline ? decodeRoute(draftSummary.routePolyline) : []

  async function handleSave() {
    if (!activityType || !startMs || !endMs || !draftSummary) return
    setSaving(true)
    try {
      const res = await fetch('/api/activity-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: todayInTz(),
          activityType,
          title: title.trim() || activityLabel,
          startTime: msToHHMM(startMs),
          endTime: msToHHMM(endMs),
          durationMin: draftSummary.durationMin,
          distanceKm: draftSummary.distanceKm,
          routePolyline: draftSummary.routePolyline,
          splits: draftSummary.splits,
          bestEfforts: draftSummary.bestEfforts,
          paceSeries: draftSummary.paceSeries,
          avgPaceSecPerKm: draftSummary.avgPaceSecPerKm,
          elevationGainM: draftSummary.elevationGainM,
          elevationLossM: draftSummary.elevationLossM,
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Activity saved')
      resetSession()
      router.push('/workout-select')
    } catch {
      toast.error('Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    resetSession()
    router.push('/workout-select')
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <h1 className="mb-4 text-xl font-bold">{title || activityLabel}</h1>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted px-2 py-3">
          <p className="text-lg font-bold tabular-nums">{draftSummary.durationMin.toFixed(1)}</p>
          <p className="text-[10px] text-muted-foreground">min</p>
        </div>
        {draftSummary.distanceKm != null && (
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.distanceKm.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">km</p>
          </div>
        )}
        {draftSummary.avgPaceSecPerKm != null && (
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">
              {Math.floor(draftSummary.avgPaceSecPerKm / 60)}:{String(Math.round(draftSummary.avgPaceSecPerKm % 60)).padStart(2, '0')}
            </p>
            <p className="text-[10px] text-muted-foreground">avg /km</p>
          </div>
        )}
      </div>

      {(draftSummary.elevationGainM != null || draftSummary.elevationLossM != null) && (
        <div className="mb-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.elevationGainM ?? 0} m</p>
            <p className="text-[10px] text-muted-foreground">elevation gain</p>
          </div>
          <div className="rounded-xl bg-muted px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.elevationLossM ?? 0} m</p>
            <p className="text-[10px] text-muted-foreground">elevation loss</p>
          </div>
        </div>
      )}

      {routePoints.length > 1 && (
        <ActivityRouteMap points={routePoints} className="mb-4 h-56 w-full" />
      )}

      {draftSummary.splits && draftSummary.splits.length > 0 && (
        <div className="mb-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Splits</p>
          {draftSummary.splits.map(s => (
            <div key={s.km} className="flex justify-between rounded-lg bg-muted px-3 py-1.5 text-sm">
              <span>Km {s.km}</span>
              <span className="tabular-nums">{Math.floor(s.paceSec / 60)}:{String(Math.round(s.paceSec % 60)).padStart(2, '0')} /km</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-1.5">
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} />
      </div>

      <div className="mt-auto flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={saving}
          className="flex-1 rounded-xl border py-3.5 text-sm font-bold transition active:scale-95 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-xl py-3.5 text-sm font-bold transition active:scale-95 disabled:opacity-50"
          style={{ background: 'var(--color-brand)', color: '#000' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run a full type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no errors. `activity-screen.tsx` (Task 8) now resolves
`ActiveActivityScreen` and `DoneActivityScreen`.

- [ ] **Step 3: Run lint**

Run: `pnpm lint`

Expected: no errors in the new `components/activity/` or `lib/activity/`
files. Fix any issues (e.g. unused imports) before continuing.

- [ ] **Step 4: Commit**

```bash
git add components/activity/done-activity-screen.tsx
git commit -m "Add activity done screen with summary, map, splits and save/discard"
```

---

## Task 11: Manual end-to-end check (browser, geolocation fallback)

**Files:** none (verification only)

- [ ] **Step 1: Run Plan 1's migration if not already applied**

Run: `node scripts/local-db/migrate.js`

Expected: `059_activity_route_data.sql` is applied (from Plan 1). If Plan 1
hasn't been implemented yet, this task cannot be completed — implement Plan 1
first.

- [ ] **Step 2: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 3: Walk through a non-distance activity (no GPS)**

1. Sign in as `test@local.dev` / `testpass123`.
2. Go to the Workout tab, tap "Log Activity".
3. Select "Yoga" (or another non-distance type).
4. Confirm you land on `/activity` showing the Yoga icon, an editable title
   pre-filled with "Yoga", and a "Start" button — no GPS permission note.
5. Tap "Start". Confirm the timer begins counting up from `0:00`.
6. Tap "Pause", wait ~3 seconds, tap "Resume" — confirm the displayed time
   does not include the paused interval (it should not jump backwards or
   double-count).
7. Tap "Finish". Confirm you land on a summary screen showing duration only
   (no distance/pace/map), with a notes field and Save/Discard buttons.
8. Tap "Save". Confirm a "Activity saved" toast appears and you're returned
   to the Workout tab.

- [ ] **Step 4: Verify the saved row**

Run:
```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
  -c "SELECT title, activity_type, duration_min, route_polyline FROM activity_logs ORDER BY created_at DESC LIMIT 1;"
```

Expected: one row with `activity_type = 'yoga'`, `duration_min` roughly
matching the time you waited, and `route_polyline` is `NULL`.

- [ ] **Step 5: Walk through a distance-based activity (browser geolocation)**

1. In the browser, tap "Log Activity" → "Run".
2. Confirm `/activity` shows the GPS-tracking note for distance-based types.
3. Tap "Start". The browser will prompt for location permission — allow it.
   (In a headless/sandboxed browser without location support, `rawPoints`
   will simply stay empty — the screen should still render without errors,
   just with `0.00 km` and `--:-- /km`.)
4. Tap "Finish" after a few seconds.
5. Confirm the summary screen renders without errors. If location data was
   available, confirm the map, distance, pace and splits render; if not,
   confirm the screen still renders cleanly with `distanceKm` fields hidden
   (since `draftSummary.distanceKm` will be `undefined` when `rawPoints.length < 2`).
6. Tap "Discard". Confirm no row is created:

```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
  -c "SELECT count(*) FROM activity_logs WHERE activity_type = 'run' AND created_at > now() - interval '5 minutes';"
```

Expected: `0`.

No commit for this task — verification only. Note in the final summary to
the user that real GPS background-tracking (screen-off) can only be verified
on a physical Android device with `npx cap sync android` and a release/debug
build — this is out of scope for the sandboxed web environment.

---

## Self-Review Notes

- **Spec coverage:** Section 1 (entry point/flow) — Task 7 (trimmed picker)
  and Task 8 (pre screen). Section 3 (GPS/background tracking) — Tasks 2, 4.
  Section 4 (state + components) — Tasks 5, 6, 8, 9, 10. Section 2's
  `lib/activity/*` consumers are wired in Task 5's `finish()`. History/
  calendar integration (Sections 5-6) is Plan 3.
- **Type consistency:** `ActivityDraftSummary` (Task 3) fields
  (`distanceKm`, `routePolyline`, `splits`, `bestEfforts`, `paceSeries`,
  `avgPaceSecPerKm`, `elevationGainM`, `elevationLossM`, `durationMin`) match
  both the `activity-store.ts` `finish()` action (Task 5) and the POST body
  built in `done-activity-screen.tsx` (Task 10), which match the Zod schema
  and Drizzle columns from Plan 1 Task 6. `Split`/`PacePoint` types are
  imported from `lib/activity/activity-metrics.ts` (Plan 1 Task 5) — same
  shape (`{ km, paceSec }` / `{ tSec, paceSec }`).
- **`activityIcon` field:** included in `activity-store.ts` from the start
  (Task 5) — `startActivity(typeId, label, icon, isDistanceBased)` stores the
  Phosphor icon name so `pre-activity-screen.tsx` (Task 8) can render it via
  `getActivityIcon` without re-fetching `activity-types`. `log-activity-sheet.tsx`
  (Task 7) passes `type.icon` from the already-fetched `ActivityType`.
