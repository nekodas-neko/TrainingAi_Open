> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Activity Data Model & Route Metrics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the database columns, types, pure route/metrics calculation
helpers, and API support needed to store route polylines, splits, best
efforts, pace series, and elevation stats for activity logs.

**Architecture:** A new migration adds columns to `activity_logs`. New pure
TypeScript modules in `lib/activity/` handle Douglas-Peucker route
simplification + polyline encode/decode, and distance/pace/split/elevation
calculations from a raw GPS trace — all unit tested with vitest, no DB or
network dependency. The repository layer and `POST /api/activity-logs` are
extended to persist the new fields.

**Tech Stack:** PostgreSQL (Drizzle ORM), `@mapbox/polyline`, vitest,
TypeScript, Next.js API routes (Zod validation).

---

This is **Plan 1 of 3** for `docs/superpowers/specs/2026-06-11-live-activity-tracking-design.md`
(Sections 2 covers this plan; Sections 3-4 are Plan 2 — GPS tracking, store,
live screens; Section 5-6 are Plan 3 — calendar/history integration).

## File Structure

| File | Status | Responsibility |
|------|--------|-----------------|
| `lib/data/postgres/migrations/059_activity_route_data.sql` | Create | New columns on `activity_logs` |
| `lib/data/postgres/schema.ts` | Modify | Add Drizzle column defs to `activityLogs` |
| `lib/types/body.ts` | Modify | Extend `ActivityLog` interface |
| `lib/activity/route-encoding.ts` | Create | Douglas-Peucker simplify + polyline encode/decode |
| `lib/activity/__tests__/route-encoding.test.ts` | Create | Tests for above |
| `lib/activity/activity-metrics.ts` | Create | Distance, splits, best efforts, pace series, elevation |
| `lib/activity/__tests__/activity-metrics.test.ts` | Create | Tests for above |
| `lib/data/postgres/adapter.ts` | Modify | `saveActivityLog` + `rowToActivityLog` carry new fields |
| `app/api/activity-logs/route.ts` | Modify | Accept new fields in `POST` body |
| `package.json` / `pnpm-lock.yaml` | Modify | Add `@mapbox/polyline` + `@types/mapbox__polyline` |

---

## Task 1: Install `@mapbox/polyline`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install the package**

Run: `pnpm add @mapbox/polyline && pnpm add -D @types/mapbox__polyline`

Expected: `package.json` gains `@mapbox/polyline` under `dependencies` and
`@types/mapbox__polyline` under `devDependencies`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify it imports correctly**

Run: `node -e "const p = require('@mapbox/polyline'); console.log(p.encode([[38.5,-120.2],[40.7,-120.95]]))"`

Expected: prints an encoded polyline string (e.g. `_p~iF~ps|U_ulLnnqC`).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add @mapbox/polyline for activity route encoding"
```

---

## Task 2: Migration — new `activity_logs` columns

**Files:**
- Create: `lib/data/postgres/migrations/059_activity_route_data.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Adds GPS route + computed metric storage for live-tracked activities.

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS route_polyline      TEXT,
  ADD COLUMN IF NOT EXISTS splits              JSONB,
  ADD COLUMN IF NOT EXISTS best_efforts        JSONB,
  ADD COLUMN IF NOT EXISTS pace_series         JSONB,
  ADD COLUMN IF NOT EXISTS avg_pace_sec_per_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS elevation_gain_m    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS elevation_loss_m    DOUBLE PRECISION;
```

- [ ] **Step 2: Apply it to the local dev DB**

Run: `node scripts/local-db/migrate.js`

Expected: output includes `059_activity_route_data.sql` as applied (no
errors). If the script reports "already applied" on a re-run, that's fine —
it's idempotent.

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev -c "\d activity_logs"
```

Expected: output lists `route_polyline`, `splits`, `best_efforts`,
`pace_series`, `avg_pace_sec_per_km`, `elevation_gain_m`, `elevation_loss_m`.

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/059_activity_route_data.sql
git commit -m "Add migration for activity route and metrics columns"
```

---

## Task 3: Drizzle schema + `ActivityLog` type

**Files:**
- Modify: `lib/data/postgres/schema.ts:209-224`
- Modify: `lib/types/body.ts:20-35`

- [ ] **Step 1: Add columns to the Drizzle `activityLogs` table**

In `lib/data/postgres/schema.ts`, replace the `activityLogs` table
definition (lines 209-224):

```ts
export const activityLogs = pgTable('activity_logs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date:            date('date', { mode: 'string' }).notNull(),
  activityType:    text('activity_type').notNull().default('other').references(() => activityTypes.id),
  title:           text('title').notNull(),
  startTime:       time('start_time'),
  endTime:         time('end_time'),
  durationMin:     doublePrecision('duration_min'),
  distanceKm:      doublePrecision('distance_km'),
  caloriesBurned:  doublePrecision('calories_burned'),
  avgHr:           integer('avg_hr'),
  maxHr:           integer('max_hr'),
  notes:           text('notes'),
  routePolyline:   text('route_polyline'),
  splits:          jsonb('splits').$type<{ km: number; paceSec: number }[]>(),
  bestEfforts:     jsonb('best_efforts').$type<Record<string, number>>(),
  paceSeries:      jsonb('pace_series').$type<{ tSec: number; paceSec: number }[]>(),
  avgPaceSecPerKm: doublePrecision('avg_pace_sec_per_km'),
  elevationGainM:  doublePrecision('elevation_gain_m'),
  elevationLossM:  doublePrecision('elevation_loss_m'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Extend the `ActivityLog` interface**

In `lib/types/body.ts`, replace lines 20-35 (`ActivityLog` interface) with:

```ts
export interface ActivityLog {
  id: string
  userId: string
  date: string           // ISO date "YYYY-MM-DD"
  activityType: string   // FK to activity_types.id
  title: string
  startTime?: string     // "HH:MM"
  endTime?: string       // "HH:MM"
  durationMin?: number
  distanceKm?: number
  caloriesBurned?: number
  avgHr?: number
  maxHr?: number
  notes?: string
  routePolyline?: string
  splits?: { km: number; paceSec: number }[]
  bestEfforts?: Record<string, number>
  paceSeries?: { tSec: number; paceSec: number }[]
  avgPaceSecPerKm?: number
  elevationGainM?: number
  elevationLossM?: number
  createdAt: Date
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm exec tsc --noEmit`

Expected: no new errors (existing unrelated errors, if any, are untouched).
If `lib/data/postgres/adapter.ts` now errors about missing fields in
`rowToActivityLog`/`saveActivityLog`, that's expected — fixed in Task 5.

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/schema.ts lib/types/body.ts
git commit -m "Add route/metrics columns to activity log schema and types"
```

---

## Task 4: `lib/activity/route-encoding.ts` — simplify + polyline encode/decode

**Files:**
- Create: `lib/activity/route-encoding.ts`
- Test: `lib/activity/__tests__/route-encoding.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/activity/__tests__/route-encoding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { simplifyRoute, encodeRoute, decodeRoute, type RoutePoint } from '../route-encoding'

describe('simplifyRoute', () => {
  it('keeps short routes unchanged', () => {
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.0001, lng: 0.0001, t: 1000 },
    ]
    expect(simplifyRoute(points, 5)).toEqual(points)
  })

  it('drops collinear points within tolerance', () => {
    // Three points on a near-perfect straight line along the equator.
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0, lng: 0.0005, t: 1000 },
      { lat: 0, lng: 0.001, t: 2000 },
    ]
    const simplified = simplifyRoute(points, 5)
    expect(simplified).toHaveLength(2)
    expect(simplified[0]).toEqual(points[0])
    expect(simplified[1]).toEqual(points[2])
  })

  it('keeps a point that deviates beyond tolerance', () => {
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.001, lng: 0.0005, t: 1000 }, // ~111m north of the line
      { lat: 0, lng: 0.001, t: 2000 },
    ]
    const simplified = simplifyRoute(points, 5)
    expect(simplified).toHaveLength(3)
  })
})

describe('encodeRoute / decodeRoute', () => {
  it('round-trips lat/lng to ~5 decimal places', () => {
    const points: RoutePoint[] = [
      { lat: 38.5, lng: -120.2, t: 0 },
      { lat: 40.7, lng: -120.95, t: 1000 },
      { lat: 43.252, lng: -126.453, t: 2000 },
    ]
    const encoded = encodeRoute(points)
    expect(typeof encoded).toBe('string')
    const decoded = decodeRoute(encoded)
    expect(decoded).toHaveLength(3)
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i].lat, 4)
      expect(p.lng).toBeCloseTo(points[i].lng, 4)
    })
  })

  it('returns an empty string for an empty route', () => {
    expect(encodeRoute([])).toBe('')
    expect(decodeRoute('')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/activity/__tests__/route-encoding.test.ts`

Expected: FAIL — `Cannot find module '../route-encoding'`.

- [ ] **Step 3: Implement `lib/activity/route-encoding.ts`**

```ts
import polyline from '@mapbox/polyline'

export interface RoutePoint {
  lat: number
  lng: number
  ele?: number
  t: number // epoch ms
}

const EARTH_RADIUS_M = 6_371_000

/** Projects a point to local flat x/y meters relative to an origin (equirectangular approximation, fine for short routes). */
function toLocalMeters(p: RoutePoint, origin: RoutePoint): { x: number; y: number } {
  const latRad = (origin.lat * Math.PI) / 180
  const x = ((p.lng - origin.lng) * Math.PI) / 180 * EARTH_RADIUS_M * Math.cos(latRad)
  const y = ((p.lat - origin.lat) * Math.PI) / 180 * EARTH_RADIUS_M
  return { x, y }
}

function perpendicularDistanceMeters(point: RoutePoint, lineStart: RoutePoint, lineEnd: RoutePoint): number {
  const p = toLocalMeters(point, lineStart)
  const a = { x: 0, y: 0 }
  const b = toLocalMeters(lineEnd, lineStart)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/** Douglas-Peucker simplification. `toleranceMeters` is the max allowed perpendicular deviation for a dropped point. */
export function simplifyRoute(points: RoutePoint[], toleranceMeters: number): RoutePoint[] {
  if (points.length < 3) return points

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceMeters(points[i], first, last)
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist > toleranceMeters) {
    const left = simplifyRoute(points.slice(0, maxIdx + 1), toleranceMeters)
    const right = simplifyRoute(points.slice(maxIdx), toleranceMeters)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

/** Encodes a route's lat/lng pairs as a Google polyline string (precision 5). */
export function encodeRoute(points: RoutePoint[]): string {
  if (points.length === 0) return ''
  return polyline.encode(points.map(p => [p.lat, p.lng]))
}

/** Decodes a polyline string back to lat/lng pairs. */
export function decodeRoute(encoded: string): { lat: number; lng: number }[] {
  if (!encoded) return []
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/activity/__tests__/route-encoding.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/activity/route-encoding.ts lib/activity/__tests__/route-encoding.test.ts
git commit -m "Add route simplification and polyline encoding helpers"
```

---

## Task 5: `lib/activity/activity-metrics.ts` — distance, splits, best efforts, pace, elevation

**Files:**
- Create: `lib/activity/activity-metrics.ts`
- Test: `lib/activity/__tests__/activity-metrics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/activity/__tests__/activity-metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  haversineDistanceKm,
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeAvgPaceSecPerKm,
} from '../activity-metrics'
import type { RoutePoint } from '../route-encoding'

describe('haversineDistanceKm', () => {
  it('returns ~0 for identical points', () => {
    const p = { lat: -27.4698, lng: 153.0251, t: 0 }
    expect(haversineDistanceKm(p, p)).toBeCloseTo(0, 5)
  })

  it('returns ~111km for 1 degree of latitude', () => {
    const a = { lat: 0, lng: 0, t: 0 }
    const b = { lat: 1, lng: 0, t: 0 }
    expect(haversineDistanceKm(a, b)).toBeCloseTo(111.2, 0)
  })
})

/** Builds a synthetic straight-line route running due north at a constant pace. */
function buildLinearRoute(numPoints: number, kmPerPoint: number, secPerPoint: number, elevations?: number[]): RoutePoint[] {
  const points: RoutePoint[] = []
  const degPerKm = 1 / 111.2 // approx degrees latitude per km
  for (let i = 0; i < numPoints; i++) {
    points.push({
      lat: i * kmPerPoint * degPerKm,
      lng: 0,
      ele: elevations?.[i],
      t: i * secPerPoint * 1000,
    })
  }
  return points
}

describe('computeTotalDistanceKm', () => {
  it('sums distance across a route', () => {
    const points = buildLinearRoute(11, 0.1, 30) // 10 segments of 0.1km = 1km
    expect(computeTotalDistanceKm(points)).toBeCloseTo(1, 1)
  })

  it('returns 0 for fewer than 2 points', () => {
    expect(computeTotalDistanceKm([])).toBe(0)
    expect(computeTotalDistanceKm([{ lat: 0, lng: 0, t: 0 }])).toBe(0)
  })
})

describe('computeSplits', () => {
  it('produces one split per completed km at constant pace', () => {
    // 100 points, 0.03km apart, 6s apart => 3km route, 5 min/km pace (300s)
    const points = buildLinearRoute(101, 0.03, 6)
    const splits = computeSplits(points)
    expect(splits.length).toBeGreaterThanOrEqual(2)
    expect(splits[0].km).toBe(1)
    expect(splits[0].paceSec).toBeCloseTo(300, -1) // within ~10s
  })

  it('returns empty for fewer than 2 points', () => {
    expect(computeSplits([])).toEqual([])
  })
})

describe('computeBestEfforts', () => {
  it('finds the fastest 1km segment', () => {
    const points = buildLinearRoute(101, 0.03, 6) // 3km @ 5min/km constant
    const efforts = computeBestEfforts(points)
    expect(efforts['1km']).toBeCloseTo(300, -1)
  })

  it('omits distances longer than the total route', () => {
    const points = buildLinearRoute(11, 0.1, 30) // 1km total
    const efforts = computeBestEfforts(points)
    expect(efforts['5km']).toBeUndefined()
  })
})

describe('computePaceSeries', () => {
  it('buckets pace over time', () => {
    const points = buildLinearRoute(61, 0.03, 1) // 60s, 1.8km @ ~33s/km
    const series = computePaceSeries(points, 30)
    expect(series.length).toBeGreaterThanOrEqual(1)
    expect(series[0].tSec).toBeCloseTo(30, 0)
  })
})

describe('computeElevationChange', () => {
  it('sums gains and losses separately', () => {
    const points = buildLinearRoute(5, 0.1, 30, [100, 105, 102, 110, 108])
    // diffs: +5, -3, +8, -2 => gain 13, loss 5
    expect(computeElevationChange(points)).toEqual({ gainM: 13, lossM: 5 })
  })

  it('ignores points with missing elevation', () => {
    const points = buildLinearRoute(3, 0.1, 30)
    expect(computeElevationChange(points)).toEqual({ gainM: 0, lossM: 0 })
  })
})

describe('computeAvgPaceSecPerKm', () => {
  it('computes pace from distance and duration', () => {
    expect(computeAvgPaceSecPerKm(5, 1500)).toBe(300)
  })

  it('returns null for zero distance', () => {
    expect(computeAvgPaceSecPerKm(0, 1500)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/activity/__tests__/activity-metrics.test.ts`

Expected: FAIL — `Cannot find module '../activity-metrics'`.

- [ ] **Step 3: Implement `lib/activity/activity-metrics.ts`**

```ts
import type { RoutePoint } from './route-encoding'

const EARTH_RADIUS_KM = 6371

/** Great-circle distance between two points in kilometers. */
export function haversineDistanceKm(a: RoutePoint, b: RoutePoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Cumulative distance (km) at each point, starting at 0. */
function cumulativeDistancesKm(points: RoutePoint[]): number[] {
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversineDistanceKm(points[i - 1], points[i]))
  }
  return cum
}

/** Total route distance in kilometers. */
export function computeTotalDistanceKm(points: RoutePoint[]): number {
  if (points.length < 2) return 0
  const cum = cumulativeDistancesKm(points)
  return cum[cum.length - 1]
}

export interface Split {
  km: number
  paceSec: number
}

/** Per-completed-km pace, computed from cumulative distance crossing each km boundary. */
export function computeSplits(points: RoutePoint[]): Split[] {
  if (points.length < 2) return []

  const splits: Split[] = []
  let cumDist = 0
  let splitStartTime = points[0].t
  let splitStartDist = 0
  let nextSplitKm = 1

  for (let i = 1; i < points.length; i++) {
    cumDist += haversineDistanceKm(points[i - 1], points[i])
    if (cumDist >= nextSplitKm) {
      const splitDistKm = cumDist - splitStartDist
      const splitTimeSec = (points[i].t - splitStartTime) / 1000
      splits.push({ km: nextSplitKm, paceSec: Math.round(splitTimeSec / splitDistKm) })
      splitStartTime = points[i].t
      splitStartDist = cumDist
      nextSplitKm += 1
    }
  }

  return splits
}

const BEST_EFFORT_DISTANCES_KM: { key: string; km: number }[] = [
  { key: '1km', km: 1 },
  { key: '5km', km: 5 },
]

/** Fastest pace (sec/km) sustained over each of `BEST_EFFORT_DISTANCES_KM`, via sliding window. */
export function computeBestEfforts(points: RoutePoint[]): Record<string, number> {
  const result: Record<string, number> = {}
  if (points.length < 2) return result

  const cum = cumulativeDistancesKm(points)
  const totalDist = cum[cum.length - 1]

  for (const { key, km } of BEST_EFFORT_DISTANCES_KM) {
    if (totalDist < km) continue

    let best = Infinity
    let j = 0
    for (let i = 0; i < points.length; i++) {
      if (j < i) j = i
      while (j < points.length && cum[j] - cum[i] < km) j++
      if (j >= points.length) break
      const timeSec = (points[j].t - points[i].t) / 1000
      const distKm = cum[j] - cum[i]
      const paceForKm = (timeSec / distKm) * km
      if (paceForKm < best) best = paceForKm
    }

    if (best !== Infinity) result[key] = Math.round(best)
  }

  return result
}

export interface PacePoint {
  tSec: number
  paceSec: number
}

/** Pace bucketed every `bucketSec` seconds (default 30s) for a pace-over-time chart. */
export function computePaceSeries(points: RoutePoint[], bucketSec = 30): PacePoint[] {
  if (points.length < 2) return []

  const cum = cumulativeDistancesKm(points)
  const startTime = points[0].t
  const series: PacePoint[] = []
  let bucketStartIdx = 0
  let nextBucketSec = bucketSec

  for (let i = 1; i < points.length; i++) {
    const elapsedSec = (points[i].t - startTime) / 1000
    if (elapsedSec >= nextBucketSec) {
      const distKm = cum[i] - cum[bucketStartIdx]
      const timeSec = (points[i].t - points[bucketStartIdx].t) / 1000
      series.push({ tSec: Math.round(elapsedSec), paceSec: distKm > 0 ? Math.round(timeSec / distKm) : 0 })
      bucketStartIdx = i
      nextBucketSec += bucketSec
    }
  }

  return series
}

/** Total elevation gain and loss in meters, ignoring points without elevation data. */
export function computeElevationChange(points: RoutePoint[]): { gainM: number; lossM: number } {
  let gain = 0
  let loss = 0
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].ele
    const curr = points[i].ele
    if (prev == null || curr == null) continue
    const diff = curr - prev
    if (diff > 0) gain += diff
    else loss += -diff
  }
  return { gainM: Math.round(gain), lossM: Math.round(loss) }
}

/** Average pace in seconds per km, or null if there's no distance to derive a pace from. */
export function computeAvgPaceSecPerKm(distanceKm: number, durationSec: number): number | null {
  if (distanceKm <= 0) return null
  return Math.round(durationSec / distanceKm)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/activity/__tests__/activity-metrics.test.ts`

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/activity/activity-metrics.ts lib/activity/__tests__/activity-metrics.test.ts
git commit -m "Add activity distance, pace, split and elevation calculations"
```

---

## Task 6: Persist new fields — repository + API route

**Files:**
- Modify: `lib/data/postgres/adapter.ts:1525-1549`
- Modify: `app/api/activity-logs/route.ts`

- [ ] **Step 1: Update `saveActivityLog` and `rowToActivityLog`**

In `lib/data/postgres/adapter.ts`, replace lines 1525-1549 with:

```ts
  async saveActivityLog(userId: string, log: Omit<ActivityLog, 'id' | 'userId' | 'createdAt'>): Promise<ActivityLog> {
    const [r] = await this.db.insert(s.activityLogs)
      .values({
        userId, date: log.date, activityType: log.activityType, title: log.title,
        startTime: log.startTime ?? null, endTime: log.endTime ?? null,
        durationMin: log.durationMin ?? null, distanceKm: log.distanceKm ?? null,
        caloriesBurned: log.caloriesBurned ?? null,
        avgHr: log.avgHr ?? null, maxHr: log.maxHr ?? null,
        notes: log.notes ?? null,
        routePolyline: log.routePolyline ?? null,
        splits: log.splits ?? null,
        bestEfforts: log.bestEfforts ?? null,
        paceSeries: log.paceSeries ?? null,
        avgPaceSecPerKm: log.avgPaceSecPerKm ?? null,
        elevationGainM: log.elevationGainM ?? null,
        elevationLossM: log.elevationLossM ?? null,
      })
      .returning()
    return this.rowToActivityLog(r)
  }

  private rowToActivityLog(r: typeof s.activityLogs.$inferSelect): ActivityLog {
    return {
      id: r.id, userId: r.userId, date: r.date, activityType: r.activityType, title: r.title,
      startTime: r.startTime ?? undefined, endTime: r.endTime ?? undefined,
      durationMin: r.durationMin ?? undefined, distanceKm: r.distanceKm ?? undefined,
      caloriesBurned: r.caloriesBurned ?? undefined,
      avgHr: r.avgHr ?? undefined, maxHr: r.maxHr ?? undefined,
      notes: r.notes ?? undefined,
      routePolyline: r.routePolyline ?? undefined,
      splits: r.splits ?? undefined,
      bestEfforts: r.bestEfforts ?? undefined,
      paceSeries: r.paceSeries ?? undefined,
      avgPaceSecPerKm: r.avgPaceSecPerKm ?? undefined,
      elevationGainM: r.elevationGainM ?? undefined,
      elevationLossM: r.elevationLossM ?? undefined,
      createdAt: r.createdAt,
    }
  }
```

- [ ] **Step 2: Extend the `POST /api/activity-logs` body schema**

In `app/api/activity-logs/route.ts`, replace the `ActivityLogBody` schema
(lines 7-16) with:

```ts
const SplitSchema = z.object({ km: z.number(), paceSec: z.number() })
const PacePointSchema = z.object({ tSec: z.number(), paceSec: z.number() })

const ActivityLogBody = z.object({
  date:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activityType:    z.string().min(1),
  title:           z.string().min(1).max(120),
  startTime:       z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime:         z.string().regex(/^\d{2}:\d{2}$/).optional(),
  durationMin:     z.number().positive().optional(),
  distanceKm:      z.number().positive().optional(),
  caloriesBurned:  z.number().positive().optional(),
  notes:           z.string().max(1000).optional(),
  routePolyline:   z.string().optional(),
  splits:          z.array(SplitSchema).optional(),
  bestEfforts:     z.record(z.string(), z.number()).optional(),
  paceSeries:      z.array(PacePointSchema).optional(),
  avgPaceSecPerKm: z.number().positive().optional(),
  elevationGainM:  z.number().nonnegative().optional(),
  elevationLossM:  z.number().nonnegative().optional(),
})
```

- [ ] **Step 3: Don't overwrite an explicit `endTime` with the duration-derived one**

In `app/api/activity-logs/route.ts`, the `POST` handler currently always
derives `endTime` from `startTime + durationMin`. Replace lines 47-48:

```ts
  const { startTime, durationMin } = body.data
  const endTime = startTime && durationMin != null ? addMinutes(startTime, durationMin) : undefined
```

with:

```ts
  const { startTime, durationMin, endTime: providedEndTime } = body.data
  const endTime = providedEndTime ?? (startTime && durationMin != null ? addMinutes(startTime, durationMin) : undefined)
```

- [ ] **Step 4: Type-check and run the full test suite**

Run: `pnpm exec tsc --noEmit && pnpm test`

Expected: no type errors; all existing tests plus the new
`route-encoding`/`activity-metrics` tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/adapter.ts app/api/activity-logs/route.ts
git commit -m "Persist route polyline and computed metrics on activity logs"
```

---

## Task 7: Manual end-to-end check against local DB

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: POST a sample activity log with the new fields**

With the dev server running and a logged-in session cookie (sign in as
`test@local.dev` / `testpass123` at `/sign-in` first, then copy the session
cookie), run:

```bash
curl -s -X POST http://localhost:3000/api/activity-logs \
  -H "Content-Type: application/json" \
  -H "Cookie: <paste session cookie here>" \
  -d '{
    "date": "2026-06-11",
    "activityType": "run",
    "title": "Test Run",
    "startTime": "06:00",
    "endTime": "06:30",
    "durationMin": 30,
    "distanceKm": 5,
    "routePolyline": "_p~iF~ps|U_ulLnnqC",
    "splits": [{"km":1,"paceSec":300},{"km":2,"paceSec":295}],
    "bestEfforts": {"1km": 290},
    "paceSeries": [{"tSec":30,"paceSec":300}],
    "avgPaceSecPerKm": 300,
    "elevationGainM": 25,
    "elevationLossM": 18
  }'
```

Expected: `201` response with an `activityLog` object that includes
`routePolyline`, `splits`, `bestEfforts`, `paceSeries`, `avgPaceSecPerKm`,
`elevationGainM`, `elevationLossM` matching the request.

- [ ] **Step 3: Confirm it round-trips via GET**

Run:
```bash
curl -s "http://localhost:3000/api/activity-logs?days=1" -H "Cookie: <paste session cookie here>"
```

Expected: the response's `activityLogs` array includes the row created in
Step 2 with all new fields populated.

- [ ] **Step 4: Clean up the test row**

```bash
PGPASSWORD=postgres psql -h /tmp -p 5433 -U postgres -d trainingai_dev \
  -c "DELETE FROM activity_logs WHERE title = 'Test Run';"
```

No commit for this task — verification only.

---

## Self-Review Notes

- **Spec coverage:** Section 2 (data model) is fully covered (Tasks 2-3,
  6). The pure metric calculations referenced in Section 2/4 (splits, best
  efforts, pace series, elevation gain/loss, avg pace) are covered by Task 5.
  Route simplification + polyline encoding (Section 2/3) covered by Task 4.
  GPS tracking, the activity store, live screens (Sections 3-4) and
  calendar/history integration (Sections 5-6) are deliberately out of scope
  for this plan — see Plans 2 and 3.
- **Type consistency:** `RoutePoint` (`lib/activity/route-encoding.ts`) is
  used identically in `lib/activity/activity-metrics.ts`. `Split`,
  `PacePoint`, `bestEfforts: Record<string, number>` field names match the
  Drizzle schema (`splits`, `paceSeries`, `bestEfforts`) and `ActivityLog`
  type (`splits`, `paceSeries`, `bestEfforts`) in Task 3, and the Zod schema
  in Task 6.
