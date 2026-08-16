# Polar H10 Chest Strap Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the owner's Polar H10 chest strap the default live heart-rate source (beat-accurate through sets *and* rest), falling back to the Oura ring automatically whenever the strap isn't connected or isn't worn — and capture the strap's RR intervals for real in-workout HRV.

**Architecture:** A `ChestStrapSource` implementing the shipped `LiveHrSource` interface (`lib/live-hr/types.ts` — the `'chest_strap'` id has been reserved since Plan 1) over the standard BLE Heart Rate Service (`0x180D`/`0x2A37`) via `@capacitor-community/bluetooth-le`. Registered ahead of `OuraRingSource` in the manager (registration order = precedence); the strap reports itself `disconnected` while unworn (sensor-contact bit) so the ring fallback genuinely engages. Samples persist via a new `/api/hr-ingest` route into `oura_heartrate` (`source='chest_strap'`) with strap-over-ring read precedence; RR intervals land in a new `rr_intervals` table (migration **124**) and surface as a rest-window rMSSD stat on the done screen.

**Tech Stack:** TypeScript, React 19, `@capacitor-community/bluetooth-le` (new dependency), the `lib/live-hr/*` layer, Drizzle/Postgres, vitest.

> **Supersedes** `2026-07-08-live-hr-plan-3-chest-strap-source.md` (written before the device was known; absorbed here with Polar-H10-specific corrections — worn-gating, RR capture, battery/FW reads, a pinned pairing-UI mount point). Knowledge base: the **`polar-h10-ble` skill** (`.agents/skills/polar-h10-ble/SKILL.md`) — protocol details, UUIDs, quirks, and the direct-GATT-not-Polar-SDK decision live there; read it first.

---

## Device facts that shape this plan (from the polar-h10-ble skill)

- **HR + RR intervals come from the standard Heart Rate Service** — no reverse-engineering, no Polar SDK, no auth. RR (beat-to-beat, 1/1024 s units) rides in the same `0x2A37` notification as bpm: live HRV the ring cannot provide.
- **The H10 has NO step counter and NO cadence output** (raw ECG/ACC streams only, via the proprietary PMD service). Steps stay on the ring pipeline. Owner-facing expectation set accordingly.
- **Stable public MAC** (unlike the ring's rotating RPA) — caching the paired `deviceId` and reconnecting directly is safe. No bonding; never system-pair.
- **Sensor-contact flag** (flags bits 1–2) tells us the strap is actually on the chest — the worn-gate that makes ring fallback real.
- Samsung's BLE stack doesn't honour `autoConnect=true` (proven on-device with the ring) — direct connect + bounded retry.
- **Out of scope here (YAGNI):** PMD ECG/ACC streaming (no product use yet — R&D only; needs its own planning session if ever wanted, see skill §3), the H10's internal exercise recording (PS-FTP, SDK-only), and any steps/cadence derivation from raw ACC. A "Not yet queued" backlog note records this scoping.

## Runtime reality / verification note

- **Needs the physical H10 + an owner APK rebuild.** `@capacitor-community/bluetooth-le` is a native plugin (self-registers via `npx cap sync android && ./gradlew assembleDebug`); nothing BLE runs in the sandbox. Parsers, merge precedence, rMSSD, and routes are sandbox-verifiable; pairing/streaming/fallback are **on-device only** — state this in the PR and add the Known-Issues row if no device is available in-session.
- Ingest is fire-and-forget (no outbox domain): live HR samples are a lossy telemetry stream, not a user-visible write — same posture the ring's live path takes; the ring's background drain still covers ambient HR history.

## File structure

**Create:**
- `lib/live-hr/hr-measurement.ts` — pure `0x2A37` parser (flags → bpm, RR[], contact). 
- `lib/live-hr/chest-strap-source.ts` — `ChestStrapSource` implementing `LiveHrSource`.
- `lib/live-hr/paired-strap.ts` — paired-device persistence (localStorage).
- `lib/health/hr-window-merge.ts` — pure strap-over-ring bucket merge for reads.
- `lib/health/rmssd.ts` — pure rMSSD-from-RR (One Formula, One Place — nothing computes rMSSD from raw RR today; the ring's 0x5d events carry precomputed values).
- `components/settings/chest-strap-pairing.tsx` — pair/forget UI + battery/firmware readout.
- `app/api/hr-ingest/route.ts` — strap sample ingest (Zod + rate limit).
- `lib/data/postgres/migrations/124_rr_intervals.sql` — RR archival table.
- Tests: `lib/live-hr/__tests__/hr-measurement.test.ts`, `lib/health/__tests__/hr-window-merge.test.ts`, `lib/health/__tests__/rmssd.test.ts`.

**Modify:**
- `package.json` / `pnpm-lock.yaml` — add `@capacitor-community/bluetooth-le`.
- `lib/live-hr/manager.ts` — register `ChestStrapSource` before `OuraRingSource`.
- `lib/data/postgres/slices/oura.ts` — `getHrForWindow` merge; new `insertRrIntervals`/`getRrForWindow`.
- `lib/data/repository.ts` + `lib/data/postgres/adapter.ts` — repo interface + delegation for the RR functions.
- `lib/data/postgres/schema.ts` — `rrIntervals` table.
- `components/more/profile-tab.tsx` — mount `<ChestStrapPairing/>` beside `OuraConnectionSection`.
- `app/api/oura/hr-data/route.ts` + `components/workout/done-screen.tsx` — workout HRV stat.
- `components/workout/live-hr-chart.tsx` — empty-state copy covers both devices.
- `lib/changelog.ts` + `package.json` version, journal + index (final task).

---

# Chunk A — H10 as the default live-HR source, ring fallback

### Task A1: Heart Rate Measurement parser (bpm + RR + contact)

**Files:**
- Create: `lib/live-hr/hr-measurement.ts`
- Test: `lib/live-hr/__tests__/hr-measurement.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/live-hr/__tests__/hr-measurement.test.ts
import { describe, it, expect } from 'vitest'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'

// 0x2A37 layout: [flags][hr:1|2][energy:2]?[rr:2]*. Flags bit0: 16-bit HR; bit1:
// sensor contact status; bit2: contact detection supported; bit3: energy present;
// bit4: RR intervals present (uint16 LE, 1/1024 s units).
function bytes(...b: number[]) { return new Uint8Array(b) }

describe('parseHeartRateMeasurement', () => {
  it('parses 8-bit HR, no contact support (flags=0x00)', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 72))).toEqual({ bpm: 72, rr: [], contact: null })
  })

  it('parses 16-bit HR (flags bit0 set)', () => {
    // flags=0x01, HR=300 (0x012C LE)
    expect(parseHeartRateMeasurement(bytes(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, rr: [], contact: null })
  })

  it('reports contact=true when supported and detected (bits 2+1)', () => {
    expect(parseHeartRateMeasurement(bytes(0x06, 80))).toEqual({ bpm: 80, rr: [], contact: true })
  })

  it('reports contact=false when supported but not detected (bit 2 only)', () => {
    expect(parseHeartRateMeasurement(bytes(0x04, 80))).toEqual({ bpm: 80, rr: [], contact: false })
  })

  it('parses RR intervals (flags bit4) in ms', () => {
    // flags=0x10, HR=60, RR raw 1024 → 1000 ms
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04))).toEqual({ bpm: 60, rr: [1000], contact: null })
  })

  it('parses multiple RR values in one packet', () => {
    // Two RRs: 1024 → 1000 ms, 512 → 500 ms
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04, 0x00, 0x02)))
      .toEqual({ bpm: 60, rr: [1000, 500], contact: null })
  })

  it('skips the energy-expended field when bit3 is set before RR', () => {
    // flags=0x18 (energy + RR), HR=60, energy=0x0000, RR=512 → 500 ms
    expect(parseHeartRateMeasurement(bytes(0x18, 60, 0x00, 0x00, 0x00, 0x02)))
      .toEqual({ bpm: 60, rr: [500], contact: null })
  })

  it('returns null for too-short buffers', () => {
    expect(parseHeartRateMeasurement(bytes(0x00))).toBeNull()
    expect(parseHeartRateMeasurement(bytes(0x01, 0x2c))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/hr-measurement.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/hr-measurement'`

- [ ] **Step 3: Implement**

```typescript
// lib/live-hr/hr-measurement.ts
// Pure parser for the standard BLE Heart Rate Measurement characteristic (0x2A37).
// The Polar H10 emits ~1 Hz notifications carrying bpm, the sensor-contact flag
// ("strap is on the chest"), and every RR interval (beat-to-beat) since the last
// packet — the raw material for live HRV.
export interface HrMeasurement {
  bpm: number
  /** RR intervals in ms (converted from 1/1024 s units). */
  rr: number[]
  /** true/false when the device supports contact detection (the H10 does); null otherwise. */
  contact: boolean | null
}

export function parseHeartRateMeasurement(v: Uint8Array): HrMeasurement | null {
  if (v.length < 2) return null
  const flags = v[0]
  const hr16 = (flags & 0x01) !== 0
  const contactSupported = (flags & 0x04) !== 0
  const energyPresent = (flags & 0x08) !== 0
  const rrPresent = (flags & 0x10) !== 0
  let i = 1
  let bpm: number
  if (hr16) {
    if (v.length < 3) return null
    bpm = v[1] | (v[2] << 8)
    i = 3
  } else {
    bpm = v[1]
    i = 2
  }
  if (energyPresent) i += 2 // uint16 energy expended — skipped
  const rr: number[] = []
  if (rrPresent) {
    for (; i + 1 < v.length; i += 2) {
      const raw = v[i] | (v[i + 1] << 8) // 1/1024 s units
      rr.push(Math.round((raw / 1024) * 1000))
    }
  }
  return { bpm, rr, contact: contactSupported ? (flags & 0x02) !== 0 : null }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/hr-measurement.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/hr-measurement.ts lib/live-hr/__tests__/hr-measurement.test.ts
git commit -m "Add BLE Heart Rate Measurement parser (bpm, RR intervals, sensor contact)"
```

---

### Task A2: Add the BLE plugin dependency

**Files:** `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install with pnpm (never npm — Railway uses the frozen lockfile)**

Run: `pnpm add @capacitor-community/bluetooth-le`
Expected: `package.json` gains the dep and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add @capacitor-community/bluetooth-le for chest-strap HR"
```

(Owner step, post-merge: `npx cap sync android && ./gradlew assembleDebug` — the plugin self-registers; no `MainActivity` edit. Note it in the PR.)

---

### Task A3: Paired-strap persistence

**Files:**
- Create: `lib/live-hr/paired-strap.ts`

- [ ] **Step 1: Implement**

```typescript
// lib/live-hr/paired-strap.ts
// Persists the chosen chest strap across sessions. localStorage is sufficient
// because the Polar H10 advertises a STABLE public MAC (unlike the ring's
// rotating RPA) — the cached deviceId stays valid indefinitely.
const KEY = 'ta_paired_hr_strap_v1'

export interface PairedStrap { deviceId: string; name: string }

export function getPairedStrap(): PairedStrap | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) as PairedStrap : null
  } catch { return null }
}

export function setPairedStrap(s: PairedStrap | null): void {
  if (typeof window === 'undefined') return
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s))
    else window.localStorage.removeItem(KEY)
  } catch { /* storage unavailable — pairing simply won't persist */ }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "paired-strap" || echo clean`
Expected: `clean`

```bash
git add lib/live-hr/paired-strap.ts
git commit -m "Add paired chest-strap persistence"
```

---

### Task A4: ChestStrapSource (worn-gated, batching ingest)

**Files:**
- Create: `lib/live-hr/chest-strap-source.ts`

*(No unit test — wires the Capacitor BLE bridge to the Task-A1 parser + manager; the parser is covered by A1, precedence by the existing manager test, and the merge by A8. Exercised on-device.)*

**Design constraints this code encodes:**
- The manager gates beats on `activeSourceId()` — the *first non-disconnected* source. A connected-but-unworn strap would therefore mask the ring. So: while sensor contact reads `false` for > 15 s, this source reports `'disconnected'` (GATT stays connected underneath) and drops its samples — the ring takes over cleanly, and the strap reclaims precedence the moment contact returns.
- Direct connect + bounded retry (Samsung ignores `autoConnect=true` — proven on-device with the ring, v1.116.4).
- No `measureNow`/`setForced` — a chest strap streams continuously at negligible battery cost; the manager's calls fall through to the ring's implementations, which is harmless.

- [ ] **Step 1: Implement**

```typescript
// lib/live-hr/chest-strap-source.ts
// LiveHrSource backed by a standard BLE chest strap (Polar H10: Heart Rate
// Service 0x180D / Heart Rate Measurement 0x2A37) via
// @capacitor-community/bluetooth-le. See the polar-h10-ble skill for protocol
// details and quirks.
import type { LiveHrSample, LiveHrSource, SourceConnectionState } from '@/lib/live-hr/types'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'
import { getPairedStrap } from '@/lib/live-hr/paired-strap'

export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
export const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'

const NOT_WORN_GRACE_MS = 15_000
const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000]
const FLUSH_EVERY_MS = 10_000
const FLUSH_AT_COUNT = 40

// Guarded dynamic import: a browser / an older APK without the plugin degrades to
// inert (state stays 'disconnected'), matching getOuraBle()'s pattern.
async function getBle() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    return BleClient
  } catch { return null }
}

export class ChestStrapSource implements LiveHrSource {
  readonly id = 'chest_strap' as const
  private gattConnected = false
  private worn = true
  private notWornSince: number | null = null
  private listeners: Array<(s: Omit<LiveHrSample, 'sourceId'>) => void> = []
  private deviceId: string | null = null
  private stopping = false
  private reconnectAttempt = 0
  private buffer: Array<{ at: number; bpm: number; rr: number[] }> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  connectionState(): SourceConnectionState {
    if (!this.gattConnected) return 'disconnected'
    // Worn-gate: report disconnected while off the chest so the manager falls
    // back to the ring (activeSourceId picks the first non-disconnected source).
    return this.worn ? 'connected' : 'disconnected'
  }

  subscribe(cb: (s: Omit<LiveHrSample, 'sourceId'>) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  async start(): Promise<void> {
    this.stopping = false
    this.reconnectAttempt = 0
    const paired = getPairedStrap()
    const ble = await getBle()
    if (!paired || !ble) return // no strap paired / no bridge → inert
    this.deviceId = paired.deviceId
    this.flushTimer = setInterval(() => this.flush(), FLUSH_EVERY_MS)
    await this.connect(ble)
  }

  private async connect(ble: NonNullable<Awaited<ReturnType<typeof getBle>>>): Promise<void> {
    if (this.stopping || !this.deviceId) return
    try {
      await ble.initialize()
      await ble.connect(this.deviceId, () => { this.onDisconnected(ble) })
      await ble.startNotifications(this.deviceId, HR_SERVICE, HR_MEASUREMENT, value => {
        const parsed = parseHeartRateMeasurement(new Uint8Array(value.buffer))
        if (!parsed) return
        this.gattConnected = true
        this.reconnectAttempt = 0
        this.updateWorn(parsed.contact)
        if (!this.worn) return // off the chest — drop; ring is covering
        const at = Date.now()
        this.buffer.push({ at, bpm: parsed.bpm, rr: parsed.rr })
        if (this.buffer.length >= FLUSH_AT_COUNT) this.flush()
        for (const l of this.listeners) l({ bpm: parsed.bpm, at })
      })
    } catch {
      this.onDisconnected(ble)
    }
  }

  // contact === null would mean a strap without contact detection — treat as worn.
  private updateWorn(contact: boolean | null) {
    if (contact !== false) {
      this.worn = true
      this.notWornSince = null
      return
    }
    if (this.notWornSince === null) this.notWornSince = Date.now()
    if (Date.now() - this.notWornSince > NOT_WORN_GRACE_MS) this.worn = false
  }

  // Samsung's stack doesn't honour autoConnect — direct connect + bounded retry,
  // same lesson as the ring. After the retries are exhausted the source stays
  // disconnected until the next manager start() (i.e. the next workout).
  private onDisconnected(ble: NonNullable<Awaited<ReturnType<typeof getBle>>>) {
    this.gattConnected = false
    if (this.stopping) return
    const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt]
    if (delay === undefined) return
    this.reconnectAttempt += 1
    setTimeout(() => { void this.connect(ble) }, delay)
  }

  private flush() {
    if (this.buffer.length === 0) return
    const samples = this.buffer.splice(0)
    // Fire-and-forget telemetry: live HR is a lossy stream by design (no outbox
    // domain); the ring's background drain still covers ambient HR history.
    fetch('/api/hr-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
    }).catch(() => {})
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null }
    this.flush()
    const ble = await getBle()
    if (ble && this.deviceId) {
      try { await ble.stopNotifications(this.deviceId, HR_SERVICE, HR_MEASUREMENT) } catch { /* gone */ }
      try { await ble.disconnect(this.deviceId) } catch { /* gone */ }
    }
    this.listeners = []
    this.deviceId = null
    this.gattConnected = false
    this.worn = true
    this.notWornSince = null
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "chest-strap-source" || echo clean`
Expected: `clean` (run `pnpm install` first if the plugin's types aren't resolved yet)

```bash
git add lib/live-hr/chest-strap-source.ts
git commit -m "Add worn-gated ChestStrapSource over the BLE Heart Rate Service"
```

---

### Task A5: Register the strap ahead of the ring (precedence)

**Files:**
- Modify: `lib/live-hr/manager.ts` (the singleton at the bottom, currently `createLiveHrManager([new OuraRingSource()])`)

- [ ] **Step 1: Add the import (top of file)**

```typescript
import { ChestStrapSource } from '@/lib/live-hr/chest-strap-source'
```

- [ ] **Step 2: Update the singleton so the strap is registered first**

```typescript
let appManager: LiveHrManager | null = null
export function getLiveHrManager(): LiveHrManager {
  // Registration order = precedence. The chest strap (beat-accurate, motion-robust,
  // worn-gated) wins whenever connected AND worn; otherwise the ring covers.
  if (!appManager) appManager = createLiveHrManager([new ChestStrapSource(), new OuraRingSource()])
  return appManager
}
```

- [ ] **Step 3: Verify the existing manager tests still pass**

Run: `npx vitest run lib/live-hr`
Expected: PASS (the manager precedence test already asserts first-registered-wins with fakes).

- [ ] **Step 4: Commit**

```bash
git add lib/live-hr/manager.ts
git commit -m "Register chest strap ahead of ring in live-HR manager"
```

---

### Task A6: Pairing UI with battery + firmware readout

**Files:**
- Create: `components/settings/chest-strap-pairing.tsx`
- Modify: `components/more/profile-tab.tsx` — mount `<ChestStrapPairing/>` directly below `<OuraConnectionSection/>` (imported there at line 42; keep the surrounding card rhythm).

- [ ] **Step 1: Implement the pairing component**

```tsx
// components/settings/chest-strap-pairing.tsx
'use client'
import { useEffect, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPairedStrap, setPairedStrap, type PairedStrap } from '@/lib/live-hr/paired-strap'
import { HR_SERVICE } from '@/lib/live-hr/chest-strap-source'

const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb'
const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb'
const DEVICE_INFO_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb'
const FIRMWARE_REVISION = '00002a26-0000-1000-8000-00805f9b34fb'

export function ChestStrapPairing() {
  const [paired, setPaired] = useState<PairedStrap | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [battery, setBattery] = useState<number | null>(null)
  const [firmware, setFirmware] = useState<string | null>(null)

  useEffect(() => { setPaired(getPairedStrap()) }, [])

  async function scanAndPair() {
    setError(null); setScanning(true)
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) { setError('Strap pairing is only available in the app.'); return }
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize()
      // OS picker filtered to Heart Rate Service devices — the H10 advertises
      // 0x180D as "Polar H10 XXXXXXXX". No bonding: connect directly, never
      // system-pair (Polar guidance; a system bond interferes with app connects).
      const device = await BleClient.requestDevice({ services: [HR_SERVICE] })
      const next = { deviceId: device.deviceId, name: device.name ?? 'HR strap' }
      setPairedStrap(next); setPaired(next)
      // Best-effort battery + firmware readout (CR2025 coin cell — a dying cell
      // presents as flaky connections, so surface the %; the FW revision is our
      // record for PMD re-validation if the owner ever updates via Polar Flow).
      try {
        await BleClient.connect(device.deviceId)
        const batt = await BleClient.read(device.deviceId, BATTERY_SERVICE, BATTERY_LEVEL)
        setBattery(new Uint8Array(batt.buffer)[0] ?? null)
        const fw = await BleClient.read(device.deviceId, DEVICE_INFO_SERVICE, FIRMWARE_REVISION)
        setFirmware(new TextDecoder().decode(fw.buffer).replace(/\0+$/, ''))
        await BleClient.disconnect(device.deviceId)
      } catch { /* readout is cosmetic — pairing already succeeded */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed or cancelled.')
    } finally {
      setScanning(false)
    }
  }

  function forget() { setPairedStrap(null); setPaired(null); setBattery(null); setFirmware(null) }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <HeartPulseIcon className="h-3.5 w-3.5" /> Heart-rate strap
      </p>
      {paired ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">{paired.name}</span>
            <Button variant="outline" size="sm" onClick={forget}>Forget</Button>
          </div>
          {(battery !== null || firmware) && (
            <p className="text-[10px] text-muted-foreground">
              {battery !== null ? `Battery ${battery}%` : ''}
              {battery !== null && firmware ? ' · ' : ''}
              {firmware ? `Firmware ${firmware}` : ''}
            </p>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={scanAndPair} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Pair a heart-rate strap'}
        </Button>
      )}
      <p className="text-[10px] text-muted-foreground">
        While the strap is worn and connected it becomes the heart-rate source during
        workouts; the ring takes over automatically whenever it isn&apos;t.
      </p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Mount in `components/more/profile-tab.tsx`**

Add the import next to the existing section imports:

```tsx
import { ChestStrapPairing } from '@/components/settings/chest-strap-pairing'
```

Render `<ChestStrapPairing />` immediately after `<OuraConnectionSection … />` in the JSX (devices group together on the profile tab).

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "chest-strap-pairing\|profile-tab" || echo clean`
Run: `npx eslint components/settings/chest-strap-pairing.tsx components/more/profile-tab.tsx`
Expected: clean

```bash
git add components/settings/chest-strap-pairing.tsx components/more/profile-tab.tsx
git commit -m "Add chest-strap pairing UI with battery/firmware readout"
```

---

### Task A7: `/api/hr-ingest` route

**Files:**
- Create: `app/api/hr-ingest/route.ts`

(RR values arrive in the payload from Task A4 but are persisted in Chunk B — the schema accepts them now so the client never needs a version dance.)

- [ ] **Step 1: Implement (Zod + rate limit, matching sibling ingest routes)**

```typescript
// app/api/hr-ingest/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  samples: z.array(z.object({
    at: z.number().int(),                              // epoch ms (client receive time)
    bpm: z.number().int().min(20).max(250),
    rr: z.array(z.number().int().min(200).max(4000)).max(16).optional(), // ms per beat
  })).min(1).max(2000),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  if (!rateLimit(`hr-ingest:${userId}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const repo = await getRepositoryAsync()
  await repo.upsertOuraHeartrate(userId, parsed.data.samples.map(s => ({
    timestamp: new Date(s.at),
    bpm: s.bpm,
    source: 'chest_strap',
  })))
  return NextResponse.json({ ok: true, stored: parsed.data.samples.length })
}
```

Note: `upsertOuraHeartrate` is `onConflictDoNothing` on `(user_id, timestamp)` — an exact-ms collision with a ring rollup row keeps the first writer. Ring rows are 5-minute-binned so this is edge-case noise; the read-side bucket precedence (Task A8) is the real merge rule.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "hr-ingest" || echo clean`
Expected: `clean`

```bash
git add app/api/hr-ingest/route.ts
git commit -m "Add chest-strap HR ingest route"
```

---

### Task A8: Strap-over-ring read precedence

**Files:**
- Create: `lib/health/hr-window-merge.ts`
- Test: `lib/health/__tests__/hr-window-merge.test.ts`
- Modify: `lib/data/postgres/slices/oura.ts` — `getHrForWindow` (line ~399)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/hr-window-merge.test.ts
import { describe, it, expect } from 'vitest'
import { preferStrapBuckets } from '@/lib/health/hr-window-merge'

const t = (s: number) => new Date(2026, 6, 16, 10, 0, s)
const row = (sec: number, bpm: number, source: string | null) => ({ timestamp: t(sec), bpm, source })

describe('preferStrapBuckets', () => {
  it('keeps all rows when sources do not overlap in time', () => {
    const rows = [row(0, 80, 'ble'), row(60, 90, 'chest_strap')]
    expect(preferStrapBuckets(rows)).toEqual(rows)
  })

  it('drops ring rows in buckets a strap row covers', () => {
    const rows = [row(0, 80, 'ble'), row(3, 132, 'chest_strap'), row(5, 82, 'ble')]
    expect(preferStrapBuckets(rows)).toEqual([row(3, 132, 'chest_strap')])
  })

  it('keeps every strap row within a bucket (no thinning of the dense stream)', () => {
    const rows = [row(0, 130, 'chest_strap'), row(1, 131, 'chest_strap'), row(2, 78, 'ble')]
    expect(preferStrapBuckets(rows)).toEqual([row(0, 130, 'chest_strap'), row(1, 131, 'chest_strap')])
  })

  it('returns rows sorted by timestamp', () => {
    const rows = [row(0, 80, 'ble'), row(11, 133, 'chest_strap'), row(15, 82, 'ble')]
    const out = preferStrapBuckets(rows)
    expect(out.map(r => r.timestamp.getTime())).toEqual([...out.map(r => r.timestamp.getTime())].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/hr-window-merge.test.ts`
Expected: FAIL — `Cannot find module '@/lib/health/hr-window-merge'`

- [ ] **Step 3: Implement**

```typescript
// lib/health/hr-window-merge.ts
// Merge precedence for HR time-series reads: where the chest strap (1 Hz,
// beat-accurate) and the ring (5-min binned) both cover a 10 s bucket, the
// strap's rows win and the ring's are dropped. Buckets with only one source
// pass through untouched — the strap never thins its own dense stream.
export interface HrRow { timestamp: Date; bpm: number; source: string | null }

const BUCKET_MS = 10_000

export function preferStrapBuckets(rows: HrRow[]): HrRow[] {
  const strapBuckets = new Set<number>()
  for (const r of rows) {
    if (r.source === 'chest_strap') strapBuckets.add(Math.floor(r.timestamp.getTime() / BUCKET_MS))
  }
  return rows
    .filter(r => r.source === 'chest_strap' || !strapBuckets.has(Math.floor(r.timestamp.getTime() / BUCKET_MS)))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/hr-window-merge.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire into `getHrForWindow`**

In `lib/data/postgres/slices/oura.ts`, import the merge and wrap the existing select (keep the returned row shape identical — `/api/oura/hr-day`, `hr-window`, `hr-data` and every chart consumer are unaffected):

```typescript
import { preferStrapBuckets } from '@/lib/health/hr-window-merge'

export async function getHrForWindow(db: Db, userId: string, from: Date, to: Date) {
  const rows = await db
    .select({ timestamp: s.ouraHeartrate.timestamp, bpm: s.ouraHeartrate.bpm, source: s.ouraHeartrate.source })
    .from(s.ouraHeartrate)
    .where(and(
      eq(s.ouraHeartrate.userId, userId),
      gte(s.ouraHeartrate.timestamp, from),
      lte(s.ouraHeartrate.timestamp, to),
    ))
    .orderBy(asc(s.ouraHeartrate.timestamp))
  return preferStrapBuckets(rows)
}
```

- [ ] **Step 6: Typecheck + full live-hr/health tests + commit**

Run: `npx tsc --noEmit && npx vitest run lib/live-hr lib/health/__tests__/hr-window-merge.test.ts`
Expected: clean, all pass.

```bash
git add lib/health/hr-window-merge.ts lib/health/__tests__/hr-window-merge.test.ts lib/data/postgres/slices/oura.ts
git commit -m "Prefer chest-strap HR over ring on window reads"
```

---

### Task A9: Empty-state copy covers both devices

**Files:**
- Modify: `components/workout/live-hr-chart.tsx` — the "Waiting for your ring…" empty state
- Modify: `components/workout/done-screen.tsx` — the no-HR-data hint (line ~438)

- [ ] **Step 1: Update the live card's empty-state string**

In `live-hr-chart.tsx`'s empty state, replace the ring-only wording ("Waiting for your ring…") with:

```
Waiting for your strap or ring…
```

(Find it: `grep -n "Waiting for your ring" components/workout/live-hr-chart.tsx` — keep the surrounding JSX untouched, string-only change.)

- [ ] **Step 2: Update the done-screen hint**

In `components/workout/done-screen.tsx` (~line 438) replace:

```
'No HR data for this session — make sure the ring was worn and connected during the workout; data arrives via the ring’s background sync'
```

with:

```
'No HR data for this session — wear the chest strap (or the ring) during the workout; ring data arrives via its background sync'
```

- [ ] **Step 3: Lint + commit**

Run: `npx eslint components/workout/live-hr-chart.tsx components/workout/done-screen.tsx`
Expected: clean

```bash
git add components/workout/live-hr-chart.tsx components/workout/done-screen.tsx
git commit -m "Mention the chest strap in live-HR empty states"
```

---

# Chunk B — RR intervals → workout HRV

### Task B1: `rr_intervals` table (migration 124) + repo functions

**Files:**
- Create: `lib/data/postgres/migrations/124_rr_intervals.sql`
- Modify: `lib/data/postgres/schema.ts`, `lib/data/postgres/slices/oura.ts`, `lib/data/repository.ts`, `lib/data/postgres/adapter.ts`

> Migration number **124** claimed against the ledger in `projectOverview.md` (on-disk max is 123; 120 is pencilled for the ring-walk plan's Chunk 3). Additive, reversible, no data touched — not a destructive migration.

- [ ] **Step 1: Write the migration**

```sql
-- 124_rr_intervals.sql
-- Beat-to-beat RR intervals from the chest strap (Polar H10). One row per beat;
-- `at` is the beat's wall-clock time derived from the notification receive time.
-- Raw material for HRV (rMSSD) — derived on read, never stored (Stored Counters rule).
CREATE TABLE IF NOT EXISTS rr_intervals (
  id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL,
  rr_ms   INTEGER     NOT NULL,
  source  TEXT        NOT NULL DEFAULT 'chest_strap',
  UNIQUE(user_id, at)
);

CREATE INDEX IF NOT EXISTS rr_intervals_user_at ON rr_intervals(user_id, at);
```

- [ ] **Step 2: Add the Drizzle table (schema.ts, next to `ouraHeartrate`)**

```typescript
export const rrIntervals = pgTable('rr_intervals', {
  id:     uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at:     timestamp('at', { withTimezone: true }).notNull(),
  rrMs:   integer('rr_ms').notNull(),
  source: text('source').notNull().default('chest_strap'),
}, t => [unique().on(t.userId, t.at)])
```

- [ ] **Step 3: Add slice functions (`lib/data/postgres/slices/oura.ts`, below `getHrForWindow`)**

```typescript
export async function insertRrIntervals(db: Db, userId: string, rows: { at: Date; rrMs: number }[]) {
  if (rows.length === 0) return
  await db.insert(s.rrIntervals)
    .values(rows.map(r => ({ userId, at: r.at, rrMs: r.rrMs })))
    .onConflictDoNothing()
}

export async function getRrForWindow(db: Db, userId: string, from: Date, to: Date) {
  return db
    .select({ at: s.rrIntervals.at, rrMs: s.rrIntervals.rrMs })
    .from(s.rrIntervals)
    .where(and(
      eq(s.rrIntervals.userId, userId),
      gte(s.rrIntervals.at, from),
      lte(s.rrIntervals.at, to),
    ))
    .orderBy(asc(s.rrIntervals.at))
}
```

- [ ] **Step 4: Extend the repository interface + adapter delegation**

In `lib/data/repository.ts` (next to `upsertOuraHeartrate`, line ~670):

```typescript
insertRrIntervals(userId: string, rows: { at: Date; rrMs: number }[]): Promise<void>
getRrForWindow(userId: string, from: Date, to: Date): Promise<{ at: Date; rrMs: number }[]>
```

In `lib/data/postgres/adapter.ts`, add the delegations next to the existing HR ones (lines ~4682–4683):

```typescript
  async insertRrIntervals(userId: string, rows: { at: Date; rrMs: number }[]) { return oura.insertRrIntervals(this.db, userId, rows) }
  async getRrForWindow(userId: string, from: Date, to: Date) { return oura.getRrForWindow(this.db, userId, from, to) }
```

- [ ] **Step 5: Apply locally + typecheck + commit**

Run: `pnpm db:local` (idempotent — applies 124 to the local dev DB)
Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: migration applies; typecheck clean.

```bash
git add lib/data/postgres/migrations/124_rr_intervals.sql lib/data/postgres/schema.ts lib/data/postgres/slices/oura.ts lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "Add rr_intervals table for chest-strap beat-to-beat data"
```

---

### Task B2: Persist RR from the ingest route

**Files:**
- Modify: `app/api/hr-ingest/route.ts`

- [ ] **Step 1: Spread beat timestamps and insert**

The client sends each ~1 Hz sample as `{at, bpm, rr: [ms…]}` where `at` is the packet receive time and `rr` lists the beats since the previous packet. Reconstruct per-beat wall-clock times by walking **backwards** from `at`: the last RR ended at `at`, the one before ended `rr[last]` earlier, etc.

Add after the `upsertOuraHeartrate` call in the POST handler:

```typescript
  const rrRows: { at: Date; rrMs: number }[] = []
  for (const s of parsed.data.samples) {
    if (!s.rr?.length) continue
    let end = s.at
    for (let i = s.rr.length - 1; i >= 0; i--) {
      rrRows.push({ at: new Date(end), rrMs: s.rr[i] })
      end -= s.rr[i]
    }
  }
  if (rrRows.length > 0) await repo.insertRrIntervals(userId, rrRows)
```

And include the count in the response:

```typescript
  return NextResponse.json({ ok: true, stored: parsed.data.samples.length, rrStored: rrRows.length })
```

- [ ] **Step 2: Dev-server smoke against the local DB**

Run: `pnpm dev` then:

```bash
curl -s -X POST http://localhost:3000/api/hr-ingest \
  -H 'Content-Type: application/json' -H "Cookie: $SESSION_COOKIE" \
  -d '{"samples":[{"at":1789000000000,"bpm":72,"rr":[830,845]},{"at":1789000001000,"bpm":73}]}'
```

Expected: `{"ok":true,"stored":2,"rrStored":2}`; `SELECT * FROM rr_intervals` on the local DB (port 5433) shows 2 rows with descending-derived timestamps. (Log in as `test@local.dev` / `testpass123` to obtain the session cookie.)

- [ ] **Step 3: Commit**

```bash
git add app/api/hr-ingest/route.ts
git commit -m "Persist chest-strap RR intervals with reconstructed beat times"
```

---

### Task B3: rMSSD (One Formula, One Place)

**Files:**
- Create: `lib/health/rmssd.ts`
- Test: `lib/health/__tests__/rmssd.test.ts`

(Nothing in `lib/` computes rMSSD from raw RR today — the ring's `0x5d` events carry ring-precomputed values (`lib/oura-ble/decode.ts:115`). This module becomes the only RR→rMSSD implementation; if a future feature needs it, import from here.)

- [ ] **Step 1: Write the failing test**

```typescript
// lib/health/__tests__/rmssd.test.ts
import { describe, it, expect } from 'vitest'
import { rmssdFromRr } from '@/lib/health/rmssd'

describe('rmssdFromRr', () => {
  it('computes rMSSD over successive differences', () => {
    // 30 beats alternating 800/820 → every successive diff is ±20 → rMSSD = 20
    const rr = Array.from({ length: 30 }, (_, i) => (i % 2 ? 820 : 800))
    expect(rmssdFromRr(rr)).toBeCloseTo(20, 5)
  })

  it('returns null with fewer than 30 beats (too little signal)', () => {
    expect(rmssdFromRr(Array.from({ length: 29 }, () => 800))).toBeNull()
  })

  it('excludes artifact pairs (>20% jump) from the differences', () => {
    // A 300 ms ectopic jump inside otherwise steady 800s must not dominate.
    const steady = Array.from({ length: 40 }, () => 800)
    const withArtifact = [...steady.slice(0, 20), 1100, ...steady.slice(21)]
    const clean = rmssdFromRr(steady)!
    const filtered = rmssdFromRr(withArtifact)!
    expect(filtered).toBeLessThan(clean + 5)
  })

  it('is null when everything is filtered', () => {
    // Alternating wild values: every pair is an artifact.
    expect(rmssdFromRr(Array.from({ length: 40 }, (_, i) => (i % 2 ? 400 : 1600)))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/health/__tests__/rmssd.test.ts`
Expected: FAIL — `Cannot find module '@/lib/health/rmssd'`

- [ ] **Step 3: Implement**

```typescript
// lib/health/rmssd.ts
// rMSSD from raw RR intervals (ms). The ONLY RR→rMSSD implementation in the app
// (the ring's 0x5d events carry ring-precomputed rMSSD — different provenance).
// Artifact gate: successive pairs differing >20% are ectopic/dropped-beat noise
// and are excluded pairwise (standard Kubios-style threshold filter).
const MIN_BEATS = 30
const ARTIFACT_RATIO = 0.2

export function rmssdFromRr(rrMs: number[]): number | null {
  if (rrMs.length < MIN_BEATS) return null
  const sqDiffs: number[] = []
  for (let i = 1; i < rrMs.length; i++) {
    const a = rrMs[i - 1]
    const b = rrMs[i]
    if (Math.abs(b - a) > ARTIFACT_RATIO * a) continue
    sqDiffs.push((b - a) ** 2)
  }
  if (sqDiffs.length < MIN_BEATS / 2) return null
  const mean = sqDiffs.reduce((s, v) => s + v, 0) / sqDiffs.length
  return Math.sqrt(mean)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/health/__tests__/rmssd.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/health/rmssd.ts lib/health/__tests__/rmssd.test.ts
git commit -m "Add artifact-gated rMSSD from raw RR intervals"
```

---

### Task B4: Workout HRV on the done screen

**Files:**
- Modify: `app/api/oura/hr-data/route.ts`
- Modify: `components/workout/done-screen.tsx`

- [ ] **Step 1: Compute rest-window rMSSD in the route**

In `app/api/oura/hr-data/route.ts`, add the imports:

```typescript
import { rmssdFromRr } from '@/lib/health/rmssd'
```

Extend the parallel fetch (line ~22) with RR rows:

```typescript
  const [readings, sets, rrRows] = await Promise.all([
    repo.getHrForWindow(session.user.id, from, to),
    repo.getSetTimestampsForSession(workoutSessionId),
    repo.getRrForWindow(session.user.id, ws.startedAt, ws.completedAt),
  ])
```

After `stats` is computed, derive rest-window HRV — beats **outside** every working-set interval (RR under load is dominated by mechanics, not autonomic tone; rest-window rMSSD is the meaningful recovery signal):

```typescript
  const setWindows = sets
    .filter(s => s.setStartMs != null && s.setEndMs != null)
    .map(s => ({ from: s.setStartMs!, to: s.setEndMs! }))
  const restRr = rrRows
    .filter(r => !setWindows.some(w => {
      const t = r.at.getTime()
      return t >= w.from && t <= w.to
    }))
    .map(r => r.rrMs)
  const workoutHrvMs = rmssdFromRr(restRr)
```

Add to the JSON response object:

```typescript
    workoutHrvMs,   // rest-window rMSSD (ms) from chest-strap RR; null without strap data
```

- [ ] **Step 2: Surface on the done screen**

In `components/workout/done-screen.tsx`, extend the `HrData` interface (line ~51):

```typescript
  workoutHrvMs?: number | null
```

Below the `<HrRecoveryChart …/>` (after line ~409), inside the same fragment, add:

```tsx
                {hrData.workoutHrvMs != null && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Workout HRV (rest-window rMSSD)</span>
                    <span className="text-foreground font-medium">{Math.round(hrData.workoutHrvMs)} ms</span>
                  </div>
                )}
```

- [ ] **Step 3: Dev-server smoke**

Seed RR rows into the local DB spanning a seeded completed workout session's window, hit `/api/oura/hr-data?sessionId=<id>` logged in as `test@local.dev`, and confirm `workoutHrvMs` is a plausible number (and `null` for sessions without RR rows — the stat row simply doesn't render).

- [ ] **Step 4: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npx eslint app/api/oura/hr-data/route.ts components/workout/done-screen.tsx`
Expected: clean

```bash
git add app/api/oura/hr-data/route.ts components/workout/done-screen.tsx
git commit -m "Surface rest-window workout HRV from chest-strap RR"
```

---

### Task Final: Gate + docs + version

- [ ] **Step 1: Full gate**

Run: `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`
Expected: all green (DB integration tests run against the local Postgres per CI parity).

- [ ] **Step 2: Version + changelog + journal + index**

Bump `package.json` **minor** (new feature). `lib/changelog.ts` entry: "Pair your Polar H10 (or any Bluetooth heart-rate strap) — while worn it becomes the heart-rate source during workouts with beat-accurate HR and workout HRV; the ring takes over automatically when it isn't." Append the session note to `docs/overview/history-current.md`, update `projectOverview.md` (Current Status; migration ledger — 124 now on disk; Known-Issues row for the device-only verification below), and **remove this plan's backlog entry**.

- [ ] **Step 3: Push**

```bash
git push -u origin feat/polar-h10-live-hr
```

---

## Verification summary

- **Automated (sandbox):** parser (8), merge (4), rMSSD (4) unit tests + existing live-hr suite; route smokes against the local DB; full gate.
- **On-device (authoritative — required, `docs/device-smoke-checklist.md`):**
  1. Pair the H10 from More → Profile (OS picker shows "Polar H10 XXXXXXXX"; battery/firmware render).
  2. Start a workout wearing the strap → live card shows beat-accurate HR through set *and* rest phases (source `chest_strap`).
  3. Unclip the strap mid-workout → within ~15 s the card falls back to ring behaviour; re-clip → strap reclaims.
  4. Start a workout *without* the strap → ring path works exactly as before (regression check).
  5. After the workout: done-screen chart shows dense strap HR, `source='chest_strap'` rows in `oura_heartrate`, `rr_intervals` populated, Workout HRV stat renders.
  6. Confirm the Oura ring's own connection/drain is unaffected while the strap streams (two concurrent BLE devices).

## Notes for the implementer

- Read the **`polar-h10-ble` skill first** — protocol, quirks (no system bonding! keep the pod moistened/clipped), and the direct-GATT decision rationale.
- `@capacitor-community/bluetooth-le` is native: after `pnpm add`, the owner must `npx cap sync android && ./gradlew assembleDebug`. State in the PR which halves are JS/server vs native-rebuild-gated.
- Keep `ChestStrapSource` degradation identical to `OuraRingSource`: no paired device / no bridge → inert `'disconnected'`, so the manager falls through to the ring with zero UI changes.
- Do not change the `LiveHrSource` interface — the manager, `useLiveHr`, and every chart already consume it.
- The exercise-trace singleton (`lib/live-hr/exercise-trace.ts`) and `LiveHrChart` are source-agnostic — they work unchanged; resist "improving" them in this PR.
