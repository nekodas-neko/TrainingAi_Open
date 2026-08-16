# Cardio Trends Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-week trends surface to the `/cardio` hub — weekly time-in-zone stacks, a
pace-vs-HR efficiency curve, and a cadence trend — following the same view-picker + `cachedFetch`
pattern the existing `TrendsSection`/`TrendChart` (`components/health/`) already established for the
`/health` page's correlation trends.

**Architecture:** One new aggregation-only API route (`/api/cardio-trends`) built entirely from data
that already exists: `repo.getZoneMinutesRange` (already used by `/api/cardio-week`) for the zone
stacks, and `repo.listActivityLogs` (already used elsewhere, filtered to `activityType === 'run'`) for
per-run `avgHr`/`avgPaceSecPerKm`/`cadenceSpm`. No new DB columns, no new stored data. Client side:
one orchestrator component with a pill picker (mirrors `TrendsSection`) and three chart.js chart
components (mirrors `TrendChart`), added to the bottom of the existing cardio hub
(`components/cardio/cardio-content.tsx`).

**Tech Stack:** `chart.js` + `react-chartjs-2` (already installed). `resolveColor` from
`lib/chart-colors.ts` for every canvas colour — same hard constraint as the sibling
`cardio-session-visuals` plan.

**Deferred, not silently dropped:** Spec D-6 lists five trend views: efficiency curve, weekly zone
stacks, **distance/pace vs anchor**, cadence trend, and **PR history**. The two bolded views depend on
baseline anchors, which don't exist yet — anchors are explicitly scoped to backlog item "Density-
progression engine + anchors + test sessions" (`feat/cardio-progression`, plan not yet written), and
running-specific PRs are explicitly the anchor system's own "beat-your-best" mechanism per that item's
backlog note (spec D-1's gamification pick belongs to the running program, not a general chart). This
plan builds the three views that need no new upstream data; the backlog update in Task 6 adds an
explicit follow-up row for the anchor-dependent two, cross-referenced to the progression-engine item so
it isn't forgotten once anchors ship.

---

### Task 1: Week-bucketing date helper

**Files:**
- Modify: `lib/date-utils.ts`
- Test: `lib/__tests__/date-utils.test.ts` (create if it doesn't already exist — check first with
  `ls lib/__tests__/date-utils.test.ts`; if it exists, add these cases to it instead of overwriting)

`startOfWeekInTz` only answers "the start of *this* week" — bucketing eight weeks of history needs the
same Monday-start logic for an arbitrary day string. New function, same UTC-safe date-string arithmetic
`aestMidnight`/`startOfWeekInTz` already use (`setUTCDate` handles month/year rollover automatically —
never hand-add to a date string).

- [ ] **Step 1: Write the failing tests**

```typescript
import { weekStartForDay } from '../date-utils'

describe('weekStartForDay', () => {
  it('returns the same date when it is already a Monday', () => {
    expect(weekStartForDay('2026-07-20')).toBe('2026-07-20') // a Monday
  })

  it('returns the preceding Monday for a mid-week date', () => {
    expect(weekStartForDay('2026-07-23')).toBe('2026-07-20') // Thursday -> Monday
  })

  it('returns the preceding Monday for a Sunday', () => {
    expect(weekStartForDay('2026-07-26')).toBe('2026-07-20') // Sunday -> Monday
  })

  it('handles a month boundary correctly', () => {
    expect(weekStartForDay('2026-08-02')).toBe('2026-07-27') // Sunday -> Monday, crossing months
  })
})
```

(If `lib/__tests__/date-utils.test.ts` already exists with a `describe('...')` structure for other
functions, add this `describe` block alongside the existing ones and keep the existing import line,
adding `weekStartForDay` to it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/__tests__/date-utils.test.ts`
Expected: FAIL — `weekStartForDay` is not exported

- [ ] **Step 3: Add the implementation**

Add to `lib/date-utils.ts`, near `startOfWeekInTz`:

```typescript
// Returns the Monday on/before an arbitrary "YYYY-MM-DD" day string — the same Mon-Sun week
// convention as startOfWeekInTz, but for a historical date rather than "now". Used to bucket a
// day-by-day range into weekly totals (cardio trends).
export function weekStartForDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // 0=Mon … 6=Sun
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/__tests__/date-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/date-utils.ts lib/__tests__/date-utils.test.ts
git commit -m "feat: add weekStartForDay for bucketing historical date ranges into weeks"
```

---

### Task 2: Pure trend-aggregation functions

**Files:**
- Create: `lib/health/cardio-trends.ts`
- Test: `lib/health/__tests__/cardio-trends.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest'
import { bucketZoneMinutesByWeek, buildEfficiencyCurve, buildCadenceTrend } from '../cardio-trends'

describe('bucketZoneMinutesByWeek', () => {
  it('sums same-week days into one bucket', () => {
    const days = [
      { day: '2026-07-20', seconds: [60, 120, 0, 0, 0] as [number, number, number, number, number] },
      { day: '2026-07-21', seconds: [0, 60, 60, 0, 0] as [number, number, number, number, number] },
    ]
    const result = bucketZoneMinutesByWeek(days)
    expect(result).toEqual([{ weekStart: '2026-07-20', seconds: [60, 180, 60, 0, 0] }])
  })

  it('splits days across a week boundary into separate buckets, sorted ascending', () => {
    const days = [
      { day: '2026-07-26', seconds: [0, 100, 0, 0, 0] as [number, number, number, number, number] }, // Sun, week of 07-20
      { day: '2026-07-27', seconds: [0, 50, 0, 0, 0] as [number, number, number, number, number] },  // Mon, week of 07-27
    ]
    const result = bucketZoneMinutesByWeek(days)
    expect(result).toEqual([
      { weekStart: '2026-07-20', seconds: [0, 100, 0, 0, 0] },
      { weekStart: '2026-07-27', seconds: [0, 50, 0, 0, 0] },
    ])
  })

  it('returns an empty array for no days', () => {
    expect(bucketZoneMinutesByWeek([])).toEqual([])
  })
})

describe('buildEfficiencyCurve', () => {
  it('includes only runs with both avgHr and avgPaceSecPerKm, sorted oldest first', () => {
    const logs = [
      { date: '2026-07-20', avgHr: 150, avgPaceSecPerKm: 330 },
      { date: '2026-07-15', avgHr: undefined, avgPaceSecPerKm: 300 },
      { date: '2026-07-10', avgHr: 145, avgPaceSecPerKm: 340 },
    ]
    expect(buildEfficiencyCurve(logs)).toEqual([
      { date: '2026-07-10', avgHr: 145, avgPaceSecPerKm: 340 },
      { date: '2026-07-20', avgHr: 150, avgPaceSecPerKm: 330 },
    ])
  })
})

describe('buildCadenceTrend', () => {
  it('includes only runs with a cadenceSpm value, sorted oldest first', () => {
    const logs = [
      { date: '2026-07-20', cadenceSpm: 168 },
      { date: '2026-07-10', cadenceSpm: undefined },
      { date: '2026-07-05', cadenceSpm: 172 },
    ]
    expect(buildCadenceTrend(logs)).toEqual([
      { date: '2026-07-05', cadenceSpm: 172 },
      { date: '2026-07-20', cadenceSpm: 168 },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/health/__tests__/cardio-trends.test.ts`
Expected: FAIL with "Cannot find module '../cardio-trends'"

- [ ] **Step 3: Write the implementation**

```typescript
import { weekStartForDay } from '@/lib/date-utils'

export interface WeeklyZoneStack {
  weekStart: string
  seconds: [number, number, number, number, number]
}

/** Buckets daily per-zone seconds (from `getZoneMinutesRange`) into Mon-Sun week totals. */
export function bucketZoneMinutesByWeek(
  days: { day: string; seconds: [number, number, number, number, number] }[],
): WeeklyZoneStack[] {
  const byWeek = new Map<string, [number, number, number, number, number]>()
  for (const row of days) {
    const weekStart = weekStartForDay(row.day)
    const existing = byWeek.get(weekStart) ?? [0, 0, 0, 0, 0]
    byWeek.set(weekStart, [
      existing[0] + row.seconds[0],
      existing[1] + row.seconds[1],
      existing[2] + row.seconds[2],
      existing[3] + row.seconds[3],
      existing[4] + row.seconds[4],
    ])
  }
  return [...byWeek.entries()]
    .map(([weekStart, seconds]) => ({ weekStart, seconds }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface EfficiencyPoint {
  date: string
  avgHr: number
  avgPaceSecPerKm: number
}

/** Per-run pace-vs-HR points, oldest first. A run needs both an avg HR reading and a GPS pace
 *  to plot — one with no HR data, or a non-distance session, contributes nothing here. */
export function buildEfficiencyCurve(
  logs: { date: string; avgHr?: number; avgPaceSecPerKm?: number }[],
): EfficiencyPoint[] {
  return logs
    .filter((l): l is { date: string; avgHr: number; avgPaceSecPerKm: number } =>
      l.avgHr != null && l.avgPaceSecPerKm != null)
    .map((l) => ({ date: l.date, avgHr: l.avgHr, avgPaceSecPerKm: l.avgPaceSecPerKm }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface CadenceTrendPoint {
  date: string
  cadenceSpm: number
}

/** Per-run average cadence, oldest first — only runs with a measured cadence contribute. */
export function buildCadenceTrend(
  logs: { date: string; cadenceSpm?: number }[],
): CadenceTrendPoint[] {
  return logs
    .filter((l): l is { date: string; cadenceSpm: number } => l.cadenceSpm != null)
    .map((l) => ({ date: l.date, cadenceSpm: l.cadenceSpm }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/health/__tests__/cardio-trends.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/health/cardio-trends.ts lib/health/__tests__/cardio-trends.test.ts
git commit -m "feat: add pure aggregation functions for the cardio trends surface"
```

---

### Task 3: `CARDIO_TRENDS_TTL` cache constant

**Files:**
- Modify: `lib/cache-ttl.ts`

- [ ] **Step 1: Add the constant**

Add near `CARDIO_WEEK_TTL` (currently around line 58):

```typescript
// Cardio trends (weekly zone stacks, efficiency curve, cadence trend) — multi-week history
// changes slowly; same TTL tier as the existing health-trends surface (TTL_MEDIUM).
export const CARDIO_TRENDS_TTL = TTL_MEDIUM;
```

- [ ] **Step 2: Commit**

```bash
git add lib/cache-ttl.ts
git commit -m "feat: add CARDIO_TRENDS_TTL cache constant"
```

---

### Task 4: `/api/cardio-trends` route

**Files:**
- Create: `app/api/cardio-trends/route.ts`

Mirrors `/api/cardio-week/route.ts`'s auth/rate-limit/tz boilerplate and its exact
`resolveHrProfile(repo, userId, tz)` call for `getZoneMinutesRange`'s profile argument — one canonical
HR-profile resolution, not a second copy.

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz, todayMidnightUtc, toAestDay } from '@/lib/date-utils'
import { resolveHrProfile } from '@/lib/health/hr-profile'
import { bucketZoneMinutesByWeek, buildEfficiencyCurve, buildCadenceTrend } from '@/lib/health/cardio-trends'

const ZONE_WEEKS = 8
const RUN_LOOKBACK_DAYS = 90

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`${userId}:cardio-trends`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const repo = await getRepository()

  const today = todayInTz(tz)
  const zoneFrom = toAestDay(new Date(todayMidnightUtc(tz).getTime() - ZONE_WEEKS * 7 * 86_400_000), tz)
  const runFrom = toAestDay(new Date(todayMidnightUtc(tz).getTime() - RUN_LOOKBACK_DAYS * 86_400_000), tz)

  const profile = await resolveHrProfile(repo, userId, tz)

  const [days, logs] = await Promise.all([
    repo.getZoneMinutesRange(userId, zoneFrom, today, tz, profile).catch(() => []),
    repo.listActivityLogs(userId, runFrom, today).catch(() => []),
  ])

  const runLogs = logs.filter((l) => l.activityType === 'run')

  return NextResponse.json(
    {
      weeklyZoneStacks: bucketZoneMinutesByWeek(days),
      efficiencyCurve: buildEfficiencyCurve(runLogs),
      cadenceTrend: buildCadenceTrend(runLogs),
    },
    { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=600' } },
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Manual verification**

Start `pnpm dev`, sign in, `curl` (or open in-browser while signed in) `/api/cardio-trends` and confirm
a 200 with the three arrays (they may be empty on the base seed if it has no `run`-type activity logs
with GPS/HR data — that's an expected empty-history response, not a bug).

- [ ] **Step 4: Commit**

```bash
git add app/api/cardio-trends/route.ts
git commit -m "feat: add /api/cardio-trends aggregation route"
```

---

### Task 5: Trend chart components + orchestrator

**Files:**
- Create: `components/cardio/zone-stack-chart.tsx`
- Create: `components/cardio/efficiency-chart.tsx`
- Create: `components/cardio/cadence-trend-chart.tsx`
- Create: `components/cardio/trends-section.tsx`
- Modify: `components/cardio/cardio-content.tsx`

- [ ] **Step 1: Weekly zone stack chart (stacked bar)**

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
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'
import { HR_ZONE_META } from '@/lib/health/hr-zones'
import type { WeeklyZoneStack } from '@/lib/health/cardio-trends'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  weeks: WeeklyZoneStack[]
}

export function ZoneStackChart({ weeks }: Props) {
  const data = useMemo<ChartData<'bar'>>(() => ({
    labels: weeks.map((w) => w.weekStart.slice(5)), // MM-DD
    datasets: HR_ZONE_META.map((zone) => ({
      label: `Z${zone.id} ${zone.name}`,
      data: weeks.map((w) => Math.round(w.seconds[zone.id - 1] / 60)),
      backgroundColor: zone.color,
      stack: 'zones',
    })),
  }), [weeks])

  if (weeks.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
          scales: {
            x: { stacked: true, ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { stacked: true, ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: resolveColor('var(--border)') } },
          },
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Efficiency curve chart (dual-axis line, pace vs HR over time)**

```tsx
'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartData,
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'
import type { EfficiencyPoint } from '@/lib/health/cardio-trends'

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip)

interface Props {
  points: EfficiencyPoint[]
}

export function EfficiencyChart({ points }: Props) {
  const data = useMemo<ChartData<'line'>>(() => ({
    labels: points.map((p) => p.date.slice(5)),
    datasets: [
      {
        label: 'Avg HR',
        data: points.map((p) => p.avgHr),
        borderColor: 'rgba(239, 68, 68, 0.85)',
        backgroundColor: 'transparent',
        yAxisID: 'y',
        pointRadius: 2,
        tension: 0.3,
      },
      {
        label: 'Avg pace (sec/km)',
        data: points.map((p) => p.avgPaceSecPerKm),
        borderColor: resolveColor('var(--color-brand)'),
        backgroundColor: 'transparent',
        yAxisID: 'y1',
        pointRadius: 2,
        tension: 0.3,
      },
    ],
  }), [points])

  if (points.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Line
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
          scales: {
            x: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { position: 'left', ticks: { color: 'rgba(239, 68, 68, 0.85)', font: { size: 9 }, maxTicksLimit: 4 }, grid: { display: false } },
            y1: {
              position: 'right',
              reverse: true, // faster pace (lower sec/km) reads as "up", matching the pace bar chart's convention
              ticks: { color: resolveColor('var(--color-brand)'), font: { size: 9 }, maxTicksLimit: 4 },
              grid: { color: resolveColor('var(--border)') },
            },
          },
        }}
      />
      <p className="mt-1 text-center text-[10px] text-muted-foreground">
        Falling HR at a similar (or faster) pace over time means better aerobic efficiency.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Cadence trend chart (bar, mirrors `components/health/trend-chart.tsx`)**

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
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'
import type { CadenceTrendPoint } from '@/lib/health/cardio-trends'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

interface Props {
  points: CadenceTrendPoint[]
}

export function CadenceTrendChart({ points }: Props) {
  const data = useMemo<ChartData<'bar'>>(() => ({
    labels: points.map((p) => p.date.slice(5)),
    datasets: [{
      data: points.map((p) => p.cadenceSpm),
      backgroundColor: resolveColor('var(--color-brand)'),
      borderRadius: 4,
      maxBarThickness: 18,
    }],
  }), [points])

  if (points.length === 0) return null

  return (
    <div className="h-40 w-full">
      <Bar
        data={data}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: true } },
          scales: {
            x: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 } }, grid: { display: false } },
            y: { ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 4 }, grid: { color: resolveColor('var(--border)') } },
          },
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Orchestrator with the view picker**

```tsx
'use client'

import { memo, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { CARDIO_TRENDS_TTL } from '@/lib/cache-ttl'
import type { WeeklyZoneStack, EfficiencyPoint, CadenceTrendPoint } from '@/lib/health/cardio-trends'

const ZoneStackChart = dynamic(() => import('./zone-stack-chart').then((m) => ({ default: m.ZoneStackChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})
const EfficiencyChart = dynamic(() => import('./efficiency-chart').then((m) => ({ default: m.EfficiencyChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})
const CadenceTrendChart = dynamic(() => import('./cadence-trend-chart').then((m) => ({ default: m.CadenceTrendChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})

interface CardioTrendsResponse {
  weeklyZoneStacks: WeeklyZoneStack[]
  efficiencyCurve: EfficiencyPoint[]
  cadenceTrend: CadenceTrendPoint[]
}

const CACHE_KEY = 'cardio-trends'

const VIEWS = [
  { key: 'zones', label: 'Zone minutes' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'cadence', label: 'Cadence' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

export const CardioTrendsSection = memo(function CardioTrendsSection() {
  const [view, setView] = useState<ViewKey>('zones')
  const [data, setData] = useState<CardioTrendsResponse | null>(null)

  useEffect(() => {
    const seeded = readCacheSync<CardioTrendsResponse>(CACHE_KEY)
    setData(seeded)
    cachedFetch<CardioTrendsResponse>(CACHE_KEY, '/api/cardio-trends', CARDIO_TRENDS_TTL, setData)
  }, [])

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trends</h3>

      <div className="mb-3 flex gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-none rounded-full border px-3 py-1 text-xs font-semibold transition ${
              view === v.key
                ? 'border-brand bg-brand text-black'
                : 'border-border bg-muted text-muted-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      ) : view === 'zones' ? (
        data.weeklyZoneStacks.length > 0 ? (
          <ZoneStackChart weeks={data.weeklyZoneStacks} />
        ) : (
          <p className="text-xs text-muted-foreground">Not enough history yet — keep logging zone minutes.</p>
        )
      ) : view === 'efficiency' ? (
        data.efficiencyCurve.length > 0 ? (
          <EfficiencyChart points={data.efficiencyCurve} />
        ) : (
          <p className="text-xs text-muted-foreground">No GPS runs with HR data yet.</p>
        )
      ) : data.cadenceTrend.length > 0 ? (
        <CadenceTrendChart points={data.cadenceTrend} />
      ) : (
        <p className="text-xs text-muted-foreground">No cadence readings yet.</p>
      )}
    </div>
  )
})
```

Following `trends-section.tsx`'s explicit failure-state rule: `cachedFetch` swallows a failed request
internally (never rejects), so `data` staying `null` forever is indistinguishable from "still loading" —
this component accepts that ambiguity the same way the existing `TrendsSection` does (a permanent
skeleton on a real failure) rather than inventing a new failure-detection mechanism here; if this proves
to be a real problem in practice it should be fixed in both places, not just this new one.

- [ ] **Step 5: Wire into the hub**

In `components/cardio/cardio-content.tsx`, import `CardioTrendsSection` and render it after the existing
`ModalityPicker` (check the current JSX order in that file before editing — add it as the last card in
the scrollable content, following the existing spacing between cards).

```tsx
import { CardioTrendsSection } from './trends-section'
```

```tsx
<CardioTrendsSection />
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 7: Manual verification (dev server + Playwright)**

1. Run `pnpm dev`, sign in, open `/cardio`.
2. Confirm a "Trends" card renders below the modality picker with three pill buttons.
3. Tap each pill and confirm the corresponding chart (or "not enough history" message) renders without
   a layout jump or console error.
4. Toggle light/dark theme and confirm no invisible gridlines/text in any of the three charts.
5. If the seed has no `run`-type activity logs with HR/pace/cadence, log one manually (or note in the
   journal that efficiency/cadence views were only checked against their empty states — say so plainly,
   don't claim populated-view coverage that wasn't exercised).

- [ ] **Step 8: Commit**

```bash
git add components/cardio/zone-stack-chart.tsx components/cardio/efficiency-chart.tsx components/cardio/cadence-trend-chart.tsx components/cardio/trends-section.tsx components/cardio/cardio-content.tsx
git commit -m "feat: add the cardio trends surface to the /cardio hub"
```

---

### Task 6: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-trends.md`
- Modify: `docs/implementation-backlog.md`

- [ ] **Step 1: Run the full local gate**

```bash
pnpm lint
node scripts/check-reconcile.js
node scripts/check-push-mutations.js
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Isolated production build**

```bash
rm -rf .next
npm run build
```

(Stop any running `pnpm dev` first — concurrent builds corrupt `.next`, per the established workaround.)

- [ ] **Step 3: Bump the version and add a changelog entry**

Minor bump (new user-visible feature) in `package.json`; matching `lib/changelog.ts` entry describing
the three trend views and the anchor-dependent deferral.

- [ ] **Step 4: Write the session journal entry**

Create `docs/overview/entries/2026-07-27-cardio-trends.md` per the convention in
`docs/overview/entries/README.md`: what shipped, the deferred distance/pace-vs-anchor and PR-history
views and why (blocked on backlog item "Density-progression engine"), and what wasn't verified
(populated efficiency/cadence charts if the seed lacked qualifying data, on-device APK rendering).

- [ ] **Step 5: Update `projectOverview.md`**

Update the Latest/Previous feature chain and tick this item shipped, with a note on the two deferred
trend views.

- [ ] **Step 6: Update the backlog**

In `docs/implementation-backlog.md`'s cardio batch table: remove this item's row, add a `✅ SHIPPED`
pointer note, renumber remaining rows, and add (or fold into the existing progression-engine row) an
explicit note that "distance/pace vs anchor" and "PR history" trend views are follow-up work for once
that item ships anchors — so the deferred scope from this plan's overview isn't an orphaned finding.

- [ ] **Step 7: Commit and push**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/entries/2026-07-27-cardio-trends.md docs/implementation-backlog.md
git commit -m "chore: version bump, journal entry and backlog update for cardio trends"
git push -u origin feat/cardio-trends
```

---

## Self-Review Notes

- **Spec coverage (D-6 trends):** weekly zone stacks ✅ (Task 5 Step 1), efficiency curve ✅ (Task 5
  Step 2, built from raw per-session `avgHr`/`avgPaceSecPerKm` rather than inventing a new derived
  "efficiency factor" formula not backed by an established definition), cadence trend ✅ (Task 5 Step
  3). Distance/pace vs anchor and PR history — **explicitly deferred**, tracked in Task 6 Step 6.
- **Canvas colour hazard:** every chart component resolves every `var(--x)` colour via `resolveColor`
  before handing it to chart.js; verified against each `ticks.color`/`grid.color`/`backgroundColor`/
  `borderColor` in Task 5.
- **One Formula, One Place:** `getZoneMinutesRange`, `resolveHrProfile`, and `HR_ZONE_META` are reused
  exactly as the sibling `/api/cardio-week` route and `ZoneQuotaCard`/`ZoneBreakdown` components already
  use them — no second zone-colour palette or HR-profile resolution introduced.
- **Independent of the sibling `cardio-session-visuals` plan:** this plan touches no file that plan
  touches (different components, different route, different lib module) — the two can implement and
  merge in either order.
