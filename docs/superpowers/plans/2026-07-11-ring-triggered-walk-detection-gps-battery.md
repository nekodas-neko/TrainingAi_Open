# Ring-Triggered Walk Detection + GPS Battery Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** make passive walk/run detection actually work again and stop it draining the phone
battery, ending at the owner's stated pipeline: *ring records movement → GPS turns on → enough
data confirms a walk → walk ends → GPS sleeps → walk is presented for review.*

**Architecture:** three chunks. Chunk 1 (JS, ships via Railway) gives the GPS watcher off-switches
that don't depend on WebView timers — the current probe-timeout and stall logic live in
`setInterval`/`setTimeout`, which Android throttles or suspends with the screen off while the GPS
foreground service keeps burning underneath. Chunk 2 (JS) replaces the phone's any-motion
significant-motion sensor with the ring's **walk-specific** col14 gate (the same paired
`0x7e`/`0x7f` windows the step orchestrator already consumes) as the GPS trigger, with the phone
sensor kept as a fallback when the ring is disconnected. Chunk 3 (native, deferred, own go/no-go)
moves the whole trigger→GPS→confirm→present loop into `OuraRingService` so it works with the
screen off and the WebView dead, sharing the Kotlin gate port already planned for the step
plan's Chunk C.

**Tech Stack:** existing pieces only — `lib/activity/*` (motion gate, GPS watcher, thresholds,
auto-detection store/service), `lib/oura-ble/*` (gate pairing, step orchestrator), Capacitor
`@capacitor/app` + `@capacitor-community/background-geolocation`, Kotlin `OuraRingService` (Chunk 3).

**Branch:** `feat/ring-triggered-walk-detection`
**Owner report (2026-07-11):** steps now accurate (±5% vs a Garmin over 12.5k steps) — but the
phone is chewing battery, and auto walk/run detection "hasn't been working since the latest fix".

> **Status (2026-07-11, session 274): Chunks 1 + 2 SHIPPED (v1.131.0).** `lib/activity/gps-watchdog.ts`
> (pure `evaluateWatchdog`, unit-tested) + wiring in `auto-detection-service.ts`/`auto-detection-store.ts`,
> and the shared `lib/oura-ble/gate-feed.ts` (`subscribeGateFeed`, unit-tested) driving GPS probing from
> the ring's walk gate. The Chunk 1/2 checkboxes below are left as historical detail — they are done.
> **Not exercised:** the on-device soak (a real walk presented, GPS actually turning off, battery) is
> owner-run. **Chunk 3 (native always-on) is DEFERRED** — do not start until Chunk 2 has soaked on-device.

---

## 0. Diagnosis — why the battery drains and why no walks appear

### Symptom A: battery drain (ranked causes)

1. **The GPS watcher's off-switches all live in throttled WebView JS (primary suspect).**
   `lib/activity/auto-detection-service.ts` enforces the 3-min probe timeout via a 30-s
   `setInterval` (`gateTicker`) and session end via a 3-min `setTimeout` (`stallTimer`). With the
   screen off / app backgrounded, Android throttles or fully suspends WebView timers — but the
   `@capacitor-community/background-geolocation` watcher is a **native foreground service** that
   keeps GPS hot regardless. One significant-motion fire with the screen off can therefore leave
   high-accuracy GPS running for hours. Nothing anywhere caps total watcher lifetime.
   Two aggravators:
   - **The "Allow all the time" grant made this reachable.** Until the v1.80.1 permission card got
     the owner to grant background location, every background GPS start failed — which
     accidentally protected the battery. Post-grant, background GPS actually runs.
   - **The phone's significant-motion sensor fires on *any* movement** — pocket jostle, picking
     the phone up, a car ride — so even when the timeouts work, each false fire costs ~3 min of
     high-accuracy GPS, many times a day.
2. **Deploy-reload orphaned watchers (needs on-device confirmation).** The APK is a remote-URL
   WebView; every Railway deploy reloads the page. A reload during `probing`/`tracking` throws
   away the JS module state (the `watcher` handle) without calling `removeWatcher`. If the
   plugin's native service keeps the watcher alive after a bridge reload, that's an unbounded GPS
   leak until the app is force-killed. Chunk 1's watchdog cannot fix an orphan (the JS handle is
   gone) — but its diagnostics row makes it visible, and Chunk 3 removes the JS watcher entirely.
3. **Bounded, known costs (not targets of this plan):** the ring's live-accel step bursts
   (20-min cap + 5-min cooldown, app-open only), hourly history drains, and the persistent BLE
   hold — all deliberately designed levers, see `docs/oura-ble-operations.md` §2.

**Owner checks that confirm/deny cause 1–2** (do these before/while Chunk 1 soaks):
- A persistent **"TrainingAI — Tracking your activity"** notification while *not* on a walk is the
  smoking gun for a wedged/orphaned watcher.
- Settings → Battery → TrainingAI: a large "Location" share implicates GPS; a modest steady share
  implicates the BLE service baseline instead.

### Symptom B: no walks presented anymore

Both sources of the "Walk detected" card are dead:

1. **Oura-Cloud detected workouts froze at the 2026-07-07 re-key.** The card
   (`components/activity/exercise-detected-card.tsx`) ingests `/api/oura/workouts?unreviewed=true`
   and fires a throttled `/api/oura/sync` — but the Oura Cloud has received no new ring data since
   the re-key, so no new detected workouts ever arrive. (That dead `/api/oura/sync` call was retired
   from the card in **v1.130.1, session 273** — the mount effect now reads a cached
   `oura-unreviewed-workouts` fetch, no Cloud sync. This §-2 phone-GPS path is what Chunk 1 fixes.)
   Before the re-key this
   source is what actually surfaced most walks, which is why detection "worked" until recently.
2. **The phone-GPS path rarely completes end-to-end in the background.** Even when the motion
   sensor fires and GPS starts, the walk is only *presented* when `endSession()` runs — and that
   is triggered by the same throttled timers as above. A session that never finalizes never
   reaches `pendingSessions`; on the next app launch the persisted in-flight session just lingers
   (only `isDetecting` is reset on rehydrate) and contaminates or gets discarded later. Separately,
   Android 12+ restricts starting a foreground service from the background — flagged as an open
   question in the session-179-era investigation and never re-tested since the always-on
   `OuraRingService` FGS changed the app's process state.

### Why the ring is the right trigger

- The col14 walk gate (paired `0x7e`/`0x7f`, ~30-s cadence) is **walk-specific** — calibrated on
  counted walks, never fires for desk activity or driving (`lib/health/step-estimate.ts`,
  v1.125.0). The phone sensor is any-motion. Fewer false triggers = less GPS = battery.
- The gate frames **already flow** — zero marginal ring or phone cost. While connected, the native
  service bridges them to JS continuously (that's what Chunk B of the step plan consumes).
- The ring's radio wakes on worn+moving, so starting a walk wakes the ring → connects → gate fires.
  Latency (reconnect + 30-s window cadence) trims the first ~1–2 min of the GPS route — acceptable;
  the step estimate covers the span regardless.

---

## 1. What already exists (reuse map)

| Piece | Where | State |
|---|---|---|
| Walk gate (col14 ≤ 20) + window pairing | `lib/health/step-estimate.ts` (`isWalkingWindow`), `lib/oura-ble/step-features.ts` (`pairStepFeatures`) | ✅ shipped, calibrated |
| Gate-frame consumption in JS | `lib/oura-ble/step-orchestrator.ts` (buffers + pairs `0x7e`/`0x7f` from `ouraFrame(s)` listeners) | ✅ shipped v1.128.0 — Chunk 2 extracts this into a shared feed |
| GPS on/off state machine | `lib/activity/motion-gate.ts` (pure reducer, tested) | ✅ keep — only its *evaluation occasions* change |
| GPS watcher | `lib/activity/gps-tracking.ts` | ✅ unchanged |
| Session confirm/quality gates | `lib/stores/auto-detection-store.ts` (`endSession` — min 750 m / 2.5 km/h / 7 min, motorised filters) | ✅ unchanged |
| Presentation + review | `exercise-detected-card.tsx` → `exercise-review-sheet.tsx` → activity log | ✅ unchanged until Chunk 3 |
| Phone significant-motion bridge | `lib/activity/motion-detection.ts` + `MainActivity.java` `MotionBridge` | ✅ becomes the fallback trigger |
| Native gate port (Kotlin unpack27 + col14) | planned in step-orchestration plan Chunk C | ⏳ shared deliverable with Chunk 3 here |

---

## 2. Chunk 1 — GPS watchdog: off-switches that don't need live timers (JS-only)

Principle: stop trusting timers; evaluate deadlines at the moments code **provably runs** — on
every GPS point (the background-geolocation FGS delivers these with the screen off), on every gate
tick (screen on), on every ring gate window (Chunk 2), and on Capacitor `resume`.

### Task 1.1: pure watchdog helper

**Files:**
- Create: `lib/activity/gps-watchdog.ts`
- Test: `lib/activity/__tests__/gps-watchdog.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateWatchdog, WATCHER_MAX_MS, PROBE_HARD_MAX_MS, STALL_GAP_MS } from '../gps-watchdog'

const base = { nowMs: 1_000_000_000, gpsStartedMs: null as number | null, lastPointMs: null as number | null, sessionActive: false }

describe('evaluateWatchdog', () => {
  it('is a no-op while GPS is off', () => {
    expect(evaluateWatchdog(base)).toEqual({ action: 'none' })
  })
  it('force-stops any watcher older than the absolute cap, even mid-session', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - WATCHER_MAX_MS - 1, lastPointMs: base.nowMs - 1000, sessionActive: true })
    expect(v).toEqual({ action: 'force-stop', reason: 'watcher-cap' })
  })
  it('force-stops a probe that outlived the hard probe cap without confirming a session', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - PROBE_HARD_MAX_MS - 1 })
    expect(v).toEqual({ action: 'force-stop', reason: 'probe-timeout' })
  })
  it('leaves a young probe alone (the gate ticker owns the normal 3-min timeout)', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 60_000 })
    expect(v).toEqual({ action: 'none' })
  })
  it('ends a session whose last point is older than the stall gap', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 600_000, lastPointMs: base.nowMs - STALL_GAP_MS - 1, sessionActive: true })
    expect(v).toEqual({ action: 'end-session', reason: 'stall' })
  })
  it('does not end a session with fresh points', () => {
    const v = evaluateWatchdog({ ...base, gpsStartedMs: base.nowMs - 600_000, lastPointMs: base.nowMs - 30_000, sessionActive: true })
    expect(v).toEqual({ action: 'none' })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run lib/activity/__tests__/gps-watchdog.test.ts`
  → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Pure watchdog for the passive-detection GPS watcher. The motion gate's
// off-switches (probe timeout, stall timer) run in WebView timers, which
// Android throttles or suspends with the screen off while the GPS foreground
// service keeps running natively. This is evaluated at moments code provably
// DOES run — every GPS point, every gate tick, every ring gate window, and
// app resume — and decides from timestamps alone whether GPS must go off.
import { MAX_DURATION_SEC } from './detection-thresholds'
import { PROBE_TIMEOUT_MS } from './motion-gate'

/** Session-stall gap — mirrors SESSION_END_GAP_MS in auto-detection-service. */
export const STALL_GAP_MS = 3 * 60 * 1000
/** Grace past the gate's own probe timeout, so when timers ARE alive the
 *  gate's normal path wins and this never fires. */
export const PROBE_HARD_MAX_MS = PROBE_TIMEOUT_MS + 60 * 1000
/** Absolute cap on one continuous watcher run: longest valid activity + slack.
 *  Nothing legitimate survives this. */
export const WATCHER_MAX_MS = MAX_DURATION_SEC * 1000 + 30 * 60 * 1000

export interface WatchdogInput {
  nowMs: number
  /** When the watcher started; null = GPS off. */
  gpsStartedMs: number | null
  /** Wall-clock of the last GPS point this watcher run; null = none yet. */
  lastPointMs: number | null
  /** store.sessionStartMs !== null */
  sessionActive: boolean
}

export type WatchdogVerdict =
  | { action: 'none' }
  | { action: 'end-session'; reason: 'stall' }
  | { action: 'force-stop'; reason: 'probe-timeout' | 'watcher-cap' }

export function evaluateWatchdog(input: WatchdogInput): WatchdogVerdict {
  const { nowMs, gpsStartedMs, lastPointMs, sessionActive } = input
  if (gpsStartedMs === null) return { action: 'none' }
  if (nowMs - gpsStartedMs > WATCHER_MAX_MS) return { action: 'force-stop', reason: 'watcher-cap' }
  if (!sessionActive && nowMs - gpsStartedMs > PROBE_HARD_MAX_MS) {
    return { action: 'force-stop', reason: 'probe-timeout' }
  }
  if (sessionActive && lastPointMs !== null && nowMs - lastPointMs > STALL_GAP_MS) {
    return { action: 'end-session', reason: 'stall' }
  }
  return { action: 'none' }
}
```

`PROBE_TIMEOUT_MS` is already exported from `motion-gate.ts`. `MAX_DURATION_SEC` is already
exported from `detection-thresholds.ts` (3 h) → `WATCHER_MAX_MS` = 3.5 h.

- [ ] **Step 4: Run tests** — same command, expect 6 PASS.
- [ ] **Step 5: Commit** — `git add lib/activity/gps-watchdog.ts lib/activity/__tests__/gps-watchdog.test.ts && git commit -m "feat: pure GPS watchdog for passive detection"`

### Task 1.2: wire the watchdog into the service

**Files:**
- Modify: `lib/activity/auto-detection-service.ts`

- [ ] **Step 1: add tracking state + `runWatchdog`**

Add module vars next to `watcher` (line ~28) and the helper:

```ts
import { evaluateWatchdog } from './gps-watchdog'
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'

let gpsStartedMs: number | null = null
let lastPointMs: number | null = null
let resumeHandle: PluginListenerHandle | null = null

// Evaluates the timer-independent off-switches. Called from every occasion
// code is known to run: each GPS point, each gate tick, ring gate windows
// (Chunk 2), and app resume. In ungated (web fallback) mode GPS is always-on
// by design, so the watchdog does not apply.
function runWatchdog(now: number): void {
  if (ungated || !watcher) return
  const verdict = evaluateWatchdog({
    nowMs: now,
    gpsStartedMs,
    lastPointMs,
    sessionActive: useAutoDetectionStore.getState().sessionStartMs !== null,
  })
  if (verdict.action === 'none') return
  const store = useAutoDetectionStore.getState()
  if (store.sessionStartMs !== null) store.endSession()
  // 'sessionEnded' collapses probing OR tracking back to idle:
  // stopGps + re-arm the motion trigger.
  dispatchGate({ type: 'sessionEnded' })
}
```

- [ ] **Step 2: stamp the state in `startGps`/`stopGps`**

```ts
async function startGps(): Promise<void> {
  if (watcher) return
  recentPoints.length = 0
  lastPointMs = null
  watcher = await startGpsWatcher(onPoint, onWatcherError)
  gpsStartedMs = Date.now()
}

async function stopGps(): Promise<void> {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  if (watcher) { await watcher.stop(); watcher = null }
  gpsStartedMs = null
  lastPointMs = null
  recentPoints.length = 0
}
```

- [ ] **Step 3: evaluate in `onPoint` — watchdog FIRST, with the previous `lastPointMs`**

At the top of `onPoint`, before the existing error-clear logic:

```ts
function onPoint(point: RoutePoint) {
  const now = Date.now()
  // Evaluate with the PREVIOUS lastPointMs: a >3-min gap between points must
  // finalize the old session before this new point can contaminate it (the
  // stall timer that used to handle this doesn't fire when timers are
  // suspended in the background).
  runWatchdog(now)
  lastPointMs = now
  ...
```

Also make session confirmation idempotent against a mid-walk page reload (a persisted session with
a gate that never saw `sessionStarted` would otherwise be probe-timed-out): in the
`speed >= MIN_MOVE_SPEED_MS` branch, dispatch unconditionally — the reducer already ignores it
unless probing:

```ts
  if (speed >= MIN_MOVE_SPEED_MS) {
    if (store.sessionStartMs === null) store.startSession(point.t)
    dispatchGate({ type: 'sessionStarted' })
    store.addPoint(point)
  }
```

- [ ] **Step 4: evaluate on gate ticks and on app resume**

In `startAutoDetection`, extend the ticker and add the resume listener (before the
`isMotionDetectionAvailable()` branch, so it exists in both modes; the watchdog itself no-ops when
ungated):

```ts
  gateTicker = setInterval(() => {
    const now = Date.now()
    dispatchGate({ type: 'tick', now })
    runWatchdog(now)
  }, GATE_TICK_MS)

  resumeHandle = await App.addListener('resume', () => {
    const now = Date.now()
    dispatchGate({ type: 'tick', now })
    runWatchdog(now)
  })
```

Note the ticker moves out of the `isMotionDetectionAvailable()` branch so ticks also run in
ungated mode (harmless — `dispatchGate` early-returns there, `runWatchdog` no-ops). In
`stopAutoDetection`, remove the listener: `resumeHandle?.remove(); resumeHandle = null`.

- [ ] **Step 5: gate + full activity tests** — `pnpm vitest run lib/activity` → all pass;
  `pnpm exec tsc --noEmit` clean.
- [ ] **Step 6: Commit** — `git commit -m "fix: GPS off-switches no longer depend on throttled WebView timers"`

### Task 1.3: finalize (don't drop) a stale persisted session on rehydrate

A walk that ended because the app died should still be presented on next launch.

**Files:**
- Modify: `lib/stores/auto-detection-store.ts` (`onRehydrateStorage`)
- Test: `lib/stores/__tests__/auto-detection-store.test.ts` (extend)

- [ ] **Step 1: implement**

```ts
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.isDetecting = false
        // A persisted in-flight session whose last point is stale means the
        // app died mid/after-walk. Finalize it — endSession's own quality
        // gates decide whether it becomes a pending session — instead of
        // letting it linger and contaminate the next walk. A FRESH session
        // (reload mid-walk, e.g. a deploy) is left in place so tracking can
        // resume seamlessly.
        const pts = state.sessionPoints
        const lastT = pts.length ? pts[pts.length - 1].t : 0
        if (state.sessionStartMs !== null && Date.now() - lastT > 3 * 60 * 1000) {
          queueMicrotask(() => useAutoDetectionStore.getState().endSession())
        }
      },
```

(Reuse the literal 3-min gap; importing `STALL_GAP_MS` from `gps-watchdog.ts` is fine too — pick
one and keep the two in sync with a comment either way.)

- [ ] **Step 2: test** — seed the store with a ≥7-min, ≥750-m synthetic point trail whose last
  point is >3 min old, trigger rehydrate (call the exported store's persist API:
  `useAutoDetectionStore.persist.rehydrate()`), `await` a microtask, assert
  `pendingSessions.length === 1` and `sessionStartMs === null`. Add the inverse: fresh last point
  → session left in place.
- [ ] **Step 3: run** — `pnpm vitest run lib/stores/__tests__/auto-detection-store.test.ts` → pass.
- [ ] **Step 4: Commit** — `git commit -m "fix: recover walks interrupted by app death instead of dropping them"`

### Task 1.4: on-device observability

The wedge/orphan hypotheses in §0 need to be confirmable without adb.

**Files:**
- Modify: `lib/stores/auto-detection-store.ts` — add transient (non-persisted) diag state:
  `detectionDiag: { gateState: string; gpsSinceMs: number | null; lastPointMs: number | null; trigger: 'ring' | 'sensor' } | null`
  + `setDetectionDiag` action; exclude from `partialize` (same treatment as `detectionError`).
- Modify: `lib/activity/auto-detection-service.ts` — call `setDetectionDiag` on every gate
  transition and watchdog action (one small helper `publishDiag()` invoked from `runCommand`,
  `runWatchdog`, `startGps`/`stopGps`).
- Modify: `components/activity/background-location-card.tsx` — render one muted line when diag is
  non-null, e.g. `Detection: tracking · GPS on 12m · last fix 8s ago · trigger: ring`. This card
  already lives on the Profile screen; keep it text-only, no new UI primitives.

- [ ] Implement, `pnpm vitest run lib/activity lib/stores`, `pnpm exec tsc --noEmit`, commit
  `git commit -m "feat: passive-detection diagnostics row"`.

### Chunk 1 verification

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test` all green.
- [ ] `pnpm dev` smoke: web fallback path (no motion bridge → ungated always-on GPS) still works —
  the profile card renders, no console errors on `/session-select` and Profile.
- [ ] **On-device (owner):** after a real walk with screen off, the "Tracking your activity"
  notification must disappear within ~4 min of stopping; the walk appears on the card; battery
  page no longer shows runaway Location share. **This is the merge gate for the battery claim.**

---

## 3. Chunk 2 — the ring walk gate becomes the GPS trigger (JS-only)

### Task 2.1: extract a shared gate feed from the step orchestrator

Two consumers (step orchestrator, activity detection) must not each run their own
pairing/dedup pipeline off the plugin listeners.

**Files:**
- Create: `lib/oura-ble/gate-feed.ts`
- Modify: `lib/oura-ble/step-orchestrator.ts`
- Test: `lib/oura-ble/__tests__/gate-feed.test.ts`

- [ ] **Step 1: implement the feed** — move the gate-frame buffering/pairing verbatim from
  `step-orchestrator.ts` (`GATE_FRAME_TAGS`, `GATE_BUFFER_CAP`, the `gateBuffer` +
  `lastProcessedGateDs` logic in `onFrames`, and the `ouraStatus` disconnect mapping):

```ts
// Shared paired-gate-window feed. Single pipeline off the plugin's frame
// listeners; consumers: the step orchestrator (counting trigger) and passive
// activity detection (GPS trigger). First subscriber attaches the plugin
// listeners, last unsubscribe detaches them.
import { getOuraBle, type OuraFrameEvent, type OuraBleStatus } from './plugin'
import { historyEventFromHex, hexToBytes } from './decode'
import { pairStepFeatures, type StepFeatureFrame } from './step-features'
import { isWalkingWindow } from '@/lib/health/step-estimate'

export type GateFeedEvent =
  | { type: 'window'; ds: number; columns: number[]; walking: boolean }
  | { type: 'disconnect' }

type Listener = (ev: GateFeedEvent) => void

const GATE_FRAME_TAGS = new Set([0x7e, 0x7f])
const GATE_BUFFER_CAP = 40

let listeners: Listener[] = []
let handles: Array<{ remove: () => Promise<void> }> = []
const gateBuffer: StepFeatureFrame[] = []
let lastProcessedGateDs = -Infinity
let attaching: Promise<void> | null = null

function emit(ev: GateFeedEvent) { for (const l of listeners) l(ev) }

function onFrames(events: OuraFrameEvent[]) {
  let sawGate = false
  for (const f of events) {
    if (!GATE_FRAME_TAGS.has(f.tag)) continue
    const ev = historyEventFromHex(f.hex)
    if (!ev) continue
    gateBuffer.push({ ds: ev.timestampDs, tag: ev.tag, body: hexToBytes(ev.bodyHex) })
    if (gateBuffer.length > GATE_BUFFER_CAP) gateBuffer.splice(0, gateBuffer.length - GATE_BUFFER_CAP)
    sawGate = true
  }
  if (!sawGate) return
  for (const p of pairStepFeatures(gateBuffer)) {
    if (p.ds <= lastProcessedGateDs) continue
    lastProcessedGateDs = p.ds
    emit({ type: 'window', ds: p.ds, columns: p.columns, walking: isWalkingWindow(p.columns) })
  }
}

function onStatus(status: OuraBleStatus) {
  if (status.state === 'disconnected' || status.state === 'closed' || status.state === 'stopped') {
    emit({ type: 'disconnect' })
  }
}

async function attach(): Promise<void> {
  const ble = await getOuraBle()
  if (!ble) return
  handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
  handles.push(await ble.plugin.addListener('ouraFrames', ({ frames }) => onFrames(frames)))
  handles.push(await ble.plugin.addListener('ouraStatus', onStatus))
}

export async function subscribeGateFeed(cb: Listener): Promise<() => void> {
  listeners.push(cb)
  if (handles.length === 0 && !attaching) attaching = attach().finally(() => { attaching = null })
  if (attaching) await attaching
  return () => {
    listeners = listeners.filter((l) => l !== cb)
    if (listeners.length === 0) {
      for (const h of handles) void h.remove().catch(() => {})
      handles = []
    }
  }
}
```

- [ ] **Step 2: refactor `step-orchestrator.ts` onto the feed.** Its `start()` subscribes
  `subscribeGateFeed` for windows/disconnect (mapping `window` → `processGateWindow({ ds, columns })`
  and `disconnect` → the existing `onDisconnect` handling) and keeps **only** its own
  `ouraFrame`/`ouraFrames` listeners for accel frames (`ACCEL_FRAME_TAG` while counting). The
  pure core (`step-orchestrator-core.ts`) is untouched, so its 15 tests must pass unchanged. Note
  `isWalkingWindow` is now applied inside the feed; the core still re-derives it from `columns` —
  fine, keep the core's signature stable.
- [ ] **Step 3: test the feed's pairing/dedup** with the same synthetic `0x7e`/`0x7f` hex fixtures
  used in `lib/oura-ble/__tests__/` for step features (fake plugin object injected via a small
  `_test` export or by exporting `onFrames` for direct exercise — match the existing test style in
  that directory). Assert: pairs emit once, out-of-order re-delivery of the same ds is deduped,
  non-gate tags are ignored.
- [ ] **Step 4:** `pnpm vitest run lib/oura-ble` → all pass (including the untouched orchestrator
  core tests). `pnpm exec tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `git commit -m "refactor: shared paired-gate-window feed"`

### Task 2.2: ring trigger + sensor fallback in the detection service

**Files:**
- Modify: `lib/activity/auto-detection-service.ts`

- [ ] **Step 1: subscribe and switch trigger source**

```ts
import { subscribeGateFeed } from '@/lib/oura-ble/gate-feed'

let triggerSource: 'sensor' | 'ring' = 'sensor'
let unsubGateFeed: (() => void) | null = null
```

In `startAutoDetection` (gated branch only, after arming the sensor):

```ts
    unsubGateFeed = await subscribeGateFeed((ev) => {
      const now = Date.now()
      if (ev.type === 'disconnect') {
        // Ring gone — fall back to the phone's any-motion sensor.
        if (triggerSource === 'ring') {
          triggerSource = 'sensor'
          if (gate.state === 'idle') armMotionTrigger(onMotionTrigger)
        }
        return
      }
      // Any paired window proves the ring path is live: it is strictly the
      // better trigger (walk-specific vs any-motion), so the sensor is
      // disarmed to stop its false GPS probes.
      if (triggerSource === 'sensor') {
        triggerSource = 'ring'
        disarmMotionTrigger()
      }
      if (ev.walking) dispatchGate({ type: 'motionTrigger', now })
      runWatchdog(now)
    })
```

- [ ] **Step 2: make the gate's `armMotion` command respect the trigger source** — in
  `runCommand`:

```ts
    case 'armMotion':
      if (triggerSource === 'ring') break
      armMotionTrigger(onMotionTrigger)
      break
```

- [ ] **Step 3: clean up in `stopAutoDetection`**: `unsubGateFeed?.(); unsubGateFeed = null;
  triggerSource = 'sensor'`. Update Task 1.4's `publishDiag()` to report the live `triggerSource`.
- [ ] **Step 4: behaviour notes to encode as comments** (the *why* is non-obvious):
  - Repeated walking windows during `probing`/`tracking` are no-ops — the reducer only accepts
    `motionTrigger` when idle.
  - Non-walking windows do **not** end a session: GPS itself (stall + motorised checks + the
    watchdog) owns ending. A standing pause at a traffic light must not kill the walk. (A
    ring-idle early stop is a possible future battery lever — deliberately YAGNI'd here.)
  - Web / plugin-absent / old-APK: `subscribeGateFeed` resolves with no listeners attached
    (`getOuraBle()` returns null), so nothing changes on those platforms.
- [ ] **Step 5:** `pnpm lint && pnpm exec tsc --noEmit && pnpm test` green; `pnpm dev` smoke
  (web fallback unchanged). Commit — `git commit -m "feat: ring walk gate triggers GPS probing, phone sensor demoted to fallback"`
- [ ] **Step 6 (same PR): journal + overview + version bump** per CLAUDE.md end-of-session rules
  (minor bump — user-visible behaviour change; changelog entry: walk detection now triggered by
  the ring and GPS shuts off reliably).

### Chunk 2 verification

- [ ] Unit gates as above; the orchestrator's existing on-device soak (step plan Chunk B) keeps
  running unchanged — both consumers share one feed, verify the tester's step status row still
  transitions during a walk.
- [ ] **On-device (owner):** walk with the app open/recently-open: Profile diag row shows
  `trigger: ring`, GPS turns on within ~60 s of walking, card presents the walk after stopping.
  Pocket walk with the app killed: still NOT expected to work — that's Chunk 3, say so honestly
  in the session notes.

---

## 4. Chunk 3 — native always-on pipeline (deferred; own PR + go/no-go)

**Do not start until Chunk 2 has soaked on-device** — it proves the trigger heuristics and the
end-to-end present-for-review flow cheaply. This chunk is APK-rebuild + on-device work (the
highest-blind-risk kind in this codebase; BLE and GPS are both inert in-sandbox).

Scope (details to be finalized against the step plan's Chunk C, which shares deliverable 1):

1. **Kotlin gate port (shared with step plan Chunk C — implement once):** `unpack27` + pairing +
   col14 threshold in `OuraRingService`, JVM-tested against the same captured vectors as
   `lib/oura-ble/__tests__/step-features.test.ts`.
2. **Location from the existing service:** add `location` to `OuraRingService`'s
   `foregroundServiceType` (manifest already declares `FOREGROUND_SERVICE_LOCATION` for the
   geolocation plugin) and use `FusedLocationProviderClient` (`PRIORITY_HIGH_ACCURACY`, 5-s
   interval, 5-m min displacement) — started/stopped by the native gate. Because the service is
   *already* a running FGS, this sidesteps the Android 12+ background-FGS-start question entirely,
   and removes the JS watcher (and its orphan risk) from the passive path.
3. **Native session semantics:** port the confirm/end/quality rules — confirm at ≥0.8 m/s rolling
   avg; end on 3-min point gap OR 4 consecutive non-walking gate windows (~2 min) OR the caps;
   quality gates 750 m / 2.5 km/h / 7 min / max-speed + P80 motorised filter (mirror the constants
   from `lib/activity/detection-thresholds.ts` + `auto-detection-store.ts`, with a JVM parity test
   pinning the TS values so drift is caught).
4. **Server-side pending sessions:** migration `detected_activities` (**claim the next free
   number against the directory AND open plans at implementation time** — 119 is on disk, R4 holds
   118, so likely 120): `id uuid PK default gen_random_uuid(), user_id uuid NOT NULL REFERENCES
   users(id) ON DELETE CASCADE, start_ms bigint NOT NULL, end_ms bigint NOT NULL, route_polyline
   text NOT NULL DEFAULT '', distance_km real NOT NULL, duration_min real NOT NULL, activity_type
   text NOT NULL, source text NOT NULL, reviewed_at timestamptz, created_at timestamptz NOT NULL
   DEFAULT now(), UNIQUE (user_id, start_ms)`. Routes: `POST /api/activity/detected` (native-key
   auth via the same pattern as the BLE samples ingest; Zod at creation; standard rate limit;
   idempotent on the unique key) + GET unreviewed + PATCH review/dismiss. The card then reads
   server-side pending sessions (generalizing today's `/api/oura/workouts?unreviewed=true` read),
   JS-detected sessions also POST there so review state survives reinstalls, and the zustand
   `pendingSessions` store becomes the offline buffer rather than the source of truth.
5. **State which half each PR touches** (Kotlin needs owner rebuild; JS/server ships via Railway),
   and run `docs/device-smoke-checklist.md` as the merge gate.

---

## 5. What this plan does NOT own (cross-refs — don't duplicate)

| Concern | Owner |
|---|---|
| Retiring the card's dead `/api/oura/sync` Cloud call + BLE-drain rewiring | Home-page freshness plan (`2026-07-10-home-page-freshness-and-performance.md`) chunk 1 — if Chunk 3 here lands first, the card read moves server-side anyway; coordinate, implement once |
| Step counting orchestration + native gate port | Step-orchestration plan (`2026-07-10-oura-ble-step-orchestration.md`) — Chunk C's Kotlin gate port is a shared deliverable with Chunk 3 here |
| Guided interval walk (explicit tracked walks) | `2026-07-08-live-hr-plan-2-guided-interval-walk.md` — consumes `startTrackedWalk()`; later it can also force GPS via this pipeline |
| BLE drain cadence / burst battery levers | `docs/oura-ble-operations.md` §2 — deliberately untouched here |

## 6. Risks & honest expectations

- **Trigger latency:** ring reconnect (radio wakes on worn+moving) + the ~30-s gate cadence trims
  the first ~1–2 min of a walk's GPS route. Distance/duration quality gates still pass for any
  real walk; the step estimate covers the full span regardless.
- **WebView throttling behaviour is device/OEM-specific.** Chunk 1 makes it observable (diag row)
  rather than assuming; the watchdog is correct under *any* throttling because it evaluates on
  externally-driven callbacks (GPS points, BLE frames, resume).
- **The orphaned-watcher hypothesis (§0 A2) is unconfirmed** — if the owner still sees a stuck
  "Tracking your activity" notification after Chunk 1, that's the confirmation, and Chunk 3's
  removal of the JS watcher is the durable fix (an interim `stopGps()`-on-fresh-launch can't
  reach a watcher whose JS handle died with the previous page).
- **No-ring days:** the phone-sensor fallback keeps working exactly as today (with Chunk 1's
  watchdog bounding its battery cost).
- **Chunk 2 coverage is app-alive only** — same honest limit as the step orchestrator's Chunk B.
  Screen-off pocket walks with the app killed only work after Chunk 3.
