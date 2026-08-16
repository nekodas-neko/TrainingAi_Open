# Plan — Oura BLE Sleep Staging Recovery + Hypnogram Ribbon Redesign

**Date:** 2026-07-08 · **Branch:** `claude/sleep-cycles-hypnogram-ibqhxl`
**Findings:** [`docs/oura-ble-sleep-staging-findings.md`](../../oura-ble-sleep-staging-findings.md)

## Goal

Bring the sleep hypnogram + stage split back under the BLE-only pipeline, and upgrade the
hypnogram visual to a connected ribbon. Two halves, different risk profiles:

- **Ribbon redesign** — pure UI, high value, verifiable on the dev server against existing
  Cloud-era data. Ships real improvement now.
- **Rollup staging wiring** — completes the already-existing (dormant) stage path so the ribbon
  lights up for BLE nights when phase events arrive. Provisional pending an on-device captured
  vector; dormant today (zero phase events in prod), so it changes nothing user-visible until
  the device-capture task lands.

Non-goals: the on-device full-night drain / cursor validation (backlog, needs the device) and
any "compute stages from raw signals" model (fallback only if a real drain proves staging is
absent).

## Context (verified against current `main`)

- `aggregateOuraRawSamples` (`lib/data/postgres/adapter.ts`, ~L3429-3542) already reads tags
  `[0x4b,0x4e,0x5a]` into `phaseRows`, computes stage **hours** (30 s/code), gates on
  `phases.length > 0`. It does **not** build `sleep_phase_5_min`.
- `upsertOuraSleep` (`lib/data/postgres/slices/oura.ts:330,353`) already accepts + COALESCEs
  `sleepPhase5Min`. `OuraSleepUpsertRow` already has the field (Cloud sync sets it).
- The pure hypnogram helper `lib/health/hypnogram.ts` defines the string format
  (`'1'=deep '2'=light '3'=REM '4'=awake`, one char per 5 min) and its segmenter/cycles/totals.
  Keep it as the One-Formula-One-Place authority.
- `components/health/hypnogram.tsx` renders a stepped-bar skyline; consumed by
  `app/health/sleep/sleep-content.tsx` (size `lg`) and `components/health-metric-sheet.tsx`
  (size `sm`).

## Tasks

### 1. `phasesToPhase5Min` helper (new, in `lib/health/hypnogram.ts`)
Add a pure, tested transform: ordered 30 s stage codes → the 5-min string.
- Input: `string[]` of `'deep'|'light'|'rem'|'awake'` (the decoder's `phases` output).
- Bucket every 10 codes (10 × 30 s = 5 min); emit the **majority** stage per bucket, mapped to
  the code char. Deterministic tie-break by a fixed severity order (deep > rem > light > awake).
- Partial trailing bucket (< 10 codes) still emits from what's present.
- Unit tests: exact known sequences → expected string; empty → `''`.
- This adds **no new byte decoder** — it transforms already-decoded data and is fully
  deterministic-testable, satisfying the pinned-vector rule at the transform level.

### 2. Wire it into the rollup (`aggregateOuraRawSamples`)
- Consolidate the night's phase codes from a **single tag** to avoid the redundancy trap
  (pick the tag among `0x4b/0x4e/0x5a` that yields the **longest** code sequence for the
  window — the per-epoch stream will be longest; self-corrects regardless of which tag is real).
  Use the same consolidated sequence for **both** the stage-hours and the string, so they agree.
- Set `sleepPhase5Min: phases.length > 0 ? phasesToPhase5Min(phases) : null` on the sleep row.
- Keep everything infallible (unknown/empty → null, never throw — decoder contract).
- Comment: the 30 s epoch + single-tag choice + forward-order are **provisional pending an
  on-device captured vector** (see findings doc). Dormant until events arrive.

### 3. Ribbon redesign (`components/health/hypnogram.tsx`)
Rebuild the render into a connected **ribbon with stage lanes** (Oura/Whoop style), keeping the
existing `STAGE_COLOR` export, the `phase5Min`/`sleepStart`/`sleepEnd`/`size` props, the time-axis
labels, the legend, and the `lg` caption. Consume `hypnogramSegments`/`sleepCycles`/`stageTotals`
(unchanged). Design for **both dark and light themes**; no hex-literal theme hazards on the axis;
verify at the S25 viewport (≤640px). Keep the file well under the size budget.

### 4. Doc corrections + backlog
- `docs/oura-ble-remaining-work.md` item 8: replace "the ring sends no hypnogram over BLE" with
  the corrected position (staging IS emitted per open_oura; we simply haven't captured a full
  night — needs the drain/cursor check), linking the findings doc.
- `projectOverview.md`: soften the "stages null by design" rows to "stages unconfirmed over BLE —
  events documented + decoder ready; needs on-device full-night capture" and add the ribbon +
  wiring as shipped.
- Backlog entry: **on-device sleep-staging capture** — run the raw-tag diagnostic, do a clean
  full-night drain, validate the 30 s/tag/timestamp assumptions against a captured vector +
  the owner's pre-re-key Oura history, then Redecode-backfill. Batch with remaining-work items 2/6.

### 5. Verify + ship
- Unit tests: `lib/health/__tests__/hypnogram.test.ts` (extend for `phasesToPhase5Min`) +
  a rollup test asserting synthetic `0x4b/0x4e/0x5a` raw rows → a populated `sleep_phase_5_min`
  + stage hours.
- Dev server: seed a sleep row with a known `sleep_phase_5_min`, open the Sleep detail, confirm
  the ribbon renders correctly in dark **and** light; insert synthetic phase raw rows, run the
  rollup, confirm the string + hours populate.
- Lint + typecheck. Version bump + changelog (user-visible: new hypnogram visual).
- **Not exercised (state on the PR):** real on-device BLE phase-event capture, Samsung WebView
  rendering, safe-area — the rollup staging path stays dormant until the device-capture task.
