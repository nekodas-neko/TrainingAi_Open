# Cardio Session Visuals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the per-session data `lib/activity/activity-metrics.ts` already computes and stores
but never renders (`bestEfforts`, `paceSeries`, dense splits), and add the spec's "hero interactive
chart" — a scrub-able HR/pace timeline whose scrub position drives a marker sliding along the route
map — plus two new static dense charts (pace-per-km bars, time-in-zone donut), all inside the existing
`ActivityDetailSheet`.

**Architecture:** No new routes, no new DB columns, no new stored fields. Everything this plan renders
is already persisted on `ActivityLog` (`splits`, `bestEfforts`, `paceSeries`) or already fetched by
`ActivityDetailSheet` (`hrData.readings`, decoded route points). The hero chart's "marker follows scrub"
works by estimating cumulative distance from the *time-based* `paceSeries` at the scrubbed instant, then
walking the *distance-based* route polyline to the matching lat/lng — a pure interpolation, no new data
needed. Two small existing components (`ActivityHrChart`, `ActivityRouteMap`) get one addition each
(colour-token fix, `activePoint` prop); everything else is new, additive components composed inside
`ActivityDetailSheet`.

**Tech Stack:** `chart.js` + `react-chartjs-2` (already installed, no new dep), `react-leaflet` (already
installed), `resolveColor` from `lib/chart-colors.ts` for every canvas colour (chart.js cannot resolve
`var(--x)` strings — this is a hard constraint, see spec D-6 and the CLAUDE.md canvas-colour-hazard rule).

**Out of scope (documented, not silently dropped):** A full elevation-profile-vs-distance chart is
**not** included. `computeElevationChange` only returns aggregate gain/loss meters (already shown as two
stat tiles) — there is no stored per-point elevation *series* to chart, because `encodeRoute` (Google
polyline format) drops the `ele` field entirely, and only the simplified lat/lng polyline is persisted,
never the raw GPS points. Building a real elevation profile requires a new stored series (mirroring how
`paceSeries` was added) plus a migration and sync-mirroring update — a materially bigger, schema-touching
piece of work than "wire up already-computed data," and is called out as its own follow-up in the backlog
entry this plan's PR updates. Cadence is also out of scope here: it already renders via `Sparkline` in
`ActivityDetailSheet` today and isn't part of the "computed but never shown" gap.

---

### Task 1: Distance/time interpolation helpers for the scrub-to-map sync

**Files:**
- Create: `lib/activity/scrub.ts`
- Test: `lib/activity/__tests__/scrub.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { estimateDistanceKmAtTime, pointAtDistanceKm } from '../scrub'

describe('estimateDistanceKmAtTime', () => {
  it('returns 0 for an empty pace series', () => {
    expect(estimateDistanceKmAtTime([], 60)).toBe(0)
  })

  it('accumulates full buckets before the target time', () => {
    // Bucket 1: 0-30s at 300 sec/km (0.1km). Bucket 2: 30-60s at 300 sec/km (0.1km).
    const series = [{ tSec: 30, paceSec: 300 }, { tSec: 60, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 60)).toBeCloseTo(0.2, 5)
  })

  it('interpolates a fraction of the bucket containing the target time', () => {
    // Bucket 1 covers 0-30s at 300 sec/km. Target at t=15s is halfway through it.
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 15)).toBeCloseTo(0.05, 5)
  })

  it('clamps to the total distance when the target time exceeds the series', () => {
    const series = [{ tSec: 30, paceSec: 300 }]
    expect(estimateDistanceKmAtTime(series, 999)).toBeCloseTo(0.1, 5)
  })
})

describe('pointAtDistanceKm', () => {
  it('returns null for fewer than 2 points', () => {
    expect(pointAtDistanceKm([{ lat: 0, lng: 0 }], 1)).toBeNull()
  })

  it('returns the first point for a non-positive target distance', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    expect(pointAtDistanceKm(points, 0)).toEqual({ lat: 0, lng: 0 })
  })

  it('interpolates between the two bracketing points', () => {
    // A straight line along the equator: ~111.19km per degree of longitude.
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    const result = pointAtDistanceKm(points, 55.6) // ~half the segment
    expect(result).not.toBeNull()
    expect(result!.lat).toBeCloseTo(0, 5)
    expect(result!.lng).toBeCloseTo(0.5, 1)
  })

  it('returns the last point when the target exceeds the route length', () => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]
    expect(pointAtDistanceKm(points, 99999)).toEqual({ lat: 0, lng: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/activity/__tests__/scrub.test.ts`
Expected: FAIL with "Cannot find module '../scrub'"

- [ ] **Step 3: Write the implementation**

```typescript
import { haversineDistanceKm } from './activity-metrics'

export interface LatLng {
  lat: number
  lng: number
}

export interface PacePoint {
  tSec: number
  paceSec: number
}

/** Cumulative distance (km) covered by elapsed time `tSec`, integrating a `computePaceSeries`
 *  result bucket by bucket (speed = 1km / paceSec). The bucket containing `tSec` is weighted
 *  by the fraction of it elapsed. Clamps to the series' total distance past the last bucket. */
export function estimateDistanceKmAtTime(paceSeries: PacePoint[], tSec: number): number {
  let distanceKm = 0
  let prevT = 0
  for (const p of paceSeries) {
    if (tSec <= prevT) break
    const bucketSec = p.tSec - prevT
    const elapsedInBucket = Math.min(bucketSec, tSec - prevT)
    distanceKm += elapsedInBucket / p.paceSec
    prevT = p.tSec
    if (tSec <= p.tSec) break
  }
  return distanceKm
}

/** Walks a route's lat/lng points accumulating haversine distance, returning the point at
 *  `targetKm` via linear interpolation between the two bracketing points. Returns the route's
 *  last point past its total length, or null for fewer than 2 points — the caller (the hero
 *  chart's scrub handler) treats null as "don't move the map marker". */
export function pointAtDistanceKm(points: LatLng[], targetKm: number): LatLng | null {
  if (points.length < 2) return null
  if (targetKm <= 0) return points[0]

  let cumKm = 0
  for (let i = 1; i < points.length; i++) {
    const segKm = haversineDistanceKm(points[i - 1], points[i])
    if (cumKm + segKm >= targetKm) {
      const frac = segKm > 0 ? (targetKm - cumKm) / segKm : 0
      return {
        lat: points[i - 1].lat + (points[i].lat - points[i - 1].lat) * frac,
        lng: points[i - 1].lng + (points[i].lng - points[i - 1].lng) * frac,
      }
    }
    cumKm += segKm
  }
  return points[points.length - 1]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/activity/__tests__/scrub.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/activity/scrub.ts lib/activity/__tests__/scrub.test.ts
git commit -m "feat: add time-to-distance and distance-to-point interpolation for the hero chart scrub"
```

---

### Task 2: `activePoint` marker on the route map

**Files:**
- Modify: `components/activity/activity-route-map.tsx`

- [ ] **Step 1: Add the prop and render an extra marker when set**

In `components/activity/activity-route-map.tsx`, change the props interface (currently at line 14):

```typescript
interface ActivityRouteMapProps {
  points: LatLng[]
  className?: string
  /** When set, renders an extra marker at this position — driven by the hero chart's scrub
   *  handler so the map tracks where on the route a given HR/pace moment happened. */
  activePoint?: LatLng | null
}
```

Update the function signature (currently at line 37):

```typescript
export function ActivityRouteMap({ points, className, activePoint }: ActivityRouteMapProps) {
```

Add the marker just after the existing start/end `CircleMarker`s (currently lines 83-84), inside the
same `<MapContainer>`:

```tsx
        <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
        <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
        {activePoint && (
          <CircleMarker
            center={[activePoint.lat, activePoint.lng]}
            radius={8}
            pathOptions={{ color: 'var(--color-brand)', fillColor: 'var(--color-brand)', fillOpacity: 1, weight: 2 }}
          />
        )}
```

Leaflet/SVG markers resolve `var(--x)` colours fine (only chart.js canvas paint calls need
`resolveColor` — the existing `Polyline` on line 82 already relies on this).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/activity/activity-route-map.tsx
git commit -m "feat: add an optional active-point marker to the route map"
```

---

### Task 3: Fix the HR chart's canvas colour hazard

**Files:**
- Modify: `components/activity/activity-hr-chart.tsx`

`activity-hr-chart.tsx` currently hardcodes `'rgb(156 163 175)'` for tick labels and
`'rgba(255,255,255,0.04)'` for gridlines (lines 69, 74, 79, 80) — a literal near-invisible white grid is
exactly the light-mode canvas-colour hazard CLAUDE.md flags (chart.js can't resolve `var(--x)`, so it
must be resolved once via `resolveColor` and passed as a computed value). `trend-chart.tsx` already
established the correct pattern (`resolveColor('var(--color-brand)')`) — this task applies the same
pattern here, since this file is being directly extended by Task 4 (the hero chart is a near-duplicate
of this chart's HR line) and shipping a second broken-in-light-mode chart node right next to a fixed one
would be an inconsistency worth avoiding.

- [ ] **Step 1: Import `resolveColor` and replace the literals**

At the top of `components/activity/activity-hr-chart.tsx`, add the import:

```typescript
import { resolveColor } from '@/lib/chart-colors'
```

Replace the `options.scales.x` and `options.scales.y` blocks (currently lines 63-83):

```typescript
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: Math.ceil(totalMin),
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 5,
          callback: v => `${Math.round(Number(v))}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
      y: {
        min: yMin,
        max: yMax,
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 },
        grid: { color: resolveColor('var(--border)') },
      },
    },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Verify visually in both themes**

Run `pnpm dev`, open `/health`, tap a past non-GPS activity (or any activity with HR data) to open
`ActivityDetailSheet`, and confirm the HR chart's gridlines are a subtle visible grey (not invisible) in
both light and dark theme (toggle via the app's theme setting).

- [ ] **Step 4: Commit**

```bash
git add components/activity/activity-hr-chart.tsx
git commit -m "fix: resolve HR chart grid/tick colours through resolveColor instead of raw literals"
```

---

### Task 4: Hero interactive chart (HR + pace, scrub-driven)

**Files:**
- Create: `components/activity/hero-activity-chart.tsx`

This is the spec's D-6 "hero (interactive)" surface: a dual-line HR + pace chart over elapsed time.
Moving a pointer over it calls back with the scrubbed elapsed seconds; `ActivityDetailSheet` (Task 7)
turns that into a distance via `estimateDistanceKmAtTime` and a map position via `pointAtDistanceKm`.
Only rendered for GPS sessions that have both HR readings and a `paceSeries` — non-distance activities
(yoga, HIIT, stretch) keep using the plain `ActivityHrChart` from Task 3, which has no pace/route to
correlate against.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useMemo, useRef } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Chart,
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'

ChartJS.register(LineElement, PointElement, LinearScale, Tooltip)

interface HrReading {
  timestamp: string
  bpm: number
}

interface PaceSeriesPoint {
  tSec: number
  paceSec: number
}

interface Props {
  hrReadings: HrReading[]
  paceSeries: PaceSeriesPoint[]
  avgHr: number | null
  maxHr: number | null
  /** Fires with the scrubbed elapsed seconds, or null when the pointer leaves the chart. */
  onScrub: (tSec: number | null) => void
}

function toElapsedMin(timestamp: string, startMs: number): number {
  return (new Date(timestamp).getTime() - startMs) / 60_000
}

export function HeroActivityChart({ hrReadings, paceSeries, avgHr, maxHr, onScrub }: Props) {
  const chartRef = useRef<Chart<'line'> | null>(null)

  const hrPoints = useMemo(() => {
    if (hrReadings.length === 0) return []
    const startMs = new Date(hrReadings[0].timestamp).getTime()
    return hrReadings.map(r => ({ x: toElapsedMin(r.timestamp, startMs), y: r.bpm }))
  }, [hrReadings])

  const pacePoints = useMemo(
    () => paceSeries.map(p => ({ x: p.tSec / 60, y: p.paceSec })),
    [paceSeries],
  )

  if (hrPoints.length === 0 && pacePoints.length === 0) return null

  const totalMin = Math.max(
    hrPoints.length ? hrPoints[hrPoints.length - 1].x : 0,
    pacePoints.length ? pacePoints[pacePoints.length - 1].x : 0,
  )

  const data: ChartData<'line'> = {
    datasets: [
      {
        label: 'Heart Rate',
        data: hrPoints,
        borderColor: 'rgba(239, 68, 68, 0.85)',
        backgroundColor: 'transparent',
        yAxisID: 'y',
        pointRadius: 0,
        tension: 0.4,
        borderWidth: 2,
      },
      {
        label: 'Pace',
        data: pacePoints,
        borderColor: resolveColor('var(--color-brand)'),
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        pointRadius: 0,
        tension: 0.4,
        borderWidth: 2,
      },
    ],
  }

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { tooltip: { enabled: false }, legend: { display: false } },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: Math.ceil(totalMin) || 1,
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 5,
          callback: v => `${Math.round(Number(v))}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
      y: {
        position: 'left',
        ticks: { color: 'rgba(239, 68, 68, 0.85)', font: { size: 9 }, maxTicksLimit: 4 },
        grid: { display: false },
      },
      y1: {
        position: 'right',
        ticks: {
          color: resolveColor('var(--color-brand)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => `${Math.floor(Number(v) / 60)}:${String(Math.round(Number(v) % 60)).padStart(2, '0')}`,
        },
        grid: { display: false },
      },
    },
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const chart = chartRef.current
    if (!chart) return
    const elements = chart.getElementsAtEventForMode(e.nativeEvent, 'index', { intersect: false }, true)
    if (elements.length === 0) return
    const point = data.datasets[elements[0].datasetIndex].data[elements[0].index] as { x: number }
    onScrub(Math.round(point.x * 60))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Heart Rate & Pace</p>
        <div className="flex gap-3 text-[10px] text-muted-foreground">
          {avgHr != null && <span>avg <span className="font-semibold text-foreground">{avgHr}</span></span>}
          {maxHr != null && <span>max <span className="font-semibold text-foreground">{maxHr}</span></span>}
        </div>
      </div>
      <div
        className="h-32 w-full touch-none"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onScrub(null)}
      >
        <Line ref={chartRef} data={data} options={options} />
      </div>
    </div>
  )
}
```

`touch-none` on the wrapper stops the page from scrolling while a finger drags across the chart to scrub
— without it, a vertical touch-drag over the canvas would scroll the sheet instead of moving the marker.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/activity/hero-activity-chart.tsx
git commit -m "feat: add the hero HR/pace scrub chart"
```

---

### Task 5: Pace-per-km bar chart + best-efforts callout

**Files:**
- Create: `components/activity/pace-bar-chart.tsx`

Renders `log.splits` as bars (never charted today — the sheet currently shows a plain text list, which
Task 7 will replace) and surfaces `log.bestEfforts` (`{ '1km'?: number; '5km'?: number }`, sec/km) —
**computed and stored since the feature shipped, never rendered anywhere until this task.**

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useMemo } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Split {
  km: number
  paceSec: number
}

interface Props {
  splits: Split[]
  bestEfforts?: Record<string, number>
}

function formatPace(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}`
}

const BEST_EFFORT_LABELS: Record<string, string> = { '1km': 'Fastest 1km', '5km': 'Fastest 5km' }

export function PaceBarChart({ splits, bestEfforts }: Props) {
  const chartData = useMemo<ChartData<'bar'>>(() => ({
    labels: splits.map(s => `${s.km}`),
    datasets: [{
      data: splits.map(s => s.paceSec),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderRadius: 4,
    }],
  }), [splits])

  if (splits.length === 0) return null

  const options: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } },
        grid: { display: false },
      },
      y: {
        reverse: true, // faster pace (lower sec/km) reads as a taller bar
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => formatPace(Number(v)),
        },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }

  const efforts = Object.entries(bestEfforts ?? {})

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pace per km</p>
      <div className="h-28 w-full">
        <Bar data={chartData} options={options} />
      </div>
      {efforts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-center">
          {efforts.map(([key, paceSec]) => (
            <div key={key} className="rounded-xl bg-muted px-2 py-2">
              <p className="text-sm font-bold tabular-nums">{formatPace(paceSec)} /km</p>
              <p className="text-[10px] text-muted-foreground">{BEST_EFFORT_LABELS[key] ?? key}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

The y-axis is `reverse: true` so a faster (numerically lower) pace draws as a taller bar — matching how
runners read pace charts (up = better), rather than a literal bar-height-equals-seconds reading that
would show slow splits as tall.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/activity/pace-bar-chart.tsx
git commit -m "feat: add the pace-per-km bar chart and best-efforts callout"
```

---

### Task 6: Time-in-zone donut

**Files:**
- Create: `components/activity/zone-donut-chart.tsx`

Spec D-6 lists a "time-in-zone donut" as one of the static dense charts. `ZoneBreakdown`
(`components/health/zone-breakdown.tsx`) already computes and renders per-zone seconds/pct/colour as a
bar-list with a "Session Load" figure — this task adds a compact donut visual **alongside** it (not a
replacement — the bar-list's colour-paired zone labels stay the accessible primary view per the
CLAUDE.md colour-only-state rule; the donut is a glanceable addition), reusing the exact same
`zoneBreakdownFromReadings` computation so there is only one zone-breakdown formula, per CLAUDE.md's
One-Formula-One-Place rule.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useMemo } from 'react'
import { Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, ArcElement, Tooltip, type ChartData } from 'chart.js'
import { computeHrZones } from '@/lib/health/hr-zones'
import { zoneBreakdownFromReadings, type HrReading } from '@/lib/health/zone-minutes'

ChartJS.register(ArcElement, Tooltip)

interface Props {
  readings: { timestamp: string; bpm: number }[]
  profile: { maxHr: number; restingHr: number } | null
}

export function ZoneDonutChart({ readings, profile }: Props) {
  const breakdown = useMemo(() => {
    if (!profile || readings.length < 2) return null
    const zones = computeHrZones(profile)
    const hr: HrReading[] = readings.map(r => ({ timestamp: new Date(r.timestamp).getTime(), bpm: r.bpm }))
    return zoneBreakdownFromReadings(hr, zones)
  }, [readings, profile])

  if (!breakdown || breakdown.totalSec <= 0) return null

  const nonZeroZones = breakdown.zones.filter(z => z.seconds > 0)
  const chartData: ChartData<'doughnut'> = {
    labels: nonZeroZones.map(z => `Z${z.id} ${z.name}`),
    datasets: [{
      data: nonZeroZones.map(z => z.seconds),
      backgroundColor: nonZeroZones.map(z => z.color),
      borderWidth: 0,
    }],
  }

  return (
    <div className="mx-auto h-28 w-28">
      <Doughnut
        data={chartData}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          cutout: '65%',
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        }}
      />
    </div>
  )
}
```

This mirrors `ZoneBreakdown`'s own `useMemo` computation exactly (same inputs, same
`zoneBreakdownFromReadings` call) — both components independently derive the same breakdown from the
same readings/profile, so there's no shared-state risk, only the one shared formula.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add components/activity/zone-donut-chart.tsx
git commit -m "feat: add the time-in-zone donut chart"
```

---

### Task 7: Wire everything into `ActivityDetailSheet`

**Files:**
- Modify: `components/activity/activity-detail-sheet.tsx`

- [ ] **Step 1: Add the new dynamic imports and scrub state**

Add alongside the existing dynamic imports (currently lines 13-20):

```typescript
const HeroActivityChart = dynamic(
  () => import('./hero-activity-chart').then(m => m.HeroActivityChart),
  { ssr: false },
)
```

`PaceBarChart` and `ZoneDonutChart` are small chart.js components already lazy-loaded transitively by
being imported only inside this client component tree — no separate `dynamic()` wrapper is needed for
them since they don't touch Leaflet/browser-only globals at import time the way the map does; import
them as plain static imports at the top of the file:

```typescript
import { PaceBarChart } from './pace-bar-chart'
import { ZoneDonutChart } from './zone-donut-chart'
import { estimateDistanceKmAtTime, pointAtDistanceKm } from '@/lib/activity/scrub'
```

Add scrub state inside the component body (after the existing `hrProfile` state, currently line 42):

```typescript
  const [scrubPoint, setScrubPoint] = useState<{ lat: number; lng: number } | null>(null)

  const handleScrub = (tSec: number | null) => {
    if (tSec == null || !log?.paceSeries || log.paceSeries.length === 0) {
      setScrubPoint(null)
      return
    }
    const distanceKm = estimateDistanceKmAtTime(log.paceSeries, tSec)
    setScrubPoint(pointAtDistanceKm(routePoints, distanceKm))
  }
```

- [ ] **Step 2: Replace the flat HR chart with the hero chart for GPS sessions**

Replace the existing HR-chart block (currently lines 177-183):

```tsx
            {hrData && hrData.readings.length > 1 && log.paceSeries && log.paceSeries.length > 0 ? (
              <HeroActivityChart
                hrReadings={hrData.readings}
                paceSeries={log.paceSeries}
                avgHr={hrData.avgHr}
                maxHr={hrData.maxHr}
                onScrub={handleScrub}
              />
            ) : hrData && hrData.readings.length > 0 ? (
              <ActivityHrChart
                readings={hrData.readings}
                avgHr={hrData.avgHr}
                maxHr={hrData.maxHr}
              />
            ) : null}
```

- [ ] **Step 3: Pass `activePoint` to the route map and add the donut beside the zone breakdown**

Replace the `ZoneBreakdown` line and the map line (currently lines 185-191):

```tsx
            {hrData && hrData.readings.length > 1 && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <ZoneBreakdown readings={hrData.readings} profile={hrProfile} />
                </div>
                <ZoneDonutChart readings={hrData.readings} profile={hrProfile} />
              </div>
            )}

            {routePoints.length > 1 && (
              <ActivityRouteMap points={routePoints} activePoint={scrubPoint} className="h-56 w-full" />
            )}
```

- [ ] **Step 4: Replace the plain splits list with the pace bar chart + dense table**

Replace the existing splits block (currently lines 193-203):

```tsx
            {log.splits && log.splits.length > 0 && (
              <PaceBarChart splits={log.splits} bestEfforts={log.bestEfforts} />
            )}

            {log.splits && log.splits.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Splits</p>
                <div className="overflow-hidden rounded-xl bg-muted">
                  {log.splits.map((s, i) => (
                    <div
                      key={s.km}
                      className={`flex justify-between px-3 py-1.5 text-sm ${i > 0 ? 'border-t border-border/60' : ''}`}
                    >
                      <span>Km {s.km}</span>
                      <span className="tabular-nums">{formatPace(s.paceSec)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
```

(The splits table keeps the existing `formatPace` helper already defined at the top of this file —
no change needed there.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Manual verification (dev server + Playwright)**

Run `pnpm dev` against the local seed DB. This plan's charts all need real GPS + HR + pace data, which
the base seed's ~9 logged sessions may not include — if the seed has no activity_log row with
`routePolyline`, `paceSeries`, and `splits` all populated, log a short manual GPS-tracked walk/run via
`/workout-select` → "Other Activity" (or use the seed script if it already has one) so there is at least
one real row to open in `ActivityDetailSheet`.

1. Open `/health`, find that activity in the history list, tap it.
2. Confirm the hero chart renders (two lines, HR in red on the left axis, pace in brand colour on the
   right axis) — not the old flat single-line HR chart.
3. Drag a finger/pointer across the hero chart and confirm a marker appears on the route map and moves
   as the pointer moves; confirm it disappears when the pointer leaves the chart.
4. Confirm the pace-per-km bar chart renders under "Pace per km", with the fastest-1km/5km callouts
   beneath it (previously never shown anywhere).
5. Confirm the donut renders beside the existing zone-breakdown bar list, coloured to match the same
   zones.
6. Confirm the splits section below the pace chart is now a bordered table, not a bare list.
7. Toggle the app theme (light/dark) and confirm no invisible gridlines and no black-on-black canvas
   text in any of the new/touched charts (this is the exact hazard Task 3 fixed and Tasks 4-6 must not
   reintroduce — verify all of them, not just Task 3's chart).
8. Open a non-GPS activity (e.g. a walk logged with no route) and confirm it still renders the plain
   `ActivityHrChart` (no hero chart, no pace bar chart, no crash from missing `paceSeries`/`splits`).

- [ ] **Step 7: Commit**

```bash
git add components/activity/activity-detail-sheet.tsx
git commit -m "feat: wire the hero chart, pace bars, zone donut and dense splits table into the activity detail sheet"
```

---

### Task 8: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-session-visuals.md`
- Modify: `docs/implementation-backlog.md` (remove this item, renumber remaining cardio-batch items)

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint
node scripts/check-reconcile.js
node scripts/check-push-mutations.js
pnpm typecheck
pnpm test
```

Expected: all green (this plan touches no sync/reconcile-relevant files, so
`check-reconcile.js`/`check-push-mutations.js` should be no-ops for this diff — run them anyway per the
standing CI-parity habit).

- [ ] **Step 2: Isolated production build**

Stop any running `pnpm dev` first (concurrent `next build` + `next dev` corrupts `.next` — the
established workaround from the cardio-hub and session-picker sessions):

```bash
rm -rf .next
npm run build
```

Expected: builds clean, no errors.

- [ ] **Step 3: Bump the version and add a changelog entry**

Bump `package.json`'s `version` (minor bump — new user-visible feature) and add a matching entry to
`lib/changelog.ts` describing the hero chart, pace bar chart, zone donut, and best-efforts callout.

- [ ] **Step 4: Write the session journal entry**

Create `docs/overview/entries/2026-07-27-cardio-session-visuals.md` following the convention in
`docs/overview/entries/README.md` (mirror the shape of
`docs/overview/entries/2026-07-27-cardio-session-picker.md`): what shipped, the elevation-profile scope
cut and why, and an explicit "not verified" section — real Samsung WebView touch-drag scrubbing (the
sandbox is desktop Chromium pointer events, not a verified on-device touch gesture), and whether the
`touch-none` class fully prevents scroll-hijack on the S25 (flag as APK-unverified per the Canonical
Runtime policy).

- [ ] **Step 5: Update `projectOverview.md`**

Update the "Current Status" Latest/Previous feature chain (cap depth as usual) and tick this item as
✅ shipped with a ⚠️ note for the on-device-unverified touch-scrub gesture.

- [ ] **Step 6: Update the backlog**

In `docs/implementation-backlog.md`'s cardio batch table, remove this item's row, add a
`✅ SHIPPED` pointer note (matching the style of the existing "Item 1 (Hub + IA split) ✅ SHIPPED"
notes), renumber the remaining rows, and add a new row for the deferred elevation-profile chart
(distinct scope: new stored series + migration + sync mirroring — not a visual-only task) so the gap
identified in this plan's "Out of scope" section isn't silently dropped, per the CLAUDE.md
no-orphaned-findings rule.

- [ ] **Step 7: Commit and push**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/entries/2026-07-27-cardio-session-visuals.md docs/implementation-backlog.md
git commit -m "chore: version bump, journal entry and backlog update for cardio session visuals"
git push -u origin feat/cardio-session-visuals
```

---

## Self-Review Notes

- **Spec coverage (D-6):** hero interactive chart ✅ (Task 4+7), route marker follows scrub ✅ (Task
  1+2+7), elevation profile ❌ **explicitly deferred, documented** (see "Out of scope" above and Task
  8 Step 6), pace-per-km bars ✅ (Task 5), cadence trace — already shipped pre-existing, untouched,
  time-in-zone donut ✅ (Task 6), splits table ✅ upgraded (Task 7 Step 4). Trends (efficiency curve,
  weekly zone stacks, distance/pace vs anchor, cadence trend, PR history) are **out of scope for this
  plan** — they are a separate, independent surface with their own data-aggregation needs and are
  covered by the sibling plan `docs/superpowers/plans/2026-07-27-cardio-trends.md`.
- **Canvas colour hazard:** every new/touched chart.js component (`hero-activity-chart.tsx`,
  `pace-bar-chart.tsx`, `zone-donut-chart.tsx`, and the Task 3 fix to `activity-hr-chart.tsx`) resolves
  every `var(--x)` colour through `resolveColor` before handing it to chart.js — verified against every
  `ticks.color`/`grid.color`/`backgroundColor`/`borderColor` in each component above.
- **Theme-awareness:** Task 7 Step 6 explicitly checks both themes for the new charts, not just the one
  Task 3 fixes.
