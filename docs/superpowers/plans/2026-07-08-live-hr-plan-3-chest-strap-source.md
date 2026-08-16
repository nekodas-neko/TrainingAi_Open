# Live HR — Plan 3: Chest-Strap Source Implementation Plan

> **⛔ SUPERSEDED (2026-07-16): do not implement from this document.** The owner bought a
> **Polar H10**; this plan is absorbed — with device-specific corrections (worn-gating via the
> sensor-contact bit so ring fallback actually engages, RR-interval capture for workout HRV,
> battery/firmware readout, a pinned pairing-UI mount point) — into
> [`2026-07-16-polar-h10-integration.md`](2026-07-16-polar-h10-integration.md), which is the
> queued plan. Protocol knowledge base: the `polar-h10-ble` skill.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standard BLE chest-strap heart-rate monitor as a live-HR source that takes precedence over the Oura ring when connected, so the strap becomes the source of truth during workouts and guided walks.

**Architecture:** Implement the `LiveHrSource` interface (shipped in Plan 1, `lib/live-hr/types.ts`) with a `ChestStrapSource` that talks to the standard BLE **Heart Rate Service** (`0x180D`) / **Heart Rate Measurement** characteristic (`0x2A37`) via `@capacitor-community/bluetooth-le`. Register it ahead of `OuraRingSource` in the manager (registration order = precedence). A small pairing UI persists the chosen device; strap samples persist to the HR time-series tagged `source='chest_strap'`, and the read path prefers strap over ring when both cover a window.

**Tech Stack:** TypeScript, React 19, `@capacitor-community/bluetooth-le` (new dependency), the Plan-1 `lib/live-hr/*` layer, Drizzle/Postgres, vitest.

> **Prerequisite:** Plan 1 (`lib/live-hr/*`) must be merged (it is, v1.120.6). This plan depends on the `LiveHrSource` interface and `createLiveHrManager` from Plan 1.

---

## Runtime reality / verification note

- **Needs a hardware chest strap + an APK rebuild.** `@capacitor-community/bluetooth-le` is a native plugin; adding it requires `npx cap sync android && ./gradlew assembleDebug` (owner rebuild) and cannot be exercised in the sandbox. The BLE parse logic and precedence are unit-tested in JS; everything else is **on-device only**.
- The strap's `0x2A37` notifications are standard GATT — no reverse-engineering. Beat-by-beat HR + optional RR intervals, far better than the ring under motion.
- State clearly in any PR: BLE pairing/streaming is device-only; only the parse + precedence are sandbox-verified.

## File structure

**Create:**
- `lib/live-hr/hr-measurement.ts` — pure parser for the `0x2A37` Heart Rate Measurement value (flags byte → HR + RR intervals). Isolated for unit testing.
- `lib/live-hr/chest-strap-source.ts` — `ChestStrapSource` implementing `LiveHrSource` over `@capacitor-community/bluetooth-le`.
- `lib/live-hr/paired-strap.ts` — persistence of the paired device id (localStorage) + helpers.
- `components/settings/chest-strap-pairing.tsx` — scan/pair/forget UI.
- `app/api/hr-ingest/route.ts` — POST route upserting strap samples into `oura_heartrate` (`source='chest_strap'`), Zod-validated + rate-limited.
- Tests: `lib/live-hr/__tests__/hr-measurement.test.ts`.

**Modify:**
- `package.json` / `pnpm-lock.yaml` — add `@capacitor-community/bluetooth-le`.
- `lib/live-hr/manager.ts` — `getLiveHrManager()` registers `ChestStrapSource` **before** `OuraRingSource` (precedence).
- `lib/data/postgres/slices/oura.ts` (`getHrForWindow`) — prefer `chest_strap` over `ble` when both cover the same time (merge precedence).
- The chest-strap live samples wiring: `ChestStrapSource` batches samples and POSTs to `/api/hr-ingest` (so summaries/charts see strap data).
- A settings/profile screen — mount `<ChestStrapPairing/>` (exact screen decided in Task 6).
- `lib/changelog.ts` + `package.json` version, journal + index (final task).

---

### Task 1: Heart Rate Measurement parser

**Files:**
- Create: `lib/live-hr/hr-measurement.ts`
- Test: `lib/live-hr/__tests__/hr-measurement.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/live-hr/__tests__/hr-measurement.test.ts
import { describe, it, expect } from 'vitest'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'

// The 0x2A37 value: byte0 = flags. bit0: 0 → HR is uint8 (byte1); 1 → HR is uint16 LE
// (bytes1-2). bit4: RR intervals present (uint16 LE, units of 1/1024 s) after HR (+ energy
// field if bit3 set). See Bluetooth GATT Heart Rate Measurement spec.
function bytes(...b: number[]) { return new Uint8Array(b) }

describe('parseHeartRateMeasurement', () => {
  it('parses 8-bit HR (flags=0x00)', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 72))).toEqual({ bpm: 72, rr: [] })
  })

  it('parses 16-bit HR (flags bit0 set)', () => {
    // flags=0x01, HR=300 (0x012C) little-endian → 0x2C, 0x01
    expect(parseHeartRateMeasurement(bytes(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, rr: [] })
  })

  it('parses RR intervals (flags bit4 set) in ms', () => {
    // flags=0x10 (RR present, 8-bit HR), HR=60, one RR = 1024 (1/1024 s units) → 1000 ms
    expect(parseHeartRateMeasurement(bytes(0x10, 60, 0x00, 0x04))).toEqual({ bpm: 60, rr: [1000] })
  })

  it('skips the energy-expended field when bit3 is set before RR', () => {
    // flags=0x18 (energy + RR), HR=60, energy=0x0000, RR=512 → 500 ms
    expect(parseHeartRateMeasurement(bytes(0x18, 60, 0x00, 0x00, 0x00, 0x02))).toEqual({ bpm: 60, rr: [500] })
  })

  it('returns null for too-short buffers', () => {
    expect(parseHeartRateMeasurement(bytes(0x00))).toBeNull()
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
export interface HrMeasurement { bpm: number; rr: number[] }

export function parseHeartRateMeasurement(v: Uint8Array): HrMeasurement | null {
  if (v.length < 2) return null
  const flags = v[0]
  const hr16 = (flags & 0x01) !== 0
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
      const raw = v[i] | (v[i + 1] << 8) // units of 1/1024 s
      rr.push(Math.round((raw / 1024) * 1000))
    }
  }
  return { bpm, rr }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/hr-measurement.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/hr-measurement.ts lib/live-hr/__tests__/hr-measurement.test.ts
git commit -m "Add BLE Heart Rate Measurement parser"
```

---

### Task 2: Add the BLE plugin dependency

**Files:** `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install with pnpm (never npm — Railway uses the frozen lockfile)**

Run: `pnpm add @capacitor-community/bluetooth-le`
Expected: `package.json` gains the dep and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Sync native (owner, on a machine with the Android SDK)**

Run (owner machine): `npx cap sync android`
Expected: the plugin is registered in the Android project. (Sandbox cannot run this — note it for the owner.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add @capacitor-community/bluetooth-le for chest-strap HR"
```

---

### Task 3: Paired-strap persistence

**Files:**
- Create: `lib/live-hr/paired-strap.ts`

- [ ] **Step 1: Implement**

```typescript
// lib/live-hr/paired-strap.ts
// Persists the chosen chest-strap device across sessions (localStorage — the paired
// deviceId is stable per strap on Android's BLE stack).
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

### Task 4: ChestStrapSource

**Files:**
- Create: `lib/live-hr/chest-strap-source.ts`

*(No unit test — wires the Capacitor BLE bridge to the Task-1 parser + manager; the parser is covered by Task 1 and precedence by Plan 1's manager test. Exercised on-device.)*

- [ ] **Step 1: Implement**

```typescript
// lib/live-hr/chest-strap-source.ts
// LiveHrSource backed by a standard BLE chest strap (Heart Rate Service 0x180D,
// Heart Rate Measurement 0x2A37) via @capacitor-community/bluetooth-le.
import type { LiveHrSample, LiveHrSource, SourceConnectionState } from '@/lib/live-hr/types'
import { parseHeartRateMeasurement } from '@/lib/live-hr/hr-measurement'
import { getPairedStrap } from '@/lib/live-hr/paired-strap'

const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'

// Dynamic import so a browser/older APK without the plugin degrades to inert, matching
// getOuraBle()'s guarded-import pattern.
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
  private state: SourceConnectionState = 'disconnected'
  private listeners: Array<(s: Omit<LiveHrSample, 'sourceId'>) => void> = []
  private deviceId: string | null = null

  connectionState(): SourceConnectionState { return this.state }

  subscribe(cb: (s: Omit<LiveHrSample, 'sourceId'>) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  async start(): Promise<void> {
    const paired = getPairedStrap()
    const ble = await getBle()
    if (!paired || !ble) { this.state = 'disconnected'; return } // no strap paired / no bridge
    this.state = 'connecting'
    this.deviceId = paired.deviceId
    try {
      await ble.initialize()
      await ble.connect(paired.deviceId, () => { this.state = 'disconnected' })
      await ble.startNotifications(paired.deviceId, HR_SERVICE, HR_MEASUREMENT, value => {
        const parsed = parseHeartRateMeasurement(new Uint8Array(value.buffer))
        if (!parsed) return
        this.state = 'connected'
        const sample = { bpm: parsed.bpm, at: Date.now() }
        for (const l of this.listeners) l(sample)
      })
    } catch {
      this.state = 'disconnected'
    }
  }

  async stop(): Promise<void> {
    const ble = await getBle()
    if (ble && this.deviceId) {
      try { await ble.stopNotifications(this.deviceId, HR_SERVICE, HR_MEASUREMENT) } catch { /* gone */ }
      try { await ble.disconnect(this.deviceId) } catch { /* gone */ }
    }
    this.listeners = []
    this.deviceId = null
    this.state = 'disconnected'
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "chest-strap-source" || echo clean`
Expected: `clean` (if the plugin's types aren't resolvable until `pnpm install`, run `pnpm install` first)

```bash
git add lib/live-hr/chest-strap-source.ts
git commit -m "Add ChestStrapSource over BLE Heart Rate Service"
```

---

### Task 5: Register the strap ahead of the ring (precedence)

**Files:**
- Modify: `lib/live-hr/manager.ts`

- [ ] **Step 1: Add the import (top of file)**

```typescript
import { ChestStrapSource } from '@/lib/live-hr/chest-strap-source'
```

- [ ] **Step 2: Update the singleton so the strap is registered first**

Replace the `getLiveHrManager` body:

```typescript
export function getLiveHrManager(): LiveHrManager {
  // Registration order = precedence. Chest strap (beat-by-beat, motion-robust) wins over
  // the ring whenever it's connected; the manager falls back to the ring otherwise.
  if (!appManager) appManager = createLiveHrManager([new ChestStrapSource(), new OuraRingSource()])
  return appManager
}
```

- [ ] **Step 3: Verify Plan-1 manager tests still pass**

Run: `npx vitest run lib/live-hr/__tests__/manager.test.ts`
Expected: PASS (the precedence test already asserts strap-over-ring using fakes; this wires the real source in the same order).

- [ ] **Step 4: Commit**

```bash
git add lib/live-hr/manager.ts
git commit -m "Register chest strap ahead of ring in live-HR manager"
```

---

### Task 6: Pairing UI

**Files:**
- Create: `components/settings/chest-strap-pairing.tsx`
- Modify: a settings/profile screen to mount it (find it: `grep -rl "Profile\|Settings" app/ components/ --include=*.tsx | head`; mount under the health/device settings section).

- [ ] **Step 1: Implement the pairing component**

```tsx
// components/settings/chest-strap-pairing.tsx
'use client'
import { useEffect, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPairedStrap, setPairedStrap, type PairedStrap } from '@/lib/live-hr/paired-strap'

const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'

export function ChestStrapPairing() {
  const [paired, setPaired] = useState<PairedStrap | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setPaired(getPairedStrap()) }, [])

  async function scanAndPair() {
    setError(null); setScanning(true)
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) { setError('Chest-strap pairing is only available in the app.'); return }
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize()
      // requestDevice shows the OS picker filtered to Heart Rate Service devices.
      const device = await BleClient.requestDevice({ services: [HR_SERVICE] })
      const next = { deviceId: device.deviceId, name: device.name ?? 'Chest strap' }
      setPairedStrap(next); setPaired(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed or cancelled.')
    } finally {
      setScanning(false)
    }
  }

  function forget() { setPairedStrap(null); setPaired(null) }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <HeartPulseIcon className="h-3.5 w-3.5" /> Heart-rate strap
      </p>
      {paired ? (
        <div className="flex items-center justify-between">
          <span className="text-sm">Paired: {paired.name}</span>
          <Button variant="outline" size="sm" onClick={forget}>Forget</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={scanAndPair} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Pair a chest strap'}
        </Button>
      )}
      <p className="text-[10px] text-muted-foreground">
        When a strap is paired and connected, it becomes the heart-rate source during workouts and walks (overriding the ring).
      </p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the settings/profile screen**

Import and render `<ChestStrapPairing/>` in the health/device settings section of the profile screen located in Step 1's grep result. Match the surrounding card layout.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep "chest-strap-pairing" || echo clean`
Run: `npx eslint components/settings/chest-strap-pairing.tsx`
Expected: clean

```bash
git add components/settings/chest-strap-pairing.tsx <the-settings-screen-file>
git commit -m "Add chest-strap pairing UI"
```

---

### Task 7: Persist strap samples + read-merge precedence

**Files:**
- Create: `app/api/hr-ingest/route.ts`
- Modify: `lib/live-hr/chest-strap-source.ts` (batch + POST), `lib/data/postgres/slices/oura.ts` (`getHrForWindow` precedence)

- [ ] **Step 1: Create the ingest route (Zod + rate limit, matching sibling routes)**

```typescript
// app/api/hr-ingest/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  samples: z.array(z.object({
    at: z.number().int(),       // epoch ms
    bpm: z.number().int().min(30).max(240),
  })).max(2000),
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

- [ ] **Step 2: Batch + POST from ChestStrapSource**

In `chest-strap-source.ts`, buffer samples and flush every ~10 s (and on `stop()`) to `/api/hr-ingest`. Add to the class:

```typescript
  private buffer: Array<{ at: number; bpm: number }> = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  private queue(at: number, bpm: number) {
    this.buffer.push({ at, bpm })
    if (this.buffer.length >= 40) this.flush()
  }

  private flush() {
    if (this.buffer.length === 0) return
    const samples = this.buffer.splice(0)
    fetch('/api/hr-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
    }).catch(() => { /* fire-and-forget; ring drain still covers HR history */ })
  }
```

Call `this.queue(sample.at, sample.bpm)` inside the notification handler (alongside the listener loop), start `this.flushTimer = setInterval(() => this.flush(), 10_000)` in `start()`, and `clearInterval` + a final `this.flush()` in `stop()`.

- [ ] **Step 3: Read-merge precedence in `getHrForWindow`**

In `lib/data/postgres/slices/oura.ts`, `getHrForWindow` currently returns all rows ordered by timestamp. Add precedence so that when both a `chest_strap` and a `ble` row exist within the same ~10 s bucket, the `chest_strap` row wins. Implement as a post-query pass in JS (keep the SQL simple):

```typescript
// After the existing select (rows ordered by timestamp asc), collapse near-duplicate
// timestamps preferring chest_strap over ble.
const BUCKET_MS = 10_000
const byBucket = new Map<number, { timestamp: Date; bpm: number; source: string | null }>()
for (const r of rows) {
  const key = Math.floor(r.timestamp.getTime() / BUCKET_MS)
  const existing = byBucket.get(key)
  if (!existing || (r.source === 'chest_strap' && existing.source !== 'chest_strap')) {
    byBucket.set(key, r)
  }
}
return Array.from(byBucket.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
```

(Confirm the exact `rows` shape before editing; keep the returned type identical so `/api/oura/hr-day`, `hr-window`, and `hr-data` callers are unaffected.)

- [ ] **Step 4: Typecheck + test + commit**

Run: `npx tsc --noEmit && npx vitest run lib/live-hr`
Expected: clean, all live-hr tests pass.

```bash
git add app/api/hr-ingest/route.ts lib/live-hr/chest-strap-source.ts lib/data/postgres/slices/oura.ts
git commit -m "Persist chest-strap HR and prefer it over ring on read"
```

---

### Task 8: Gate + docs + version

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npx eslint lib/live-hr components/settings/chest-strap-pairing.tsx app/api/hr-ingest/route.ts && npx vitest run lib/live-hr`
Expected: typecheck clean, lint clean, all live-hr tests pass.

- [ ] **Step 2: Version + changelog + journal + index**

Bump `package.json` a minor (new feature). Add a user-facing `lib/changelog.ts` entry ("Pair a Bluetooth heart-rate strap — when connected it becomes your heart-rate source during workouts and walks, overriding the ring"). Prepend the session note to `docs/overview/history-current.md` and update `projectOverview.md` Current Status. Remove this plan's backlog entry.

- [ ] **Step 3: Commit + push**

```bash
git add -A && git commit -m "Chest-strap HR source: version bump + journal"
git push -u origin feat/live-hr-chest-strap
```

---

## Verification summary

- **Automated (sandbox):** `hr-measurement` parser tests (5) + Plan-1 manager precedence test; typecheck + lint.
- **On-device (authoritative — required):** pair a real strap via the OS picker; confirm it connects, streams beat-by-beat HR into the live readout and the guided-walk zones, takes precedence over the ring, persists to history (`source='chest_strap'`), and that `getHrForWindow` shows strap-preferred data. Run `docs/device-smoke-checklist.md`.

## Notes for the implementer

- `@capacitor-community/bluetooth-le` is native — after `pnpm add`, the owner must `npx cap sync android && ./gradlew assembleDebug`. Nothing BLE runs in the sandbox.
- Keep `ChestStrapSource` degradation identical to `OuraRingSource`: no paired device or no bridge → inert, `connectionState() === 'disconnected'`, so the manager falls back to the ring cleanly.
- Do not change the `LiveHrSource` interface — the manager and `useLiveHr` already consume it.
```
