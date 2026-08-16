# Cross-Domain Correlations (energy-balance × training, soreness × volume) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two genuinely-missing cross-domain correlation views — **energy balance (nutrition) vs strength** and **per-muscle training volume vs next-morning soreness** — to the app's existing correlation engine, and surface them in the health-tab Trends card, so the user can see whether under-fuelling costs them strength and whether a muscle's volume predicts its soreness.

**Architecture:** This is **~90% reuse.** The app already has a generic bucketed-correlation engine (`lib/health/correlation.ts`: `bucketize` / `correlationInsight` / `computeBaselines` / `pctFromBaseline`), a multi-view route (`app/api/health-trends/route.ts`) that already serves five correlation views, and a mounted client card (`components/health/trends-section.tsx`) that is a tab-strip over those views. This plan adds **two new pure helper functions** (`lib/health/energy-balance.ts`, `lib/health/soreness-volume.ts`) with unit tests, **two new `?view=` branches** to the existing route that wire repo data → helper → the existing `bucketize`/`correlationInsight` primitives, and **two entries to the `VIEWS` array** in the client card. No new route, no new component, no migration, no schema change — all data already lands in `body_metrics`, `workout_sessions`/`exercise_logs`, and `day_checkins`.

**Tech Stack:** TypeScript, Next.js 15 route handlers, Drizzle/Postgres (read-only), the existing `lib/health/correlation.ts` engine, `lib/muscles.ts` (`normalizeMuscle`/`moodMuscleMatches`), vitest.

---

## Runtime reality / verification note

- **Server/JS + client only — ships via Railway, no APK rebuild, no migration.** Fully buildable AND verifiable in the sandbox against the local dev Postgres (`pnpm db:local`) + `pnpm dev`.
- The two new pure helpers are unit-tested in the sandbox (`pnpm test`).
- The route branches are verifiable against the local dev DB by seeding a few days of `body_metrics` + `workout_sessions` + `day_checkins` and hitting `/api/health-trends?view=energy-balance` / `?view=soreness-volume`.
- The client card change is verifiable in `pnpm dev` (the two new tabs appear and render buckets or the "Not enough data yet" state).
- **Not device-gated** — nothing here touches native plugins, safe-area, BLE, or offline-first local writes. It reads server-computed aggregates exactly like the five existing views (which are server-only by design, per CLAUDE.md's read-site audit note — cross-session aggregates stay on `cachedFetch`).

## Scope — what this does and does NOT build

**In scope (the two clearly-missing, clearly-cross-domain, highest-ROI signals from spec §C3):**
- **Energy balance ↔ strength** — does eating below your own norm going into a session cost you strength on the bar?
- **Soreness ↔ volume** — does higher training volume for a muscle predict that muscle being sore the next morning?

**Explicitly OUT of scope (with rationale — do NOT build these here):**
- **Weather ↔ performance** — the spec assumed weather is stored; it is **not**. `schema.ts` has no weather/latitude/longitude columns — weather is fetched live client-side only (`lib/weather/`). This would require a new capture path (a schema change + a write path) and therefore violates the "no new capture" premise. Left for a separate plan if wanted.
- **Sleep regularity index** — already has a shipped formula (`computeSleepStartConsistency`, `lib/health/sleep-consistency.ts`); it is a single-domain sleep index, not a cross-domain correlation. Not built here.
- **Bodyweight trend / rate-of-change** — already shipped (`computeWeightRateKgPerWeek`, `lib/health/long-term-goal-progress.ts`) and already rendered on the health tab.
- **Meal timing vs sleep** — already the `meal-timing` view in the route.
- **Readiness/HRV ↔ strength** and **subjective-vs-objective recovery** — already the `recovery-vs-strength` and `subjective-recovery` views.

If you find yourself writing weather code, a migration, or a new component/route, STOP — you have left this plan's scope.

## File structure

**Create:**
- `lib/health/energy-balance.ts` — pure helpers: per-day energy-balance-proxy map + baseline-relative pairing points.
- `lib/health/soreness-volume.ts` — pure helper: per-(day, muscle) volume-load → next-morning-soreness points.
- `lib/health/__tests__/energy-balance.test.ts`
- `lib/health/__tests__/soreness-volume.test.ts`

**Modify:**
- `app/api/health-trends/route.ts` — add `energy-balance` and `soreness-volume` view branches + their bucket definitions.
- `components/health/trends-section.tsx` — add the two new tabs to the `VIEWS` array.
- `docs/implementation-backlog.md` — remove this item's Queue entry (final task).
- `lib/changelog.ts` + `package.json` — version bump + changelog entry (final task; user-visible).
- `projectOverview.md` + `docs/overview/history-*.md` — journal + index (final task).

---

## Domain facts you need (verified against `main`, do not re-derive)

- **`body_metrics`** (`lib/types/body.ts`, one row per `(userId, date)`, `date` = `"YYYY-MM-DD"`): `calories?` (food intake kcal), `activeCalories?` (activity-burned kcal, from Oura), `weightKg?`. Read via `repo.listBodyMetrics(userId, fromIso, toIso)`.
- **`workout_sessions`** (`lib/types/log.ts` `WorkoutSession`): `startedAt: Date`, `completedAt?: Date`, `exercises: ExerciseLog[]`, `sessionRpe?`. Each `ExerciseLog` has `exerciseName`, `estimated1rm?`, `volume?` (per-exercise volume-load kg), and **`muscleGroups: string[]`** (already on the hydrated log — no join needed). Read via `repo.getWorkoutSessionsFrom(userId, fromDate)`.
- **`day_checkins`** (`lib/types/day-checkin.ts` `DayCheckin`, `phase: 'morning' | 'evening'`): morning rows carry `restingSoreness: number | null` (**1 = none … 5 = very sore**), `soreMuscles: string[]`, `logDate: "YYYY-MM-DD"`, `perceivedRecovery`. Read via `repo.listDayCheckins(userId, fromIso, toIso, 'morning')`.
- **Muscle matching** (`lib/muscles.ts`): `normalizeMuscle(raw)` folds synonyms to one lowercase canonical name; `moodMuscleMatches(exerciseMuscle, moodLabel)` matches a broad soreness label ("Back") against a specific exercise muscle. Use `moodMuscleMatches` to test whether a trained muscle appears in the next morning's `soreMuscles`.
- **The correlation engine** (`lib/health/correlation.ts`): `bucketize(points: {x,y}[], defs: BucketDef[]): CorrelationBucket[]` averages `y` per `x`-bucket and drops empty buckets; `correlationInsight(buckets, render, minCount=3, texts?)` returns `{insight, hasSufficientData}` (needs ≥2 buckets with ≥`minCount` points). `BucketDef = {label, min, max}` with half-open `[min, max)`.
- **Route conventions** (mirror `app/api/health-trends/route.ts` exactly): `auth()` → 401 if no `userId`; `rateLimit(\`${userId}:health-trends\`, 20, 60_000)` → 429; `tz = session.user?.timezone ?? DEFAULT_TZ`; 90-day window via `todayMidnightUtc(tz)` / `formatInTimeZone`; map a session's day-string with `toAestDay(ws.startedAt, tz)`; response header `'Cache-Control': 'private, max-age=300, stale-while-revalidate=600'`. The new views live inside the same `GET` handler's `if (view === …)` chain and reuse the in-file `buildExercise1rmBaseline` + `sessionMean1RmPct` helpers.
- **Client cache**: the card seeds from `readCacheSync('health-trends:<view>')` and revalidates with `cachedFetch(..., TTL_MEDIUM)`. The `health-trends:` prefix is already prefix-invalidated by every relevant write group in `lib/cache-groups.ts` (lines 35, 149, 197) — **new views inherit invalidation for free; add nothing to cache-groups.**
- **Tests**: `pnpm test` runs `vitest run`. Co-locate in `lib/health/__tests__/`. Import from `@/lib/...`. Pure-function tests only — no DB needed for the two helpers.

---

### Task 1: Energy-balance helper — per-day proxy + baseline-relative pairing

**Rationale for the formula:** true energy *deficit* needs BMR, which needs the user's height/age/sex profile and drags in a whole dependency + caveat (the spec's §C4). We deliberately avoid it: the load-bearing signal is *"did you eat less than YOUR OWN normal going into this session?"*. So the proxy is **`calories − activeCalories`** (intake net of activity burn) per day, and we bucket each session by that day's proxy **relative to the window's median** — the constant BMR term cancels out of a relative comparison. This is an *association*, not a calorie-accounting claim; the insight copy says so.

**Files:**
- Create: `lib/health/energy-balance.ts`
- Test: `lib/health/__tests__/energy-balance.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/energy-balance.test.ts
import { describe, it, expect } from 'vitest'
import { energyBalanceByDay, medianOf } from '@/lib/health/energy-balance'

describe('energyBalanceByDay', () => {
  it('maps date -> (calories - activeCalories), skipping days with no food logged', () => {
    const map = energyBalanceByDay([
      { date: '2026-07-01', calories: 2500, activeCalories: 400 },
      { date: '2026-07-02', calories: 2000, activeCalories: undefined }, // activity missing -> treat as 0
      { date: '2026-07-03', calories: undefined, activeCalories: 300 },  // no food -> skipped
    ])
    expect(map.get('2026-07-01')).toBe(2100)
    expect(map.get('2026-07-02')).toBe(2000)
    expect(map.has('2026-07-03')).toBe(false)
  })
})

describe('medianOf', () => {
  it('returns the median of an odd-length list', () => {
    expect(medianOf([2100, 2000, 2600])).toBe(2100)
  })
  it('averages the two middle values for an even-length list', () => {
    expect(medianOf([2000, 2100, 2200, 2600])).toBe(2150)
  })
  it('returns null for an empty list', () => {
    expect(medianOf([])).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/energy-balance.test.ts`
Expected: FAIL with "Cannot find module '@/lib/health/energy-balance'" (or "energyBalanceByDay is not a function").

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/health/energy-balance.ts
// Cross-domain "fuelling vs strength" correlation helpers. We use intake net of
// activity burn (calories - activeCalories) as an energy-balance PROXY and always
// compare it against the user's own window median, so the unmodelled BMR term
// cancels out — this is an association, never a calorie-accounting claim.

interface EnergyRow { date: string; calories?: number; activeCalories?: number }

/** date -> (calories - (activeCalories ?? 0)), only for days with food logged. */
export function energyBalanceByDay(rows: EnergyRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.calories == null) continue
    out.set(r.date, r.calories - (r.activeCalories ?? 0))
  }
  return out
}

/** Median of a numeric list, or null when empty. Does not mutate the input. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/energy-balance.test.ts`
Expected: PASS (5 assertions across 3 `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add lib/health/energy-balance.ts lib/health/__tests__/energy-balance.test.ts
git commit -m "Add energy-balance proxy helpers for fuelling-vs-strength correlation"
```

---

### Task 2: Wire the `energy-balance` view into the health-trends route

**What it correlates:** x = the session-day's energy-balance proxy **minus the window median** (so negative = under-fuelled vs your norm); y = that session's mean estimated-1RM as a % of the per-exercise baseline (the exact same `sessionMean1RmPct` the `recovery-vs-strength` view uses). Bucketed into deficit/surplus bands relative to baseline.

**Files:**
- Modify: `app/api/health-trends/route.ts`

- [ ] **Step 1: Add the bucket definitions and imports**

At the top of `app/api/health-trends/route.ts`, add the import for the new helper (place it next to the existing `@/lib/health/correlation` import on line 7):

```typescript
import { energyBalanceByDay, medianOf } from '@/lib/health/energy-balance'
```

Then add a new bucket-definition constant alongside the existing `MEAL_TIMING_BUCKETS` block (after line 50). Bands are kcal **relative to the user's median** fuelling day:

```typescript
const ENERGY_BALANCE_BUCKETS: BucketDef[] = [
  { label: '<-400',   min: -100000, max: -400 },
  { label: '-400–0',  min: -400,    max: 0     },
  { label: '0–400',   min: 0,       max: 400   },
  { label: '400+',    min: 400,     max: 100000 },
]
```

- [ ] **Step 2: Add the view branch**

Insert this `else if` branch into the `GET` handler's view chain, immediately **before** the final `} else {` that returns the 400 "Invalid view" (currently line 246):

```typescript
  } else if (view === 'energy-balance') {
    const [workoutSessions, bodyMetrics] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listBodyMetrics(userId, from90dIso, todayIso),
    ])
    const baseline = buildExercise1rmBaseline(workoutSessions)
    const balanceByDate = energyBalanceByDay(bodyMetrics)
    const median = medianOf([...balanceByDate.values()])

    const points: { x: number; y: number }[] = []
    if (median != null) {
      for (const ws of workoutSessions) {
        const date = toAestDay(ws.startedAt, tz)
        const balance = balanceByDate.get(date)
        const meanPct = sessionMean1RmPct(ws, baseline)
        if (balance == null || meanPct == null) continue
        points.push({ x: balance - median, y: meanPct })
      }
    }
    const buckets = bucketize(points, ENERGY_BALANCE_BUCKETS)
    const { insight, hasSufficientData } = correlationInsight(
      buckets,
      (best, worst) => `Your lifts average ${best.avg >= 0 ? '+' : ''}${best.avg}% vs baseline on days you eat ${best.label} kcal vs your usual, compared with ${worst.avg >= 0 ? '+' : ''}${worst.avg}% at ${worst.label}.`,
      3,
      { insufficient: 'Log food and workouts on the same days to unlock this.' },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData }

```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS (no type errors — `buildExercise1rmBaseline`, `sessionMean1RmPct`, `bucketize`, `correlationInsight`, `toBucketResponse`, `toAestDay` are all already in scope in this file).

- [ ] **Step 4: Verify against the local dev DB**

Ensure the dev DB is up (`pnpm db:local`) and the server is running (`pnpm dev`), then log in as the seed user and hit the route. Expected: HTTP 200 with `{ view: 'energy-balance', insight, buckets, hasSufficientData }`. With the default seed (thin data) `hasSufficientData` will likely be `false` and `insight` = the "Log food and workouts…" fallback — that is correct behaviour, not a bug. Confirm it is **not** a 400/500.

```bash
# after logging in via the browser and copying the session cookie, or simply
# observe the Network tab hitting: /api/health-trends?view=energy-balance
```

- [ ] **Step 5: Commit**

```bash
git add app/api/health-trends/route.ts
git commit -m "Add energy-balance-vs-strength correlation view"
```

---

### Task 3: Soreness-vs-volume helper — per-(day, muscle) volume → next-morning soreness

**What it correlates:** for every (training day, muscle trained) pair, x = total volume-load (kg) for that muscle that day, y = **100 if that muscle is sore the next morning, else 0** (so a bucket's average is the *% of the time that volume band left you sore*). "Sore next morning" = the muscle matches any entry in the next day's `day_checkins.soreMuscles` (via `moodMuscleMatches`), OR — when `soreMuscles` is empty but `restingSoreness >= 4` — treat the whole body as sore. A morning check-in must exist for day+1 or the pair is dropped (no check-in ≠ not sore).

**Files:**
- Create: `lib/health/soreness-volume.ts`
- Test: `lib/health/__tests__/soreness-volume.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/soreness-volume.test.ts
import { describe, it, expect } from 'vitest'
import { volumeByDayMuscle, sorenessVsVolumePoints } from '@/lib/health/soreness-volume'

const day = (d: string, muscles: string[], volume: number) => ({
  startedAt: new Date(`${d}T10:00:00.000Z`),
  exercises: [{ muscleGroups: muscles, volume }],
})

describe('volumeByDayMuscle', () => {
  it('sums per-exercise volume onto each normalized muscle for that local day', () => {
    const map = volumeByDayMuscle(
      [day('2026-07-01', ['Chest', 'Triceps'], 3000), day('2026-07-01', ['pecs'], 1000)],
      'UTC',
    )
    // 'Chest' and 'pecs' both normalize to 'chest' -> 3000 + 1000
    expect(map.get('2026-07-01|chest')).toBe(4000)
    expect(map.get('2026-07-01|triceps')).toBe(3000)
  })
})

describe('sorenessVsVolumePoints', () => {
  it('pairs a muscle-day volume with next-morning soreness as a 0/100 hit', () => {
    const sessions = [day('2026-07-01', ['Chest'], 5000), day('2026-07-02', ['Legs'], 5000)]
    const checkins = [
      { logDate: '2026-07-02', soreMuscles: ['Chest'], restingSoreness: 3 }, // chest sore next AM -> 100
      { logDate: '2026-07-03', soreMuscles: [], restingSoreness: 2 },         // legs not sore -> 0
    ]
    const points = sorenessVsVolumePoints(sessions, checkins, 'UTC')
    expect(points).toEqual([{ x: 5000, y: 100 }, { x: 5000, y: 0 }])
  })

  it('uses whole-body restingSoreness>=4 when soreMuscles is empty', () => {
    const points = sorenessVsVolumePoints(
      [day('2026-07-01', ['Back'], 4000)],
      [{ logDate: '2026-07-02', soreMuscles: [], restingSoreness: 4 }],
      'UTC',
    )
    expect(points).toEqual([{ x: 4000, y: 100 }])
  })

  it('drops a muscle-day with no morning check-in the next day', () => {
    const points = sorenessVsVolumePoints(
      [day('2026-07-01', ['Back'], 4000)],
      [], // no check-ins at all
      'UTC',
    )
    expect(points).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/soreness-volume.test.ts`
Expected: FAIL with "Cannot find module '@/lib/health/soreness-volume'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/health/soreness-volume.ts
// Cross-domain "does volume predict soreness" correlation helper. For each
// (training day, muscle) pair, x = that muscle's volume-load that day, y = whether
// the muscle was sore the next morning (0/100 so a bucket average reads as a %).
import { normalizeMuscle, moodMuscleMatches } from '@/lib/muscles'
import { toAestDay, shiftDateStr } from '@/lib/date-utils'

interface SessionLite {
  startedAt: Date
  exercises: { muscleGroups: string[]; volume?: number }[]
}
interface CheckinLite {
  logDate: string
  soreMuscles: string[]
  restingSoreness: number | null
}

/** "YYYY-MM-DD|<normalized muscle>" -> summed volume-load (kg) for that local day. */
export function volumeByDayMuscle(sessions: SessionLite[], tz: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const ws of sessions) {
    const date = toAestDay(ws.startedAt, tz)
    for (const ex of ws.exercises) {
      if (!ex.volume || ex.volume <= 0) continue
      for (const raw of ex.muscleGroups) {
        const key = `${date}|${normalizeMuscle(raw)}`
        out.set(key, (out.get(key) ?? 0) + ex.volume)
      }
    }
  }
  return out
}

/** Points {x: muscle-day volume, y: 100 if sore next morning else 0}. Drops any
 *  muscle-day with no morning check-in on day+1. */
export function sorenessVsVolumePoints(
  sessions: SessionLite[],
  checkins: CheckinLite[],
  tz: string,
): { x: number; y: number }[] {
  const checkinByDate = new Map(checkins.map(c => [c.logDate, c]))
  const points: { x: number; y: number }[] = []
  for (const [key, volume] of volumeByDayMuscle(sessions, tz)) {
    const [date, muscle] = key.split('|')
    const next = checkinByDate.get(shiftDateStr(date, 1))
    if (!next) continue
    const listed = next.soreMuscles.some(m => moodMuscleMatches(muscle, m))
    const wholeBody = next.soreMuscles.length === 0 && (next.restingSoreness ?? 0) >= 4
    points.push({ x: volume, y: listed || wholeBody ? 100 : 0 })
  }
  return points
}
```

**Note on `shiftDateStr`:** it exists in `lib/date-utils.ts` (`shiftDateStr(dateStr, days)` → new `"YYYY-MM-DD"` with `Date.UTC` overflow normalisation — the CLAUDE.md-approved way to add days to a date string; never hand-add). Confirm the exact export name before relying on it — if it is absent, add a tiny local helper using `Date.UTC(y, m-1, d+days)` + `formatInTimeZone`, never string arithmetic.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/soreness-volume.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/health/soreness-volume.ts lib/health/__tests__/soreness-volume.test.ts
git commit -m "Add soreness-vs-volume correlation helper"
```

---

### Task 4: Wire the `soreness-volume` view into the health-trends route

**Files:**
- Modify: `app/api/health-trends/route.ts`

- [ ] **Step 1: Add the import and bucket definitions**

Add the import next to the Task-2 import:

```typescript
import { sorenessVsVolumePoints } from '@/lib/health/soreness-volume'
```

Add the bucket constant after `ENERGY_BALANCE_BUCKETS`. Bands are per-muscle volume-load in kg (tune later against real data — start coarse):

```typescript
const MUSCLE_VOLUME_BUCKETS: BucketDef[] = [
  { label: '<2000kg',    min: 0,    max: 2000   },
  { label: '2–4000kg',   min: 2000, max: 4000   },
  { label: '4–6000kg',   min: 4000, max: 6000   },
  { label: '6000kg+',    min: 6000, max: 1000000 },
]
```

- [ ] **Step 2: Add the view branch**

Insert immediately after the `energy-balance` branch from Task 2 (still before the final `} else {`):

```typescript
  } else if (view === 'soreness-volume') {
    const [workoutSessions, checkins] = await Promise.all([
      repo.getWorkoutSessionsFrom(userId, from90dDate),
      repo.listDayCheckins(userId, from90dIso, todayIso, 'morning'),
    ])
    const points = sorenessVsVolumePoints(workoutSessions, checkins, tz)
    const buckets = bucketize(points, MUSCLE_VOLUME_BUCKETS)
    const { insight, hasSufficientData } = correlationInsight(
      buckets,
      (best, worst) => `Muscles you train with ${best.label} are sore next morning ${best.avg}% of the time, vs ${worst.avg}% at ${worst.label}.`,
      3,
      { insufficient: 'Log workouts and morning check-ins to unlock this.' },
    )
    result = { view, insight, buckets: toBucketResponse(buckets), hasSufficientData }

```

**Note:** `sorenessVsVolumePoints` expects `checkins` items with `logDate`/`soreMuscles`/`restingSoreness` — the `DayCheckin` rows from `listDayCheckins` carry exactly these fields (plus more, which the helper's `CheckinLite` structurally ignores). `workoutSessions` items carry `startedAt` + `exercises[].muscleGroups`/`volume` — same structural match to `SessionLite`. No mapping needed; pass them straight through.

- [ ] **Step 3: Type-check, lint, run all tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS — including the two new helper test files.

- [ ] **Step 4: Verify against the local dev DB**

With `pnpm dev` running and logged in, hit `/api/health-trends?view=soreness-volume`. Expected: HTTP 200, correct response shape, `hasSufficientData` likely `false` on the thin seed (fallback insight) — confirm it is **not** 400/500.

- [ ] **Step 5: Commit**

```bash
git add app/api/health-trends/route.ts
git commit -m "Add soreness-vs-volume correlation view"
```

---

### Task 5: Surface both views in the health-tab Trends card

The mounted `TrendsSection` card (`components/health/trends-section.tsx`, rendered from `app/health/health-sections.tsx:966` as the `"trends"` section) is a tab-strip over the `VIEWS` array. Adding two entries adds two tabs — the card already seeds from `health-trends:<view>` cache, revalidates with `cachedFetch`, renders `CorrelationBars` from `data.buckets`, and shows the "Not enough data yet" empty state when `hasSufficientData` is false. **No other client change is needed** (cache-group invalidation for the `health-trends:` prefix is already in place).

**Files:**
- Modify: `components/health/trends-section.tsx`

- [ ] **Step 1: Add the two tabs to the `VIEWS` array**

Replace the `VIEWS` array (lines 16–22) with:

```typescript
const VIEWS: { key: string; label: string }[] = [
  { key: "subjective-recovery", label: "Recovery calibration" },
  { key: "session-rpe",         label: "Session effort" },
  { key: "rest-adherence",      label: "Rest discipline" },
  { key: "recovery-vs-strength", label: "Recovery vs strength" },
  { key: "meal-timing",         label: "Meals vs sleep" },
  { key: "energy-balance",      label: "Fuelling vs strength" },
  { key: "soreness-volume",     label: "Volume vs soreness" },
];
```

- [ ] **Step 2: Confirm the fetch handles the new views**

Read the `useEffect` (lines 50–61). The URL builder only special-cases `recovery-vs-strength` (it appends `&metric=hrv`); every other view — including the two new ones — falls through to `/api/health-trends?view=${view}`. That is correct for both new views (neither takes a `metric` param). **No change needed here** — this step is a read-only verification, not an edit.

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Verify in the dev server**

With `pnpm dev` running, open the health tab, scroll to the **Trends** card, and confirm two new tabs — **"Fuelling vs strength"** and **"Volume vs soreness"** — appear at the end of the tab strip and, when tapped, render either correlation bars or the "Not enough data yet" state (depending on how much paired data the seed user has). No console errors.

- [ ] **Step 5: Commit**

```bash
git add components/health/trends-section.tsx
git commit -m "Surface fuelling-vs-strength and volume-vs-soreness trend tabs"
```

---

### Task 6: (Optional, if the seed data is too thin to eyeball) — seed paired data for a manual check

The default seed may not have enough overlapping food + workout + morning-check-in days to flip `hasSufficientData` to `true`, so the views can only be seen in their empty state. This task is **optional** and only for a richer manual verification — it changes no product code.

**Files:**
- (No product files. Uses a throwaway SQL snippet against the local dev DB only.)

- [ ] **Step 1: Insert a handful of paired days directly into the local dev DB**

Write and run a throwaway SQL script (against `postgresql://postgres:postgres@localhost:5433/trainingai_dev`) that, for the seed user, inserts ~8 days each of: a `body_metrics` row with varied `calories`/`active_calories`, a completed `workout_sessions` + `exercise_logs` (with `muscle_groups` + `volume` + `estimated_1rm`) + `set_logs`, and a next-morning `day_checkins` row (`phase='morning'`) with `resting_soreness` + `sore_muscles`. Vary the fuelling and volume so buckets populate on both sides.

- [ ] **Step 2: Re-hit both routes and confirm a real insight sentence**

Expected: `/api/health-trends?view=energy-balance` and `?view=soreness-volume` now return `hasSufficientData: true` with a rendered best-vs-worst sentence and ≥2 buckets each. Sanity-check the direction (more volume → higher soreness %; bigger deficit → lower or negative strength %) reads plausibly.

- [ ] **Step 3: No commit** (this is throwaway verification data, not product code).

---

### Task 7: Bookkeeping — changelog, version, journal, index, backlog removal

Per CLAUDE.md's end-of-session rule, this rides in the **same PR** as the implementation.

**Files:**
- Modify: `package.json` (version bump), `lib/changelog.ts` (user-visible entry)
- Modify: `projectOverview.md` (index) + append to the latest `docs/overview/history-*.md` (journal)
- Modify: `docs/implementation-backlog.md` (remove this item's Queue entry)

- [ ] **Step 1: Bump the version and add a changelog entry**

This is a user-visible new feature → **minor** bump in `package.json`. Add a matching entry to `lib/changelog.ts` (match the existing entry shape in that file — do not invent a new format). Copy suggestion: *"New health-tab trends: see how your fuelling affects your strength on the bar, and how a muscle's training volume predicts next-day soreness."*

- [ ] **Step 2: Remove this item's Queue entry from `docs/implementation-backlog.md`**

Delete the whole numbered "Cross-domain correlations" entry from the Queue (a merged item must never linger). If any other item cross-references it by number, fix that reference in the same edit.

- [ ] **Step 3: Write the journal + index update**

Append a session summary to the most recent `docs/overview/history-*.md` and update `projectOverview.md`'s lean index (mark the feature shipped; note that weather-vs-performance and the other §C3 signals were deliberately out of scope, with the reasons from this plan's Scope section). State the verification surfaces exercised (local dev DB + `pnpm dev`) and that nothing here is device-gated.

- [ ] **Step 4: Run the full gate one last time**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/ docs/implementation-backlog.md
git commit -m "Ship cross-domain correlation trends; journal + backlog bookkeeping"
```

---

## Self-review checklist (run before handing off)

- **Spec coverage:** the two in-scope §C3 signals (energy-balance-vs-load, soreness-vs-volume) each have a helper task + a view task + a client task. The out-of-scope signals are enumerated with reasons in the Scope section (weather = not stored; the rest already shipped). ✅
- **No new capture / no migration:** every field read (`calories`, `activeCalories`, `volume`, `muscleGroups`, `restingSoreness`, `soreMuscles`, `estimated1rm`) already exists and is already populated. ✅
- **One-Formula:** reuses `bucketize`/`correlationInsight`/`computeBaselines`, `buildExercise1rmBaseline`/`sessionMean1RmPct` (in-file), `normalizeMuscle`/`moodMuscleMatches`, `toAestDay`/`shiftDateStr`. Adds no duplicate of any existing formula. ✅
- **Caching:** new `health-trends:<view>` keys inherit the existing prefix invalidation — nothing added to `lib/cache-groups.ts`, no stale-write risk. ✅
- **Caveats honoured (§C4):** insight copy says "average … vs …" (association), reports bucket counts (`b.count` rendered by `CorrelationBars`), and `correlationInsight`'s `minCount=3` + ≥2-bucket gate enforces the small-N guard. ✅
- **Type consistency:** helper signatures (`energyBalanceByDay`, `medianOf`, `sorenessVsVolumePoints`, `volumeByDayMuscle`) match their call sites in the route branches; `SessionLite`/`CheckinLite` structurally accept the repo's `WorkoutSession`/`DayCheckin`. ✅
- **Runtime:** server + client only, no APK rebuild, fully sandbox-verifiable. ✅
