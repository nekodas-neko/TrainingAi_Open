# Intraday SpO₂ Curve (admin device-metrics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth owner-facing Oura-ring device metric — an **intraday SpO₂ curve** (continuous SpO₂ % across the day) — as a pure compute-on-read aggregation of already-captured `oura_raw_samples` (tag `0x8b`, `spo2_r_pi_event`). Oura's app only surfaces one nightly average; this is the waking-hours curve, computed on read, admin-gated, rendered in the existing `/admin/oura-ble` tester.

**Architecture:** A direct **clone of item 18's daytime-HRV / intraday-temp helpers** (`docs/superpowers/plans/2026-07-11-oura-device-metrics-server-only.md`). Item 18 explicitly listed intraday SpO₂ as OUT of scope ("a possible later addition") and forbade scope-creep, so this is a **separate small plan built on top of item 18**, sharing item 18's route (`app/api/oura-ble/device-metrics/route.ts`) and panel (`components/oura-ble/device-metrics-panel.tsx`). No new capture, **no migration, no native/Kotlin/APK work.** The data is already captured and decoded — `lib/oura-ble/decode.ts` decodes `0x8b` → `{ r: number[], perfusion_index: number[] }`, and `lib/oura-ble/spo2.ts` already exposes `spo2PctFromR(r)` (calibrated R→SpO₂ %, quadratic, clamped `[85, 100]`). The rollup already derives a *daily* SpO₂ from these samples; intraday is the same inputs, one point per frame instead of one per day.

**Tech Stack:** TypeScript, one pure helper (`lib/health/intraday-spo2.ts`) + vitest, extends item 18's admin route and tester panel. Reuses `spo2PctFromR` (`lib/oura-ble/spo2.ts`) and the `0x8b` decode — no new formula.

---

## Lane & sequencing (read before scheduling)

- **Lane = Admin/device R&D (Lane 5)** — same lane as item 18. Admin-gated, no user-facing surface, no product-cache headers.
- **Depends on item 18 landing first.** This plan *extends* item 18's route (`device-metrics/route.ts`), panel (`device-metrics-panel.tsx`), and the `getOuraRawSamplesForTags` repo method that item 18 introduces. **Seam:** it touches the same files as item 18, so within Lane 5 it **serialises after item 18** — do not run the two in parallel (they will collide on the route, the panel, and the response type). At owner discretion the two may instead be **merged into a single PR** (item 18 + the SpO₂ curve together) — the helper + wiring here are small enough to fold in. If item 18 is not yet on `main` at implementation time, either wait for it or merge the two.
- If, at implementation time, item 18's route already includes `0x8b` in its `BIOMETRIC_TAGS` completeness set (it does — `0x8b` is listed there), no change to completeness is needed; SpO₂ is an *additional per-day curve* alongside daytime-HRV and intraday-temp.

**Branch:** `feat/intraday-spo2`

## Runtime reality / verification note

- **Server/JS only — ships via Railway, no APK rebuild, no migration, no schema change.** Buildable AND unit-testable in the sandbox.
- The pure helper is unit-tested against synthetic sample shapes (`pnpm test`).
- The route path is verifiable against the local dev DB by inserting a clock anchor + a couple of `0x8b` `oura_raw_samples` rows with hand-built `decoded` (`{"r":[...],"perfusion_index":[...]}`) and a recent `measured_at`, then hitting `GET /api/oura-ble/device-metrics` as an admin — same pattern item 18 uses.
- **Device caveat:** a *real* SpO₂ curve only renders against real ring data on-device (SpO₂ is emitted mainly during sleep / low-motion worn periods). The helper and route are sandbox-testable against synthetic samples; the owner confirms the curve looks sane against their Oura app history on a real drain. No device gate on the compute/verification path.

## Scope

**In scope:** one pure helper (intraday SpO₂ curve: `0x8b` frames → per-frame SpO₂ % via `spo2PctFromR`, time-ordered), its test, and the two-file wiring into item 18's route + panel.

**Explicitly OUT of scope (do NOT build):**
- Anything item 18 already covers (daytime HRV, intraday temp, completeness) — this is additive only.
- Re-deriving SpO₂ from R — always go through the existing `spo2PctFromR`; never re-implement the quadratic (One Formula, One Place).
- Promoting the curve to the user-facing health tab — stays admin R&D like the rest of `/api/oura-ble/*`.
- Any migration, Kotlin, or new capture. If you find yourself writing any of those, STOP — you have left this plan's scope.

## Domain facts you need (verified against `main`, do not re-derive)

- **Decode** — `lib/oura-ble/decode.ts` `decodeSpo2RPi` (tag `0x8b`, `eventName` `spo2_r_pi_event`, `:137-149`) returns `{ r: number[], perfusion_index: number[] }`. The per-frame `decoded` holds an *array* of R sub-samples; item 18's convention is to attribute the whole frame to its `measured_at` and average the array — do the same here (average R → one SpO₂ point per frame).
- **R → SpO₂ %** — `spo2PctFromR(r: number): number | null` (`lib/oura-ble/spo2.ts:24`): quadratic (`gen4` coeffs), clamped `[85, 100]`; returns `null` for non-physical R (`r <= 0` / non-finite). A frame whose averaged R yields `null` is dropped.
- **Raw-sample reader** — item 18 adds `repo.getOuraRawSamplesForTags(userId, tags, days)` returning `{ tag, decoded, measuredAt }[]`. `0x8b` = 139 decimal, already present in item 18's `BIOMETRIC_TAGS`. Reuse the same rows the route already loads — do not add a second DB read.
- **Seconds-of-day / day bucketing** — reuse item 18's route helpers verbatim (`measured_at` → local day via `toAestDay(date, tz)`; the tz-correct seconds-since-local-midnight the route already resolved). Do not re-invent either; do not use `setHours`.
- **Tester** — `components/oura-ble/device-metrics-panel.tsx` (created by item 18) renders per-day rows with the shared `Sparkline` primitive (`components/ui/sparkline.tsx`). Add one more row for the SpO₂ curve. Never hand-roll a polyline (CLAUDE.md rule).

## File structure

**Create:**
- `lib/health/intraday-spo2.ts` — pure: `0x8b` frames (averaged R per frame) + `measured_at`-derived `tSec` → time-ordered SpO₂ % curve.
- `lib/health/__tests__/intraday-spo2.test.ts`

**Modify:**
- `app/api/oura-ble/device-metrics/route.ts` — add the SpO₂ curve to each day (build `spo2Samples` from `0x8b` rows, call the helper, add `intradaySpo2` to `DeviceMetricsResponse`).
- `components/oura-ble/device-metrics-panel.tsx` — one more sparkline row per day ("Intraday SpO₂").
- `components/oura-ble/oura-ble-debug.tsx` — no change expected (panel already mounted by item 18); touch only if the panel's mount site needs it.
- `docs/implementation-backlog.md` — remove this item's Queue entry (final task).
- `projectOverview.md` + `docs/overview/history-*.md` — journal + index (final task). No version bump (admin-only R&D, no user-visible change).

---

### Task 1: Intraday-SpO₂ helper

**What it does:** given the day's SpO₂ samples (`{ tSec, r }` where `tSec` = seconds-since-local-midnight and `r` = the frame's averaged ratio-of-ratios), convert each `r` to SpO₂ % via the shared `spo2PctFromR`, drop frames whose R is non-physical (`null`), and return a time-ordered curve. Mirrors `intradayTempCurve` exactly in shape.

**Files:**
- Create: `lib/health/intraday-spo2.ts`
- Test: `lib/health/__tests__/intraday-spo2.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/intraday-spo2.test.ts
import { describe, it, expect } from 'vitest'
import { intradaySpo2Curve } from '@/lib/health/intraday-spo2'
import { spo2PctFromR } from '@/lib/oura-ble/spo2'

describe('intradaySpo2Curve', () => {
  it('converts each frame R to SpO₂ % via spo2PctFromR, sorted by time', () => {
    const samples = [
      { tSec: 300, r: 0.9 },
      { tSec: 100, r: 0.8 },
    ]
    expect(intradaySpo2Curve(samples)).toEqual([
      { tSec: 100, spo2: spo2PctFromR(0.8) },
      { tSec: 300, spo2: spo2PctFromR(0.9) },
    ])
  })

  it('drops frames whose R is non-physical (spo2PctFromR → null)', () => {
    const out = intradaySpo2Curve([{ tSec: 100, r: 0 }, { tSec: 200, r: 0.85 }])
    expect(out.map(p => p.tSec)).toEqual([200])
  })

  it('returns an empty curve for no samples', () => {
    expect(intradaySpo2Curve([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test lib/health/__tests__/intraday-spo2.test.ts`
Expected: FAIL with "Cannot find module '@/lib/health/intraday-spo2'".

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/health/intraday-spo2.ts
// Intraday SpO₂ curve from tag 0x8b (spo2_r_pi_event). Oura's app shows only one
// nightly average; the ring emits a raw R ratio-of-ratios per sample, which the
// SHARED spo2PctFromR (lib/oura-ble/spo2.ts) turns into a calibrated SpO₂ % (the
// same conversion the daily rollup uses — One Formula, One Place). One point per
// frame; non-physical R (spo2PctFromR → null) is dropped.

import { spo2PctFromR } from '@/lib/oura-ble/spo2'

export interface Spo2RSample { tSec: number; r: number } // r = frame-averaged ratio-of-ratios
export interface Spo2Point { tSec: number; spo2: number }

/** On-finger SpO₂ % points (non-physical R dropped), ascending by tSec. */
export function intradaySpo2Curve(samples: Spo2RSample[]): Spo2Point[] {
  return samples
    .map(s => ({ tSec: s.tSec, spo2: spo2PctFromR(s.r) }))
    .filter((p): p is Spo2Point => p.spo2 != null)
    .sort((a, b) => a.tSec - b.tSec)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test lib/health/__tests__/intraday-spo2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health/intraday-spo2.ts lib/health/__tests__/intraday-spo2.test.ts
git commit -m "Add intraday SpO2 curve helper (R samples -> calibrated SpO2 %)"
```

---

### Task 2: Wire the curve into the device-metrics route

**Files:**
- Modify: `app/api/oura-ble/device-metrics/route.ts`

The route already loads `oura_raw_samples` for `BIOMETRIC_TAGS` (which includes `0x8b`), buckets by local day, and computes `tSec` per row. Add the SpO₂ curve alongside the existing daytime-HRV / intraday-temp assembly — no new DB read, no new day loop.

- [ ] **Step 1: Import + tag constant.** Add at the top (next to the existing helper imports):

```typescript
import { intradaySpo2Curve } from '@/lib/health/intraday-spo2'
```

and add `const SPO2_TAG = 0x8b` beside the existing `HRV_TAG` / `TEMP_TAGS` constants.

- [ ] **Step 2: Extend `DeviceMetricsResponse`.** Add `intradaySpo2: { tSec: number; spo2: number }[]` to the per-day object type.

- [ ] **Step 3: Build the samples in the per-day loop.** Beside the existing `hrvSamples` / `tempSamples` blocks, add (reusing the route's own `secOfDay`, `numArr`, and `avg` helpers — the same `avg` used for HRV/temp gives the frame-averaged R):

```typescript
    const spo2Samples = dayRows
      .filter(r => r.tag === SPO2_TAG)
      .map(r => ({ tSec: secOfDay(r), r: avg(numArr(r.decoded, 'r')) }))
      .filter((s): s is { tSec: number; r: number } => s.r != null)
```

and add `intradaySpo2: intradaySpo2Curve(spo2Samples),` to the pushed day object (next to `intradayTemp`).

- [ ] **Step 4: Type-check + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Verify against the local dev DB** (admin seed user, `pnpm dev`)

Insert a clock anchor + an `0x8b` `oura_raw_samples` row with `decoded = {"r":[0.85,0.86],"perfusion_index":[0.02,0.02]}` and a recent `measured_at`, then hit `GET /api/oura-ble/device-metrics?days=3`. Expected: the seeded day carries an `intradaySpo2` point with `spo2 ≈ spo2PctFromR(0.855)`. Confirm a non-admin session still gets 401/403.

- [ ] **Step 6: Commit**

```bash
git add app/api/oura-ble/device-metrics/route.ts
git commit -m "Add intraday SpO2 curve to the admin device-metrics route"
```

---

### Task 3: Render the SpO₂ curve in the admin tester panel

**Files:**
- Modify: `components/oura-ble/device-metrics-panel.tsx`

- [ ] **Step 1: Add one sparkline row per day.** Below the existing "Intraday temp" row, mirroring it exactly (reuse the shared `Sparkline`; confirm its prop name against `components/ui/sparkline.tsx` — do not hand-roll):

```tsx
          <div className="flex items-center gap-2">
            <span className="w-24 text-muted-foreground">Intraday SpO₂</span>
            {d.intradaySpo2.length ? <Sparkline values={d.intradaySpo2.map(p => p.spo2)} /> : <span className="text-muted-foreground">—</span>}
          </div>
```

- [ ] **Step 2: Type-check, lint, all tests**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 3: Verify in the dev server**

With `pnpm dev` and the admin seed user, open `/admin/oura-ble`. Expected: the "Device metrics (BLE-derived)" panel now shows an "Intraday SpO₂" sparkline row per recent day (or "—" when no `0x8b` samples). No console errors.

- [ ] **Step 4: Commit**

```bash
git add components/oura-ble/device-metrics-panel.tsx
git commit -m "Render intraday SpO2 curve in the admin device-metrics panel"
```

---

### Task Final: Gate + bookkeeping

**No version bump / no changelog** — admin-only R&D, no user-visible product change (matches item 18).

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 2: Backlog + journal + index** — remove this item's Queue entry from `docs/implementation-backlog.md` (a merged item must never linger); append a session summary to the latest `docs/overview/history-*.md` and update `projectOverview.md`'s lean index: the intraday SpO₂ curve shipped as an extension of item 18's admin device-metrics; note the aggregation was verified against seeded dev data but the real curve is only observable on-device (SpO₂ emitted mainly during worn/low-motion periods).

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/intraday-spo2
```

Standard change (no migration, no auth/security, no data-dropping anything) — merge on green per the CI/CD workflow once the gate passes. (If merging together with item 18 at owner discretion, fold these commits into that branch instead.)

---

## Verification summary

- **Automated (sandbox):** `intradaySpo2Curve` (3 unit tests — conversion/ordering, non-physical-R drop, empty); full existing suites green; full gate.
- **Dev-server (sandbox):** route returns `intradaySpo2` points for a seeded `0x8b` row; panel renders the SpO₂ sparkline row; admin gate rejects non-admins.
- **Deferred (device-only):** a real SpO₂ curve from live ring drains — owner eyeballs it against Oura app history.

## Notes for the implementer

- **Never re-derive SpO₂ from R.** Always `spo2PctFromR`. If you import or re-implement the quadratic anywhere else, stop.
- **This serialises after item 18** (shares its route + panel + `getOuraRawSamplesForTags`). If item 18 isn't on `main`, wait or merge the two into one PR — do not run both in parallel.
- The `0x8b` rows are already in the route's `BIOMETRIC_TAGS` load — do not add a second DB read; reuse `dayRows`, `secOfDay`, `numArr`, `avg`.
- If any line/symbol above has drifted at implementation time, re-anchor by symbol name, not by re-designing.
