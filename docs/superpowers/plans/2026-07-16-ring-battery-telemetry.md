# Ring Battery Telemetry Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the owner's three battery questions from data the ring **already emits and we already decode** — roughly **how much the ring drains per day**, **how much it charges per charging session**, and its **average charging time** — by un-dropping the `0x61` battery telemetry events at ingest (they are decoded today but discarded), aggregating them into daily-drain / charge-session / avg-charge-time metrics, and surfacing the result in the admin `/admin/oura-ble` tester. **In-sandbox, no APK rebuild, no migration.**

**Architecture:** The ring streams battery telemetry over BLE as `debug_data` (tag `0x61`) and `lib/oura-ble/decode.ts` (`decodeDebugData`, ~lines 160-182) already decodes the two binary subtypes: `body[0] === 0x11` → `{ kind: 'charging_time', charging_time }` (device-reported charge duration, LE u32) and `body[0] === 0x24` → `{ kind: 'battery_level_changed', battery_pct, voltage_mv, flag_a, flag_b }`. **But `0x61` is in `RAW_STORAGE_DROP_TAGS` (`lib/oura-ble/raw-storage.ts`)** — the Lever-2 ingest cull drops it as "debug/telemetry, no analytical value", so battery events never reach `oura_raw_samples`. That drop is explicitly forward-only and **reversible** ("drop the tag from this set and it stores again"). The fix is a **subtype-aware keep**: at ingest, store a `0x61` row **only** when its decoded body is a battery subtype (`charging_time` / `battery_level_changed`), and keep dropping the ASCII debug text and every other `0x61` binary subtype — preserving the Lever-2 intent while capturing battery. Once stored, a windowed read (via the ring clock anchor, exactly like `getOuraDaytimeSignals`) feeds a pure aggregator (`lib/health/ring-battery.ts`) that builds the battery-level time series, detects charge sessions, and derives the three metrics. A read-only admin route + tester console renders them — the same shape as the daytime-coverage / device-metrics probes.

**Tech Stack:** TypeScript, Next.js 15 route handler (`requireAdmin`-gated), Drizzle/Postgres (read-only over `oura_raw_samples`), `lib/oura-ble/decode.ts` (`decodeEventBody`/`measuredAtMs`), `lib/oura-ble/raw-storage.ts`, `lib/health/ring-battery.ts` (new pure module), vitest.

---

## Why now

This was previously mis-parked as "needs the native APK rebuild" — the 2026-07-11 device-metrics plan (`docs/superpowers/plans/2026-07-11-oura-device-metrics-server-only.md`) explicitly out-scoped battery as *"the native half of Part A (the plugin reads battery every 5 min but discards it; capturing it needs a Kotlin POST path + migration + owner APK rebuild)"*. That was wrong about the **event stream**: the ring **also** emits battery over BLE as `0x61` `debug_data`, we **already decode it**, and it is being **thrown away at ingest** by the Lever-2 drop — not for lack of a native path. So the owner's actual questions (daily drain / charge-per-session / avg charge time) are buildable **in-sandbox today**: un-drop the battery subtypes and aggregate. The finer-resolution native 5-min poll (Chunk 2) remains a genuine native enhancement, but it is **not required** for the ask.

**Branch:** `feat/ring-battery-telemetry`

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Subtype-aware keep, not a blanket un-drop.** `0x61` stays in `RAW_STORAGE_DROP_TAGS` (the ASCII debug spam and other binary subtypes carry no value and would bloat the table). A new `shouldDropRawEvent(tag, decoded)` predicate keeps a `0x61` row **only** when `decoded?.kind` is `'charging_time'` or `'battery_level_changed'`. Keying the exception off the **decoded kind** (not raw bytes) keeps the decoder the single authority on "what is a battery event" (One Formula, One Place) — `decodeDebugData` already ran at ingest and `ev.decoded` is in hand.
2. **Reuse `oura_raw_samples` — no migration, no new table, no derived-summary column.** The battery events **are** the storage; the metrics are computed on read, back-fillable from `body_hex` like every other raw-sample metric. A stored rollup column (e.g. `oura_daily.battery_drain_pct`) is deliberately **not** added — the read is cheap (one narrow tag over a windowed range on a single-user table) and a stored counter would just be one more thing to drift (per the Stored-Counters rule). Revisit only if a user-facing card needs it hot.
3. **The aggregator is pure and lives in `lib/health/ring-battery.ts`.** It takes a plain `RingBatteryEvent[]` (wall-clock ms + kind + pct + charging-time) and returns the three metrics + a `sane` flag — no DB, no Drizzle, fully unit-testable against synthetic event rows. The route is a thin loader: fetch window → call aggregator → JSON.
4. **Read surface = admin tester first (Lane 5), not the user health tab.** Matches the rest of the `/api/oura-ble/*` pipeline (`requireAdmin`) and the device-metrics plan's stated R&D posture. A dedicated `RingBatteryConsole` section on `/admin/oura-ble`, beside daytime-coverage. If the not-yet-built `device-metrics-panel.tsx` (item 18 / the 2026-07-11 plan) has landed by implementation time, co-locate the battery block there instead of a second console — same Lane 5 territory (reconcile, don't duplicate).
5. **Charging duration prefers the device-reported `charging_time` (0x11) event; span-duration is the fallback.** The ring tells us the charge duration directly via `charging_time`; only when no `0x11` event covers a detected charge session do we fall back to the wall-clock span of the level-rise. State which source produced each number.
6. **The battery chip (`components/oura-battery-chip.tsx`, Cloud-token `batteryLevel`/`batteryCharging`) is a cross-check, not the source.** It's a single instantaneous point from the Oura token status and is frozen-stale post-re-key (it hides itself when `batteryStale`); the `0x61` event stream is the real telemetry. Mention it in the console for sanity comparison; do not derive analytics from it.

## Verified current state (2026-07-16)

- `lib/oura-ble/raw-storage.ts` — `RAW_STORAGE_DROP_TAGS` includes `0x61`; only `shouldDropRawTag(tag)` exists (tag-only). Tests: `lib/oura-ble/__tests__/raw-storage.test.ts` assert `0x61` drops and the rollup/archival invariants.
- `app/api/oura-ble/samples/route.ts:49` — the ingest loop calls `if (shouldDropRawTag(ev.tag)) continue`. `ev` (from `historyEventFromHex`) carries `.tag`, `.timestampDs`, `.name`, `.bodyHex`, `.decoded` — the decoded JSONB is computed at ingest even though Lever 1 no longer persists it.
- `lib/oura-ble/decode.ts` — `decodeDebugData` (160-182): `0x11` → `charging_time` (`le32(body,1)`, `_status: 'unvalidated'`); `0x24` → `battery_level_changed` (`battery_pct = body[1]`, `voltage_mv = le16(body,2)`, `flag_a/flag_b` from `body[4]`). **Caveat: `0x24` has NO `_status` marker and `0x11` is explicitly `'unvalidated'` — treat both as untrusted until verified on real device data.** `eventName(0x61) === 'debug_data'`.
- Windowed-anchor read reference: `adapter.ts` `getOuraDaytimeSignals(userId, from, to)` (3570-3606) — resolves the clock anchor (`getOuraClockAnchor`), maps `from`/`to` ms → ring ds (`dsFromMeasuredAtMs`), `inArray(tag, [...])` + ds range, decodes each row (`r.decoded ?? decodeEventBody(tag, hexToBytes(bodyHex))`), stamps `measuredAtMs`. Mirror this exactly for a battery read.
- `getOuraRawSamplesByTags(userId, tags, limit)` (4632-4655) exists and returns `measuredAt` per row — an acceptable **fallback** if avoiding an `adapter.ts` edit, but it is limit-based (newest-N), not window-based, so a dedicated windowed method is cleaner for "per day over N days".
- Admin tester: `app/admin/oura-ble/page.tsx` mounts consoles from `components/oura-ble/*`; `daytime-coverage-console.tsx` + `app/api/oura-ble/daytime-coverage/route.ts` are the console↔route pattern to copy (admin-gated, `rateLimit`, `?days=N`).
- `app/api/oura-ble/device-metrics/route.ts` and `components/oura-ble/device-metrics-panel.tsx` do **not** exist yet (item 18 unbuilt) — so a dedicated battery console/route is the default; design decision 4 covers the co-locate case.

## File structure

**Create:**
- `lib/health/ring-battery.ts` — pure aggregator (`analyzeRingBattery`) + its types.
- `lib/health/__tests__/ring-battery.test.ts` — aggregator tests against synthetic events.
- `app/api/oura-ble/battery-analytics/route.ts` — admin GET; loads the `0x61` battery window, calls the aggregator, returns JSON.
- `components/oura-ble/ring-battery-console.tsx` — tester panel (mirrors `daytime-coverage-console.tsx`).

**Modify:**
- `lib/oura-ble/raw-storage.ts` — add `isBatteryDebugEvent` + `shouldDropRawEvent(tag, decoded)` (keep `shouldDropRawTag` for the existing invariant tests).
- `lib/oura-ble/__tests__/raw-storage.test.ts` — subtype-keep cases.
- `app/api/oura-ble/samples/route.ts` — swap `shouldDropRawTag(ev.tag)` → `shouldDropRawEvent(ev.tag, ev.decoded)`.
- `lib/data/postgres/adapter.ts` + `lib/data/repository.ts` — new **read-only** `getOuraBatteryEvents(userId, from, to)` (append-safe; the item-5 / P-A data-architecture seam — read side, low collision).
- `app/admin/oura-ble/page.tsx` — mount `RingBatteryConsole`.
- `docs/implementation-backlog.md` — remove this item's row from the Chain-unblock batch (final task).
- `projectOverview.md` + `docs/overview/history-*.md` — journal + index (final task). No version bump (admin-only R&D, no user-visible change) unless the battery block is promoted to the user battery area (design decision 4).

---

### Task 1: Subtype-aware keep for `0x61` battery events at ingest

**Files:**
- Modify: `lib/oura-ble/raw-storage.ts`, `app/api/oura-ble/samples/route.ts`
- Test: `lib/oura-ble/__tests__/raw-storage.test.ts`

The whole feature hinges on battery events actually landing in `oura_raw_samples`. Today they are dropped. This task un-drops **only** the battery subtypes.

- [ ] **Step 1: Write the failing tests** (append to `lib/oura-ble/__tests__/raw-storage.test.ts`)

```typescript
import { shouldDropRawEvent, isBatteryDebugEvent } from '../raw-storage'

describe('shouldDropRawEvent — 0x61 subtype-aware battery keep (Lever 2 exception)', () => {
  it('KEEPS a 0x61 charging_time event (subtype 0x11)', () => {
    expect(shouldDropRawEvent(0x61, { kind: 'charging_time', charging_time: 5400 })).toBe(false)
    expect(isBatteryDebugEvent(0x61, { kind: 'charging_time' })).toBe(true)
  })
  it('KEEPS a 0x61 battery_level_changed event (subtype 0x24)', () => {
    expect(shouldDropRawEvent(0x61, { kind: 'battery_level_changed', battery_pct: 87 })).toBe(false)
  })
  it('still DROPS 0x61 ASCII debug text and other binary subtypes', () => {
    expect(shouldDropRawEvent(0x61, { ascii: 'boot ok' })).toBe(true)
    expect(shouldDropRawEvent(0x61, { kind: 'debug_data', subtype: 0x30 })).toBe(true)
    expect(shouldDropRawEvent(0x61, null)).toBe(true)
  })
  it('is identical to shouldDropRawTag for every non-0x61 tag', () => {
    for (const tag of [0x42, 0x43, 0x45, 0x53, 0x56, 0x5b, 0x79, 0x82, 0x83, 0x76, 0x46, 0x64]) {
      expect(shouldDropRawEvent(tag, null)).toBe(shouldDropRawTag(tag))
    }
  })
})
```

(Keep the existing `shouldDropRawTag`/`RAW_STORAGE_DROP_TAGS` tests unchanged — `0x61` STAYS in the drop set; the exception lives in the new event-level predicate.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/oura-ble/__tests__/raw-storage.test.ts`
Expected: FAIL — `shouldDropRawEvent`/`isBatteryDebugEvent` not exported.

- [ ] **Step 3: Implement** (append to `lib/oura-ble/raw-storage.ts`)

```typescript
// The two decoded `debug_data` (0x61) subtypes we DO want to persist — the ring's
// battery telemetry. Everything else on 0x61 (ASCII boot/debug text, other binary
// subtypes) stays dropped per Lever 2. Keying off the DECODED kind keeps the decoder
// (decodeDebugData) the single authority on "what is a battery event".
const BATTERY_DEBUG_KINDS: ReadonlySet<string> = new Set(['charging_time', 'battery_level_changed'])

/** True when a 0x61 event's decoded body is a battery subtype worth keeping. */
export function isBatteryDebugEvent(tag: number, decoded: Record<string, unknown> | null): boolean {
  return tag === 0x61 && typeof decoded?.kind === 'string' && BATTERY_DEBUG_KINDS.has(decoded.kind as string)
}

/**
 * True when a raw BLE history event should NOT be persisted (Lever 2), WITH the
 * subtype-aware exception that 0x61 battery events are kept even though 0x61 is a
 * dropped tag. Use this at ingest instead of shouldDropRawTag when the decoded body
 * is available.
 */
export function shouldDropRawEvent(tag: number, decoded: Record<string, unknown> | null): boolean {
  if (isBatteryDebugEvent(tag, decoded)) return false
  return RAW_STORAGE_DROP_TAGS.has(tag)
}
```

- [ ] **Step 4: Wire the ingest route.** In `app/api/oura-ble/samples/route.ts`, replace the import and the drop check:

```typescript
import { shouldDropRawEvent } from '@/lib/oura-ble/raw-storage'
// ...
    if (shouldDropRawEvent(ev.tag, ev.decoded)) continue // Lever 2, minus the 0x61 battery keep
```

(`ev.decoded` is the decoded JSONB from `historyEventFromHex` — computed at ingest even under Lever 1's no-persist-decoded policy. Confirm `historyEventFromHex` populates `.decoded`: `grep -n "decoded" lib/oura-ble/decode.ts` around the history-event builder.)

- [ ] **Step 5: Run tests + typecheck + commit**

Run: `npx vitest run lib/oura-ble/__tests__/raw-storage.test.ts && npx tsc --noEmit 2>&1 | grep "raw-storage\|samples/route" || echo clean`
Expected: PASS; `clean`.

```bash
git add lib/oura-ble/raw-storage.ts lib/oura-ble/__tests__/raw-storage.test.ts app/api/oura-ble/samples/route.ts
git commit -m "Persist 0x61 ring battery telemetry (subtype-aware keep past the Lever-2 drop)"
```

---

### Task 2: `analyzeRingBattery` — the pure aggregator

**Files:**
- Create: `lib/health/ring-battery.ts`, `lib/health/__tests__/ring-battery.test.ts`

Given the wall-clock battery-level series and charging-time events over a window, derive daily drain %, per-charge-session delta, and average charging time. Pure and unit-testable — no DB.

- [ ] **Step 1: Write the failing tests** (`lib/health/__tests__/ring-battery.test.ts`)

```typescript
import { describe, it, expect } from 'vitest'
import { analyzeRingBattery, type RingBatteryEvent } from '../ring-battery'

const H = 3_600_000 // 1h in ms
const lvl = (tsMs: number, pct: number): RingBatteryEvent =>
  ({ tsMs, kind: 'battery_level_changed', batteryPct: pct, chargingTimeSec: null })
const charge = (tsMs: number, sec: number): RingBatteryEvent =>
  ({ tsMs, kind: 'charging_time', batteryPct: null, chargingTimeSec: sec })

describe('analyzeRingBattery', () => {
  it('returns nulls / not-sane for an empty or single-point series', () => {
    const r = analyzeRingBattery([])
    expect(r.avgDailyDrainPct).toBeNull()
    expect(r.chargeSessions).toEqual([])
    expect(r.avgChargePerSessionPct).toBeNull()
    expect(r.avgChargingTimeSec).toBeNull()
  })

  it('computes daily drain from the summed level decreases over the observed span', () => {
    // 100% → 90% over 24h (pure discharge) → 10 %/day.
    const r = analyzeRingBattery([lvl(0, 100), lvl(12 * H, 95), lvl(24 * H, 90)])
    expect(r.avgDailyDrainPct).toBeCloseTo(10, 1)
    expect(r.chargeSessions).toEqual([])
  })

  it('detects a charge session (rising level) and reports its delta + duration', () => {
    // discharge to 20, charge 20→100 over 2h, then discharge again.
    const r = analyzeRingBattery([
      lvl(0, 40), lvl(6 * H, 20), lvl(7 * H, 60), lvl(8 * H, 100), lvl(20 * H, 88),
    ])
    expect(r.chargeSessions).toHaveLength(1)
    expect(r.chargeSessions[0].deltaPct).toBe(80)
    expect(r.chargeSessions[0].durationSec).toBe(2 * 3600)
    expect(r.avgChargePerSessionPct).toBe(80)
    // drain excludes the charge span: only the 40→20 and 100→88 decreases count.
    expect(r.avgDailyDrainPct).toBeGreaterThan(0)
  })

  it('prefers the device-reported charging_time event over the span duration', () => {
    const r = analyzeRingBattery([
      lvl(0, 20), lvl(1 * H, 100), charge(1 * H, 5400), // ring says 90 min
    ])
    expect(r.avgChargingTimeSec).toBe(5400)
    expect(r.chargeSessions[0].chargingTimeSource).toBe('device')
  })

  it('flags not-sane when a battery_pct is out of [0,100]', () => {
    expect(analyzeRingBattery([lvl(0, 140), lvl(H, 90)]).sane).toBe(false)
    expect(analyzeRingBattery([lvl(0, 90), lvl(H, 80)]).sane).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/ring-battery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`lib/health/ring-battery.ts`)

Shape the module around these types and semantics (the exact numeric thresholds are the implementer's to tune against the tests; keep the contract):

```typescript
export interface RingBatteryEvent {
  tsMs: number
  kind: 'battery_level_changed' | 'charging_time'
  batteryPct: number | null    // present on battery_level_changed
  chargingTimeSec: number | null // present on charging_time (device-reported)
}

export interface ChargeSession {
  startMs: number
  endMs: number
  startPct: number
  endPct: number
  deltaPct: number             // endPct - startPct
  durationSec: number          // device charging_time if one covers the session, else span
  chargingTimeSource: 'device' | 'span'
}

export interface RingBatteryAnalytics {
  avgDailyDrainPct: number | null   // summed level DECREASES ÷ discharging-span days
  chargeSessions: ChargeSession[]
  avgChargePerSessionPct: number | null
  avgChargingTimeSec: number | null // mean of session durations (device-time preferred)
  levelSampleCount: number
  spanDays: number | null           // (last − first ts) in days
  sane: boolean                     // every batteryPct in [0,100] and every chargingTimeSec plausible (< ~6h)
}

export function analyzeRingBattery(events: RingBatteryEvent[]): RingBatteryAnalytics
```

Algorithm:
1. Sort ascending by `tsMs`. Split into a **level series** (`battery_level_changed` with `batteryPct` in `[0,100]`) and a list of `charging_time` events.
2. **Charge sessions:** walk the level series; a session opens when the level rises above the previous by more than a small noise threshold (e.g. ≥ 2%), continues while non-decreasing, and closes when it turns down (or the series ends). Record start/end pct + ms; `deltaPct = endPct − startPct`.
3. **Charging duration per session:** if a `charging_time` event falls within the session's `[startMs, endMs]` (± a small margin), use its value (`chargingTimeSource: 'device'`); else use the wall-clock span (`'span'`).
4. **Daily drain:** sum every consecutive **decrease** in the level series (ignore the rises — those are charges), and divide by the number of days spanned by discharging samples (guard div-by-zero → `null` when < ~2 points or span ≈ 0).
5. **Averages:** `avgChargePerSessionPct` = mean of session `deltaPct`; `avgChargingTimeSec` = mean of session `durationSec`.
6. **`sane`:** false if any `batteryPct` ∉ `[0,100]` or any `chargingTimeSec` implausible (e.g. > 6h) — surfaced so the console can warn that the unvalidated decoder is producing garbage.

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npx vitest run lib/health/__tests__/ring-battery.test.ts`
Expected: PASS.

```bash
git add lib/health/ring-battery.ts lib/health/__tests__/ring-battery.test.ts
git commit -m "Add analyzeRingBattery — daily drain / charge-session / avg-charge-time aggregator"
```

---

### Task 3: Windowed battery-events read on the repository

**Files:**
- Modify: `lib/data/postgres/adapter.ts`, `lib/data/repository.ts`

A read-only method that returns the decoded `0x61` battery events in a wall-clock window — the exact analogue of `getOuraDaytimeSignals`.

- [ ] **Step 1: Add the interface method** to `lib/data/repository.ts` (near `getOuraDaytimeSignals`):

```typescript
  /** Decoded 0x61 battery telemetry (level changes + charging-time) in a wall-clock window,
   *  anchored via the ring clock. Empty when the ring has no clock anchor. Read-only. */
  getOuraBatteryEvents(userId: string, from: Date, to: Date): Promise<Array<{
    tsMs: number
    kind: 'battery_level_changed' | 'charging_time'
    batteryPct: number | null
    voltageMv: number | null
    chargingTimeSec: number | null
  }>>
```

- [ ] **Step 2: Implement** in `lib/data/postgres/adapter.ts` (copy `getOuraDaytimeSignals`'s anchor + ds-window + decode shape; filter `tag = 0x61`):

```typescript
  async getOuraBatteryEvents(userId: string, from: Date, to: Date) {
    const anchor = await this.getOuraClockAnchor(userId)
    if (!anchor) return []
    const anchorUtcMs = anchor.anchorUtc.getTime()
    const startDs = Math.floor(dsFromMeasuredAtMs(from.getTime(), anchor.anchorDs, anchorUtcMs))
    const endDs = Math.ceil(dsFromMeasuredAtMs(to.getTime(), anchor.anchorDs, anchorUtcMs))
    const rows = await this.db
      .select({ ds: s.ouraRawSamples.ringTimestampDs, tag: s.ouraRawSamples.tag, decoded: s.ouraRawSamples.decoded, bodyHex: s.ouraRawSamples.bodyHex })
      .from(s.ouraRawSamples)
      .where(and(
        eq(s.ouraRawSamples.userId, userId),
        eq(s.ouraRawSamples.tag, 0x61),
        gte(s.ouraRawSamples.ringTimestampDs, startDs),
        lte(s.ouraRawSamples.ringTimestampDs, endDs),
      ))
      .orderBy(asc(s.ouraRawSamples.ringTimestampDs))
    const out: Array<{ tsMs: number; kind: 'battery_level_changed' | 'charging_time'; batteryPct: number | null; voltageMv: number | null; chargingTimeSec: number | null }> = []
    for (const r of rows) {
      const decoded = r.decoded ?? (r.bodyHex ? decodeEventBody(r.tag, hexToBytes(r.bodyHex)) : null)
      const kind = decoded?.kind
      if (kind !== 'battery_level_changed' && kind !== 'charging_time') continue
      out.push({
        tsMs: measuredAtMs(Number(r.ds), anchor.anchorDs, anchorUtcMs),
        kind,
        batteryPct: typeof decoded.battery_pct === 'number' ? decoded.battery_pct : null,
        voltageMv: typeof decoded.voltage_mv === 'number' ? decoded.voltage_mv : null,
        chargingTimeSec: typeof decoded.charging_time === 'number' ? decoded.charging_time : null,
      })
    }
    return out
  }
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "adapter\|repository" || echo clean`
Expected: `clean` (append-only method; no other implementer of the repository interface — this is the sole Postgres adapter).

```bash
git add lib/data/postgres/adapter.ts lib/data/repository.ts
git commit -m "Add getOuraBatteryEvents — windowed read of 0x61 battery telemetry"
```

---

### Task 4: Admin route + tester console (read surface)

**Files:**
- Create: `app/api/oura-ble/battery-analytics/route.ts`, `components/oura-ble/ring-battery-console.tsx`
- Modify: `app/admin/oura-ble/page.tsx`

- [ ] **Step 1: The route** — copy `app/api/oura-ble/daytime-coverage/route.ts` verbatim (auth → `requireAdmin` → `rateLimit(`oura-ble-battery:${userId}`, 20, 60_000)` → `?days=N`, clamp 1–30), then:

```typescript
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)
  const repo = await getRepositoryAsync()
  const events = await repo.getOuraBatteryEvents(userId, from, to)
  const analytics = analyzeRingBattery(events)
  return NextResponse.json({ days, eventCount: events.length, ...analytics })
```

Return `eventCount: 0` gracefully (the console renders the "no battery events yet — un-drop just shipped, wear + drain the ring" message; see the caveat). No SWR headers needed — it's an on-demand admin probe, not an aggregate GET the app seeds.

- [ ] **Step 2: The console** — copy `components/oura-ble/daytime-coverage-console.tsx`'s structure (input + Probe/Copy buttons + `<pre>` log). Use a `BatteryCharging` Lucide icon and a `formatBattery(data)` that prints: avg daily drain %, a line per charge session (`+Δ% over Nm, source device/span`), avg charge-per-session %, avg charging time, event count, span days, and a **`⚠ decoder values look off`** line when `sane === false`. Include one line cross-checking against the Cloud battery chip's last known level for sanity.

- [ ] **Step 3: Mount it** in `app/admin/oura-ble/page.tsx` — import `RingBatteryConsole` and add `<div className="mt-4"><RingBatteryConsole /></div>` beside the daytime-coverage console. (If `device-metrics-panel.tsx` has landed by now, add the battery block there instead — design decision 4.)

- [ ] **Step 4: Lint + typecheck + commit**

Run: `npx eslint app/api/oura-ble/battery-analytics/route.ts components/oura-ble/ring-battery-console.tsx app/admin/oura-ble/page.tsx && npx tsc --noEmit 2>&1 | head -5`
Expected: clean.

```bash
git add app/api/oura-ble/battery-analytics/route.ts components/oura-ble/ring-battery-console.tsx app/admin/oura-ble/page.tsx
git commit -m "Add ring battery analytics admin probe (drain / charge sessions / avg charge time)"
```

---

### Task Final: Gate + dev-server smoke + docs

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, admin user — set `isAdmin=true` on `test@local.dev` in the dev DB if needed)

The `0x61` un-drop can't be exercised without a real ring drain, so seed the read path directly. Insert a clock anchor + a handful of `0x61` battery rows (psql on port 5433, `trainingai_dev`; `:uid` = test user id). `body_hex` for `battery_level_changed` (0x24) = `24` + `pct` byte + `voltage_mv` LE u16 (+ optional flags byte); for `charging_time` (0x11) = `11` + `charging_time` LE u32:

```sql
-- Clock anchor (newest ds ↔ now) so measuredAtMs maps ring ds → wall clock.
INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc)
VALUES (:uid, 1000000, NOW());
-- battery_level_changed rows: 24 <pct> <voltage LE16>. 87% @ ~3900mV → hex '2457' + '4c0f'.
-- Space the ring ds so they map to distinct times (10 ds = 1s).
INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
 (:uid, 1000000, 97, 'debug_data', '24574c0f', NULL),   -- 87%
 (:uid,  568000, 97, 'debug_data', '2414500f', NULL),   -- 20% (earlier)
 (:uid,  136000, 97, 'debug_data', '2464540f', NULL),   -- 100% (earliest)
 (:uid,  600000, 97, 'debug_data', '11'||to_hex_le32(5400), NULL); -- charging_time 90min
```

(`0x61 = 97` decimal; `event_name` = `'debug_data'`; `decoded` NULL forces the read to decode from `body_hex` — exactly the redecode path. Compute the LE hex by hand or via a tiny node one-liner; the `to_hex_le32` above is pseudo — write the literal, e.g. `charging_time 5400 → '18150000'`.)

Exact checks:
1. `GET /api/oura-ble/battery-analytics?days=7` (as admin) → JSON with `eventCount: 4`, a non-empty `chargeSessions` (the 20→100 rise), `avgChargePerSessionPct` ≈ 80, `avgChargingTimeSec: 5400` with `chargingTimeSource: 'device'`, a positive `avgDailyDrainPct`, and `sane: true`.
2. `/admin/oura-ble` at the S25 viewport (412×915) → the **Ring battery** console renders; click Probe → the formatted drain/charge/avg-charge lines appear; delete the rows → the "no battery events yet" message.
3. **Ingest keep (unit-verified, not seedable here):** the subtype-aware keep is covered by the Task-1 tests; state in the PR that the live ingest path (real ring `0x61` frames through `/api/oura-ble/samples`) is device-only and NOT exercised in the sandbox.

- [ ] **Step 3: Docs**

Remove this plan's row from `docs/implementation-backlog.md` (the Chain-unblock batch table). Append the session note to the current `docs/overview/history-*.md`, update `projectOverview.md` (current status; note battery telemetry now captured + admin analytics). **No version bump / changelog entry** — admin-only R&D, no user-visible change (bump to **minor** only if design decision 4's user-facing promotion is included in the same PR).

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/ring-battery-telemetry
```

Standard change — no migration, no auth/security, no data-dropping. The ingest filter change is **additive** (it stores strictly *more* than before; it can't drop anything it kept previously). Merge on green once the smoke passes.

---

## Chunk 2 (OPTIONAL — native, finer resolution — NOT required for the owner's ask)

**Do not build this for the owner's three questions.** Chunk 1 answers them from the event stream. This chunk is a resolution upgrade only, and it is gated on the **owner APK rebuild**.

The native foreground service already reads battery every ~5 min (`plugin.readBattery()` / the Cloud-token `batteryLevel`; the battery-soak manager samples it) but **discards** it — the ring only *emits* `0x61` battery events opportunistically (on level change / charge), so the event stream is sparser and event-driven, not a fixed cadence. A Kotlin change that POSTs the 5-min `{tsMs, batteryPct, charging}` reading to a new ingest path would give a **regular, higher-resolution** drain curve.

- **What it touches:** the native `OuraBle` plugin (Kotlin) + a new server ingest route + likely a small `battery_readings` table (migration). **Kotlin = compile-gated only in the sandbox and requires the owner APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`).
- **Backlog home:** the native-battery time-series item (item 6-Chunk3) already sits in the ⛔ Native APK holding pen. This chunk stays there as an **enhancement**; the owner's analytics ship in Chunk 1 without it.
- **Cross-check, not source:** even with the native path, `analyzeRingBattery` stays the single aggregator — the native readings would just feed it a denser `RingBatteryEvent[]` (map `batteryPct`/`charging` to `battery_level_changed`). One Formula, One Place.

---

## Important caveats (state these in the PR)

1. **The decoder is unvalidated.** `charging_time` (0x11) is marked `_status: 'unvalidated'` and `battery_level_changed` (0x24) has no validation marker at all — both are reverse-engineered. **Before trusting the numbers, verify on real device data** that `battery_pct` lands in `[0,100]` and tracks the ring's actual level (cross-check the Cloud battery chip / the Oura app), and that `charging_time` is a plausible duration. The aggregator's `sane` flag surfaces obvious garbage; a real on-device drain+charge cycle is the authoritative check. This is an **on-device verification** the sandbox cannot do — call it out.
2. **History begins at the un-drop — it is forward-only.** Battery events were dropped at ingest until this ships, and the dropped events are **gone** (Lever-2 drop discards at ingest; there is no `body_hex` to re-decode for them). So analytics only cover drains/charges captured **after** this deploys — the console must not imply it has historical battery data. It will read empty until the ring next drains post-deploy.
3. **`ring_timestamp_ds` is not wall-clock.** All timing goes through the clock anchor (`measuredAtMs`); if the ring clock reset (re-key / dead battery) mid-window, the anchor epoch changes and old events map wrong — a known pipeline constraint, not specific to battery.

---

## Verification summary

- **Automated (sandbox):** `shouldDropRawEvent` subtype-keep (4), `analyzeRingBattery` drain/charge/avg/sane (5) unit tests; full existing suites (raw-storage invariants, oura-ble decode) still green; full gate.
- **Dev-server (sandbox):** `battery-analytics` route against seeded `0x61` rows, console render at the S25 viewport.
- **Deferred (device-only, state in PR):** live `0x61` ingest through `/api/oura-ble/samples`; decoder validation against a real drain+charge cycle (caveat 1); Chunk 2 native path entirely.

## Notes for the implementer

- **Never widen the un-drop.** The exception is exactly the two battery kinds — do not un-drop `0x61` wholesale (the ASCII debug spam is high-volume noise) and do not touch any other tag in `RAW_STORAGE_DROP_TAGS`.
- **The aggregator is the single source of the metrics** — the route and (later) the native path both call `analyzeRingBattery`; never re-derive drain/charge math inline in a route or component.
- **Read-only vs the Oura cluster.** `getOuraBatteryEvents` is an append-only read method; it must not touch the rollup (`aggregateOuraRawSamples`) or any write path. Keep this PR inside Lane 5's territory (`app/admin/oura-ble/*`, `components/oura-ble/*`, `app/api/oura-ble/*`) plus the additive `raw-storage`/`samples`-route ingest edit and the two append-only repo methods.
- If line numbers have drifted at implementation time, re-anchor by symbol name (`decodeDebugData`, `getOuraDaytimeSignals`, `shouldDropRawTag`), not by re-designing.
