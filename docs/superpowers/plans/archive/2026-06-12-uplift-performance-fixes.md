# Performance Uplift — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address 6 performance findings from the 2026-06-12 deep review: unconditional geolocation/weather fetches on every page load, O(n²) GPS distance recomputation during activity tracking, unthrottled Leaflet map re-renders, unbounded `localStorage` writes during GPS tracking, an overfetching DB call on the workout-data hot path, and an eagerly-bundled chart.js dependency on the pre-workout screen.

**Architecture:** This is a backlog of **6 independent tasks** — pick any one, implement, verify, and commit on its own. Tasks 1–4 are all in the activity/weather/background-rendering area but touch different files and don't depend on each other. Tasks 5 and 6 are unrelated workout-screen hot-path fixes.

**Note on overlap with the Security plan:** Task 5 below and Task 1 of `2026-06-12-uplift-security-fixes.md` both add new methods near `getDayLog` in `lib/data/repository.ts` / `lib/data/postgres/adapter.ts`. If that plan's Task 1 has already been applied, insert this plan's `getDayExerciseNames` method using `getDayLog`'s new neighbours as the anchor rather than the exact line numbers shown here — the diff is additive either way.

**Tech Stack:** Next.js 15, React 19, Zustand (`persist`/`createJSONStorage`), Drizzle ORM, react-leaflet, `next/dynamic`.

**Prerequisite:** Local dev Postgres must be running (`pnpm db:local`) for Task 5's DB verification. Tasks 1–4 and 6 are frontend-only and verified via `pnpm dev` in a browser.

---

### Task 1: Gate `useWeather` behind `enabled` and dedup concurrent fetches

**Problem:** `DynamicBackground` (rendered on every page) calls `useWeather()` unconditionally — *before* it computes whether the dynamic background is actually active for the current section. Since the feature defaults to **off** (`enabled: false` in `useBackgroundSettingsStore`), every page load on every screen still calls `getDeviceLocation()` (which prompts for geolocation permission on native) and `fetchWeatherSnapshot()`, even though `DynamicBackground` then immediately returns `null`. Additionally, when both `DynamicBackground` and `WeatherChip` are mounted at once (Home screen, background active), both call `useWeather()` independently and can both kick off a network fetch for the same coordinates.

**Fix:** Add an `enabled` parameter to `useWeather` (default `true`, so `WeatherChip` — which has no gating concept — is unaffected). `DynamicBackground` computes `isActive` first and passes it in. Add a module-level in-flight-fetch dedup keyed by rounded coordinates.

**Files:**
- Modify: `lib/weather/use-weather.ts`
- Modify: `components/dynamic-background/dynamic-background.tsx:45-56`

- [ ] **Step 1: Add `enabled` param and in-flight dedup to `useWeather`**

Current `lib/weather/use-weather.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { getDeviceLocation } from '@/lib/location'
import { fetchWeatherSnapshot } from './open-meteo'
import type { WeatherSnapshot } from './types'

const CACHE_KEY = 'ta_weather_cache'
const CACHE_TTL_MS = 30 * 60 * 1000

function readCache(): WeatherSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as WeatherSnapshot) : null
  } catch {
    return null
  }
}

function writeCache(snapshot: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // localStorage unavailable or full — skip caching
  }
}

export function useWeather() {
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => readCache())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const cached = readCache()
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setSnapshot(cached)
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      const device = await getDeviceLocation()
      const coords = device ?? manualLocation
      if (!coords) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const fresh = await fetchWeatherSnapshot(coords)
        if (!cancelled) {
          writeCache(fresh)
          setSnapshot(fresh)
        }
      } catch {
        // keep showing the stale/cached snapshot if the fetch fails
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [manualLocation])

  return { snapshot, loading }
}
```

Replace it with:

```ts
'use client'

import { useEffect, useState } from 'react'
import { useBackgroundSettingsStore } from '@/lib/stores/background-settings-store'
import { getDeviceLocation } from '@/lib/location'
import { fetchWeatherSnapshot } from './open-meteo'
import type { LocationCoords, WeatherSnapshot } from './types'

const CACHE_KEY = 'ta_weather_cache'
const CACHE_TTL_MS = 30 * 60 * 1000

function readCache(): WeatherSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as WeatherSnapshot) : null
  } catch {
    return null
  }
}

function writeCache(snapshot: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // localStorage unavailable or full — skip caching
  }
}

// Dedup concurrent fetches for the same coordinates — DynamicBackground and
// WeatherChip can both be mounted on Home and request weather at once.
let inflightKey: string | null = null
let inflightFetch: Promise<WeatherSnapshot> | null = null

function fetchWeatherSnapshotShared(coords: LocationCoords): Promise<WeatherSnapshot> {
  const key = `${coords.lat.toFixed(2)},${coords.lon.toFixed(2)}`
  if (inflightFetch && inflightKey === key) return inflightFetch
  inflightKey = key
  inflightFetch = fetchWeatherSnapshot(coords).finally(() => {
    inflightFetch = null
    inflightKey = null
  })
  return inflightFetch
}

export function useWeather(enabled = true) {
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const [snapshot, setSnapshot] = useState<WeatherSnapshot | null>(() => readCache())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const cached = readCache()
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setSnapshot(cached)
      return
    }

    let cancelled = false
    setLoading(true)

    async function load() {
      const device = await getDeviceLocation()
      const coords = device ?? manualLocation
      if (!coords) {
        if (!cancelled) setLoading(false)
        return
      }
      try {
        const fresh = await fetchWeatherSnapshotShared(coords)
        if (!cancelled) {
          writeCache(fresh)
          setSnapshot(fresh)
        }
      } catch {
        // keep showing the stale/cached snapshot if the fetch fails
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [manualLocation, enabled])

  return { snapshot, loading }
}
```

- [ ] **Step 2: Reorder `DynamicBackground` so `isActive` is computed before `useWeather`**

Current `components/dynamic-background/dynamic-background.tsx` (lines 45-90):

```ts
export function DynamicBackground() {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const enabled = useBackgroundSettingsStore((s) => s.enabled)
  const sections = useBackgroundSettingsStore((s) => s.sections)
  const pathname = usePathname()
  const { snapshot } = useWeather()

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const tick = () => setNow(new Date())
    const interval = setInterval(() => {
      if (!document.hidden) tick()
    }, RECOMPUTE_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [mounted])

  const section = pathnameToSection(pathname)
  const isActive = mounted && enabled && sections[section]

  useEffect(() => {
    if (isActive) {
      document.documentElement.style.setProperty('--page-bg', 'transparent')
    } else {
      document.documentElement.style.removeProperty('--page-bg')
    }
    return () => {
      document.documentElement.style.removeProperty('--page-bg')
    }
  }, [isActive])

  if (!isActive) return null
```

Replace with (moves `section`/`isActive` above the `useWeather` call and passes `isActive` in):

```ts
export function DynamicBackground() {
  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const enabled = useBackgroundSettingsStore((s) => s.enabled)
  const sections = useBackgroundSettingsStore((s) => s.sections)
  const pathname = usePathname()

  const section = pathnameToSection(pathname)
  const isActive = mounted && enabled && sections[section]

  const { snapshot } = useWeather(isActive)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    const tick = () => setNow(new Date())
    const interval = setInterval(() => {
      if (!document.hidden) tick()
    }, RECOMPUTE_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [mounted])

  useEffect(() => {
    if (isActive) {
      document.documentElement.style.setProperty('--page-bg', 'transparent')
    } else {
      document.documentElement.style.removeProperty('--page-bg')
    }
    return () => {
      document.documentElement.style.removeProperty('--page-bg')
    }
  }, [isActive])

  if (!isActive) return null
```

The rest of the function (from `const condition: WeatherCondition = ...` onward) is unchanged.

- [ ] **Step 3: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors. `WeatherChip` calls `useWeather()` with no argument, so `enabled` defaults to `true` and its behaviour is unchanged.

- [ ] **Step 4: Verify in the browser**

Run `pnpm dev` and open `http://localhost:3000` in a desktop browser with devtools open (Network tab, filter on `open-meteo.com`):

1. With the dynamic background **disabled** (default — Profile → Theme & Appearance → background toggle off), navigate between Home / Health / Workout / Nutrition / More. Expected: **no** `api.open-meteo.com` request fires on any page, and no geolocation permission prompt appears.
2. Enable the dynamic background for "Home" only (leave other sections off). Navigate to Home — expected: one `open-meteo.com` request (shared between `DynamicBackground` and `WeatherChip` if both render). Navigate to Health — expected: **no** new `open-meteo.com` request (background inactive for that section, and `WeatherChip` isn't rendered there).
3. Re-enable for all sections and confirm the sky/weather background still renders correctly on Home, matching pre-change appearance.

- [ ] **Step 5: Commit**

```bash
git add lib/weather/use-weather.ts components/dynamic-background/dynamic-background.tsx
git commit -m "Gate useWeather behind dynamic-background activity and dedup concurrent fetches"
```

---

### Task 2: Incremental distance calculation in `appendPoint`

**Problem:** `lib/activity/activity-metrics.ts`'s `computeTotalDistanceKm(points)` calls `cumulativeDistancesKm(points)`, which rebuilds the **entire** cumulative-distance array from scratch — O(n). `lib/stores/activity-store.ts`'s `appendPoint` calls `computeTotalDistanceKm(rawPoints)` on every GPS point (every ~5m of movement via the native `distanceFilter`), making the whole tracking session O(n²) in the number of recorded points. A 10km run at one point every ~10m is ~1000 points — by the end, each `appendPoint` call is re-summing ~1000 haversine distances.

**Fix:** `appendPoint` already has the previous total (`s.distanceKm`) and the new point — just add the haversine distance between the last point and the new one. `computeTotalDistanceKm` remains as-is for the one-time `finish()` recompute (used for the final rounded summary), and `haversineDistanceKm` is already exported from `activity-metrics.ts`.

**Files:**
- Modify: `lib/stores/activity-store.ts:1-13` (import) and `:99-108` (`appendPoint`)

- [ ] **Step 1: Import `haversineDistanceKm`**

Current import block (lines 6-13):

```ts
import {
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeAvgPaceSecPerKm,
} from '@/lib/activity/activity-metrics'
```

Change to:

```ts
import {
  haversineDistanceKm,
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeAvgPaceSecPerKm,
} from '@/lib/activity/activity-metrics'
```

- [ ] **Step 2: Make `appendPoint` incremental**

Current (lines 99-108):

```ts
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
```

Change to:

```ts
      appendPoint: (point) => set((s) => {
        const rawPoints = [...s.rawPoints, point]
        const prevPoint = s.rawPoints[s.rawPoints.length - 1]
        const distanceKm = prevPoint ? s.distanceKm + haversineDistanceKm(prevPoint, point) : s.distanceKm
        const activeMs = s.startMs ? Date.now() - s.startMs - s.accumulatedPauseMs : 0
        return {
          rawPoints,
          distanceKm,
          currentPaceSecPerKm: computeAvgPaceSecPerKm(distanceKm, activeMs / 1000) ?? null,
        }
      }),
```

`computeTotalDistanceKm` is still used in `finish()` (recomputes the final rounded distance once from `s.rawPoints`) — its import stays.

- [ ] **Step 3: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors, no unused-import warnings (`computeTotalDistanceKm` is still used in `finish()`).

- [ ] **Step 4: Verify in the browser**

Run `pnpm dev`, log in as `test@local.dev` / `testpass123`, start a distance-based activity (e.g. Run) from `/workout-select` → Activity. If testing on desktop without GPS, browser geolocation will return a fixed point repeatedly — to exercise `appendPoint` with multiple distinct points, use Chrome devtools' Sensors panel (⋮ → More tools → Sensors) to override geolocation and manually change the lat/lng a few times while the activity is active. Expected: the distance readout updates incrementally and matches what it showed before this change for the same sequence of points (spot-check: two points ~100m apart should add ~0.1 km).

- [ ] **Step 5: Commit**

```bash
git add lib/stores/activity-store.ts
git commit -m "Compute activity distance incrementally instead of O(n^2) per GPS point"
```

---

### Task 3: Throttle and memoize `ActivityRouteMap`, add an offline fallback

**Problem:** `components/activity/activity-route-map.tsx` recomputes `positions` and `bounds` via `Array.map`/`Math.min`/`Math.max` over the **entire** `points` array on every render, and re-renders the whole `MapContainer`/`Polyline` tree every time `rawPoints` grows (every GPS point, i.e. every few seconds during an active run) — each re-render causes Leaflet to recompute bounds and redraw the polyline. Separately, the map requires network access to load OpenStreetMap tiles; with no connectivity it renders a blank/grey tile grid with no explanation.

**Fix:** Throttle the points actually passed to Leaflet to once every 2 seconds via a small internal `displayPoints` state, memoize the derived `positions`/`bounds`, and render a text fallback instead of the tile map when `navigator.onLine` is `false`.

**Files:**
- Modify: `components/activity/activity-route-map.tsx`

- [ ] **Step 1: Rewrite the component**

Current (full file):

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

Replace with:

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'

interface LatLng {
  lat: number
  lng: number
}

interface ActivityRouteMapProps {
  points: LatLng[]
  className?: string
}

const THROTTLE_MS = 2000

function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

export function ActivityRouteMap({ points, className }: ActivityRouteMapProps) {
  const [displayPoints, setDisplayPoints] = useState(points)
  const lastUpdateRef = useRef(0)
  const online = useIsOnline()

  useEffect(() => {
    const elapsed = Date.now() - lastUpdateRef.current
    if (elapsed >= THROTTLE_MS) {
      lastUpdateRef.current = Date.now()
      setDisplayPoints(points)
      return
    }
    const timeout = setTimeout(() => {
      lastUpdateRef.current = Date.now()
      setDisplayPoints(points)
    }, THROTTLE_MS - elapsed)
    return () => clearTimeout(timeout)
  }, [points])

  const positions = useMemo<[number, number][]>(
    () => displayPoints.map(p => [p.lat, p.lng]),
    [displayPoints],
  )

  const bounds = useMemo<[[number, number], [number, number]]>(() => [
    [Math.min(...positions.map(p => p[0])), Math.min(...positions.map(p => p[1]))],
    [Math.max(...positions.map(p => p[0])), Math.max(...positions.map(p => p[1]))],
  ], [positions])

  if (displayPoints.length === 0) return null

  if (!online) {
    return (
      <div className={cn('flex items-center justify-center rounded-xl bg-muted/60 border border-border text-center px-4', className)}>
        <p className="text-xs text-muted-foreground">Map unavailable offline — {displayPoints.length} GPS points recorded</p>
      </div>
    )
  }

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

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 3: Verify in the browser**

Run `pnpm dev`, log in, and start a distance-based activity. Using Chrome devtools' Sensors panel to move the simulated location every second or two:

1. Confirm the map still appears once at least 2 points exist, and the polyline/markers update — but visibly only every ~2 seconds rather than on every simulated GPS tick.
2. Open devtools Network tab, set throttling to "Offline", and reload the done/active screen with `routePoints.length > 1`. Expected: instead of a blank grey map, you see "Map unavailable offline — N GPS points recorded".
3. Set Network back to "Online" / "No throttling" and confirm the map renders normally again on next mount.

- [ ] **Step 4: Commit**

```bash
git add components/activity/activity-route-map.tsx
git commit -m "Throttle and memoize ActivityRouteMap re-renders, add offline fallback"
```

---

### Task 4: Debounce `ta_activity_state` localStorage persistence

**Problem:** `useActivityStore` (`lib/stores/activity-store.ts`) is wrapped in zustand's `persist` middleware with the default synchronous `localStorage` storage. Every `set()` call — including every `appendPoint` during GPS tracking (every ~5m / few seconds) — triggers `JSON.stringify` of the **entire** store state (including the growing `rawPoints` array) and a synchronous `localStorage.setItem`. For a long run, `rawPoints` can grow to hundreds of entries, making each of these writes progressively more expensive and blocking the main thread on every GPS update.

**Fix:** Wrap `localStorage` in a small debounced storage adapter so writes are coalesced to at most once every 2 seconds, while always persisting the *latest* state when the debounce fires.

**Files:**
- Modify: `lib/stores/activity-store.ts:140-145`

- [ ] **Step 1: Add a debounced storage adapter and use it**

Current persist config (end of file):

```ts
    {
      name: 'ta_activity_state',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
```

Add a helper above `export const useActivityStore = create<ActivityStore>()(` (after the `INITIAL_STATE` constant):

```ts
const PERSIST_DEBOUNCE_MS = 2000

// Coalesces writes during GPS tracking (appendPoint fires every few seconds)
// to at most one localStorage.setItem per PERSIST_DEBOUNCE_MS, always
// flushing the latest state when the timer fires.
function debouncedLocalStorage(delayMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null
  let pending: { name: string; value: string } | null = null

  return {
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => {
      pending = { name, value }
      if (timeout) return
      timeout = setTimeout(() => {
        if (pending) localStorage.setItem(pending.name, pending.value)
        pending = null
        timeout = null
      }, delayMs)
    },
    removeItem: (name: string) => localStorage.removeItem(name),
  }
}
```

Then change the persist config to:

```ts
    {
      name: 'ta_activity_state',
      storage: createJSONStorage(() => debouncedLocalStorage(PERSIST_DEBOUNCE_MS)),
    }
  )
)
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors. `createJSONStorage` accepts any object with synchronous `getItem`/`setItem`/`removeItem`, which `debouncedLocalStorage` provides.

- [ ] **Step 3: Verify in the browser**

Run `pnpm dev`, open devtools → Application → Local Storage, log in, and start an activity. Move the simulated GPS location a few times in quick succession (faster than 2s apart). Expected: the `ta_activity_state` entry updates roughly every 2 seconds (not on every point), and after the activity finishes/discards, the final state is still correctly persisted (refresh the page mid-activity and confirm `rawPoints`/`distanceKm` survive — allow ~2s after the last point before refreshing).

- [ ] **Step 4: Commit**

```bash
git add lib/stores/activity-store.ts
git commit -m "Debounce ta_activity_state localStorage writes during GPS tracking"
```

---

### Task 5: Replace `getDayLog` with a lighter `getDayExerciseNames` in the workout-data hot path

**Problem:** `app/api/workout-data/route.ts` calls `repo.getDayLog(userId, todayStr...)` purely to build a `Set` of `(sessionId, exerciseName)` pairs for "already logged today" checks. `getDayLog` → `buildWorkoutSessions` runs **3 queries** (workout sessions, then all their exercise logs, then all those exercise logs' set rows) and builds the full nested `WorkoutSession[]` tree with sets — all of which is discarded except `sessionId` and `exerciseName`. This runs on every load of the pre-workout screen.

**Fix:** Add a `getDayExerciseNames` repository method that does a single join query returning only `{ sessionId, exerciseName }` pairs, and use it in place of `getDayLog` for this purpose.

**Files:**
- Modify: `lib/data/repository.ts:112` (add method declaration after `getDayLog`)
- Modify: `lib/data/postgres/adapter.ts:1217-1230` (add method implementation after `getDayLog`)
- Modify: `app/api/workout-data/route.ts:122-135`

- [ ] **Step 1: Add the method to the `WorkoutRepository` interface**

In `lib/data/repository.ts`, `getDayLog` is declared as:

```ts
  getDayLog(userId: string, date: string): Promise<WorkoutSession[]>
```

Add directly after it:

```ts
  getDayLog(userId: string, date: string): Promise<WorkoutSession[]>
  // Lightweight alternative to getDayLog for "already logged today" checks —
  // single join, no nested exercises/sets.
  getDayExerciseNames(userId: string, date: string): Promise<{ sessionId?: string; exerciseName: string }[]>
```

- [ ] **Step 2: Implement it in the Postgres adapter**

In `lib/data/postgres/adapter.ts`, `getDayLog` (lines 1217-1229) is:

```ts
  async getDayLog(userId: string, date: string): Promise<WorkoutSession[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d)
    const to   = aestMidnight(y, m, d + 1)
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }
```

Add directly after it:

```ts
  async getDayLog(userId: string, date: string): Promise<WorkoutSession[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d)
    const to   = aestMidnight(y, m, d + 1)
    const wsRows = await this.db.select().from(s.workoutSessions)
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))
      .orderBy(asc(s.workoutSessions.startedAt))
    return this.buildWorkoutSessions(wsRows)
  }

  async getDayExerciseNames(userId: string, date: string): Promise<{ sessionId?: string; exerciseName: string }[]> {
    const [y, m, d] = date.split('/').map(Number)
    const from = aestMidnight(y, m, d)
    const to   = aestMidnight(y, m, d + 1)
    const rows = await this.db.select({
      sessionId: s.workoutSessions.sessionId,
      exerciseName: s.exerciseLogs.exerciseName,
    })
      .from(s.exerciseLogs)
      .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, from),
        lt(s.workoutSessions.startedAt, to),
      ))
    return rows.map(r => ({ sessionId: r.sessionId ?? undefined, exerciseName: r.exerciseName }))
  }
```

- [ ] **Step 3: Use it in `workout-data/route.ts`**

Current (lines 122-135):

```ts
  const [allPhases, lastLogs, todaySessions] = await Promise.all([
    isAutomatic ? repo.listProgramPhases(program.id) : Promise.resolve([] as ProgramPhase[]),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getDayLog(userId, todayStr.replace(/-/g, '/')),
  ]);

  // Only count an exercise as "done today" if it was logged as part of *this* program
  // session — exercises shared between sessions (e.g. Tricep Cable Combo in both Push
  // and Upper) shouldn't show as completed here just because they were done elsewhere today.
  const loggedTodayInThisSession = new Set(
    todaySessions
      .filter(ws => ws.sessionId === programSession.id)
      .flatMap(ws => ws.exercises.map(e => e.exerciseName)),
  );
```

Change to:

```ts
  const [allPhases, lastLogs, todayExercises] = await Promise.all([
    isAutomatic ? repo.listProgramPhases(program.id) : Promise.resolve([] as ProgramPhase[]),
    repo.getLastExerciseLogsBatch(userId, exerciseNames),
    repo.getDayExerciseNames(userId, todayStr.replace(/-/g, '/')),
  ]);

  // Only count an exercise as "done today" if it was logged as part of *this* program
  // session — exercises shared between sessions (e.g. Tricep Cable Combo in both Push
  // and Upper) shouldn't show as completed here just because they were done elsewhere today.
  const loggedTodayInThisSession = new Set(
    todayExercises
      .filter(e => e.sessionId === programSession.id)
      .map(e => e.exerciseName),
  );
```

`todaySessions`/`todayExercises` is not referenced anywhere else in this file (verified — `getDayLog` was only used for this one derivation here).

- [ ] **Step 4: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 5: Verify against the local dev DB**

Run `pnpm dev`, log in as `test@local.dev` / `testpass123`, open the pre-workout screen for a session, log a set for one exercise, then return to the pre-workout screen for the **same session**. Expected: that exercise now shows as "done today" (same behaviour as before this change). Then check a **different** session that shares an exercise name with the one you just logged — expected: that exercise does **not** show as done today in the other session (the per-session scoping from session 95 is preserved).

Optionally confirm the query directly:
```bash
set -a && source .env.local && set +a
psql "$DATABASE_URL" -c "
  SELECT ws.session_id, el.exercise_name
  FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
  WHERE ws.user_id = (SELECT id FROM users WHERE email = 'test@local.dev')
    AND ws.started_at >= date_trunc('day', now() AT TIME ZONE 'Australia/Brisbane') AT TIME ZONE 'Australia/Brisbane';
"
```
Expected: rows match what `getDayExerciseNames` returns for today.

- [ ] **Step 6: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts app/api/workout-data/route.ts
git commit -m "Replace getDayLog with lighter getDayExerciseNames on workout-data hot path"
```

---

### Task 6: Lazy-load `ExerciseStatsSheet` (and its chart.js dependency) via `next/dynamic`

**Problem:** `components/workout/pre-workout-screen.tsx` statically imports `ExerciseStatsSheet`, which statically imports `SparklineChart` (`components/ui/sparkline-chart`, chart.js + react-chartjs-2). This means chart.js is bundled into the initial pre-workout screen chunk even though the stats sheet is only opened when the user taps an exercise to view its history — chart.js is only actually needed at that point. `components/workout/exercise-summary-screen.tsx` already establishes the lazy pattern for `SparklineChart` via `next/dynamic` — apply the same pattern one level up, to `ExerciseStatsSheet` itself, so the whole sheet (and its chart import) is code-split out of the pre-workout screen's initial chunk.

**Files:**
- Modify: `components/workout/pre-workout-screen.tsx:1-12`

- [ ] **Step 1: Replace the static import with `next/dynamic`**

Current (lines 1-12):

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronLeftIcon, DumbbellIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import type { SessionLogEntry } from "./types";
import { formatSheetDate } from "./utils";
import { ExerciseStatsSheet } from "./exercise-stats-sheet";

interface PreWorkoutScreenProps {
```

Change to:

```tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { CheckIcon, ChevronLeftIcon, DumbbellIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import type { SessionLogEntry } from "./types";
import { formatSheetDate } from "./utils";

const ExerciseStatsSheet = dynamic(
  () => import("./exercise-stats-sheet").then((m) => ({ default: m.ExerciseStatsSheet })),
  { ssr: false },
);

interface PreWorkoutScreenProps {
```

The `<ExerciseStatsSheet exercise={...} isDoneToday={...} onClose={...} onRedo={...} />` usage later in the file (around line 233) is unchanged — `next/dynamic` produces a drop-in component with the same prop types.

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit
pnpm lint
```
Expected: no new errors.

- [ ] **Step 3: Verify in the browser**

Run `pnpm dev`, open devtools Network tab, filter on `.js`, and load the pre-workout screen for a session. Note the chunk list. Tap an exercise card to open its stats sheet (the one with the sparkline chart). Expected: a new JS chunk loads at that point (containing chart.js/react-chartjs-2/`exercise-stats-sheet`) that was **not** part of the initial pre-workout screen load. Confirm the stats sheet still renders the sparkline, history, and 1RM/redo controls exactly as before.

- [ ] **Step 4: Commit**

```bash
git add components/workout/pre-workout-screen.tsx
git commit -m "Lazy-load ExerciseStatsSheet to defer chart.js until stats sheet is opened"
```

---

## Deferred / Not Included

- **Thunderstorm particle count (`weather-overlay.tsx`)**: the `thunderstorm` case renders `<Clouds count={6} /> <RainStreaks count={36} /> <LightningFlashes />` (45 animated elements). This was flagged in the original review but the dynamic background feature is **off by default** and only affects users who both enable it and experience a thunderstorm — low real-world impact relative to the rework needed to reduce particle counts without visibly degrading the effect. Revisit if/when the feature is enabled by default or particle-related jank is reported.

## Self-Review Notes

- **Spec coverage:** All 6 in-scope performance findings are covered — weather gating + dedup (Task 1), O(n²) distance calc (Task 2), Leaflet re-render throttling + offline fallback (Task 3, also covers the related design finding), localStorage write frequency (Task 4), `getDayLog` overfetch (Task 5), eager chart.js import (Task 6).
- **Independence:** Each task touches a disjoint set of files (Tasks 1–4: weather/activity files; Task 5: workout-data repo+route; Task 6: pre-workout-screen) and can be committed separately.
- **Type consistency:** `getDayExerciseNames` return type (`{ sessionId?: string; exerciseName: string }[]`) matches its usage in `workout-data/route.ts` (`.filter(e => e.sessionId === programSession.id)`, `.map(e => e.exerciseName)`). `useWeather(enabled = true)` keeps `WeatherChip`'s existing no-argument call (`useWeather()`) working unchanged.
- **No placeholders:** every step shows exact before/after code or exact commands with expected output.
