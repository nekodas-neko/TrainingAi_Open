# Heart-Rate Recovery (HRR) Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trend the user's post-set heart-rate recovery (HRR1 — the 60-second bpm drop the app already computes per workout) as a 14-day sparkline on the Heart Rate detail page, so it reads as a fitness-improvement marker instead of a per-session curiosity.

**Architecture:** Derive-on-read, **no migration, no new synced column.** The 14-day HRR1 series is a cross-session, server-computed aggregate — exactly the posture the repo already sanctions for `weekly-stats`/the health-trends summary (server-only, `cachedFetch`). We re-run the existing `analyseHrRecovery` logic over each completed session's stored HR window inside the existing `/api/health/trends` route, roll it up to one "best session HRR1" per day, and add an `hrr1Bpm` field to `HealthTrendDay`. The Heart Rate page then renders a third `TrendSparkline` — reusing the same Chart.js line + "vs last week" delta chip already used for RHR and HRV. No new cache key, no cache-group change, no offline-sync surface.

**Tech Stack:** Next.js 15 route handler, TypeScript, Drizzle/Postgres repository, Vitest (unit), Chart.js via `react-chartjs-2`, the client SQLite cache (`cachedFetchToday`/`readTodayCacheSync`).

---

## Design decision — derive-on-read (chosen), migration 130 (rejected fallback)

Two options were on the table (see the feature brief). **We choose derive-on-read.** Justification, grounded in the current code:

1. **The invalidation is already wired.** The Heart Rate page reads the HRR series off the *existing* `health-trends-summary` cache key (`app/health/heart-rate/page.tsx:37`), and that key is already cleared on workout completion by `invalidateWorkoutSummaries()` (`lib/cache-groups.ts:54`). Adding a field to the same payload needs **zero** cache-group edits — the write that changes HRR (completing a workout) already invalidates the key that carries it.
2. **Reuse is trivial.** `TrendSparkline` is generic over `HealthTrendDay` fields (`components/health/trend-sparkline.tsx:15,33-44`). Adding `hrr1Bpm` to the `Field` union + `HealthTrendDay` interface makes the entire chart + delta-chip machinery work unchanged — no new component, no new fetch, no new TTL.
3. **The One-Formula rule is honoured.** HRR math stays in exactly one place — `analyseHrRecovery` (`lib/workout/hr-analysis.ts:51`). We add only *aggregation* (median-per-session, best-per-day), extracted to one tested pure helper.
4. **Bounded cost.** The route already fetches the in-range sessions via `getWorkoutSessionsFrom` (`app/api/health/trends/route.ts:47`). We add, per *completed* session in the 14-day window (≤ ~14, usually far fewer), one small HR-window read (`getHrForWindow`) + one set-timestamp read (`getSetTimestampsForSession`) — parallelised. The route sits behind one shared cache key at `TTL_LONG` (6 h) via `cachedFetchToday`, so this runs only on cold cache.

**Rejected fallback (migration 130):** persisting an `hrr1_bpm` column on `workout_sessions` computed at completion + reconciled-on-read. Rejected because `workout_sessions` is a *synced* table: a new column would drag in the full offline-sync mirror obligation (local SQLite column + `RECONCILE_COLUMNS`, the `pushMutations` branch, `getSyncDelta`/`applyDelta` mapping) for a value that is purely derivable from data already stored. Only revisit 130 if per-session re-derivation ever measures as too expensive for this single-user app — it does not today. **Migration number 130 is reserved but intentionally left unused by this plan.**

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `lib/workout/hrr-trend.ts` | **Create** | Pure aggregation helpers: median HRR1 for one session, best-session HRR1 per day. No I/O, no dates-as-strings math beyond keying. |
| `lib/workout/__tests__/hrr-trend.test.ts` | **Create** | Unit tests for the two helpers (median odd/even, all-null, per-day best-of-N rollup). |
| `app/api/health/trends/route.ts` | **Modify** (`:9-22` interface, `:43-89` computation) | Add `hrr1Bpm` to `HealthTrendDay`; re-derive per-completed-session HRR1 via `analyseHrRecovery` and roll up to best-per-day. |
| `components/health/trend-sparkline.tsx` | **Modify** (`:15`, plus wrap export in `memo`) | Add `hrr1Bpm` to the `Field` union; memoize the component so the third instance doesn't re-render on unrelated parent state. |
| `app/health/heart-rate/page.tsx` | **Modify** (`:105-110`) | Render a third `TrendSparkline` for `hrr1Bpm`, paired with a text label (never colour alone). |

No migration. No `lib/cache-groups.ts` change (key already invalidated). No new cache key or `lib/cache-ttl.ts` constant (rides the existing `health-trends-summary` payload).

---

## Task 1: HRR aggregation helper (pure, tested)

**Files:**
- Create: `lib/workout/hrr-trend.ts`
- Test: `lib/workout/__tests__/hrr-trend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/workout/__tests__/hrr-trend.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sessionHrr1Median, rollupDailyBestHrr } from '../hrr-trend'

describe('sessionHrr1Median', () => {
  it('returns the median of non-null HRR1 values (odd count)', () => {
    expect(sessionHrr1Median([10, 30, 20])).toBe(20)
  })

  it('averages the two middle values and rounds (even count)', () => {
    // sorted [10, 20, 30, 40] -> (20 + 30) / 2 = 25
    expect(sessionHrr1Median([40, 10, 30, 20])).toBe(25)
    // sorted [10, 15] -> 12.5 -> rounds to 13
    expect(sessionHrr1Median([15, 10])).toBe(13)
  })

  it('ignores nulls when computing the median', () => {
    expect(sessionHrr1Median([null, 18, null, 22])).toBe(20)
  })

  it('returns null when there are no non-null values', () => {
    expect(sessionHrr1Median([])).toBeNull()
    expect(sessionHrr1Median([null, null])).toBeNull()
  })
})

describe('rollupDailyBestHrr', () => {
  it('keeps the best (highest) session median per day', () => {
    const map = rollupDailyBestHrr([
      { day: '2026-07-15', hrr1Values: [10, 12] },   // median 11
      { day: '2026-07-15', hrr1Values: [20, 22] },   // median 21 -> wins the day
      { day: '2026-07-16', hrr1Values: [8, 8, 8] },  // median 8
    ])
    expect(map.get('2026-07-15')).toBe(21)
    expect(map.get('2026-07-16')).toBe(8)
  })

  it('skips sessions whose HRR1 values are all null', () => {
    const map = rollupDailyBestHrr([
      { day: '2026-07-15', hrr1Values: [null, null] },
    ])
    expect(map.has('2026-07-15')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/workout/__tests__/hrr-trend.test.ts`
Expected: FAIL — `Failed to resolve import "../hrr-trend"` (the module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `lib/workout/hrr-trend.ts`:

```ts
// Aggregation for the 14-day HRR (heart-rate recovery) trend. The core HRR1 math
// — bpmAtLog - bpm60 per set — lives once in analyseHrRecovery (lib/workout/
// hr-analysis.ts); this file only rolls those per-set values up to one number
// per session and one "best session" number per day. No HRR formula here.

/** Median of a session's per-set HRR1 values, ignoring nulls. Rounded to a whole
 *  bpm/min. Median (not mean) so one anomalous set doesn't skew the session. */
export function sessionHrr1Median(hrr1Values: (number | null)[]): number | null {
  const vals = hrr1Values
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid]
  return Math.round(median)
}

/** One value per day: the best (highest) session median for that day. Higher HRR1
 *  = faster recovery = better cardiovascular fitness. Days with no usable HR data
 *  are absent from the map (caller renders them as a gap). */
export function rollupDailyBestHrr(
  sessions: { day: string; hrr1Values: (number | null)[] }[],
): Map<string, number | null> {
  const byDay = new Map<string, number | null>()
  for (const s of sessions) {
    const m = sessionHrr1Median(s.hrr1Values)
    if (m == null) continue
    const prev = byDay.get(s.day)
    byDay.set(s.day, prev == null ? m : Math.max(prev, m))
  }
  return byDay
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/workout/__tests__/hrr-trend.test.ts`
Expected: PASS — 2 suites, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/workout/hrr-trend.ts lib/workout/__tests__/hrr-trend.test.ts
git commit -m "Add HRR trend aggregation helpers (median-per-session, best-per-day)"
```

---

## Task 2: Compute `hrr1Bpm` in the trends route

**Files:**
- Modify: `app/api/health/trends/route.ts` (interface `:9-22`; imports `:1-7`; computation `:43-89`)

- [ ] **Step 1: Add `hrr1Bpm` to the `HealthTrendDay` interface**

In `app/api/health/trends/route.ts`, add the field to the interface (after `rhrBpm`, `:19`):

```ts
export interface HealthTrendDay {
  date: string            // YYYY-MM-DD
  readinessScore: number | null
  sleepScore: number | null
  activityScore: number | null
  hrvMs: number | null
  rhrBpm: number | null
  hrr1Bpm: number | null  // best-session 60s HR-recovery drop (bpm/min); derived, not stored
  wornHours: number | null
  sessionDurationMin: number | null
  workoutDensity: number | null  // kg lifted per active minute
  proteinPerKg: number | null    // day's protein_g ÷ the latest known bodyweight in range
  steps: number | null
  waterMl: number | null
}
```

- [ ] **Step 2: Add the imports**

At the top of the same file, add two imports alongside the existing ones (after the `aggregateWorkoutDay` import at `:7`):

```ts
import { analyseHrRecovery } from '@/lib/workout/hr-analysis'
import { rollupDailyBestHrr } from '@/lib/workout/hrr-trend'
```

- [ ] **Step 3: Re-derive HRR1 per completed session and roll up per day**

In `GET()`, after the existing `Promise.all(...)` block that assigns `[ouraRows, derivedRows, bodyRows, workoutSessions]` (ends `:48`) and before the `const trends: HealthTrendDay[] = []` loop (`:66`), insert:

```ts
  // HRR trend — re-derive each completed session's HRR1 from its stored HR window
  // (no persisted column; server-only aggregate, same posture as weekly-stats).
  // Reuses analyseHrRecovery — the single HRR formula. Bounded: one HR-window read
  // + one set-timestamp read per completed session in range (≤ ~14), parallelised.
  const completedSessions = workoutSessions.filter(ws => ws.completedAt != null)
  const perSessionHrr = await Promise.all(
    completedSessions.map(async ws => {
      const from = new Date(ws.startedAt.getTime() - 10 * 60 * 1000)
      const to   = new Date(ws.completedAt!.getTime() + 10 * 60 * 1000)
      const [readings, sets] = await Promise.all([
        repo.getHrForWindow(userId, from, to),
        repo.getSetTimestampsForSession(ws.id),
      ])
      const stats = analyseHrRecovery(readings, sets)
      return { day: toAestDay(ws.startedAt, tz), hrr1Values: stats.map(s => s.hrr1) }
    }),
  )
  const hrrByDay = rollupDailyBestHrr(perSessionHrr)
```

- [ ] **Step 4: Emit the field in the day loop**

In the `for (let i = 13; i >= 0; i--)` loop, add `hrr1Bpm` to the pushed object (next to `rhrBpm`, `:79`):

```ts
      hrvMs: body?.hrvMs ?? null,
      rhrBpm: body?.restingHeartRate ?? null,
      hrr1Bpm: hrrByDay.get(d) ?? null,
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). This confirms `getHrForWindow`/`getSetTimestampsForSession` return shapes structurally satisfy `analyseHrRecovery`'s `HrReading[]`/`SetMarker[]` params, and that `hrr1Bpm` is set on every `HealthTrendDay` literal.

- [ ] **Step 6: Verify the route against the local seeded DB**

Ensure the local dev DB is up (`pnpm db:local`), start the dev server (`pnpm dev`), then hit the route as the seeded user's session (log in as `test@local.dev` / `testpass123` in the browser, or reuse an authed session cookie). Confirm the JSON now includes `hrr1Bpm` on every trend day:

Run (browser or authed curl against `http://localhost:3000/api/health/trends`), Expected shape:

```json
{ "trends": [ { "date": "2026-07-04", "rhrBpm": 58, "hrr1Bpm": null, "...": "..." } ] }
```

Note: the seed has logged workouts but **no `oura_heartrate` time-series rows**, so `hrr1Bpm` will be `null` for every day locally — that is correct and expected (see Verification summary). The check here is that the field is present, the route still returns 200, and adding the HR re-derivation did not break the existing fields or throw.

- [ ] **Step 7: Commit**

```bash
git add app/api/health/trends/route.ts
git commit -m "Derive best-session HRR1 per day in the health trends route"
```

---

## Task 3: Add `hrr1Bpm` to the sparkline field union and memoize

**Files:**
- Modify: `components/health/trend-sparkline.tsx` (`:15`, export wrapper)

- [ ] **Step 1: Add `hrr1Bpm` to the `Field` union**

In `components/health/trend-sparkline.tsx`, extend the `Field` type (`:15`):

```ts
type Field = "readinessScore" | "sleepScore" | "activityScore" | "hrvMs" | "rhrBpm" | "hrr1Bpm" | "wornHours" | "sessionDurationMin" | "workoutDensity" | "proteinPerKg" | "steps" | "waterMl";
```

- [ ] **Step 2: Memoize the component (stable props → no needless re-render)**

The Heart Rate page will render three `TrendSparkline` instances under one parent; each gets stable literal props (`field`/`label`/`color`/`unit`) and a stable `trends` reference. Wrap the export in `React.memo` so an unrelated parent state change (e.g. the 24h HR fetch resolving) doesn't re-render all three charts.

Add `memo` to the React import at the top of the file (the file currently imports from `react-chartjs-2`/`chart.js` only — add a React import line):

```ts
import { memo } from "react";
```

Then change the export from a bare function to a memoized one. Replace:

```ts
export function TrendSparkline({ trends, field, label, color, unit }: TrendSparklineProps) {
```

with:

```ts
function TrendSparklineBase({ trends, field, label, color, unit }: TrendSparklineProps) {
```

and add at the very end of the file (after the closing `}` of `TrendSparklineBase`):

```ts
export const TrendSparkline = memo(TrendSparklineBase);
```

The lazy wrapper (`components/health/trend-sparkline-lazy.tsx`) imports `m.TrendSparkline`, so the named export must remain `TrendSparkline` — the rename to `TrendSparklineBase` + `memo` export preserves that name.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Confirms `memo` is imported correctly and the `hrr1Bpm` field is a valid `HealthTrendDay` key (Task 2 added it to the interface).

- [ ] **Step 4: Commit**

```bash
git add components/health/trend-sparkline.tsx
git commit -m "Add hrr1Bpm sparkline field and memoize TrendSparkline"
```

---

## Task 4: Render the HRR sparkline on the Heart Rate page

**Files:**
- Modify: `app/health/heart-rate/page.tsx` (`:105-110`)

- [ ] **Step 1: Add the third sparkline**

In `app/health/heart-rate/page.tsx`, inside the `{trends?.trends && ( ... )}` block, add a third `TrendSparkline` after the HRV line (`:108`):

```tsx
        {trends?.trends && (
          <>
            <TrendSparkline trends={trends.trends} field="rhrBpm" label="Resting Heart Rate" color="#f87171" unit="bpm" />
            <TrendSparkline trends={trends.trends} field="hrvMs" label="HRV (overnight)" color="#a78bfa" unit="ms" />
            <TrendSparkline trends={trends.trends} field="hrr1Bpm" label="HR Recovery (60s drop)" color="#34d399" unit="bpm/min" />
          </>
        )}
```

Notes for the implementer (do not add as code comments):
- The **label text** `"HR Recovery (60s drop)"` and the tooltip `unit` carry the meaning — colour is decorative only, satisfying "never convey state by colour alone." A higher line = faster recovery; the built-in "▲ N vs last week" delta chip (`trend-sparkline.tsx:33-44`) already frames improvement.
- **No cache work is needed here.** `hrr1Bpm` rides the existing `health-trends-summary` payload the page already seeds in a `useEffect` (`:31-40`) via `readTodayCacheSync` + `cachedFetchToday` at `HEALTH_TRENDS_SUMMARY_TTL`. Do **not** add a new cache key, TTL constant, or seed — and do not move the seed into a `useState` initializer.
- `#34d399` is a placeholder literal matching the existing sibling calls (`#f87171`, `#a78bfa`), which pass raw hex that `resolveColor` handles (`trend-sparkline.tsx:64`). Keep it consistent with its siblings; a follow-up token migration would convert all three at once, not just this one.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. `field="hrr1Bpm"` is accepted because Task 3 widened the `Field` union.

- [ ] **Step 3: Verify the page renders in the browser**

With `pnpm dev` running, open `http://localhost:3000/health/heart-rate` (authed as `test@local.dev`). Expected:
- The page renders without runtime errors; three trend cards appear in order: Resting Heart Rate, HRV (overnight), **HR Recovery (60s drop)**.
- Because the local seed has no HR time-series, the HRR card has no data points — `TrendSparkline` returns `null` when every value is null (`trend-sparkline.tsx:50-52`), so the card is simply **absent locally**. That is the correct offline/no-data behaviour. The RHR and HRV cards still render from seeded body metrics, proving the block itself works.

- [ ] **Step 4: Commit**

```bash
git add app/health/heart-rate/page.tsx
git commit -m "Render HR Recovery 14-day trend on the Heart Rate page"
```

---

## Task 5: Full local gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full local CI gate**

Run: `pnpm ci:local`
Expected: PASS — `lint`, `check-reconcile.js` (no schema change, so trivially green), `check-push-mutations.js` (no `pushMutations` change, green), `typecheck`, and `test` (including the new `hrr-trend.test.ts`) all pass.

- [ ] **Step 2: Confirm no cache/sync obligations were missed**

Manually confirm (checklist, no code): (a) `health-trends-summary` remains listed in `invalidateWorkoutSummaries()` (`lib/cache-groups.ts:54`) — it is, so completing a workout refreshes the HRR trend; (b) no new synced column was added, so no `pushMutations`/`getSyncDelta`/`applyDelta`/`RECONCILE_COLUMNS` work is owed; (c) no new cache key was introduced.

- [ ] **Step 3: Commit (if any lint autofix touched files; otherwise skip)**

```bash
git add -A
git commit -m "HRR trend: lint/format pass" || echo "nothing to commit"
```

---

## Verification summary — what is and isn't sandbox-verifiable

**Verifiable in the sandbox (must be green before merge):**
- `hrr-trend.test.ts` unit tests (pure functions) — `pnpm exec vitest run lib/workout/__tests__/hrr-trend.test.ts`.
- `pnpm typecheck`, `pnpm lint`, and full `pnpm ci:local`.
- The `/api/health/trends` route returns 200 with `hrr1Bpm` present on every day against the local seeded DB (`pnpm dev`).
- The Heart Rate page renders the RHR + HRV cards and does not error with the new block added.

**NOT verifiable in the sandbox — requires real data / the device (call these out when presenting the work):**
- **A non-null HRR trend with real values.** The local seed has logged workouts but **no `oura_heartrate` time-series** and no per-set `logged_at`/HR overlap, so `hrr1Bpm` is `null` everywhere locally and the HRR card renders empty. Proving the derivation produces real numbers requires a user with actual ring/chest-strap HR captured during workouts — only reproducible against production data or on-device.
- **Chart.js rendering, the "▲ N vs last week" delta chip with real values, theme-token/light-mode correctness, and safe-area** — per the Canonical Runtime policy these are only authoritative on the Samsung S25 APK (the web sandbox renders insets as 0 and Chart.js compositing differs from Samsung's WebView). Run `docs/device-smoke-checklist.md` on-device, or add a Known-Issues row in `projectOverview.md` marking the HRR sparkline not-yet-device-verified.
- **Cost under a realistic session history.** The per-session HR-window re-derivation is bounded (≤ ~14 completed sessions/14 days) and behind a 6 h cache, but its real-data latency is only observable against a populated DB.

---

## Self-review (performed against the feature brief)

- **Spec coverage:** trend HRR over time (Task 2 + 4); reuse `analyseHrRecovery`, no re-implementation (Task 2 imports it; Task 1 adds only aggregation) ✓; derive-on-read, no migration (design decision + Task 2) ✓; `hrr1Bpm` on `HealthTrendDay` (Task 2) ✓; third `TrendSparkline` (Task 4) ✓; SWR headers already present on the route (unchanged — `route.ts:91`) ✓; cache key registered/invalidated — already covered by `health-trends-summary` in `invalidateWorkoutSummaries()`, verified in Task 5 ✓; canonical TTL — reuses existing `HEALTH_TRENDS_SUMMARY_TTL`, no new key ✓; colour never conveys state alone — label + unit + delta chip (Task 4) ✓; memoized sparkline with stable props (Task 3) ✓; seed in `useEffect` not initializer — unchanged existing pattern, explicitly preserved (Task 4 note) ✓; `todayInTz`/`toAestDay` used, no `toISOString().slice(0,10)` — Task 2 uses the route's existing `toAestDay(ws.startedAt, tz)` ✓; Lucide-not-emoji — no new iconography introduced ✓.
- **Placeholder scan:** every code step contains real code; every command has expected output; no TBD/TODO/"handle edge cases."
- **Type consistency:** `sessionHrr1Median` / `rollupDailyBestHrr` names and the `{ day, hrr1Values }` shape are identical across Task 1 (definition/test) and Task 2 (call site). `hrr1Bpm` field name is identical across the interface (Task 2), the `Field` union (Task 3), and the render call (Task 4). `TrendSparkline` named export preserved through the `memo` rename (Task 3).

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-17-hrr-recovery-trend.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
