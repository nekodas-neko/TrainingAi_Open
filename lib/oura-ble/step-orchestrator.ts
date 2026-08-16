/**
 * Effectful shell for the step orchestrator (Chunk B of the step-orchestration plan).
 * Owns the plugin listeners, the accel counter, timers, and the POST — all decisions
 * are delegated to the pure core (`step-orchestrator-core.ts`), which is what's unit
 * tested. Mounted once (native-only, guarded) from `components/sync-provider.tsx`.
 *
 * Honest coverage limit: this only runs while the WebView is alive. A pocket walk
 * with the app killed stays on the Tier-1 gate estimate (Chunk C, native, is the fix).
 */
import { getOuraBle, type OuraFrameEvent, type OuraBlePlugin } from './plugin'
import { hexToBytes } from './decode'
import { decodeAccelFrame, StepPeakCounter, ACCEL_FRAME_TAG } from './accel'
import { countGaitGatedSteps } from './gait-step-count'
import { disableAutoMeasurements, restoreAutoMeasurements, isAutoCaptureEnabled } from './accel-capture'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { subscribeGateFeed } from './gate-feed'
import {
  initialSnapshot, onGateWindow, onDisconnect, forceStart, forceStop,
  type OrchestratorSnapshot, type OrchestratorEffect, type GateWindow,
} from './step-orchestrator-core'

const REARM_MS = 4 * 60 * 1000
// Chunk 1b — automatic accel capture. A detected walk (gate feed) opens a bounded
// capture window: disable the ring's automatic measurements so 0x33 streams, buffer the
// magnitudes, gait-count them, then restore the measurements. The window is time-capped
// because with the measurements OFF no gate frames arrive to signal the walk's end.
const CAPTURE_CAP_MS = 60_000
const DEFAULT_ACCEL_RATE_HZ = 50

export interface StepOrchestratorStatus {
  state: OrchestratorSnapshot['state']
  countingSteps: number
  lastPosted: { startDs: number; endDs: number; steps: number } | null
}

export interface StepOrchestrator {
  /** Mount the listeners (idempotent; no-op on web / old APKs). */
  start(): Promise<void>
  /** Unmount the listeners. */
  stop(): void
  subscribe(cb: (status: StepOrchestratorStatus) => void): () => void
  getStatus(): StepOrchestratorStatus
  /** Explicit trigger for a future guided-walk feature — bypasses the gate. */
  startTrackedWalk(): void
  stopTrackedWalk(): void
}

// localStorage retry buffer for windows whose POST failed, mirroring the manual tester's pattern
// (components/oura-ble/live-step-test.tsx). The server's `(user_id, start_ds)` unique key makes a
// re-post of an already-saved window a harmless idempotent no-op, so flushing is safe to retry
// blindly. Full outbox-domain machinery is overkill for this best-effort auto-post — a missed
// window is still recovered by the next drain's gate estimate for that span either way.
const PENDING_KEY = 'ta-oura-ble-pending-live-steps-auto'
type PendingWindow = { startDs: number; endDs: number; steps: number }

function readPendingWindows(): PendingWindow[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') } catch { return [] }
}
function writePendingWindows(items: PendingWindow[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(items)) } catch { /* storage unavailable */ }
}

async function postWindowOnce(window: PendingWindow): Promise<boolean> {
  try {
    const res = await fetch('/api/oura-ble/live-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(window),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Post one window; on failure, queue it in the retry buffer instead of silently dropping it. */
async function postWindow(window: PendingWindow): Promise<boolean> {
  const ok = await postWindowOnce(window)
  if (!ok) writePendingWindows([...readPendingWindows(), window])
  return ok
}

/** Flush the retry buffer — call on mount and after every successful post. */
async function flushPendingWindows(): Promise<void> {
  const pending = readPendingWindows()
  if (pending.length === 0) return
  writePendingWindows([]) // clear first: a window that fails again re-queues itself below
  for (const w of pending) {
    if (!(await postWindowOnce(w))) writePendingWindows([...readPendingWindows(), w])
  }
}

export function createStepOrchestrator(): StepOrchestrator {
  let snapshot = initialSnapshot()
  let lastPosted: StepOrchestratorStatus['lastPosted'] = null
  const counter = new StepPeakCounter()
  let subscribers: Array<(s: StepOrchestratorStatus) => void> = []
  let rearmTimer: ReturnType<typeof setInterval> | null = null
  let handles: Array<{ remove: () => Promise<void> }> = []
  let pluginRef: OuraBlePlugin | null = null
  let unsubGateFeed: (() => void) | null = null
  // Auto-capture (Chunk 1b) state — only used while isAutoCaptureEnabled().
  let capturing = false
  let captureBuf: number[] = []
  let captureRate = DEFAULT_ACCEL_RATE_HZ
  let captureCapTimer: ReturnType<typeof setTimeout> | null = null

  // Load-bearing: never leave the ring's automatic measurements off. Called on every
  // capture end AND on stop()/unmount, idempotently.
  function endCaptureCleanup() {
    if (captureCapTimer) { clearTimeout(captureCapTimer); captureCapTimer = null }
    if (capturing) {
      capturing = false
      if (pluginRef) void restoreAutoMeasurements(pluginRef)
    }
  }

  function currentStatus(): StepOrchestratorStatus {
    return {
      state: snapshot.state,
      countingSteps: snapshot.state === 'counting' ? counter.count : 0,
      lastPosted,
    }
  }

  function notify() {
    const status = currentStatus()
    for (const cb of subscribers) cb(status)
  }

  function beginAutoCapture() {
    capturing = true
    captureBuf = []
    captureRate = DEFAULT_ACCEL_RATE_HZ
    // Disable the automatic measurements (they preempt 0x33), then start the stream.
    const p = pluginRef
    if (p) void (async () => { await disableAutoMeasurements(p); await p.startAccel().catch(() => {}) })()
    if (captureCapTimer) clearTimeout(captureCapTimer)
    captureCapTimer = setTimeout(() => {
      // No gate frames arrive while measurements are off, so a time cap ends the window
      // (via the same forceStop path the core uses).
      const { snapshot: next, effects } = forceStop(snapshot, { nowMs: Date.now() })
      snapshot = next
      applyEffects(effects)
      notify()
    }, CAPTURE_CAP_MS)
  }

  function applyEffects(effects: OrchestratorEffect[]) {
    for (const eff of effects) {
      if (eff.type === 'startAccel') {
        counter.reset()
        // Cleared per BURST now that every post is gait-gated from this buffer — otherwise a
        // second burst would re-count the first one's magnitudes.
        captureBuf = []
        captureRate = DEFAULT_ACCEL_RATE_HZ
        if (isAutoCaptureEnabled()) {
          beginAutoCapture()
        } else {
          void pluginRef?.startAccel().catch(() => {})
        }
        if (rearmTimer) clearInterval(rearmTimer)
        rearmTimer = setInterval(() => {
          if (snapshot.state === 'counting') void pluginRef?.startAccel().catch(() => {})
        }, REARM_MS)
      } else if (eff.type === 'stopAndPost') {
        if (rearmTimer) { clearInterval(rearmTimer); rearmTimer = null }
        void pluginRef?.stopAccel().catch(() => {})
        // Gait-gate the posted count. `counter.count` is a NAIVE peak counter — accurate on real
        // walking (30 real → 31 counted) but it also counts irregular hand motion: the owner's
        // capture peak-counted **114 "steps" over 61 s of cooking with zero real steps**
        // (see lib/oura-ble/gait-step-count.ts). That is ~112 steps/min, which sits comfortably
        // UNDER the cadence ceiling, so `isPlausibleStepWindow` cannot catch it — a plausible-looking
        // phantom count that then OVERRIDES the ring's own model for the span.
        //
        // Until now gating only ran when auto-capture was on, and that is off by default
        // (`isAutoCaptureEnabled` reads a localStorage flag), so the default path posted the
        // ungated count. countGaitGatedSteps is documented as "the ONE place walking is separated
        // from non-walk hand motion" — so use it for every posted window. `counter.count` stays as
        // the live on-screen number only.
        const steps = countGaitGatedSteps(captureBuf, captureRate)
        // The window MUST span the data the count came from. `eff.endDs` is derived from the GATE
        // stream (0x7e/0x7f), which stalls whenever the ring power-gates its radio or automatic
        // measurements are off — while the 0x33 accel stream keeps feeding the counter. Pairing the
        // two produced the 2026-07-28 over-count: 3,605 steps, which need ~21 min of accel by the
        // refractory bound, posted over a 12.5-minute gate-derived window (289 steps/min). On
        // disconnect with no gate frames at all the window collapses to 30 s for a whole burst.
        //
        // So take the counter's own elapsed accel time, and only fall back to the gate-derived end
        // when no rate byte was ever seen (nothing to measure the count against). Whichever is
        // LONGER wins: the gate end can legitimately exceed the accel span when the accel stream
        // dropped out mid-burst, and over-stating the window only under-states cadence — the safe
        // direction. This is the same rule the capture path below already applies.
        const accelEndDs = counter.elapsedSec != null
          ? eff.startDs + Math.round(counter.elapsedSec * 10)
          : null
        const endDs = accelEndDs != null ? Math.max(eff.endDs, accelEndDs) : eff.endDs
        if (capturing) {
          // The count is already gait-gated above — this path only has to restore the ring's
          // automatic measurements. The window end needs no special case either: `accelEndDs` is
          // derived from the same buffer's duration, and no gate frames arrive while measurements
          // are off, so the max above already resolves to the capture span. (This branch used to
          // ASSIGN endDs, silently overriding that max — the comment claiming otherwise was wrong.)
          endCaptureCleanup() // restore measurements + clear cap timer (guaranteed)
        }
        if (steps > 0) {
          const window = { startDs: eff.startDs, endDs, steps }
          void postWindow(window).then(ok => {
            // Only reflect the window in the status once the POST actually succeeded — setting
            // it beforehand made the tester's status row show windows whose post silently failed.
            if (ok) { lastPosted = window; notify() }
          })
        }
      }
    }
  }

  function processGateWindow(window: GateWindow) {
    const liveHrActive = getLiveHrManager().isRunning()
    const { snapshot: next, effects } = onGateWindow(snapshot, window, { liveHrActive, nowMs: Date.now() })
    snapshot = next
    applyEffects(effects)
    notify()
  }

  // Only accel frames now — gate-frame (0x7e/0x7f) pairing/dedup lives in the
  // shared gate-feed so the step orchestrator and passive activity detection
  // don't each run their own pipeline off the same plugin listeners.
  function onFrames(events: OuraFrameEvent[]) {
    for (const f of events) {
      if (f.tag === ACCEL_FRAME_TAG && snapshot.state === 'counting') {
        const decoded = decodeAccelFrame(hexToBytes(f.hex))
        if (decoded) {
          counter.addFrame(decoded)
          // Buffered on EVERY burst, not just an auto-capture one: the posted count is now
          // gait-gated in both cases (see stopAndPost), and gating needs the raw magnitudes.
          if (decoded.sampleRate > 0) captureRate = decoded.sampleRate
          for (const s of decoded.samples) captureBuf.push(s.magnitude)
          notify()
        }
      }
    }
  }

  return {
    async start() {
      const ble = await getOuraBle()
      if (!ble) return
      void flushPendingWindows()
      pluginRef = ble.plugin
      handles.push(await ble.plugin.addListener('ouraFrame', (f) => onFrames([f])))
      handles.push(await ble.plugin.addListener('ouraFrames', ({ frames }) => onFrames(frames)))
      unsubGateFeed = await subscribeGateFeed((ev) => {
        if (ev.type === 'disconnect') {
          const { snapshot: next, effects } = onDisconnect(snapshot)
          snapshot = next
          applyEffects(effects)
          notify()
          return
        }
        processGateWindow({ ds: ev.ds, columns: ev.columns })
      })
    },
    stop() {
      endCaptureCleanup() // restore measurements if a capture was in flight (pluginRef still set)
      if (rearmTimer) { clearInterval(rearmTimer); rearmTimer = null }
      for (const h of handles) void h.remove().catch(() => {})
      handles = []
      unsubGateFeed?.()
      unsubGateFeed = null
      pluginRef = null
    },
    subscribe(cb) {
      subscribers.push(cb)
      return () => { subscribers = subscribers.filter((s) => s !== cb) }
    },
    getStatus: currentStatus,
    startTrackedWalk() {
      const liveHrActive = getLiveHrManager().isRunning()
      const { snapshot: next, effects } = forceStart(snapshot, { liveHrActive })
      snapshot = next
      applyEffects(effects)
      notify()
    },
    stopTrackedWalk() {
      const { snapshot: next, effects } = forceStop(snapshot, { nowMs: Date.now() })
      snapshot = next
      applyEffects(effects)
      notify()
    },
  }
}

let appOrchestrator: StepOrchestrator | null = null
export function getStepOrchestrator(): StepOrchestrator {
  if (!appOrchestrator) appOrchestrator = createStepOrchestrator()
  return appOrchestrator
}
