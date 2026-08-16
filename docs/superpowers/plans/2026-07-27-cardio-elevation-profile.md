# Elevation Profile Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A real elevation-vs-distance chart on the per-session activity detail sheet, for GPS
activities (primarily runs) whose route carries elevation data. Today only the aggregate
`elevationGainM`/`elevationLossM` numbers are stored — no per-point series exists, so no chart is
possible.

**Architecture:** Mirrors exactly how `paceSeries` was added to this same pipeline (the precedent
this backlog item names) — a new `computeElevationProfile` pure function alongside
`computePaceSeries` in `lib/activity/activity-metrics.ts`, a new `ActivityLog.elevationProfile`
field threaded through every layer `paceSeries` already goes through: the Postgres column
(migration), the repository type + Zod validation schema, the adapter's read/write mapping, the
`activity-store.ts` `finish()` computation, the `done-activity-screen.tsx` save payloads (local
SQLite write, outbox mutation, and web-fallback fetch — all three), the offline sync chain (local
SQLite table via `RECONCILE_COLUMNS`, `pushMutations`, pull-delta mapping), and finally a new
`ElevationProfileChart` component rendered in `activity-detail-sheet.tsx` next to the existing
`PaceBarChart`.

**No new architecture, no new sync domain** — this is the well-trodden "add a field" path an
existing per-point series (`paceSeries`) already validates end-to-end; every task below touches the
exact same files at the exact same call sites `paceSeries` touches, with the field name swapped.

**Tech Stack:** `chart.js` + `react-chartjs-2` (already installed, no new dep — `PaceBarChart` is
the reference), Drizzle migration, the existing offline-sync machinery (`lib/local-store/`).

---

### Task 1: `computeElevationProfile` pure function

**Files:**
- Modify: `lib/activity/activity-metrics.ts`
- Test: `lib/activity/__tests__/activity-metrics.test.ts`

Bucketed by distance (every `bucketKm`, default 0.1km) rather than time, since this is an
elevation-**vs-distance** chart — mirrors `computePaceSeries`'s bucketing loop shape exactly, but
keyed on cumulative distance instead of elapsed time, and reading `.ele` instead of computing pace.
Points without elevation data are skipped, matching `computeElevationChange`'s existing
null-skipping behavior — a route with partial elevation coverage just yields a sparser profile
instead of a fabricated one.

- [ ] **Step 1: Write the failing tests**

Add to `lib/activity/__tests__/activity-metrics.test.ts`, alongside the existing
`computeElevationChange` describe block:

```typescript
describe('computeElevationProfile', () => {
  it('buckets elevation by distance', () => {
    const points: RoutePoint[] = [
      { lat: -27.4698, lng: 153.0251, t: 0, ele: 10 },
      { lat: -27.4658, lng: 153.0251, t: 60_000, ele: 25 },  // ~0.44km, crosses 0.1/0.2/0.3/0.4
      { lat: -27.4608, lng: 153.0251, t: 120_000, ele: 15 }, // ~0.56km further
    ]
    const profile = computeElevationProfile(points, 0.2)
    expect(profile.length).toBeGreaterThan(0)
    expect(profile[0]).toEqual({ distKm: expect.any(Number), eleM: expect.any(Number) })
    expect(profile[profile.length - 1].distKm).toBeGreaterThan(profile[0].distKm)
  })

  it('skips points with no elevation data', () => {
    const points: RoutePoint[] = [
      { lat: -27.4698, lng: 153.0251, t: 0 },
      { lat: -27.4658, lng: 153.0251, t: 60_000 },
    ]
    expect(computeElevationProfile(points)).toEqual([])
  })

  it('returns empty for fewer than 2 points', () => {
    expect(computeElevationProfile([{ lat: -27.4698, lng: 153.0251, t: 0, ele: 10 }])).toEqual([])
  })
})
```

Add `computeElevationProfile` to the existing import block at the top of the test file:

```typescript
import {
  haversineDistanceKm,
  computeTotalDistanceKm,
  computeSplits,
  computeBestEfforts,
  computePaceSeries,
  computeElevationChange,
  computeElevationProfile,
  computeAvgPaceSecPerKm,
} from '../activity-metrics'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/activity/__tests__/activity-metrics.test.ts`
Expected: FAIL — `computeElevationProfile` is not exported

- [ ] **Step 3: Write the implementation**

In `lib/activity/activity-metrics.ts`, add after `computeElevationChange` (which stays unchanged):

```typescript
export interface ElevationPoint {
  distKm: number
  eleM: number
}

/** Elevation bucketed every `bucketKm` km (default 0.1km) for an elevation-vs-distance chart.
 *  Points without elevation data are skipped — the profile just has fewer entries, matching
 *  computeElevationChange's existing null-skipping behavior rather than fabricating a value. */
export function computeElevationProfile(points: RoutePoint[], bucketKm = 0.1): ElevationPoint[] {
  if (points.length < 2) return []

  const cum = cumulativeDistancesKm(points)
  const profile: ElevationPoint[] = []
  let nextBucketKm = 0

  for (let i = 0; i < points.length; i++) {
    const ele = points[i].ele
    if (ele == null) continue
    if (cum[i] >= nextBucketKm) {
      profile.push({ distKm: Math.round(cum[i] * 100) / 100, eleM: Math.round(ele) })
      nextBucketKm += bucketKm
    }
  }

  return profile
}
```

`cumulativeDistancesKm` is already a private helper in this same file (used by
`computeTotalDistanceKm`/`computeSplits`/`computeBestEfforts`/`computePaceSeries`) — no new export
needed, `computeElevationProfile` calls it directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/activity/__tests__/activity-metrics.test.ts`
Expected: PASS (all `computeElevationProfile` cases plus the pre-existing suite)

- [ ] **Step 5: Commit**

```bash
git add lib/activity/activity-metrics.ts lib/activity/__tests__/activity-metrics.test.ts
git commit -m "feat: add computeElevationProfile — a distance-bucketed elevation series"
```

---

### Task 2: DB column, repository type, validation, adapter mapping

**Files:**
- Modify: `lib/data/postgres/schema.ts`
- Create: `lib/data/postgres/migrations/151_activity_log_elevation_profile.sql`
- Modify: `lib/types/body.ts`
- Modify: `lib/validation/activity-log.ts`
- Modify: `lib/data/postgres/adapter.ts`

Highest existing migration is `150_daytime_hrv_model.sql` — this claims `151`; re-verify against
`main` at implementation time in case a parallel PR has since claimed it, and renumber if so.

- [ ] **Step 1: Migration**

```sql
-- 151_activity_log_elevation_profile.sql
ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS elevation_profile JSONB;
```

- [ ] **Step 2: Schema**

In `lib/data/postgres/schema.ts`, add to the `activityLogs` table definition, immediately after
`elevationLossM` (currently line 299):

```typescript
  elevationProfile: jsonb('elevation_profile').$type<{ distKm: number; eleM: number }[]>(),
```

- [ ] **Step 3: Repository type**

In `lib/types/body.ts`, add to the `ActivityLog` interface, immediately after `elevationLossM?: number`:

```typescript
  elevationProfile?: { distKm: number; eleM: number }[]
```

- [ ] **Step 4: Validation schema**

In `lib/validation/activity-log.ts`, add an `ElevationPointSchema` alongside the existing
`PacePointSchema`, and a field on `ActivityLogBody` immediately after `elevationLossM`:

```typescript
const ElevationPointSchema = z.object({ distKm: z.number(), eleM: z.number() })
```

```typescript
  elevationProfile: z.array(ElevationPointSchema).max(2000).optional(),
```

- [ ] **Step 5: Adapter — write, overwrite-set, and read mapping**

In `lib/data/postgres/adapter.ts`'s `saveActivityLog`, add to the `values` object immediately after
`elevationLossM: data.elevationLossM ?? null,` (currently line 1815):

```typescript
      elevationProfile: data.elevationProfile ?? null,
```

Add to the `overwrite` branch's `set` object immediately after `elevationLossM: values.elevationLossM,`
(currently line 1844):

```typescript
        elevationProfile: values.elevationProfile,
```

In `rowToActivityLog`, add immediately after `elevationLossM: r.elevationLossM ?? undefined,`
(currently line 1901):

```typescript
      elevationProfile: r.elevationProfile ?? undefined,
```

- [ ] **Step 6: Type-check and apply the migration**

```bash
npx tsc --noEmit
node scripts/local-db/migrate.js
```
Expected: clean, migration applies, `psql` `\d activity_logs` shows the `elevation_profile` column.

- [ ] **Step 7: Commit**

```bash
git add lib/data/postgres/schema.ts lib/data/postgres/migrations/151_activity_log_elevation_profile.sql lib/types/body.ts lib/validation/activity-log.ts lib/data/postgres/adapter.ts
git commit -m "feat: add elevationProfile column, wired through validation and the adapter"
```

---

### Task 3: Wire into `activity-store.ts`'s `finish()`

**Files:**
- Modify: `lib/stores/activity-store.ts`
- Modify: `components/activity/types.ts`

- [ ] **Step 1: Add the field to `ActivityDraftSummary`**

In `components/activity/types.ts`, import `ElevationPoint` alongside the existing `Split`/`PacePoint`
import and add the field after `elevationLossM?: number`:

```typescript
import type { Split, PacePoint, ElevationPoint } from '@/lib/activity/activity-metrics'
```

```typescript
  elevationProfile?: ElevationPoint[]
```

- [ ] **Step 2: Compute it in `finish()`**

In `lib/stores/activity-store.ts`, import `computeElevationProfile` alongside the existing
`computeElevationChange` import, and add to the `draftSummary` object inside the
`if (s.isDistanceBased && s.rawPoints.length >= 2)` block, immediately after
`elevationLossM: lossM,` (currently line 163):

```typescript
            elevationProfile: computeElevationProfile(s.rawPoints),
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/stores/activity-store.ts components/activity/types.ts
git commit -m "feat: compute the elevation profile when an activity finishes"
```

---

### Task 4: Thread it through the three save payloads in `done-activity-screen.tsx`

**Files:**
- Modify: `components/activity/done-activity-screen.tsx`

Three sites, matching exactly how `elevationGainM`/`elevationLossM` already appear at each: the
local SQLite `store.upsertActivityLog()` call, the outbox `store.queueMutation()` payload, and the
web-fallback `fetch('/api/activity-logs')` body.

- [ ] **Step 1: Local SQLite write**

Add immediately after `elevationLossM: draftSummary.elevationLossM ?? null,` inside the
`store.upsertActivityLog({...})` call (currently line 155):

```typescript
          elevationProfile: draftSummary.elevationProfile ?? null,
```

- [ ] **Step 2: Outbox mutation payload**

Add immediately after the second occurrence of `elevationLossM: draftSummary.elevationLossM ?? null,`
inside the `store.queueMutation({... payload: omitNullFields({...`  call (currently line 186):

```typescript
            elevationProfile: draftSummary.elevationProfile ?? null,
```

- [ ] **Step 3: Web-fallback fetch body**

Add immediately after `elevationLossM: draftSummary.elevationLossM,` inside the
`fetch('/api/activity-logs', {... body: JSON.stringify({...` call (currently line 228):

```typescript
          elevationProfile: draftSummary.elevationProfile,
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/activity/done-activity-screen.tsx
git commit -m "feat: save the elevation profile through all three activity-log write paths"
```

---

### Task 5: Offline sync chain — local table, pull-delta, RECONCILE_COLUMNS

**Files:**
- Modify: `lib/local-store/types.ts`
- Modify: `lib/local-store/sqlite-backend.ts`
- Modify: `lib/local-store/sync-engine.ts`
- Modify: `lib/sqlite/migrations.ts`

`pushMutations`' `activity_logs` branch (`lib/data/postgres/adapter.ts:3586-3606`) is generic —
schema-driven via `ActivityLogBody.safeParse` + `saveActivityLog(..., {overwrite:true})` — so no
`elevationProfile`-specific code is needed there; Task 2's validation-schema change is sufficient.
Likewise `getSyncDelta` selects all columns, so no per-field server-side mapping is needed for the
pull side either. What genuinely needs touching is the **local** SQLite side: the type, the
column list on both local writes, the pull-delta upsert, the pull-delta JS mapping, and the
self-healing schema registration.

- [ ] **Step 1: `LocalActivityLog` type**

In `lib/local-store/types.ts`, add to `LocalActivityLog` immediately after `elevationLossM: number | null;`:

```typescript
  elevationProfile: { distKm: number; eleM: number }[] | null;
```

- [ ] **Step 2: `RECONCILE_COLUMNS` registration**

In `lib/sqlite/migrations.ts`, add immediately after the `elevation_loss_m` entry:

```typescript
  { table: 'activity_logs', column: 'elevation_profile',    ddl: `ALTER TABLE activity_logs ADD COLUMN elevation_profile TEXT` },
```

This is the step CLAUDE.md's Local SQLite Migrations rule requires "in the same commit as the
migration" — a local column that isn't registered here is invisible to `reconcileSchema()` after a
partial upgrade.

- [ ] **Step 3: `sqlite-backend.ts` — read mapper**

In the `getActivityLogs` row mapper, add immediately after
`elevationLossM:  (r.elevation_loss_m as number) ?? null,` (currently line 747):

```typescript
      elevationProfile: typeof r.elevation_profile === 'string' ? JSON.parse(r.elevation_profile) : null,
```

- [ ] **Step 4: `sqlite-backend.ts` — pull-delta upsert**

In the `applyDelta`-equivalent loop over `delta.activityLogs ?? []`, add `elevation_profile` to the
`INSERT` column list (after `elevation_loss_m`), the matching `?` placeholder, the
`ON CONFLICT ... DO UPDATE SET` clause (`elevation_profile=excluded.elevation_profile`), and the
bound parameter (after `r.elevationLossM,`):

```typescript
      await runSQL(
        `INSERT INTO activity_logs
           (id, date, activity_type, title, duration_min, distance_km, steps,
            avg_hr, max_hr, calories_burned, start_time, end_time, notes,
            route_polyline, splits, best_efforts, pace_series,
            avg_pace_sec_per_km, elevation_gain_m, elevation_loss_m, elevation_profile,
            cadence_spm, cadence_series, cadence_source, updated_at, sync_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'synced')
         ON CONFLICT(id) DO UPDATE SET
           date=excluded.date, activity_type=excluded.activity_type,
           title=excluded.title, duration_min=excluded.duration_min,
           distance_km=excluded.distance_km, steps=excluded.steps,
           avg_hr=excluded.avg_hr, max_hr=excluded.max_hr,
           calories_burned=excluded.calories_burned, start_time=excluded.start_time,
           end_time=excluded.end_time, notes=excluded.notes,
           route_polyline=excluded.route_polyline, splits=excluded.splits,
           best_efforts=excluded.best_efforts, pace_series=excluded.pace_series,
           avg_pace_sec_per_km=excluded.avg_pace_sec_per_km,
           elevation_gain_m=excluded.elevation_gain_m, elevation_loss_m=excluded.elevation_loss_m,
           elevation_profile=excluded.elevation_profile,
           cadence_spm=excluded.cadence_spm, cadence_series=excluded.cadence_series,
           cadence_source=excluded.cadence_source,
           updated_at=excluded.updated_at, sync_status='synced'
         WHERE activity_logs.sync_status='synced'`,
        [r.id, r.date, r.activityType, r.title, r.durationMin, r.distanceKm,
         r.steps, r.avgHr, r.maxHr, r.caloriesBurned, r.startTime,
         r.endTime, r.notes, r.routePolyline,
         r.splits ? JSON.stringify(r.splits) : null,
         r.bestEfforts ? JSON.stringify(r.bestEfforts) : null,
         r.paceSeries ? JSON.stringify(r.paceSeries) : null,
         r.avgPaceSecPerKm, r.elevationGainM, r.elevationLossM,
         r.elevationProfile ? JSON.stringify(r.elevationProfile) : null,
         r.cadenceSpm, r.cadenceSeries ? JSON.stringify(r.cadenceSeries) : null, r.cadenceSource,
         r.updatedAt],
      );
```

(Replaces the existing block at `lib/local-store/sqlite-backend.ts:1399-1431` — the diff is
`elevation_profile` inserted at each of the four positions: column list, `VALUES` placeholder
count (24→25 plus the literal `'synced'`), `ON CONFLICT SET` clause, and bound parameter.)

- [ ] **Step 5: `sqlite-backend.ts` — local `upsertActivityLog`**

Same shape of change to `upsertActivityLog` (currently `lib/local-store/sqlite-backend.ts:2158-2192`):
add `elevation_profile` to the column list, the `VALUES` placeholder count, the
`ON CONFLICT ... SET` clause, and `record.elevationProfile ? JSON.stringify(record.elevationProfile) : null,`
to the bound parameters (immediately after `record.elevationGainM, record.elevationLossM,`).

- [ ] **Step 6: `sync-engine.ts` — pull-delta JS mapping**

In `applyPullDelta`'s `activityLogs` map (currently `lib/local-store/sync-engine.ts:296-323`), add
immediately after `elevationLossM:  (r.elevationLossM as number) ?? null,`:

```typescript
    elevationProfile: (r.elevationProfile as { distKm: number; eleM: number }[] | null) ?? null,
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Manual verification**

`pnpm dev` (web sandbox — native SQLite doesn't run here, so this only exercises the web-fallback
path; the local-SQLite path in Tasks 4-5 needs the on-device smoke run, flagged in Task 7's
journal). Log a run with a route (or use the local dev DB seed's GPS-bearing activity logs), confirm
via `psql` that `activity_logs.elevation_profile` is populated when the route carries elevation
data.

- [ ] **Step 9: Commit**

```bash
git add lib/local-store/types.ts lib/local-store/sqlite-backend.ts lib/local-store/sync-engine.ts lib/sqlite/migrations.ts
git commit -m "feat: thread elevationProfile through the offline sync chain"
```

---

### Task 6: `ElevationProfileChart` component

**Files:**
- Create: `components/activity/elevation-profile-chart.tsx`
- Modify: `components/activity/activity-detail-sheet.tsx`

Mirrors `PaceBarChart`'s exact visual language and chart.js setup — a `Line` chart instead of `Bar`
(elevation-vs-distance reads naturally as a line/area, matching the spec's "elevation profile" framing),
same token-resolved colors, same `h-28` sizing convention.

- [ ] **Step 1: Create the component**

```tsx
// components/activity/elevation-profile-chart.tsx
'use client'

import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from 'chart.js'
import { resolveColor } from '@/lib/chart-colors'
import type { ElevationPoint } from '@/lib/activity/activity-metrics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip)

interface Props {
  profile: ElevationPoint[]
}

export function ElevationProfileChart({ profile }: Props) {
  const chartData = useMemo<ChartData<'line'>>(() => ({
    labels: profile.map(p => p.distKm.toFixed(1)),
    datasets: [{
      data: profile.map(p => p.eleM),
      borderColor: resolveColor('var(--color-brand)'),
      backgroundColor: resolveColor('var(--color-brand)'),
      fill: true,
      pointRadius: 0,
      borderWidth: 1.75,
      tension: 0.3,
    }],
  }), [profile])

  if (profile.length < 2) return null

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        ticks: { color: resolveColor('var(--muted-foreground)'), font: { size: 9 }, maxTicksLimit: 5 },
        grid: { display: false },
      },
      y: {
        ticks: {
          color: resolveColor('var(--muted-foreground)'),
          font: { size: 9 },
          maxTicksLimit: 4,
          callback: v => `${v}m`,
        },
        grid: { color: resolveColor('var(--border)') },
      },
    },
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elevation</p>
      <div className="h-28 w-full">
        <Line data={chartData} options={options} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `activity-detail-sheet.tsx`**

Add the import alongside the existing `PaceBarChart` import:

```typescript
import { ElevationProfileChart } from './elevation-profile-chart'
```

Render it immediately after the existing `PaceBarChart` block (currently lines 223-225):

```tsx
            {log.elevationProfile && log.elevationProfile.length > 1 && (
              <ElevationProfileChart profile={log.elevationProfile} />
            )}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual verification (dev server + Playwright)**

`pnpm dev`. Since the web sandbox has no real GPS elevation data, seed a test `activity_logs` row
via `psql` with a non-null `elevation_profile` array (e.g.
`UPDATE activity_logs SET elevation_profile = '[{"distKm":0,"eleM":10},{"distKm":0.5,"eleM":25},{"distKm":1,"eleM":15}]' WHERE id = '<a run row>';`),
open that activity's detail sheet, and confirm the "Elevation" chart renders below the pace bar
chart with a visible line.

- [ ] **Step 5: Commit**

```bash
git add components/activity/elevation-profile-chart.tsx components/activity/activity-detail-sheet.tsx
git commit -m "feat: render the elevation profile chart on the activity detail sheet"
```

---

### Task 7: Full gate, version bump, session bookkeeping

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `projectOverview.md`
- Create: `docs/overview/entries/2026-07-27-cardio-elevation-profile.md`
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
(Stop any running `pnpm dev` first.)

- [ ] **Step 3: Version bump + changelog**

Minor bump; changelog entry describing the new elevation chart in plain language.

- [ ] **Step 4: Journal entry**

`docs/overview/entries/2026-07-27-cardio-elevation-profile.md` — what shipped, and explicitly flag
**not verified**: on-device (APK) for the local-SQLite/offline-sync path (Task 5) — the web sandbox
only exercises the web-fallback write path and a manually-seeded read path, never the native SQLite
local-first write→sync→pull round-trip; real GPS elevation data (the dev sandbox has no real device
GPS, so the chart was only verified against a hand-seeded row, never a genuine recorded route).

- [ ] **Step 5: `projectOverview.md`**

Update the Current Status chain; add a Known Issues row for the on-device-not-verified items above.

- [ ] **Step 6: Backlog update**

In `docs/implementation-backlog.md`'s cardio batch: mark the elevation-profile-chart item shipped
with a pointer note, matching the style of prior items in this batch.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "chore: version bump, journal entry and backlog update for the elevation profile chart"
git push -u origin feat/cardio-elevation-profile
```

---

## Self-Review Notes

- **Spec coverage:** the backlog item's four named pieces are all covered — `computeElevationProfile`
  pure function ✅ Task 1; `ActivityLog.elevationProfile` field + DB column/migration ✅ Task 2;
  wiring in `activity-store.ts`'s `finish()` ✅ Task 3; the `pushMutations` branch, local SQLite
  table/reconcile entries, and pull-delta mapping ✅ Task 5 (the `pushMutations` branch itself needs
  no code change, confirmed generic/schema-driven — documented in Task 5's intro, not silently
  assumed).
- **No new sync domain, no new architecture:** every touched file already handles `paceSeries`
  identically — this plan adds one more field to an existing, proven pattern rather than inventing
  anything new.
- **DRY / One Formula, One Place:** `computeElevationProfile` lives in the same file as
  `computeElevationChange` (the existing aggregate) and reuses the same private
  `cumulativeDistancesKm` helper `computeSplits`/`computeBestEfforts`/`computePaceSeries` already
  share — no second distance-accumulation implementation.
- **Out of scope, by design:** no changes to `encodeRoute`/`route-encoding.ts` (the polyline
  encoding already drops `ele`, per the backlog item's own note — this plan stores the elevation
  profile as its own JSONB series, entirely independent of the route polyline, so nothing there
  needs to change).
- **Type consistency:** `ElevationPoint` (Task 1) is the one type used everywhere downstream —
  `ActivityDraftSummary` (Task 3), `LocalActivityLog` (Task 5), and the chart component's props
  (Task 6) all import or structurally match `{ distKm: number; eleM: number }`, never a
  second/drifting shape.
