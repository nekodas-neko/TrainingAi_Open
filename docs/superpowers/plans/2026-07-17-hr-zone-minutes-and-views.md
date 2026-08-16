# HR Zone-Minutes Primitive + Per-Workout Zone View + Time-in-Zone Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single shared "time-in-zone" primitive the app is missing, then light up two surfaces on top of it — a Whoop-style **per-workout/per-activity zone breakdown + Session Load** (Feature 1) and **daily / weekly / monthly time-in-zone stats** (Feature 4).

**Architecture:** One pure module (`lib/health/zone-minutes.ts`) classifies an HR-reading series into the five canonical Karvonen zones (`lib/health/hr-zones.ts`) and accumulates seconds-per-zone, plus an Edwards-TRIMP "Session Load" number. Per-workout views compute this **client-side, derive-on-read** from the HR readings the detail sheets already fetch (`/api/oura/hr-window`) + the zone profile (`/api/hr-profile`) — no persistence needed. The day/week/month stats read a new server-side **rollup cache** table `daily_zone_minutes` (migration 129) that is **reconcile-on-read** (recomputed from `oura_heartrate` when missing or for the still-partial current day) — it is a server-computed aggregate like `weekly-stats`, NOT an offline-first user-write domain, so it needs no local-store/outbox path.

**Tech Stack:** TypeScript; `lib/health/zone-minutes.ts` (pure), Drizzle table + repo slice, a `GET /api/zone-minutes` route, chart.js/`react-chartjs-2` (already used), the existing `computeHrZones`/`zoneForBpm`/`getHrForWindow` primitives, `lib/cache-ttl.ts` + `lib/cache-groups.ts`, vitest.

---

## Why this is the keystone

Two of the owner's requested features share one missing primitive. Today HR zones are computed **live-only for display** (`components/workout/live-hr-chart.tsx`, `components/guided-walk/walk-active.tsx`) and thrown away — nothing accumulates "you spent 12 min in Zone 3." Feature 1 (per-workout zone breakdown) and Feature 4 (day/week/month time-in-zone) both need that accumulation. Build the pure primitive once and both surfaces follow.

**Naming discipline (avoid the two-"strain" collision):** the whole-day, movement-based (MET) metric planned in `docs/superpowers/plans/2026-07-16-training-stress-score-and-vo2max.md` is **"Training Stress (OTS)"**. The per-workout HR-zone intensity number built here is **"Session Load"** (Edwards TRIMP). Different names, different scope — never reuse "Training Stress" for the per-workout number, and never re-band the zone thresholds (they come only from `hr-zones.ts`).

## Verified current state (2026-07-17)

- **Canonical zones:** `lib/health/hr-zones.ts` — `computeHrZones({ maxHr, restingHr })` returns 5 `HrZone` bands (`id` 1–5, `name` Recovery/Light/Aerobic/Hard/Peak, `minBpm`, `maxBpm` (Infinity for top), `color` hex token safe in both themes); `zoneForBpm(bpm, zones)` classifies a bpm (always non-null). Do not re-implement.
- **Zone profile source:** `GET /api/hr-profile` (`app/api/hr-profile/route.ts`) returns `{ maxHr, restingHr, reserve }` (age-predicted HRmax + 28-day avg resting HR). Cached `HR_PROFILE_TTL` (`lib/cache-ttl.ts`).
- **HR series source:** `getHrForWindow(userId, from, to)` (`lib/data/postgres/slices/oura.ts:418`) → `{ timestamp, bpm, source }[]` (strap-preferred buckets), ordered ascending. `oura_heartrate` holds all-day HR (`schema.ts:678`, cols `userId, timestamp, bpm, source`; pruned at 180 days).
- **Per-workout HR readings, already fetched by the UI:** `GET /api/oura/hr-window` (`app/api/oura/hr-window/route.ts`) → `{ avgHr, maxHr, readings: {timestamp, bpm}[] }` for a window (accepts `?date&startTime&endTime` or `?start&end`; on-demand Oura backfill). The **activity detail sheet** (`components/activity/activity-detail-sheet.tsx`, 171 lines) already fetches this and renders `components/activity/activity-hr-chart.tsx` (a plain red HR line). This is the F1 mount point.
- **Session time windows:** `workout_sessions.startedAt` / `.completedAt` (`schema.ts:144`); `activity_logs.date` + `.startTime`/`.endTime`/`.durationMin`, `.avgHr`/`.maxHr` (`schema.ts` activityLogs).
- **Stats mount point (F4):** `app/health/health-sections.tsx` renders cards via a `case` registry (e.g. `weeklyStats` → `WeeklyStatsHub`, `health-sections.tsx:702`). `components/stats/weekly-stats-hub.tsx` and `components/health/weekly-muscle-sets-card.tsx` are the sibling patterns to mirror.
- **Cache:** per-key TTLs live in `lib/cache-ttl.ts`; invalidation groups in `lib/cache-groups.ts`. New aggregate GET routes ship `Cache-Control: private, max-age=60, stale-while-revalidate=120`.

## File structure

**Create:**
- `lib/health/zone-minutes.ts` — pure: `accumulateZoneSeconds`, `edwardsTrimp`, `zoneBreakdownFromReadings`, types.
- `lib/health/__tests__/zone-minutes.test.ts` — unit tests (accumulation, gap cap, TRIMP, breakdown).
- `lib/data/postgres/migrations/129_daily_zone_minutes.sql` — rollup cache table.
- `app/api/zone-minutes/route.ts` — `GET ?from&to` → daily zone-second rows (reconcile-on-read).
- `components/health/zone-breakdown.tsx` — the per-zone horizontal bars (F1) + Session Load, `memo`.
- `components/health/time-in-zone-card.tsx` — the day/week/month stacked stat card (F4), `memo`.
- `components/health/__tests__/` not required (pure logic lives in `zone-minutes.ts`).

**Modify:**
- `lib/data/postgres/schema.ts` — add the `dailyZoneMinutes` table def.
- `lib/data/repository.ts` — add `getZoneMinutesRange` to the interface.
- `lib/data/postgres/adapter.ts` + `lib/data/postgres/slices/oura.ts` — implement `computeDayZoneSeconds` + rollup get/upsert + `getZoneMinutesRange`.
- `lib/local-store/` reconcile registration — **N/A**: `daily_zone_minutes` is server-only (not synced). Add a one-line comment in the migration noting this. Do NOT add it to `RECONCILE_TABLES`.
- `components/activity/activity-detail-sheet.tsx` — add a "Zones" section (ZoneBreakdown) + Session Load, computed client-side from the readings it already has.
- `components/workout/done-screen.tsx` — add the same ZoneBreakdown + Session Load for a just-finished workout (uses its HR window).
- `app/health/health-sections.tsx` — register the `TimeInZoneCard` in the card `case` registry.
- `lib/cache-ttl.ts` — `ZONE_MINUTES_TTL`.
- `lib/cache-groups.ts` — register the `zone-minutes:` key in the workout/activity/oura-sync invalidation groups.
- `lib/changelog.ts` + `package.json` (version bump — user-visible); journal + `projectOverview.md` (orchestrator, end of PR).

---

### Task 1: The pure zone-minutes primitive — `lib/health/zone-minutes.ts`

**Files:**
- Create: `lib/health/zone-minutes.ts`
- Test: `lib/health/__tests__/zone-minutes.test.ts`

One Formula, One Place: zone-time accumulation + Session Load live here and nowhere else. Both surfaces import them.

- [ ] **Step 1: Write the failing tests** (`lib/health/__tests__/zone-minutes.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { computeHrZones } from '../hr-zones'
import { accumulateZoneSeconds, edwardsTrimp, zoneBreakdownFromReadings } from '../zone-minutes'

// Profile: maxHr 190, restingHr 50 → reserve 140. Zone lower bpms:
// Z1 50, Z2 50+0.6*140=134, Z3 50+0.7*140=148, Z4 50+0.8*140=162, Z5 50+0.9*140=176
const zones = computeHrZones({ maxHr: 190, restingHr: 50 })

const t = (min: number) => new Date(Date.UTC(2026, 6, 17, 15, 0, 0) + min * 60_000).getTime()

describe('accumulateZoneSeconds', () => {
  it('attributes the gap to the zone of the earlier reading', () => {
    // 100 bpm (Z1) for 1 min, then 150 bpm (Z3) for 1 min, then a trailing sample.
    const readings = [
      { timestamp: t(0), bpm: 100 },
      { timestamp: t(1), bpm: 150 },
      { timestamp: t(2), bpm: 150 },
    ]
    const secs = accumulateZoneSeconds(readings, zones)
    expect(secs[0]).toBeCloseTo(60, 5) // Z1: first 60s
    expect(secs[2]).toBeCloseTo(60, 5) // Z3: second 60s
    expect(secs[1]).toBe(0)
    expect(secs[3]).toBe(0)
  })

  it('caps a large data gap at maxGapSec (idle / no-data stretch)', () => {
    const readings = [
      { timestamp: t(0), bpm: 140 },     // Z2
      { timestamp: t(60), bpm: 140 },    // 1h gap → capped to 120s
    ]
    const secs = accumulateZoneSeconds(readings, zones, 120)
    expect(secs[1]).toBe(120)
  })

  it('returns all-zero for <2 readings', () => {
    expect(accumulateZoneSeconds([], zones)).toEqual([0, 0, 0, 0, 0])
    expect(accumulateZoneSeconds([{ timestamp: t(0), bpm: 140 }], zones)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('edwardsTrimp', () => {
  it('sums minutes-in-zone weighted by zone number (1..5)', () => {
    // 60s Z1, 120s Z3, 60s Z5 → 1*1 + 2*3 + 1*5 = 12
    expect(edwardsTrimp([60, 0, 120, 0, 60])).toBeCloseTo(1 * 1 + 2 * 3 + 1 * 5, 5)
  })
  it('is zero for an empty session', () => {
    expect(edwardsTrimp([0, 0, 0, 0, 0])).toBe(0)
  })
})

describe('zoneBreakdownFromReadings', () => {
  it('returns per-zone seconds, percentages, total, and Session Load', () => {
    const readings = [
      { timestamp: t(0), bpm: 100 },  // Z1 60s
      { timestamp: t(1), bpm: 150 },  // Z3 60s
      { timestamp: t(2), bpm: 150 },
    ]
    const b = zoneBreakdownFromReadings(readings, zones)
    expect(b.totalSec).toBeCloseTo(120, 5)
    expect(b.zones[0].seconds).toBeCloseTo(60, 5)
    expect(b.zones[2].seconds).toBeCloseTo(60, 5)
    expect(b.zones[0].pct).toBeCloseTo(50, 1)
    expect(b.sessionLoad).toBe(Math.round(1 * 1 + 1 * 3))
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/health/__tests__/zone-minutes.test.ts`
  Expected: FAIL (`zone-minutes` module not found).

- [ ] **Step 3: Implement `lib/health/zone-minutes.ts`**

```typescript
import { zoneForBpm, type HrZone } from './hr-zones'

export interface HrReading {
  /** epoch ms */
  timestamp: number
  bpm: number
}

/** Default cap for the gap between two consecutive readings (seconds). A ring
 *  samples ~1/min; a strap faster. Anything longer than this is a data gap
 *  (ring asleep, no wear) and must not inflate a zone — cap it. */
export const DEFAULT_MAX_GAP_SEC = 120

/** Seconds spent in each of the 5 zones. Index 0 = Zone 1 … index 4 = Zone 5.
 *  Each inter-sample interval is attributed to the zone of the EARLIER reading,
 *  with the interval capped at maxGapSec. */
export function accumulateZoneSeconds(
  readings: HrReading[],
  zones: HrZone[],
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): number[] {
  const secs = [0, 0, 0, 0, 0]
  for (let i = 0; i < readings.length - 1; i++) {
    const dt = Math.min((readings[i + 1].timestamp - readings[i].timestamp) / 1000, maxGapSec)
    if (dt <= 0) continue
    const z = zoneForBpm(readings[i].bpm, zones)
    secs[z.id - 1] += dt
  }
  return secs
}

/** Edwards TRIMP — the standard HR training-load number: minutes-in-zone × zone
 *  number (1..5), summed. This is "Session Load" (NOT "Training Stress (OTS)"). */
export function edwardsTrimp(zoneSeconds: number[]): number {
  return zoneSeconds.reduce((sum, sec, i) => sum + (sec / 60) * (i + 1), 0)
}

export interface ZoneSlice {
  id: HrZone['id']
  name: string
  color: string
  seconds: number
  pct: number
}
export interface ZoneBreakdown {
  zones: ZoneSlice[]
  totalSec: number
  sessionLoad: number
}

/** Full breakdown for a surface: per-zone seconds + %, total, and Session Load. */
export function zoneBreakdownFromReadings(
  readings: HrReading[],
  zones: HrZone[],
  maxGapSec = DEFAULT_MAX_GAP_SEC,
): ZoneBreakdown {
  const secs = accumulateZoneSeconds(readings, zones, maxGapSec)
  const totalSec = secs.reduce((a, b) => a + b, 0)
  return {
    zones: zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: z.color,
      seconds: secs[i],
      pct: totalSec > 0 ? (secs[i] / totalSec) * 100 : 0,
    })),
    totalSec,
    sessionLoad: Math.round(edwardsTrimp(secs)),
  }
}
```

- [ ] **Step 4: Run to verify it passes + commit** — `npx vitest run lib/health/__tests__/zone-minutes.test.ts` → PASS.

```bash
git add lib/health/zone-minutes.ts lib/health/__tests__/zone-minutes.test.ts
git commit -m "Add pure HR zone-minutes primitive + Edwards-TRIMP Session Load"
```

---

### Task 2: Rollup cache table — migration `129_daily_zone_minutes.sql` + schema

**Files:**
- Create: `lib/data/postgres/migrations/129_daily_zone_minutes.sql`
- Modify: `lib/data/postgres/schema.ts`

`daily_zone_minutes` is a **server-side derived cache** of a value computable from `oura_heartrate`. It is NOT a user-write domain and must NOT be added to the offline local store / outbox / `RECONCILE_TABLES`.

- [ ] **Step 1: Write the migration**

```sql
-- 129_daily_zone_minutes.sql
-- Server-side rollup CACHE of per-day time-in-HR-zone, derived from oura_heartrate.
-- NOT an offline-first user-write domain: it is recomputed on read (reconcile) and
-- is never written by a device outbox. One row per (user, local date).
CREATE TABLE IF NOT EXISTS daily_zone_minutes (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         date NOT NULL,                 -- user-local date (YYYY-MM-DD)
  zone1_sec   integer NOT NULL DEFAULT 0,
  zone2_sec   integer NOT NULL DEFAULT 0,
  zone3_sec   integer NOT NULL DEFAULT 0,
  zone4_sec   integer NOT NULL DEFAULT 0,
  zone5_sec   integer NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
```

- [ ] **Step 2: Add the Drizzle table to `schema.ts`** (next to the other oura/health tables)

```typescript
export const dailyZoneMinutes = pgTable('daily_zone_minutes', {
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day:        date('day', { mode: 'string' }).notNull(),
  zone1Sec:   integer('zone1_sec').notNull().default(0),
  zone2Sec:   integer('zone2_sec').notNull().default(0),
  zone3Sec:   integer('zone3_sec').notNull().default(0),
  zone4Sec:   integer('zone4_sec').notNull().default(0),
  zone5Sec:   integer('zone5_sec').notNull().default(0),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.day] }) }))
```

- [ ] **Step 3: Apply the migration locally + verify** — `node scripts/local-db/migrate.js` (or `pnpm db:local`), then:

```bash
psql "postgresql://postgres:postgres@localhost:5433/trainingai_dev" -c "\d daily_zone_minutes"
```
Expected: the table with the `(user_id, day)` primary key.

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/129_daily_zone_minutes.sql lib/data/postgres/schema.ts
git commit -m "Add daily_zone_minutes rollup cache table (migration 129)"
```

---

### Task 3: Repo compute + reconcile-on-read — adapter + slice + interface

**Files:**
- Modify: `lib/data/postgres/slices/oura.ts` (compute + rollup get/upsert live next to `getHrForWindow`)
- Modify: `lib/data/postgres/adapter.ts` (expose `getZoneMinutesRange`)
- Modify: `lib/data/repository.ts` (interface)

The compute reuses `getHrForWindow` + the pure primitive. Reconcile rule: for **past** days use the cached row if present; for a **missing** past day, compute + persist; for **today** (partial, still changing) always recompute and do not trust a stale cache.

- [ ] **Step 1: Add compute + range fns to `slices/oura.ts`** (after `getHrForWindow`, ~line 429)

```typescript
import { computeHrZones } from '@/lib/health/hr-zones'
import { accumulateZoneSeconds, type HrReading } from '@/lib/health/zone-minutes'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export interface DayZoneSeconds { day: string; seconds: [number, number, number, number, number] }

/** Compute one local day's zone-seconds from stored HR, using the caller's zone
 *  profile. Pure DB read → primitive; no persistence here. */
export async function computeDayZoneSeconds(
  db: Db, userId: string, day: string, tz: string,
  profile: { maxHr: number; restingHr: number },
): Promise<[number, number, number, number, number]> {
  const from = fromZonedTime(`${day}T00:00:00`, tz)
  const to = fromZonedTime(`${day}T23:59:59`, tz)
  const rows = await getHrForWindow(db, userId, from, to)
  const readings: HrReading[] = rows.map(r => ({
    timestamp: (r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp)).getTime(),
    bpm: r.bpm,
  }))
  const zones = computeHrZones(profile)
  return accumulateZoneSeconds(readings, zones) as [number, number, number, number, number]
}

/** Range of daily zone-seconds with reconcile-on-read caching. `today` (user-local)
 *  is always recomputed (partial day); other missing days are computed and cached. */
export async function getZoneMinutesRange(
  db: Db, userId: string, fromDay: string, toDay: string, tz: string,
  profile: { maxHr: number; restingHr: number },
): Promise<DayZoneSeconds[]> {
  const today = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  const cached = await db.select().from(s.dailyZoneMinutes).where(and(
    eq(s.dailyZoneMinutes.userId, userId),
    gte(s.dailyZoneMinutes.day, fromDay),
    lte(s.dailyZoneMinutes.day, toDay),
  ))
  const byDay = new Map(cached.map(r => [r.day, r]))

  const out: DayZoneSeconds[] = []
  for (const day of eachDay(fromDay, toDay)) {
    const row = byDay.get(day)
    if (row && day !== today) {
      out.push({ day, seconds: [row.zone1Sec, row.zone2Sec, row.zone3Sec, row.zone4Sec, row.zone5Sec] })
      continue
    }
    const seconds = await computeDayZoneSeconds(db, userId, day, tz, profile)
    out.push({ day, seconds })
    if (day !== today) {
      // cache past days only (today is partial and re-derived each read)
      await db.insert(s.dailyZoneMinutes).values({
        userId, day,
        zone1Sec: Math.round(seconds[0]), zone2Sec: Math.round(seconds[1]), zone3Sec: Math.round(seconds[2]),
        zone4Sec: Math.round(seconds[3]), zone5Sec: Math.round(seconds[4]),
      }).onConflictDoUpdate({
        target: [s.dailyZoneMinutes.userId, s.dailyZoneMinutes.day],
        set: {
          zone1Sec: Math.round(seconds[0]), zone2Sec: Math.round(seconds[1]), zone3Sec: Math.round(seconds[2]),
          zone4Sec: Math.round(seconds[3]), zone5Sec: Math.round(seconds[4]), computedAt: new Date(),
        },
      })
    }
  }
  return out
}

/** Inclusive YYYY-MM-DD day iterator using Date.UTC overflow normalisation
 *  (never string-splice arithmetic — see the Date Arithmetic rule). */
function eachDay(fromDay: string, toDay: string): string[] {
  const out: string[] = []
  const [fy, fm, fd] = fromDay.split('-').map(Number)
  const [ty, tm, td] = toDay.split('-').map(Number)
  let cur = Date.UTC(fy, fm - 1, fd)
  const end = Date.UTC(ty, tm - 1, td)
  while (cur <= end) {
    const dt = new Date(cur)
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`)
    cur += 86_400_000
  }
  return out
}
```

> Note: confirm `s.dailyZoneMinutes`, `and/eq/gte/lte`, and the `Db` type are imported at the top of `slices/oura.ts` (they already are for `getHrForWindow`). Add the `dailyZoneMinutes` import to the `s` schema namespace if the file imports named tables rather than `* as s`.

- [ ] **Step 2: Expose `getZoneMinutesRange` on the adapter** (`lib/data/postgres/adapter.ts`) — delegate to the slice, threading the profile the route passes:

```typescript
async getZoneMinutesRange(userId: string, fromDay: string, toDay: string, tz: string, profile: { maxHr: number; restingHr: number }) {
  return getZoneMinutesRange(this.db, userId, fromDay, toDay, tz, profile)
}
```

- [ ] **Step 3: Add to the repository interface** (`lib/data/repository.ts`)

```typescript
getZoneMinutesRange(
  userId: string, fromDay: string, toDay: string, tz: string,
  profile: { maxHr: number; restingHr: number },
): Promise<{ day: string; seconds: [number, number, number, number, number] }[]>
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "zone-minutes|oura.ts|adapter.ts|repository.ts" || echo clean
git add lib/data/postgres/slices/oura.ts lib/data/postgres/adapter.ts lib/data/repository.ts
git commit -m "Compute + reconcile-on-read daily zone-minutes rollups in the repo"
```

---

### Task 4: `GET /api/zone-minutes?from&to` route

**Files:**
- Create: `app/api/zone-minutes/route.ts`

- [ ] **Step 1: Implement the route** (session auth; tz-aware; SWR + rate limit matching sibling aggregate routes; resolves the zone profile the same way `/api/hr-profile` does, reused here so the range and the per-workout view use identical zones)

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, todayInTz, normalizeDateParam, ageFromDob, toAestDay, todayMidnightUtc } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { hrMaxFromAge } from '@/lib/health/hr-zones'

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:zone-minutes`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const tz = session.user?.timezone ?? DEFAULT_TZ
  const today = todayInTz(tz)
  const to = normalizeDateParam(req.nextUrl.searchParams.get('to')) ?? today
  const from = normalizeDateParam(req.nextUrl.searchParams.get('from'))
    ?? toAestDay(new Date(todayMidnightUtc(tz).getTime() - 29 * 86_400_000), tz) // default: last 30 days

  const repo = await getRepository()
  // Zone profile — same derivation as /api/hr-profile (One Formula, One Place).
  const [user, body] = await Promise.all([
    repo.getUserById(userId),
    repo.listBodyMetrics(userId, from, today),
  ])
  const rhrRows = body.filter(m => m.restingHeartRate != null && m.restingHeartRate > 0)
  const restingHr = rhrRows.length
    ? Math.round(rhrRows.reduce((s, m) => s + m.restingHeartRate!, 0) / rhrRows.length) : 60
  const maxHr = hrMaxFromAge(ageFromDob(user?.dateOfBirth, new Date()))

  const days = await repo.getZoneMinutesRange(userId, from, to, tz, { maxHr, restingHr })

  return NextResponse.json(
    { from, to, profile: { maxHr, restingHr }, days },
    { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' } },
  )
}
```

> If `normalizeDateParam` isn't exported from `lib/date-utils`, add it there (the repo's rule requires every route with a `date` param to route it through `normalizeDateParam`; several routes already do). Verify by grep before assuming.

- [ ] **Step 2: Manual smoke** — `pnpm dev`, then `curl -s "http://localhost:3000/api/zone-minutes?from=2026-07-10&to=2026-07-17" -H "cookie: <session>"` returns `{ from, to, profile, days: [{ day, seconds:[...] }, ...] }`. Commit.

```bash
git add app/api/zone-minutes/route.ts
git commit -m "Add GET /api/zone-minutes range route (reconcile-on-read rollups)"
```

---

### Task 5: Feature 1 — per-workout/activity Zone Breakdown + Session Load

**Files:**
- Create: `components/health/zone-breakdown.tsx`
- Modify: `components/activity/activity-detail-sheet.tsx`, `components/workout/done-screen.tsx`

The breakdown is computed **client-side** from readings the surfaces already have (`/api/oura/hr-window`) + the zone profile (`/api/hr-profile`), via the shared `lib/health/zone-minutes.ts`. No new persistence.

- [ ] **Step 1: `ZoneBreakdown` component** — `memo`; renders the five horizontal bars (Whoop-style) with each zone's colour + name + bpm range + duration + %, plus a "Session Load" number with a Lucide icon and a text label (never colour-alone). Colours come from the `HrZone.color` tokens; bar widths from `pct`.

```tsx
'use client'
import { memo, useMemo } from 'react'
import { Activity } from 'lucide-react'
import { computeHrZones } from '@/lib/health/hr-zones'
import { zoneBreakdownFromReadings, type HrReading } from '@/lib/health/zone-minutes'
import { formatTime } from '@/components/workout/utils' // mm:ss formatter (verify export)

interface Props {
  readings: { timestamp: string; bpm: number }[]
  profile: { maxHr: number; restingHr: number } | null
}

export const ZoneBreakdown = memo(function ZoneBreakdown({ readings, profile }: Props) {
  const breakdown = useMemo(() => {
    if (!profile || readings.length < 2) return null
    const zones = computeHrZones(profile)
    const hr: HrReading[] = readings.map(r => ({ timestamp: new Date(r.timestamp).getTime(), bpm: r.bpm }))
    return zoneBreakdownFromReadings(hr, zones)
  }, [readings, profile])

  if (!breakdown) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time in Zone</p>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Session Load <span className="font-semibold text-foreground">{breakdown.sessionLoad}</span>
        </span>
      </div>
      <ul className="space-y-1.5">
        {[...breakdown.zones].reverse().map(z => ( // Z5 at top, like the reference UI
          <li key={z.id} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] font-medium" style={{ color: z.color }}>Z{z.id} {z.name}</span>
            <span className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
              <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${z.pct}%`, backgroundColor: z.color }} />
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{formatTime(Math.round(z.seconds))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
})
```

> Verify `formatTime` in `components/workout/utils.ts` renders mm:ss; if it needs hh:mm:ss for long sessions, use it or add a local `fmt`. Do not introduce a second time formatter if one exists.

- [ ] **Step 2: Mount in the activity detail sheet.** `components/activity/activity-detail-sheet.tsx` already fetches `/api/oura/hr-window` (readings, avg, max). Add a `cachedFetch` of `/api/hr-profile` (key + TTL `HR_PROFILE_TTL`, reuse the existing key if one exists — grep first) and render `<ZoneBreakdown readings={readings} profile={profile} />` directly under the existing `<ActivityHrChart />`. Pass stable props (memoize `profile`).

- [ ] **Step 3: Mount on the workout done-screen.** `components/workout/done-screen.tsx` already computes an HR window for the finished session (it renders the HR-recovery card). Reuse those readings + the hr-profile fetch to render `<ZoneBreakdown />` in the summary. Do not re-fetch HR if the done-screen already has it.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npx eslint components/health/zone-breakdown.tsx components/activity/activity-detail-sheet.tsx components/workout/done-screen.tsx && npx tsc --noEmit 2>&1 | head -5
git add components/health/zone-breakdown.tsx components/activity/activity-detail-sheet.tsx components/workout/done-screen.tsx
git commit -m "Show per-workout/activity zone breakdown + Session Load (Feature 1)"
```

---

### Task 6: Feature 4 — day / week / month Time-in-Zone stat card

**Files:**
- Create: `components/health/time-in-zone-card.tsx`
- Modify: `app/health/health-sections.tsx`, `lib/cache-ttl.ts`

- [ ] **Step 1: `ZONE_MINUTES_TTL` in `lib/cache-ttl.ts`**

```typescript
/** /api/zone-minutes daily rollups — today is partial (re-derived server-side),
 *  past days are cached, so a 30-min client TTL is safe. */
export const ZONE_MINUTES_TTL = TTL_MEDIUM
```

- [ ] **Step 2: `TimeInZoneCard`** — `memo`; a day/week/month toggle (reuse the `components/ui/` pill-tab primitive — grep before hand-rolling) that fetches `/api/zone-minutes` for the selected window via `cachedFetch` + `readCacheSync` seed (seed in a `useEffect`, not a `useState` initializer), and renders a **stacked** bar (chart.js, colours from `computeHrZones` tokens resolved via `resolveColor` — never pass `var(--x)` to canvas; never white/black-alpha literal gridlines) plus a summary line ("This month: 4h 12m in Zone 2+"). Colour is always paired with the zone name/label (no colour-only state). Window math uses `todayInTz` + `lib/date-utils` range helpers (never `now − N×86400000`).

- [ ] **Step 3: Register in the health card registry.** In `app/health/health-sections.tsx`, add a `case "timeInZone": return <TimeInZoneCard key="timeInZone" />;` to the render switch (mirror `weeklyStats` at `health-sections.tsx:702`) and add `"timeInZone"` to wherever the card order/list is defined.

- [ ] **Step 4: Lint + typecheck + commit**

```bash
npx eslint components/health/time-in-zone-card.tsx app/health/health-sections.tsx lib/cache-ttl.ts && npx tsc --noEmit 2>&1 | head -5
git add components/health/time-in-zone-card.tsx app/health/health-sections.tsx lib/cache-ttl.ts
git commit -m "Add day/week/month Time-in-Zone stat card (Feature 4)"
```

---

### Task 7: Cache invalidation wiring

**Files:**
- Modify: `lib/cache-groups.ts`

The `zone-minutes:` payload derives from `oura_heartrate`, which changes on (a) workout completion (HR sync), (b) an activity log with HR, (c) an Oura sync. Register the key in each of those groups so a fresh workout's zones/stats aren't served stale.

- [ ] **Step 1: Add `zone-minutes` to the relevant groups.** Grep `lib/cache-groups.ts` for `invalidateWorkoutSummaries` and the Oura/activity groups; add the `zone-minutes:` prefix key to each (mirror how `weekly-stats`/`muscle-recovery` are registered). If a group helper doesn't exist for activity writes, add the key to the closest existing group that fires on an activity log.

- [ ] **Step 2: Verify no bare key / prefix-sibling mistake** — the client fetch key is `zone-minutes:<from>:<to>`; register the `zone-minutes:` prefix (with the colon) so prefix invalidation catches every window. Confirm there's no bare `zone-minutes` (no colon) key elsewhere.

- [ ] **Step 3: Commit**

```bash
git add lib/cache-groups.ts
git commit -m "Invalidate zone-minutes cache on workout/activity/oura writes"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate** — `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`.

- [ ] **Step 2: Dev-server smoke against local DB** (`pnpm dev`, log in as `test@local.dev` / `testpass123`). The seed has body metrics + some sessions; to exercise zones you need HR rows in `oura_heartrate` for a day — insert a synthetic day of readings if the seed lacks them:

```sql
-- ~1 reading/min for 2026-07-16, bpm ramping 90→175 (spans several zones)
INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
SELECT :uid, timestamp '2026-07-16 06:00:00+10' + (g || ' minutes')::interval,
       90 + (85.0 * g / 600)::int, 'ble'
FROM generate_series(0, 600) g
ON CONFLICT DO NOTHING;
```

  Exact checks:
  1. `GET /api/zone-minutes?from=2026-07-16&to=2026-07-16` → a `days[0].seconds` array with non-zero spread across zones; a `daily_zone_minutes` row now exists for 2026-07-16 (verify with psql) but NOT for today (partial). 
  2. Re-hit the same URL → identical numbers (served from the cached rollup for the past day).
  3. Health page (S25 viewport 412×915) → the **Time in Zone** card renders the stacked bars with a day/week/month toggle; colours pair with zone labels.
  4. Open an activity with HR in the detail sheet → the **Time in Zone** breakdown + **Session Load** render under the HR chart; Session Load is a plausible integer with an icon + label (not colour-alone).
  5. Complete a workout on `/workout` → the done-screen shows the same breakdown.

- [ ] **Step 3: Version + changelog + (orchestrator) journal/index.** Bump `package.json` **minor** (new user-visible metric on 3 surfaces). `lib/changelog.ts` top entry: "New: see exactly how long each workout and every day/week/month put you in each heart-rate zone, plus a Session Load number for how hard each session was." (The journal entry + `projectOverview.md` index + backlog removal are handled in the batched planning PR by the orchestrator — do not prepend to a shared history file.)

- [ ] **Step 4: Push** — `git push -u origin <branch>`. Standard change (additive migration, no auth/security, no data-dropping) — merge on green per the CI/CD workflow once the smoke passes.

---

## Verification summary

- **Automated (sandbox):** the zone-minutes primitive (accumulation, gap cap, TRIMP, breakdown — ~6 cases); the reconcile-range compute against seeded `oura_heartrate`; full existing suites + gate.
- **Dev-server (sandbox):** `/api/zone-minutes` range + rollup caching + today-is-partial behaviour; the health Time-in-Zone card and the per-workout breakdown at the S25 web viewport.
- **NOT sandbox-verifiable — state in the PR:**
  - **Real HR density.** The sandbox seeds synthetic `oura_heartrate`; only on-device does a real worn day (ring/strap cadence, sleep gaps) exercise the `maxGapSec` cap and the strap-preferred bucketing. Verify the day totals look sane on a real day on the S25.
  - **Samsung WebView rendering** of the stacked bars / breakdown bars (gradient-sibling compositor quirks) — eyeball on the APK.
  - No native/Kotlin, no offline-sync domain touched (server-only aggregate) — ships via Railway with no APK rebuild.

## Notes for the implementer

- **`daily_zone_minutes` is a derived cache, never a source of truth** — it is always recomputable from `oura_heartrate`. Never let a device write it; never add it to the outbox / `RECONCILE_TABLES`. If in doubt, delete a row and it self-heals on next read.
- **Zones come only from `computeHrZones`; Session Load only from `edwardsTrimp`.** Do not re-band thresholds or invent a second load formula. If the app later gets user-editable zones, change `hr-zones.ts` once and every surface here follows.
- **"Session Load" ≠ "Training Stress (OTS)".** Keep the labels distinct on every surface.
- Anchor by symbol if line numbers drift (the Oura slice/adapter move fast).
