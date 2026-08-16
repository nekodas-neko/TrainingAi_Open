# Live HR — Plan 1: Shared Layer + Lifting Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live heart-rate readout (BPM + rolling sparkline) on the lifting rest and exercise-summary screens, driven by a reusable, source-agnostic live-HR layer, and keep the existing per-set end-of-session HR summary working.

**Architecture:** A `LiveHrSource` interface with one implementation now — `OuraRingSource` — behind a `liveHrManager` singleton and a `useLiveHr()` hook. The Oura source calls the *already-existing* native `startLiveHr()`/`stopLiveHr()` plugin methods and decodes the ring's live HR frames **in JS** from the `ouraFrames`/`ouraFrame` events the native service already emits (using the existing `historyEventFromHex` decoder). **No native/Kotlin change and no APK rebuild for this plan** — it ships via Railway into the WebView. The workout screen owns the start/stop lifecycle; a leaf component renders the readout.

**Tech Stack:** TypeScript, React 19, Next.js 15, Capacitor plugin bridge (`@/lib/oura-ble/plugin`), vitest, existing `@/lib/oura-ble/decode` + `@/components/ui/sparkline`.

> **Spec note (supersedes the spec's assumption):** the design spec (`docs/superpowers/specs/2026-07-08-live-hr-and-interval-walking-design.md` §5.1) proposed a *native* `ouraLiveHr` event requiring an APK rebuild. Investigation found the native service already forwards every history frame to JS via `ouraFrames`, and a JS decoder already extracts HR — so Plan 1 decodes in JS instead. The native `ouraLiveHr` event is deferred as an optional later optimisation; it is **not** part of this plan.

---

## Runtime reality / verification note

- This plan is **JS/server only** — it ships via Railway into the WebView with no APK rebuild.
- Live HR only produces real data **on-device** (native SQLite/Capacitor + a paired, connected ring). In the web/dev sandbox `getOuraBle()` returns `null`, so `OuraRingSource` is inert and the readout shows "—". That is the correct, tested degraded state — but it means the *live data path* is only truly verifiable on the APK. State this when presenting the work; run `docs/device-smoke-checklist.md` for the on-device pass.
- The ring emits a green-LED HR **trend** under motion (not beat-by-beat) and can power-gate its PPG at rest — so "—"/stale during a still rest period is expected firmware behaviour, not a bug. The UI must never imply higher fidelity than exists.

## File structure

**Create:**
- `lib/live-hr/types.ts` — `LiveHrSample`, `LiveHrSourceId`, `LiveHrSource`, `LiveHrCurrent` types. One responsibility: shared contracts.
- `lib/live-hr/decode-live-hr.ts` — pure `latestBpmFromFrames(frameHexes)` extracting the newest valid BPM from ring frames. Isolated so it's unit-testable without the BLE bridge.
- `lib/live-hr/oura-ring-source.ts` — `OuraRingSource` implementing `LiveHrSource`: wires plugin `startLiveHr`/`stopLiveHr` + `ouraFrames`/`ouraFrame` listeners → `latestBpmFromFrames` → sample callback.
- `lib/live-hr/manager.ts` — `liveHrManager` singleton: source registration, precedence selection, current-sample store, subscribe/notify, start/stop.
- `lib/live-hr/use-live-hr.ts` — `useLiveHr()` React hook: subscribes to the manager, computes staleness on a 1 Hz leaf tick, returns display state.
- `components/workout/live-hr-readout.tsx` — memoised leaf: reads `useLiveHr()` itself, renders compact BPM + rolling `Sparkline`. Degrades to "—" when no source.
- Tests: `lib/live-hr/__tests__/decode-live-hr.test.ts`, `lib/live-hr/__tests__/manager.test.ts`.

**Modify:**
- `components/workout-screen.tsx` — start the manager when the workout is in a live range (`warmup`/`active`/`exercise-summary`), stop otherwise and on unmount.
- `components/workout/active-workout-screen.tsx` — render `<LiveHrReadout>` in the rest-phase block (anchor: line ~646, `{workoutPhase === "rest" && !allSetsLogged && (`).
- `components/workout/exercise-summary-screen.tsx` — render `<LiveHrReadout>` near the top of the summary.
- `lib/changelog.ts` + `package.json` — version bump + entry (final task).
- `docs/overview/history-current.md` + `projectOverview.md` — journal + index (final task).

---

### Task 1: Shared live-HR types

**Files:**
- Create: `lib/live-hr/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// lib/live-hr/types.ts
// Shared contracts for the source-agnostic live-HR layer. A "source" is a device
// that streams heart rate (the Oura ring today; a BLE chest strap later). The
// manager picks one active source by precedence and exposes a single stream.

export type LiveHrSourceId = 'oura_ble' | 'chest_strap'

export interface LiveHrSample {
  bpm: number
  /** Wall-clock receive time (ms). We stamp on receipt — the ring's own clock is
   *  deciseconds since an arbitrary epoch and irrelevant for a live readout. */
  at: number
  sourceId: LiveHrSourceId
}

export type SourceConnectionState = 'connected' | 'connecting' | 'disconnected'

export interface LiveHrSource {
  id: LiveHrSourceId
  connectionState(): SourceConnectionState
  /** Begin live measurement. Must be a no-op (not throw) when the device/bridge is
   *  unavailable — e.g. the web sandbox. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Register a callback for each decoded beat. Returns an unsubscribe fn. */
  subscribe(cb: (sample: Omit<LiveHrSample, 'sourceId'>) => void): () => void
}

export interface LiveHrCurrent {
  bpm: number | null
  at: number | null
  sourceId: LiveHrSourceId | null
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit 2>&1 | grep -c "live-hr/types" || echo "clean"`
Expected: `clean` (0 errors referencing the file)

- [ ] **Step 3: Commit**

```bash
git add lib/live-hr/types.ts
git commit -m "Add shared live-HR layer types"
```

---

### Task 2: Pure live-HR frame decoder

**Files:**
- Create: `lib/live-hr/decode-live-hr.ts`
- Test: `lib/live-hr/__tests__/decode-live-hr.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/live-hr/__tests__/decode-live-hr.test.ts
import { describe, it, expect } from 'vitest'
import { latestBpmFromFrames } from '@/lib/live-hr/decode-live-hr'

// Build a ring history-event frame hex: tag + length + payload, where payload is
// a 4-byte LE deciseconds timestamp followed by the event body. Mirrors the format
// historyEventFromHex() expects (see lib/oura-ble/decode.ts parseHistoryEvent).
function frameHex(tag: number, ds: number, body: number[]): string {
  const ts = [ds & 0xff, (ds >> 8) & 0xff, (ds >> 16) & 0xff, (ds >> 24) & 0xff]
  const payload = [...ts, ...body]
  return [tag, payload.length, ...payload].map(b => b.toString(16).padStart(2, '0')).join('')
}

describe('latestBpmFromFrames', () => {
  it('returns null for no frames', () => {
    expect(latestBpmFromFrames([])).toBeNull()
  })

  it('extracts the newest BPM from an aohr (0x86) frame', () => {
    // aohr body: flag=1, base_offset=0, count=6, then 6×(bpm,quality) pairs.
    const body = [0x01, 0x00, 0x06, 50, 1, 51, 1, 52, 1, 53, 1, 54, 1, 55, 1]
    // decoded.bpm = [50..55] → newest = 55.
    expect(latestBpmFromFrames([frameHex(0x86, 1000, body)])).toBe(55)
  })

  it('extracts BPM from a green_ibi_quality (0x80) frame', () => {
    // ibi=(b1&7)|(b0<<3), quality=(b1>>3)&3. Choose bytes giving quality=1 and a
    // plausible ibi. b0=0x4b, b1=0x08 → ibi=(0)|(0x4b<<3)=600, q=1 → 60000/600=100 bpm.
    expect(latestBpmFromFrames([frameHex(0x80, 1000, [0x4b, 0x08])])).toBe(100)
  })

  it('ignores frames with no usable HR and returns the last valid one', () => {
    const aohr = frameHex(0x86, 1000, [0x01, 0x00, 0x02, 70, 1, 72, 1]) // newest = 72
    const junk = frameHex(0x84, 1001, [0x10, 0x00]) // ambient_event — no HR
    expect(latestBpmFromFrames([aohr, junk])).toBe(72)
  })

  it('rejects out-of-range BPM', () => {
    // count=1, bpm=250 (>220) → no valid sample → null.
    expect(latestBpmFromFrames([frameHex(0x86, 1000, [0x01, 0x00, 0x01, 250, 1])])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/decode-live-hr.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/decode-live-hr'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/live-hr/decode-live-hr.ts
// Pure extraction of the newest plausible live BPM from ring history-event frames.
// Reuses the byte-exact decoder in @/lib/oura-ble/decode (the source of truth).
import { historyEventFromHex } from '@/lib/oura-ble/decode'

const MIN_BPM = 30
const MAX_BPM = 220

function latestValidBpm(values: unknown): number | null {
  if (!Array.isArray(values)) return null
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM) return v
  }
  return null
}

/**
 * Given a batch of raw frame hex strings (as delivered by the native service's
 * `ouraFrames`/`ouraFrame` events), return the most recent usable BPM, or null.
 * aohr (0x86) exposes `bpm`; IBI frames (0x80/0x60) expose `hr_bpm`.
 */
export function latestBpmFromFrames(frameHexes: string[]): number | null {
  let latest: number | null = null
  for (const hex of frameHexes) {
    const ev = historyEventFromHex(hex)
    if (!ev || !ev.decoded) continue
    const bpm =
      latestValidBpm((ev.decoded as Record<string, unknown>).bpm) ??
      latestValidBpm((ev.decoded as Record<string, unknown>).hr_bpm)
    if (bpm != null) latest = bpm // later frames in the batch are newer
  }
  return latest
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/decode-live-hr.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/decode-live-hr.ts lib/live-hr/__tests__/decode-live-hr.test.ts
git commit -m "Add pure live-HR frame decoder"
```

---

### Task 3: OuraRingSource

**Files:**
- Create: `lib/live-hr/oura-ring-source.ts`

*(No unit test: this class only wires the Capacitor bridge to the already-tested pure decoder and manager. Its logic is exercised on-device; the pure decode is covered by Task 2 and precedence by Task 4.)*

- [ ] **Step 1: Write the implementation**

```typescript
// lib/live-hr/oura-ring-source.ts
// LiveHrSource backed by the Oura ring over the existing native BLE plugin.
// Calls the already-shipped startLiveHr()/stopLiveHr() and decodes the live HR
// frames the service already emits as `ouraFrames`/`ouraFrame` — no native change.
import { getOuraBle, type OuraFrameEvent } from '@/lib/oura-ble/plugin'
import type { PluginListenerHandle } from '@capacitor/core'
import { latestBpmFromFrames } from '@/lib/live-hr/decode-live-hr'
import type { LiveHrSample, LiveHrSource, SourceConnectionState } from '@/lib/live-hr/types'

export class OuraRingSource implements LiveHrSource {
  readonly id = 'oura_ble' as const
  private state: SourceConnectionState = 'disconnected'
  private listeners: Array<(s: Omit<LiveHrSample, 'sourceId'>) => void> = []
  private handles: PluginListenerHandle[] = []

  connectionState(): SourceConnectionState {
    return this.state
  }

  subscribe(cb: (s: Omit<LiveHrSample, 'sourceId'>) => void): () => void {
    this.listeners.push(cb)
    return () => { this.listeners = this.listeners.filter(l => l !== cb) }
  }

  private emitFrames(frames: OuraFrameEvent[]) {
    const bpm = latestBpmFromFrames(frames.map(f => f.hex))
    if (bpm == null) return
    const sample = { bpm, at: Date.now() }
    this.state = 'connected'
    for (const l of this.listeners) l(sample)
  }

  async start(): Promise<void> {
    const ble = await getOuraBle()
    if (!ble) { this.state = 'disconnected'; return } // web sandbox / old APK — inert
    this.state = 'connecting'
    try {
      this.handles.push(await ble.plugin.addListener('ouraFrames', d => this.emitFrames(d.frames)))
      this.handles.push(await ble.plugin.addListener('ouraFrame', d => this.emitFrames([d])))
      await ble.plugin.startLiveHr()
    } catch {
      this.state = 'disconnected'
    }
  }

  async stop(): Promise<void> {
    const ble = await getOuraBle()
    try { await ble?.plugin.stopLiveHr() } catch { /* ring/service gone — nothing to stop */ }
    for (const h of this.handles) { try { await h.remove() } catch { /* already removed */ } }
    this.handles = []
    this.listeners = []
    this.state = 'disconnected'
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit 2>&1 | grep "oura-ring-source" || echo "clean"`
Expected: `clean`

- [ ] **Step 3: Commit**

```bash
git add lib/live-hr/oura-ring-source.ts
git commit -m "Add OuraRingSource live-HR source"
```

---

### Task 4: liveHrManager (precedence + current-sample store)

**Files:**
- Create: `lib/live-hr/manager.ts`
- Test: `lib/live-hr/__tests__/manager.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/live-hr/__tests__/manager.test.ts
import { describe, it, expect } from 'vitest'
import { createLiveHrManager } from '@/lib/live-hr/manager'
import type { LiveHrSample, LiveHrSource, LiveHrSourceId, SourceConnectionState } from '@/lib/live-hr/types'

// A fake source the test can drive: push samples + flip connection state.
function fakeSource(id: LiveHrSourceId, state: SourceConnectionState = 'connected') {
  let cb: ((s: Omit<LiveHrSample, 'sourceId'>) => void) | null = null
  const src: LiveHrSource = {
    id,
    connectionState: () => state,
    start: async () => {},
    stop: async () => {},
    subscribe: (fn) => { cb = fn; return () => { cb = null } },
  }
  return { src, push: (bpm: number, at = 1) => cb?.({ bpm, at }), setState: (s: SourceConnectionState) => { state = s } }
}

describe('liveHrManager', () => {
  it('stores the latest sample and notifies subscribers', async () => {
    const ring = fakeSource('oura_ble')
    const mgr = createLiveHrManager([ring.src])
    const seen: number[] = []
    mgr.subscribe(s => seen.push(s.bpm))
    await mgr.start()
    ring.push(88, 100)
    expect(mgr.getCurrent()).toEqual({ bpm: 88, at: 100, sourceId: 'oura_ble' })
    expect(seen).toEqual([88])
  })

  it('prefers the chest strap over the ring when both are connected', async () => {
    const ring = fakeSource('oura_ble', 'connected')
    const strap = fakeSource('chest_strap', 'connected')
    // Registration order is precedence order: strap first.
    const mgr = createLiveHrManager([strap.src, ring.src])
    await mgr.start()
    expect(mgr.activeSourceId()).toBe('chest_strap')
  })

  it('falls back to the ring when the strap is disconnected', async () => {
    const ring = fakeSource('oura_ble', 'connected')
    const strap = fakeSource('chest_strap', 'disconnected')
    const mgr = createLiveHrManager([strap.src, ring.src])
    await mgr.start()
    expect(mgr.activeSourceId()).toBe('oura_ble')
  })

  it('clears the current sample on stop', async () => {
    const ring = fakeSource('oura_ble')
    const mgr = createLiveHrManager([ring.src])
    await mgr.start()
    ring.push(90)
    await mgr.stop()
    expect(mgr.getCurrent()).toEqual({ bpm: null, at: null, sourceId: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/live-hr/__tests__/manager.test.ts`
Expected: FAIL — `Cannot find module '@/lib/live-hr/manager'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/live-hr/manager.ts
// Owns the set of live-HR sources, picks one active source by precedence
// (registration order = precedence; chest strap registered before the ring),
// starts/stops them, and exposes a single current-sample stream to the UI.
import type { LiveHrCurrent, LiveHrSample, LiveHrSource, LiveHrSourceId } from '@/lib/live-hr/types'

export interface LiveHrManager {
  start(): Promise<void>
  stop(): Promise<void>
  subscribe(cb: (s: LiveHrSample) => void): () => void
  getCurrent(): LiveHrCurrent
  activeSourceId(): LiveHrSourceId | null
}

export function createLiveHrManager(sources: LiveHrSource[]): LiveHrManager {
  let current: LiveHrCurrent = { bpm: null, at: null, sourceId: null }
  let subscribers: Array<(s: LiveHrSample) => void> = []
  let unsubs: Array<() => void> = []
  let running = false

  function activeSourceId(): LiveHrSourceId | null {
    // First (highest-precedence) source that isn't disconnected.
    const active = sources.find(s => s.connectionState() !== 'disconnected')
    return active?.id ?? null
  }

  return {
    activeSourceId,
    getCurrent: () => current,
    subscribe(cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter(s => s !== cb) }
    },
    async start() {
      if (running) return
      running = true
      for (const source of sources) {
        await source.start()
        unsubs.push(source.subscribe(sample => {
          // Only surface the highest-precedence connected source's beats.
          if (activeSourceId() !== source.id) return
          current = { ...sample, sourceId: source.id }
          const full: LiveHrSample = { ...sample, sourceId: source.id }
          for (const cb of subscribers) cb(full)
        }))
      }
    },
    async stop() {
      running = false
      for (const u of unsubs) u()
      unsubs = []
      for (const source of sources) { try { await source.stop() } catch { /* best effort */ } }
      current = { bpm: null, at: null, sourceId: null }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/live-hr/__tests__/manager.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/manager.ts lib/live-hr/__tests__/manager.test.ts
git commit -m "Add liveHrManager with source precedence"
```

---

### Task 5: Shared singleton + useLiveHr hook

**Files:**
- Modify: `lib/live-hr/manager.ts` (append the app singleton)
- Create: `lib/live-hr/use-live-hr.ts`

- [ ] **Step 1: Append the app singleton to the manager module**

First add the import to the **top** of `lib/live-hr/manager.ts`, next to the existing
`import type` line (a mid-file `import` fails eslint `import/first`):

```typescript
import { OuraRingSource } from '@/lib/live-hr/oura-ring-source'
```

Then add to the **end** of `lib/live-hr/manager.ts`:

```typescript
// App-wide singleton. Plan 1 registers the ring only; Plan 3 will unshift a
// ChestStrapSource ahead of it (registration order = precedence).
let appManager: LiveHrManager | null = null
export function getLiveHrManager(): LiveHrManager {
  if (!appManager) appManager = createLiveHrManager([new OuraRingSource()])
  return appManager
}
```

- [ ] **Step 2: Write the hook**

```typescript
// lib/live-hr/use-live-hr.ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import type { LiveHrSourceId } from '@/lib/live-hr/types'

const STALE_MS = 8_000

export interface UseLiveHr {
  bpm: number | null
  at: number | null
  sourceId: LiveHrSourceId | null
  /** True once we've received at least one sample and it isn't stale. */
  live: boolean
}

/**
 * Read-only view of the live-HR stream. Does NOT start/stop the manager — the
 * workout/activity screen owns that lifecycle. Recomputes staleness on a 1 Hz
 * tick; safe to call in a leaf component (this hook IS the leaf's only timer).
 */
export function useLiveHr(): UseLiveHr {
  const [bpm, setBpm] = useState<number | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [sourceId, setSourceId] = useState<LiveHrSourceId | null>(null)
  const [now, setNow] = useState<number>(() => Date.now())
  const atRef = useRef<number | null>(null)

  useEffect(() => {
    const mgr = getLiveHrManager()
    const seed = mgr.getCurrent()
    setBpm(seed.bpm); setAt(seed.at); setSourceId(seed.sourceId); atRef.current = seed.at
    const unsub = mgr.subscribe(s => {
      setBpm(s.bpm); setAt(s.at); setSourceId(s.sourceId); atRef.current = s.at
    })
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { unsub(); clearInterval(tick) }
  }, [])

  const live = bpm != null && at != null && now - at < STALE_MS
  return { bpm: live ? bpm : null, at, sourceId, live }
}
```

- [ ] **Step 3: Verify it typechecks and existing manager tests still pass**

Run: `npx tsc --noEmit 2>&1 | grep -E "live-hr/(manager|use-live-hr)" || echo "clean"`
Expected: `clean`

Run: `npx vitest run lib/live-hr/__tests__/manager.test.ts`
Expected: PASS (4 tests — the appended singleton import must not break them)

- [ ] **Step 4: Commit**

```bash
git add lib/live-hr/manager.ts lib/live-hr/use-live-hr.ts
git commit -m "Add live-HR app singleton and useLiveHr hook"
```

---

### Task 6: LiveHrReadout leaf component

**Files:**
- Create: `components/workout/live-hr-readout.tsx`

- [ ] **Step 1: Write the component**

```tsx
// components/workout/live-hr-readout.tsx
'use client'
import { memo, useEffect, useRef, useState } from 'react'
import { HeartPulseIcon } from 'lucide-react'
import { Sparkline } from '@/components/ui/sparkline'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'

const MAX_POINTS = 40

// Leaf-scoped: this component owns the live-HR subscription + its own rolling
// buffer, so new beats re-render only this readout, never the workout screen.
function LiveHrReadoutInner({ className }: { className?: string }) {
  const { bpm, live } = useLiveHr()
  const [points, setPoints] = useState<number[]>([])
  const lastAt = useRef(0)

  useEffect(() => {
    if (bpm == null) return
    const now = Date.now()
    if (now - lastAt.current < 500) return // cap buffer growth on bursty frames
    lastAt.current = now
    setPoints(prev => [...prev, bpm].slice(-MAX_POINTS))
  }, [bpm])

  return (
    <div className={`rounded-2xl bg-muted/40 border border-border px-4 py-3 ${className ?? ''}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <HeartPulseIcon className="h-3.5 w-3.5" /> Live HR
        </span>
        <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--color-brand)' }}>
          {live && bpm != null ? bpm : '—'}
          <span className="ml-1 text-[10px] font-medium text-muted-foreground">bpm</span>
        </span>
      </div>
      {points.length >= 2 ? (
        <div className="mt-2">
          <Sparkline values={points} color="rgb(239 68 68)" fill responsive height={36} />
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {live ? 'Reading…' : 'Waiting for your ring — worn & moving wakes the sensor'}
        </p>
      )}
    </div>
  )
}

export const LiveHrReadout = memo(LiveHrReadoutInner)
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `npx tsc --noEmit 2>&1 | grep "live-hr-readout" || echo "clean"`
Expected: `clean`

Run: `npx eslint components/workout/live-hr-readout.tsx`
Expected: no output (clean)

- [ ] **Step 3: Commit**

```bash
git add components/workout/live-hr-readout.tsx
git commit -m "Add LiveHrReadout leaf component"
```

---

### Task 7: Wire the live-HR lifecycle into the workout screen

**Files:**
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Add the import**

Near the other `@/lib` imports at the top of `components/workout-screen.tsx`, add:

```typescript
import { getLiveHrManager } from "@/lib/live-hr/manager";
```

- [ ] **Step 2: Add the lifecycle effect**

Inside the `WorkoutScreen` component body, alongside the other `useEffect`s (e.g. after the rest-notification effects, ~line 386), add:

```typescript
// Live HR runs while the workout is physically underway (warmup → active → the
// per-exercise summary), and stops on pre/done and unmount to spare the ring.
// It only does real work on-device with a connected ring; a no-op otherwise.
const liveHrRun =
  store.mode === "warmup" || store.mode === "active" || store.mode === "exercise-summary";
useEffect(() => {
  const mgr = getLiveHrManager();
  if (liveHrRun) {
    mgr.start().catch(() => {});
    return () => { mgr.stop().catch(() => {}); };
  }
  return;
}, [liveHrRun]);
```

- [ ] **Step 3: Verify `store.mode` values match**

Run: `grep -nE "setMode\((\"|')(warmup|active|exercise-summary|pre|done)" components/workout-screen.tsx | head`
Expected: confirms `"warmup"`, `"active"`, `"exercise-summary"` are real modes used in this file. (If `"warmup"` is not a mode in this codebase, drop it from `liveHrRun` — the modes actually set here are authoritative.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "workout-screen" || echo "clean"`
Expected: `clean`

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "Start/stop live HR with the workout lifecycle"
```

---

### Task 8: Render the readout on the rest + summary screens

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`
- Modify: `components/workout/exercise-summary-screen.tsx`

- [ ] **Step 1: Import into the active-workout screen**

Near the top imports of `components/workout/active-workout-screen.tsx`, add:

```typescript
import { LiveHrReadout } from "@/components/workout/live-hr-readout";
```

- [ ] **Step 2: Render it in the rest-phase block**

Find the rest-phase block (anchor ~line 646: `{workoutPhase === "rest" && !allSetsLogged && (`). Immediately inside that block, above the rest timer markup, add:

```tsx
<LiveHrReadout className="mb-3 w-full max-w-xs" />
```

- [ ] **Step 3: Import into the exercise-summary screen**

Near the top imports of `components/workout/exercise-summary-screen.tsx`, add:

```typescript
import { LiveHrReadout } from "@/components/workout/live-hr-readout";
```

- [ ] **Step 4: Render it near the top of the summary body**

After the summary header (the exercise name / `ChevronLeftIcon` row), add:

```tsx
<LiveHrReadout className="mb-4" />
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep -E "active-workout-screen|exercise-summary-screen" || echo "clean"`
Expected: `clean`

Run: `npx eslint components/workout/active-workout-screen.tsx components/workout/exercise-summary-screen.tsx`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add components/workout/active-workout-screen.tsx components/workout/exercise-summary-screen.tsx
git commit -m "Show live HR on rest and exercise-summary screens"
```

---

### Task 9: Full gate + docs + version

**Files:**
- Modify: `package.json`, `lib/changelog.ts`, `docs/overview/history-current.md`, `projectOverview.md`

- [ ] **Step 1: Run the full local gate**

Run: `npx tsc --noEmit && npx eslint lib/live-hr components/workout/live-hr-readout.tsx && npx vitest run lib/live-hr`
Expected: typecheck clean, lint clean, all live-hr tests PASS (9 tests across 2 files).

- [ ] **Step 2: Bump the version**

In `package.json`, bump `"version"` by a patch (e.g. `1.120.5` → `1.120.6`).

- [ ] **Step 3: Add a changelog entry**

Prepend to the `CHANGELOG` array in `lib/changelog.ts` (match the existing object shape; user-facing wording, no internals):

```typescript
{
  version: "1.120.6",
  date: "2026-07-08",
  changes: [
    "Added a live heart-rate readout on the rest and exercise-summary screens during a workout, so you can watch your heart rate recover between sets. It reads directly from your ring; if the ring isn't streaming it simply shows a dash.",
  ],
},
```

- [ ] **Step 4: Write the journal + index note**

Prepend a session block to `docs/overview/history-current.md` (newest at top) summarising: the source-agnostic live-HR layer (`lib/live-hr/*`), the JS-decode approach (no APK rebuild — supersedes the spec's native-event assumption), the lifting rest/summary display, and that the live data path is on-device-only (sandbox shows "—"). Update the `projectOverview.md` Current Status block (version + one-line summary).

- [ ] **Step 5: Commit**

```bash
git add package.json lib/changelog.ts docs/overview/history-current.md projectOverview.md
git commit -m "Live HR on lifting screens: version bump + journal"
```

- [ ] **Step 6: Push**

```bash
git push -u origin claude/workout-hr-chart-lt0lw8
```

---

## Verification summary (what to check, and where it can't be checked)

- **Automated (sandbox):** `npx tsc --noEmit`, `npx eslint lib/live-hr components/workout/live-hr-readout.tsx`, `npx vitest run lib/live-hr` — all green. These cover the decode math and the manager precedence/staleness.
- **Dev server (sandbox):** `pnpm dev`, start a workout → the rest and exercise-summary screens render the "Live HR" card showing "—" / "Waiting for your ring" (no native bridge in the browser). This confirms the degraded state and that nothing throws.
- **On-device (authoritative — required before "done"):** with the APK + a worn, connected ring, start a workout and confirm a live BPM appears on the rest screen and updates, the rolling sparkline fills, it stops on finish, and the existing done-screen per-set HR summary still populates. Run `docs/device-smoke-checklist.md`. If no device is available in-session, add a `projectOverview.md` Known-Issues row marking the live path NOT device-verified.

## Notes for the implementer

- **Do not** add an `ouraLiveHr` native event or touch any Kotlin — this plan is JS/server only (see the spec note above). If you find yourself editing `android/`, stop: that belongs to a later optimisation, not Plan 1.
- The per-set end-of-session summary is **already** fed by the ring frames the service ingests during the session (the samples ingest route triggers `aggregateOuraRawSamples`); Plan 1 changes nothing there. Just verify it still populates on-device.
- Keep `LiveHrReadout` a leaf that calls `useLiveHr()` itself — never lift the hook into `workout-screen.tsx` and thread `bpm` down as a prop, or every beat re-renders the whole ~1,000-line workout screen (render-discipline rule).
```
