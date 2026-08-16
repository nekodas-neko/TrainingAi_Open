# Oura Device Metrics (server-only: daytime HRV, intraday temp, ring uptime) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface three owner-facing Oura-ring device metrics that are pure aggregations of already-captured raw BLE samples — a **daytime HRV curve** (Oura only shows nighttime HRV), an **intraday skin-temperature curve** (Oura only shows a single nightly deviation), and a **data-capture completeness / "ring uptime"** gauge (% of day with samples, longest gap, last-sample age) — all computed on-read from `oura_raw_samples`, exposed in the admin `/admin/oura-ble` tester.

**Architecture:** This is **Part A of the extended-metrics spec (`docs/superpowers/specs/2026-07-07-extended-metrics-capture-and-analysis-design.md` §A2), server-only subset only.** Everything reads the raw samples that already land in `oura_raw_samples` (with a `decoded` JSONB per event and a `measured_at` wall-clock stamp via the clock anchor). No new on-ring collection, **no native/Kotlin/APK work, no migration** — the three metrics are computed on read in a new admin route and rendered in the existing tester. Because the inputs are already stored (and re-decodable from `body_hex`), the metrics are automatically available for all captured history with zero ring re-sync. Three small **pure helper functions** (unit-tested against pinned sample shapes) hold the math; the route just loads samples and calls them.

**Tech Stack:** TypeScript, Next.js 15 route handler (`requireAdmin`-gated), Drizzle/Postgres (read-only over `oura_raw_samples`), the existing `lib/oura-ble/decode.ts` (`measuredAtMs`), `lib/date-utils` (`toAestDay`), `lib/health/wear-confidence.ts` (extended), vitest.

---

## Runtime reality / verification note

- **Server/JS only — ships via Railway, no APK rebuild, no migration, no schema change.** Fully buildable AND verifiable in the sandbox against the local dev Postgres.
- The three pure helpers are unit-tested in the sandbox (`pnpm test`).
- The route is verifiable against the local dev DB by inserting a clock anchor + a handful of `oura_raw_samples` rows (HRV `0x5d`, temp `0x46`, and any biometric tags for completeness) with hand-computed `decoded` JSONB, then hitting `GET /api/oura-ble/device-metrics` as an admin user — exactly the pattern the existing `lib/data/postgres/__tests__/oura-ble-*.test.ts` DB tests use.
- The tester panel is verifiable in `pnpm dev` at `/admin/oura-ble` (admin-only; the seed user `test@local.dev` must have `isAdmin=true` — set it directly in the dev DB if needed).
- **Not device-gated for the server/verification path.** The *data source* (the ring actually emitting daytime `0x5d`/`0x46` frames) is only exercisable on-device, but this plan reads whatever is already stored — it does not depend on new ring behaviour. On a real drain the owner confirms the curves look sane against their Oura app history.

## Scope

**In scope (the three server-only, back-fillable §A2 metrics that are genuinely NEW):**
- **Daytime HRV curve** — continuous 5-min RMSSD across waking hours.
- **Intraday skin-temperature curve** — continuous temp across the day.
- **Ring uptime / completeness** — worn-bins/expected-bins %, longest gap, last-sample age.

**Explicitly OUT of scope (do NOT build here):**
- **Wear time (hours worn/day)** — **already shipped.** The rollup already writes `oura_daily.non_wear_time_sec` (15-min on-finger bins) and `lib/health/wear-confidence.ts` already computes `wornHours`. This plan *extends* that file with a completeness ratio; it does not re-derive wear time.
- **Battery / charging-time / drain / battery-health** — these are the **native** half of Part A (the plugin reads battery every 5 min but discards it; capturing it needs a Kotlin POST path + migration + owner APK rebuild). A separate, device-gated plan.
- **SpO₂ intraday** — the rollup already derives daily SpO₂ (`lib/oura-ble/spo2.ts`); an intraday SpO₂ curve is a possible later addition, not part of this plan.
- **Promoting any of these to the user-facing health tab** — the spec's stated posture is admin/owner R&D (`requireAdmin`), matching the rest of the `/api/oura-ble/*` pipeline. Keep it in the tester. User-facing promotion is a follow-up decision, not this plan.

If you find yourself writing Kotlin, a migration, or a user-facing health-tab card, STOP — you have left this plan's scope.

## File structure

**Create:**
- `lib/health/daytime-hrv.ts` — pure: HRV samples + the day's sleep interval → daytime-only 5-min RMSSD points.
- `lib/health/intraday-temp.ts` — pure: temp samples → skin-range intraday temperature curve.
- `lib/health/__tests__/daytime-hrv.test.ts`, `lib/health/__tests__/intraday-temp.test.ts`
- `app/api/oura-ble/device-metrics/route.ts` — admin GET; loads raw samples, calls the helpers, returns the three metrics.
- `components/oura-ble/device-metrics-panel.tsx` — tester panel rendering the three metrics.

**Modify:**
- `lib/health/wear-confidence.ts` — add a `completenessForDay(...)` helper (worn-bins/expected-bins %, longest gap, last-sample age).
- `lib/health/__tests__/wear-confidence.test.ts` — add tests for `completenessForDay`.
- `components/oura-ble/oura-ble-debug.tsx` — mount the new panel.
- `docs/implementation-backlog.md` — remove this item's Queue entry (final task).
- `projectOverview.md` + `docs/overview/history-*.md` — journal + index (final task). No version bump (admin-only R&D, no user-visible change).

---

## Domain facts you need (verified against `main` by exploration, do not re-derive)

- **`oura_raw_samples`** (`schema.ts:685-695`): `userId`, `ringTimestampDs` (ring clock, deciseconds), `tag` (smallint, e.g. `0x5d`=93), `eventName`, `bodyHex` (archival), `decoded` (JSONB, nullable), `measuredAt` (wall-clock timestamptz, populated at ingest via the clock anchor). Index on `(user_id, tag, ring_timestamp_ds)`.
- **Clock anchor** — `repo.getOuraClockAnchor(userId)` (`adapter.ts:3355`) → `{ anchorDs, anchorUtc: Date } | null`. Convert a sample's ds to wall-clock ms with **`measuredAtMs(ds, anchorDs, anchorUtcMs)`** (`lib/oura-ble/decode.ts:608`). **But** every row already has `measured_at` stamped at ingest — so for a compute-on-read route you can select `measured_at` directly and skip the anchor math entirely. Use `measured_at`; fall back to the anchor only if you ever need to re-derive.
- **Decoded field shapes** (from `lib/oura-ble/decode.ts`, pinned by `lib/__tests__/oura-ble-decode.test.ts`):
  - HRV `0x5d` (`hrv_event`): `{ hr_bpm: number[], rmssd_ms: number[], interval_min: 5 }` — **the RMSSD values are `decoded.rmssd_ms` (one per 5-min sub-interval).**
  - Temp `0x46`/`0x69` (`temp_event`/`temp_period`): `{ temps_c: number[] }` — **°C values are `decoded.temps_c`.** (Do NOT use `0x75`/`sleep_temp` — it only fires while asleep.)
  - The per-frame `decoded` holds an *array* of sub-samples; the frame's `measured_at` is the timestamp of the frame — treat each array element as evenly spaced within the frame's cadence, or (simpler and sufficient here) attribute the whole frame to its `measured_at` and average the array. This plan averages per frame (see helpers) to keep it simple and robust.
- **Day bucketing** — map a wall-clock timestamp to a user-local day-string with `toAestDay(date, tz)` (`lib/date-utils.ts:23`); `tz = session.user?.timezone ?? DEFAULT_TZ`.
- **Wear/completeness precedent** — the rollup marks worn 15-min bins (`WEAR_BIN_DS = 15*60*10`) if ANY on-finger signal (IBI/HRV/SpO₂/phase/sleep-signal/aohr, or temp ≥31 °C) is present in the bin, and writes `oura_daily.non_wear_time_sec = dayLenSec - wornSec` (partial-day-aware via `secondsSinceLocalMidnight`). `lib/health/wear-confidence.ts` already exports `wornHours(nonWearTimeSec, dayLenSec)`, `MIN_WEAR_HOURS`, `isLowWearDay`. **Completeness is the same worn-bin set expressed as a ratio + gap stats** — extend this file, don't re-derive the binning.
- **Route conventions** (mirror an existing admin `/api/oura-ble/*` route, e.g. `samples/summary/route.ts`): `requireAdmin` gate → 401/403; `rateLimit`; read `tz` from the session; return `NextResponse.json(...)`. These are admin R&D routes — match that posture, no SWR product-cache headers needed.
- **Tester** — `components/oura-ble/oura-ble-debug.tsx` is the admin client tester (stat tiles + redecode/frame-dump buttons + `SampleInspector`). Mount new panels here; it already fetches `/api/oura-ble/samples/summary`.
- **Tests** — `pnpm test` runs `vitest run`. Pure helpers: co-locate in `lib/health/__tests__/` (see `wear-confidence.test.ts`). DB-backed route check: the `lib/data/postgres/__tests__/oura-ble-spo2-daykeying.test.ts` template (fixed `TEST_USER_ID`, insert a clock anchor + raw rows with hand-built `decoded`, call, assert; self-skips without `DATABASE_URL`).

---

### Task 1: Daytime-HRV helper

**What it does:** given the day's 5-min RMSSD samples (each a `{tSec, rmssd}` where `tSec` = seconds-since-local-midnight) and the day's sleep interval(s) in the same seconds-since-midnight frame, return the **daytime** subset (samples outside sleep) as a time-ordered curve. "Daytime HRV" is genuinely new — the rollup only reads `0x5d` *inside* sleep windows today.

**Files:**
- Create: `lib/health/daytime-hrv.ts`
- Test: `lib/health/__tests__/daytime-hrv.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/daytime-hrv.test.ts
import { describe, it, expect } from 'vitest'
import { daytimeHrvCurve } from '@/lib/health/daytime-hrv'

describe('daytimeHrvCurve', () => {
  it('keeps samples outside every sleep interval, time-ordered', () => {
    const samples = [
      { tSec: 3_600, rmssd: 40 },   // 01:00 — inside sleep -> dropped
      { tSec: 32_400, rmssd: 55 },  // 09:00 — awake -> kept
      { tSec: 50_400, rmssd: 48 },  // 14:00 — awake -> kept
    ]
    const sleep = [{ startSec: 0, endSec: 27_000 }] // 00:00–07:30
    expect(daytimeHrvCurve(samples, sleep)).toEqual([
      { tSec: 32_400, rmssd: 55 },
      { tSec: 50_400, rmssd: 48 },
    ])
  })

  it('returns all samples when there is no sleep interval', () => {
    const samples = [{ tSec: 100, rmssd: 30 }]
    expect(daytimeHrvCurve(samples, [])).toEqual([{ tSec: 100, rmssd: 30 }])
  })

  it('sorts out-of-order samples by time', () => {
    const out = daytimeHrvCurve([{ tSec: 200, rmssd: 2 }, { tSec: 100, rmssd: 1 }], [])
    expect(out.map(p => p.tSec)).toEqual([100, 200])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/daytime-hrv.test.ts`
Expected: FAIL with "Cannot find module '@/lib/health/daytime-hrv'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/health/daytime-hrv.ts
// Daytime HRV curve — 5-min RMSSD samples that fall OUTSIDE the day's sleep
// interval(s). Oura only surfaces nighttime HRV; the ring emits 5-min RMSSD
// (tag 0x5d) all day, so the waking-hours curve is a signal Oura never shows.

export interface HrvSample { tSec: number; rmssd: number }
export interface SleepInterval { startSec: number; endSec: number } // seconds since local midnight

/** Samples not inside any [startSec, endSec] sleep interval, ascending by tSec. */
export function daytimeHrvCurve(samples: HrvSample[], sleep: SleepInterval[]): HrvSample[] {
  return samples
    .filter(s => !sleep.some(w => s.tSec >= w.startSec && s.tSec < w.endSec))
    .sort((a, b) => a.tSec - b.tSec)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/daytime-hrv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health/daytime-hrv.ts lib/health/__tests__/daytime-hrv.test.ts
git commit -m "Add daytime-HRV curve helper (samples outside sleep)"
```

---

### Task 2: Intraday-temperature helper

**What it does:** given the day's skin-temperature samples (`{tSec, tempC}`), return a time-ordered curve filtered to the on-finger skin range (drops off-finger samples that have fallen toward ambient), optionally binned to reduce noise. Oura only shows one nightly deviation number; this is the continuous intraday curve.

**Files:**
- Create: `lib/health/intraday-temp.ts`
- Test: `lib/health/__tests__/intraday-temp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/intraday-temp.test.ts
import { describe, it, expect } from 'vitest'
import { intradayTempCurve, SKIN_MIN_C } from '@/lib/health/intraday-temp'

describe('intradayTempCurve', () => {
  it('drops sub-skin-range (off-finger) samples and sorts by time', () => {
    const samples = [
      { tSec: 200, tempC: 20.0 },  // ambient / off finger -> dropped (< SKIN_MIN_C)
      { tSec: 100, tempC: 33.5 },  // worn -> kept
      { tSec: 300, tempC: 34.1 },  // worn -> kept
    ]
    expect(intradayTempCurve(samples)).toEqual([
      { tSec: 100, tempC: 33.5 },
      { tSec: 300, tempC: 34.1 },
    ])
  })

  it('exposes the skin-range floor used by the wear-time gate (31 °C)', () => {
    expect(SKIN_MIN_C).toBe(31)
  })

  it('returns an empty curve when nothing is in range', () => {
    expect(intradayTempCurve([{ tSec: 1, tempC: 22 }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/intraday-temp.test.ts`
Expected: FAIL with "Cannot find module '@/lib/health/intraday-temp'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/health/intraday-temp.ts
// Intraday skin-temperature curve from tags 0x46/0x69 (temps_c). Oura shows only
// one nightly deviation; this is the continuous daytime curve. Samples below the
// skin range are the ring off the finger cooling toward ambient — drop them
// (same 31 °C floor the wear-time gate uses in the rollup).

export const SKIN_MIN_C = 31

export interface TempSample { tSec: number; tempC: number }

/** On-finger temperature samples (>= SKIN_MIN_C), ascending by tSec. */
export function intradayTempCurve(samples: TempSample[]): TempSample[] {
  return samples
    .filter(s => s.tempC >= SKIN_MIN_C)
    .sort((a, b) => a.tSec - b.tSec)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/intraday-temp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health/intraday-temp.ts lib/health/__tests__/intraday-temp.test.ts
git commit -m "Add intraday skin-temperature curve helper"
```

---

### Task 3: Ring-uptime / completeness helper (extend `wear-confidence.ts`)

**What it does:** given the set of worn 15-min bin indices for a day and the number of expected bins so far (full day, or elapsed-so-far for today), return `{ wornBins, expectedBins, pct, longestGapMin, lastSampleAgeMin }`. This is the same worn-bin data the wear-time metric already computes, expressed as a *completeness ratio* + gap stats. It lives in `wear-confidence.ts` because that file already owns the wear/worn-bin concept (One-Formula).

**Files:**
- Modify: `lib/health/wear-confidence.ts`
- Test: `lib/health/__tests__/wear-confidence.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `lib/health/__tests__/wear-confidence.test.ts`:

```typescript
import { completenessForDay } from '@/lib/health/wear-confidence'

describe('completenessForDay', () => {
  it('computes worn %, longest gap and last-sample age from worn 15-min bins', () => {
    // 15-min bins. Worn bins 0,1,2 then 6,7 (a 3-bin = 45-min gap between 2 and 6).
    // expectedBins = 8 (elapsed = 8 * 15 min = 2h into the day).
    const r = completenessForDay({ wornBinIndices: [0, 1, 2, 6, 7], expectedBins: 8, binMinutes: 15 })
    expect(r.wornBins).toBe(5)
    expect(r.expectedBins).toBe(8)
    expect(r.pct).toBe(63)          // round(5/8 * 100)
    expect(r.longestGapMin).toBe(45) // bins 3,4,5 missing = 3 * 15
    expect(r.lastSampleAgeMin).toBe(0) // last worn bin (7) == last expected bin (7)
  })

  it('reports a trailing gap as last-sample age', () => {
    // worn only bins 0,1; expected 5 -> trailing gap of bins 2,3,4 = last worn is bin 1,
    // last expected is bin 4 -> age = (4 - 1) * 15 = 45.
    const r = completenessForDay({ wornBinIndices: [0, 1], expectedBins: 5, binMinutes: 15 })
    expect(r.lastSampleAgeMin).toBe(45)
    expect(r.longestGapMin).toBe(45)
  })

  it('handles a day with no samples', () => {
    const r = completenessForDay({ wornBinIndices: [], expectedBins: 4, binMinutes: 15 })
    expect(r).toEqual({ wornBins: 0, expectedBins: 4, pct: 0, longestGapMin: 60, lastSampleAgeMin: 60 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/wear-confidence.test.ts`
Expected: FAIL with "completenessForDay is not a function".

- [ ] **Step 3: Add the implementation to `wear-confidence.ts`**

Append (do not modify the existing exports):

```typescript
export interface DayCompleteness {
  wornBins: number
  expectedBins: number
  pct: number
  longestGapMin: number
  lastSampleAgeMin: number
}

/** Data-capture completeness for one day from its worn 15-min bin indices.
 *  `expectedBins` = full day (96) for a past day, or elapsed-so-far for today.
 *  A "gap" is a run of consecutive expected-but-unworn bins; the trailing gap
 *  (from the last worn bin to the last expected bin) is the last-sample age. */
export function completenessForDay(input: {
  wornBinIndices: number[]
  expectedBins: number
  binMinutes: number
}): DayCompleteness {
  const { expectedBins, binMinutes } = input
  const worn = new Set(input.wornBinIndices.filter(i => i >= 0 && i < expectedBins))
  const wornBins = worn.size
  const pct = expectedBins > 0 ? Math.round((wornBins / expectedBins) * 100) : 0

  let longestRun = 0
  let currentRun = 0
  let lastWorn = -1
  for (let i = 0; i < expectedBins; i++) {
    if (worn.has(i)) {
      lastWorn = i
      currentRun = 0
    } else {
      currentRun++
      if (currentRun > longestRun) longestRun = currentRun
    }
  }
  const trailingGapBins = expectedBins - 1 - lastWorn // = expectedBins if lastWorn === -1
  return {
    wornBins,
    expectedBins,
    pct,
    longestGapMin: longestRun * binMinutes,
    lastSampleAgeMin: Math.max(0, trailingGapBins) * binMinutes,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/wear-confidence.test.ts`
Expected: PASS (existing wear-confidence tests still pass; three new ones pass).

- [ ] **Step 5: Commit**

```bash
git add lib/health/wear-confidence.ts lib/health/__tests__/wear-confidence.test.ts
git commit -m "Add ring-uptime completeness helper to wear-confidence"
```

---

### Task 4: Admin `device-metrics` route — load raw samples, call the helpers

**What it does:** an admin GET that, for the last `days` (default 3), loads the relevant raw samples, buckets them into user-local days via `measured_at`, and returns the three metrics per day. Reads `measured_at` directly (already stamped at ingest) — no anchor math. Completeness bins every biometric tag's `measured_at` into 15-min bins.

**Files:**
- Create: `app/api/oura-ble/device-metrics/route.ts`

- [ ] **Step 1: Read a sibling admin route to copy the exact gate/rate-limit shape**

Read `app/api/oura-ble/samples/summary/route.ts` in full. Note exactly how it imports and calls the admin gate (`requireAdmin` or an `auth()` + `isAdmin` check — **use whatever that file uses, verbatim**), how it applies `rateLimit`, and how it gets `userId`/`tz` from the session. This is a read-only step — no edit — to avoid guessing the admin-gate import.

- [ ] **Step 2: Write the route**

Create `app/api/oura-ble/device-metrics/route.ts`. Replace the `AUTH GATE` comment block with the exact admin gate + rate-limit copied from Step 1's file:

```typescript
import { NextResponse } from 'next/server'
import { getRepository } from '@/lib/data'
import { DEFAULT_TZ, toAestDay, secondsSinceLocalMidnight } from '@/lib/date-utils'
import { daytimeHrvCurve } from '@/lib/health/daytime-hrv'
import { intradayTempCurve } from '@/lib/health/intraday-temp'
import { completenessForDay } from '@/lib/health/wear-confidence'
// ── AUTH GATE ──  copy the exact imports (auth/requireAdmin) + rateLimit from
//                 app/api/oura-ble/samples/summary/route.ts

const HRV_TAG = 0x5d
const TEMP_TAGS = [0x46, 0x69]
// on-finger signals the wear/completeness gate counts (mirror the rollup's set)
const BIOMETRIC_TAGS = [0x5d, 0x80, 0x60, 0x6f, 0x8b, 0x86, 0x46, 0x69, 0x72, 0x75, 0x4b, 0x4e, 0x5a]

export interface DeviceMetricsResponse {
  days: {
    date: string
    daytimeHrv: { tSec: number; rmssd: number }[]
    intradayTemp: { tSec: number; tempC: number }[]
    completeness: { wornBins: number; expectedBins: number; pct: number; longestGapMin: number; lastSampleAgeMin: number }
  }[]
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const numArr = (decoded: unknown, key: string): number[] => {
  const v = (decoded as Record<string, unknown> | null)?.[key]
  return Array.isArray(v) ? (v.filter(n => typeof n === 'number') as number[]) : []
}

export async function GET(req: Request) {
  // ── AUTH GATE ── (from Step 1): reject non-admins with 401/403; rateLimit; get session.
  const userId = /* session.user.id from the gate */ ''
  const tz = /* session.user?.timezone */ DEFAULT_TZ
  const days = Math.min(14, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? '3')))

  const repo = await getRepository()
  // One admin read that returns raw rows for the tags we need over the window.
  // Use the repo's existing raw-sample reader (see note below) filtered to BIOMETRIC_TAGS.
  const rows = await repo.getOuraRawSamplesForTags(userId, BIOMETRIC_TAGS, days)

  // Bucket by local day using the already-stamped measured_at.
  const todayIso = toAestDay(new Date(), tz)
  const byDay = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!r.measuredAt) continue
    const day = toAestDay(new Date(r.measuredAt), tz)
    ;(byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r)
  }

  const WEAR_BIN_MIN = 15
  const out: DeviceMetricsResponse['days'] = []
  for (const [date, dayRows] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const secOfDay = (r: (typeof rows)[number]) => {
      const d = new Date(r.measuredAt!)
      const midnight = new Date(d); midnight.setHours(0, 0, 0, 0) // local — see note
      return Math.max(0, Math.floor((d.getTime() - midnight.getTime()) / 1000))
    }
    // Daytime HRV: average each 0x5d frame's rmssd_ms, exclude sleep (see note on sleep interval)
    const hrvSamples = dayRows
      .filter(r => r.tag === HRV_TAG)
      .map(r => ({ tSec: secOfDay(r), rmssd: avg(numArr(r.decoded, 'rmssd_ms')) }))
      .filter((s): s is { tSec: number; rmssd: number } => s.rmssd != null)
    const tempSamples = dayRows
      .filter(r => TEMP_TAGS.includes(r.tag))
      .map(r => ({ tSec: secOfDay(r), tempC: avg(numArr(r.decoded, 'temps_c')) }))
      .filter((s): s is { tSec: number; tempC: number } => s.tempC != null)

    const wornBinIndices = [...new Set(dayRows.map(r => Math.floor(secOfDay(r) / (WEAR_BIN_MIN * 60))))]
    const expectedBins = date === todayIso
      ? Math.ceil(secondsSinceLocalMidnight(tz) / (WEAR_BIN_MIN * 60))
      : Math.ceil(86_400 / (WEAR_BIN_MIN * 60)) // 96

    out.push({
      date,
      daytimeHrv: daytimeHrvCurve(hrvSamples, /* sleep intervals — see note */ []),
      intradayTemp: intradayTempCurve(tempSamples),
      completeness: completenessForDay({ wornBinIndices, expectedBins, binMinutes: WEAR_BIN_MIN }),
    })
  }

  const body: DeviceMetricsResponse = { days: out }
  return NextResponse.json(body)
}
```

**Implementation notes the executor MUST resolve (do not skip):**
1. **`repo.getOuraRawSamplesForTags` does not exist yet** — add it. There is already a raw-sample reader for the tester's frame-dump (`getOuraRawSampleRows` / the `samples/raw` route) and the rollup's private `rowsByTags`. Add a thin repo method `getOuraRawSamplesForTags(userId, tags: number[], days: number): Promise<{ tag: number; decoded: unknown; measuredAt: string | null }[]>` in `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` that selects `tag, decoded, measured_at` from `oura_raw_samples` WHERE `user_id = $1 AND tag = ANY($2) AND measured_at >= now() - ($3 || ' days')::interval AND decoded IS NOT NULL` ordered by `measured_at ASC`. Mirror the existing `getOuraRawSampleRows` method's shape exactly.
2. **Seconds-since-local-midnight**: the inline `setHours(0,0,0,0)` above uses the *server's* local zone, which is wrong. Use the timezone-correct path: compute the day's local-midnight UTC via `dateStrMidnightInTz(date, tz)` (`lib/date-utils.ts`) and subtract, OR reuse `secondsSinceLocalMidnight` semantics. Confirm the exact `lib/date-utils` export for "a given date-string's local midnight as a Date" and use it — never `setHours`.
3. **Sleep interval for daytime-HRV**: pass the day's sleep interval(s) so `daytimeHrvCurve` can exclude sleep. Load the day's `sleep_sessions` row(s) via the existing `repo.listSleepSessions(userId, date, date)` and convert each `{sleepStart, sleepEnd}` to seconds-since-local-midnight in `tz`. If a session crosses midnight, clamp to `[0, 86400]` for the day. If you want to defer this, passing `[]` yields the *full-day* HRV curve (still useful, just not sleep-excluded) — but prefer wiring the sleep interval; it is the point of "daytime".

- [ ] **Step 3: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Verify against the local dev DB**

Make the seed user an admin (`UPDATE users SET is_admin = true WHERE email = 'test@local.dev';` against the dev DB), start `pnpm dev`, log in, insert a clock anchor + a few `oura_raw_samples` rows (an `0x5d` with `decoded = {"rmssd_ms":[40,45]}`, an `0x46` with `decoded = {"temps_c":[33.5]}`, both with a recent `measured_at`), then hit `/api/oura-ble/device-metrics?days=3`. Expected: HTTP 200 with a `days[]` array; the seeded day shows a `daytimeHrv` point (~42.5), an `intradayTemp` point (33.5), and a `completeness` object. Confirm a non-admin session gets 401/403.

- [ ] **Step 5: Commit**

```bash
git add app/api/oura-ble/device-metrics/route.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add admin device-metrics route (daytime HRV, intraday temp, uptime)"
```

---

### Task 5: Render the three metrics in the admin tester

**Files:**
- Create: `components/oura-ble/device-metrics-panel.tsx`
- Modify: `components/oura-ble/oura-ble-debug.tsx`

- [ ] **Step 1: Write the panel**

Create `components/oura-ble/device-metrics-panel.tsx` — a `"use client"` component that fetches `/api/oura-ble/device-metrics?days=3` on mount and renders, per day: the completeness numbers (`pct`%, `longestGapMin`, `lastSampleAgeMin`), a compact daytime-HRV list/sparkline, and an intraday-temp list/sparkline. Keep it plain (this is an admin diagnostic, not product chrome — match the existing `oura-ble-debug.tsx` styling: mono text, simple rows). Reuse the existing `Sparkline` primitive (`components/ui/sparkline.tsx`) for the two curves — do NOT hand-roll a polyline (CLAUDE.md rule). Import the response type: `import type { DeviceMetricsResponse } from '@/app/api/oura-ble/device-metrics/route'`.

```typescript
"use client";
import { useEffect, useState } from "react";
import type { DeviceMetricsResponse } from "@/app/api/oura-ble/device-metrics/route";
import { Sparkline } from "@/components/ui/sparkline";

export function DeviceMetricsPanel() {
  const [data, setData] = useState<DeviceMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/oura-ble/device-metrics?days=3")
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(String(e)));
  }, []);
  if (error) return <div className="text-xs text-red-500">Device metrics: {error}</div>;
  if (!data) return <div className="text-xs text-muted-foreground">Loading device metrics…</div>;
  return (
    <div className="rounded-xl border border-border p-3 text-xs space-y-3">
      <h3 className="font-semibold uppercase tracking-widest text-muted-foreground">Device metrics (BLE-derived)</h3>
      {data.days.map(d => (
        <div key={d.date} className="space-y-1">
          <p className="font-mono">{d.date}</p>
          <p className="text-muted-foreground">
            Uptime {d.completeness.pct}% · longest gap {d.completeness.longestGapMin}m · last sample {d.completeness.lastSampleAgeMin}m ago
          </p>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Daytime HRV</span>
            {d.daytimeHrv.length ? <Sparkline values={d.daytimeHrv.map(p => p.rmssd)} /> : <span className="text-muted-foreground">—</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Intraday temp</span>
            {d.intradayTemp.length ? <Sparkline values={d.intradayTemp.map(p => p.tempC)} /> : <span className="text-muted-foreground">—</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Note:** confirm the exact prop name of the shared `Sparkline` primitive (`components/ui/sparkline.tsx`) — it may be `values`, `data`, or `points`. Read the file and match it; if the primitive's shape differs, adapt the two call sites. Do not add a second sparkline implementation.

- [ ] **Step 2: Mount it in the tester**

In `components/oura-ble/oura-ble-debug.tsx`, import `DeviceMetricsPanel` and render `<DeviceMetricsPanel />` in a sensible place (e.g. below the stat tiles, near the `SampleInspector`). One import + one JSX line.

- [ ] **Step 3: Type-check, lint, run all tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 4: Verify in the dev server**

With `pnpm dev` running and logged in as the admin seed user, open `/admin/oura-ble`. Expected: a "Device metrics (BLE-derived)" panel showing, per recent day, the uptime line and the two sparklines (or "—" when no samples). No console errors.

- [ ] **Step 5: Commit**

```bash
git add components/oura-ble/device-metrics-panel.tsx components/oura-ble/oura-ble-debug.tsx
git commit -m "Render BLE device metrics in the admin tester"
```

---

### Task 6: (Optional) DB-backed route test

Mirrors the `lib/data/postgres/__tests__/oura-ble-spo2-daykeying.test.ts` template. Optional but recommended since the day-bucketing + seconds-of-day math is the fiddly part.

**Files:**
- Create: `lib/data/postgres/__tests__/oura-ble-device-metrics.test.ts`

- [ ] **Step 1: Write a `describe.skipIf(!process.env.DATABASE_URL)` test** that inserts a clock anchor + `oura_raw_samples` rows (an `0x5d` and an `0x46` at known ds offsets from the anchor, so `measured_at` lands on a known local day + hour), then asserts `repo.getOuraRawSamplesForTags(...)` returns them and — if you extract the route's per-day assembly into a small exported pure function — that the assembled day has the expected HRV/temp points and completeness. Use `TEST_USER_ID`, `beforeAll`/`afterAll` cleanup exactly as the sibling test does.

- [ ] **Step 2: Run it**

Run: `pnpm test lib/data/postgres/__tests__/oura-ble-device-metrics.test.ts`
Expected: PASS locally (self-skips in CI without `DATABASE_URL`).

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/__tests__/oura-ble-device-metrics.test.ts
git commit -m "Add DB-backed test for device-metrics day assembly"
```

---

### Task 7: Bookkeeping — journal, index, backlog removal

**No version bump / no changelog entry** — this is admin-only R&D with no user-visible product change (per CLAUDE.md, version bumps + changelog are for user-visible changes).

**Files:**
- Modify: `docs/implementation-backlog.md` (remove this item's Queue entry)
- Modify: `projectOverview.md` (index) + append to the latest `docs/overview/history-*.md` (journal)

- [ ] **Step 1: Remove this item's Queue entry** from `docs/implementation-backlog.md` (a merged item must never linger). Fix any cross-reference to it in the same edit.

- [ ] **Step 2: Journal + index** — append a session summary to the latest `docs/overview/history-*.md` and update `projectOverview.md`'s lean index: the three admin BLE device metrics shipped; the battery/native half of Part A remains unbuilt (separate device-gated plan); note that the *data source* (ring emitting daytime `0x5d`/`0x46`) is only verifiable on-device, but the aggregation was verified against seeded dev data.

- [ ] **Step 3: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/implementation-backlog.md projectOverview.md docs/overview/
git commit -m "Journal + backlog bookkeeping for BLE device metrics"
```

---

## Self-review checklist (run before handing off)

- **Spec coverage:** the three in-scope §A2 server-only metrics (daytime HRV, intraday temp, completeness) each have a pure-helper task + wiring. Wear-time, battery, and SpO₂-intraday are enumerated as out-of-scope with reasons. ✅
- **No new capture / no migration / no native:** reads only already-stored `oura_raw_samples` (via `measured_at`, already stamped); no APK, no schema change, no Kotlin. ✅
- **One-Formula:** completeness extends `wear-confidence.ts` (owns the worn-bin concept); reuses `measuredAtMs`/`measured_at`, `toAestDay`, `numArr`-style decoded access, the shared `Sparkline` primitive. No duplicate wear/binning logic. ✅
- **Pipeline rules honoured:** reads `body_hex`-derived `decoded` (never mutates raw); adds no throwing path to ingest (compute-on-read route, isolated from the rollup); new metrics back-fill for free because inputs are already stored. ✅
- **Posture:** admin-gated (`requireAdmin`), rendered in the existing tester — matches the rest of `/api/oura-ble/*`; no user-facing surface. ✅
- **Type consistency:** helper signatures (`daytimeHrvCurve`, `intradayTempCurve`, `completenessForDay`) match the route's call sites; `DeviceMetricsResponse` is imported by the panel. ✅
- **Placeholders resolved:** the route's three `MUST resolve` notes (repo method, tz-correct seconds-of-day, sleep interval) are explicit tasks, not hand-waves. ✅
- **Runtime:** server + admin client only, sandbox-verifiable; only the underlying ring-emits-the-frames reality is device-observed. ✅
