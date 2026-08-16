'use client'

import type { RoutePoint } from './route-encoding'
import { haversineDistanceKm, computeTotalDistanceKm } from './activity-metrics'
import { startGpsWatcher, type GpsWatcher } from './gps-tracking'
import { armMotionTrigger, disarmMotionTrigger, isMotionDetectionAvailable } from './motion-detection'
import {
  reduceGate,
  initGate,
  type MotionGateContext,
  type MotionGateCommand,
  type MotionGateEvent,
} from './motion-gate'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { evaluateWatchdog } from './gps-watchdog'
import { subscribeGateFeed } from '@/lib/oura-ble/gate-feed'
import { notifyActivityDetected, clearActivityDetected } from '@/lib/notifications'
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import {
  runStepsMotionDecoder,
  hasStepsDecoderConstants,
  STRIDE_FREQUENCY_COLUMN,
  STRIDE_AMPLITUDE_FRAC_COLUMN,
  TOTAL_AMPLITUDE_MG_COLUMN,
} from '@/lib/oura-models/steps-motion-decoder'
import { ensureStepsDecoderConstants } from './steps-decoder-constants-client'
import { classifyGait } from '@trainingai/shared/health/gait-classifier'
import { initGaitConfirm, pushGaitWindow, type GaitConfirmContext } from './gait-confirm'
import { useWorkoutStore } from '@/lib/stores/workout-store'
import type { WorkoutMode } from '@/components/workout/types'
import { useGuidedWalkStore, isGuidedWalkActive } from '@/lib/stores/guided-walk-store'
import { useActivityStore, isActivityActive } from '@/lib/stores/activity-store'

const MIN_MOVE_SPEED_MS = 0.8           // 2.9 km/h — below this = stationary noise
const SESSION_END_GAP_MS = 3 * 60 * 1000  // 3-min silence = session ended
const SPEED_BUFFER_SIZE = 5             // average speed over last N points
// If rolling-window avg speed exceeds this we're in a vehicle — end any active
// walking session immediately so the walk portion is saved before train GPS
// points contaminate it (a combined walk+train session would otherwise be
// discarded in full by the post-hoc P80 filter in endSession).
const REALTIME_MOTORISED_SPEED_MS = 7.5 // same threshold as MAX_SPEED_MS in store
// How often the probe-timeout tick is evaluated while GPS is on but no session
// has been confirmed yet.
const GATE_TICK_MS = 30 * 1000

// These gate only the "Activity detected" NOTIFICATION, not detection or saving.
// The save-path quality gates (detection-thresholds.ts, applied in endSession)
// stay authoritative for what gets persisted; these just stop indoor GPS drift
// during stationary training from posting a "Recording your walk or run" ping.
// A session starts (and records) on the first point over MIN_MOVE_SPEED_MS as
// before — the ping is simply held until the live session shows sustained
// movement: 200 m is well above indoor multipath drift and well below the 750 m
// save floor, so a genuine walk still pings early.
const NOTIFY_MIN_DISTANCE_M = 200
const NOTIFY_MIN_ELAPSED_SEC = 90

// A workout session in progress means any incidental ring/phone motion (pacing between sets,
// adjusting a bar, warmup arm swings) is training-related, not a real walk/run — and it is a
// far stronger, zero-guesswork signal than any cadence or speed threshold, since the app knows
// definitively (not probabilistically) when the user is mid-workout. Observed false positive:
// a "Sumo Deadlift" rest period sustained ~90s of ring cadence in the walk band, confirming a
// phantom walk via the AD-2 gait-confirm path (its Hz bands are still provisional/uncalibrated —
// see gait-classifier.ts — so they alone can't be trusted to reject this). Covers 'warmup',
// 'active', and 'exercise-summary' (still physically in the training space); 'pre' (not yet
// started) and 'done' (finished) are unaffected. Pure predicate, extracted so it's
// unit-testable without a device.
export function isWorkoutInProgress(mode: WorkoutMode): boolean {
  return mode !== 'pre' && mode !== 'done'
}

/**
 * Should an auto-detection session that is ALREADY under way be thrown away (Q-95-followup)?
 *
 * `dispatchGate` blocks a *new* `motionTrigger` while a Guided Walk / manual activity / lifting
 * workout is running, which stops a second session from arming. It does nothing about a session
 * that was already probing or tracking when that walk began — the shipped comment called that
 * "a narrow, low-risk edge case", and it is the case the owner then hit: the "Other Activity"
 * naming sheet opened by itself right as a Guided Walk finished, because the surviving session
 * finalized into a `pendingSessions` entry.
 *
 * The session is checked separately from the gate state because they can be non-idle
 * independently: in ungated (web-fallback) mode GPS is always on and the gate never leaves
 * 'idle', yet a session still accumulates and can still finalize.
 */
export function shouldAbortInFlightDetection(args: {
  gateIdle: boolean
  sessionActive: boolean
  workoutActive: boolean
  guidedWalkActive: boolean
  activityActive: boolean
}): boolean {
  if (args.gateIdle && !args.sessionActive) return false
  return args.workoutActive || args.guidedWalkActive || args.activityActive
}

// Pure predicate for the notification gate — extracted so the distance/elapsed
// logic is unit-testable without a device (native notifications + real GPS don't
// run in the web sandbox). Fires at most once per session (alreadyNotified latch).
export function shouldNotifyActivity(args: {
  distanceM: number
  elapsedSec: number
  alreadyNotified: boolean
}): boolean {
  return (
    !args.alreadyNotified &&
    args.distanceM >= NOTIFY_MIN_DISTANCE_M &&
    args.elapsedSec >= NOTIFY_MIN_ELAPSED_SEC
  )
}

/**
 * The same gate for AD-2's ring-confirm path (Q-68).
 *
 * AD-1's sensor-fallback path has run behind `shouldNotifyActivity` for a while, but the
 * ring-confirm path — the one actually active whenever the ring is connected, so the common case —
 * fired the notification the instant cadence confirmed, with no distance corroboration at all. The
 * owner saw "Recording your walk or run" in the same minute as a scale weigh-in.
 *
 * GPS corroboration is a **veto, not a requirement**, and the distinction is the whole design. A
 * genuine indoor walk can have no GPS fix whatsoever, and that is precisely the case AD-2 exists to
 * handle better than GPS — so "no points" must keep trusting the ring, unchanged. Only when GPS is
 * present AND says you did not really move does it override the cadence confirmation.
 *
 * Two points is the floor for judging: one point is a position, not a distance.
 */
export function shouldNotifyRingConfirmedActivity(args: {
  pointCount: number
  distanceM: number
  elapsedSec: number
  alreadyNotified: boolean
}): boolean {
  if (args.alreadyNotified) return false
  if (args.pointCount < 2) return true
  return shouldNotifyActivity({
    distanceM: args.distanceM,
    elapsedSec: args.elapsedSec,
    alreadyNotified: args.alreadyNotified,
  })
}

let watcher: GpsWatcher | null = null
let stallTimer: ReturnType<typeof setTimeout> | null = null
let gateTicker: ReturnType<typeof setInterval> | null = null
let running = false
// When true, the significant-motion sensor is unavailable and we fall back to
// the old always-on GPS behaviour (no battery gating, but detection still works).
let ungated = false
let gate: MotionGateContext = initGate()
const recentPoints: RoutePoint[] = []
// One-shot latch: the "Activity detected" ping fires at most once per session,
// once sustained movement is confirmed (see shouldNotifyActivity). Reset when a
// fresh GPS watcher starts so a second walk in the same detection run re-notifies.
let activityNotified = false

// Timer-independent watchdog state — see gps-watchdog.ts. The stallTimer/gateTicker
// above are the normal path; these off-switches fire from occasions code provably
// runs (GPS points, gate ticks, app resume) so they still work when Android throttles
// WebView timers with the screen off.
let gpsStartedMs: number | null = null
let lastPointMs: number | null = null
let resumeHandle: PluginListenerHandle | null = null

// Which signal is currently arming GPS probing. The ring's paired gate windows
// are walk-specific (vs the phone's any-motion sensor), so once a live window
// arrives the sensor is disarmed and demoted to a fallback for when the ring
// disconnects.
let triggerSource: 'sensor' | 'ring' = 'sensor'
let unsubGateFeed: (() => void) | null = null

// AD-2: ring-cadence confirmation state (docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md).
// Sustained-window accumulator — reset whenever a fresh probe starts (see startGps()).
let gaitConfirmCtx: GaitConfirmContext = initGaitConfirm()
// Buffers GPS points seen while merely "probing" (before ring-cadence confirms) so a confirmation
// landing ~90s after the true onset can backdate the session's route to the actual start instead
// of clipping it to the confirm instant. Cleared on a fresh probe and once backfilled.
const probeBuffer: RoutePoint[] = []
const PROBE_BUFFER_CAP = 400 // generous vs. the ~3-min probe timeout at typical GPS point rates

function median(values: number[]): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!finite.length) return NaN
  const mid = Math.floor(finite.length / 2)
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2
}

// Publishes a diagnostics snapshot for the profile screen's background-location
// card so battery-drain/orphaned-watcher reports are confirmable without adb.
// Not persisted (see detectionDiag in auto-detection-store.ts) — always reflects
// this process's live state.
function publishDiag(): void {
  useAutoDetectionStore.getState().setDetectionDiag({
    gateState: gate.state,
    gpsSinceMs: gpsStartedMs,
    lastPointMs,
    trigger: triggerSource,
  })
}

// Evaluates the timer-independent off-switches. Called from every occasion code is
// known to run: each GPS point, each gate tick, ring gate windows (Chunk 2), and app
// resume. In ungated (web fallback) mode GPS is always-on by design, so the watchdog
// does not apply.
function runWatchdog(now: number): void {
  if (ungated || !watcher) return
  const verdict = evaluateWatchdog({
    nowMs: now,
    gpsStartedMs,
    lastPointMs,
    sessionActive: useAutoDetectionStore.getState().sessionStartMs !== null,
  })
  if (verdict.action === 'none') { publishDiag(); return }
  const store = useAutoDetectionStore.getState()
  if (store.sessionStartMs !== null) store.endSession()
  // 'sessionEnded' collapses probing OR tracking back to idle:
  // stopGps + re-arm the motion trigger.
  dispatchGate({ type: 'sessionEnded' })
  publishDiag()
}

function avgSpeedMs(points: RoutePoint[]): number {
  if (points.length < 2) return 0
  let distM = 0
  let ms = 0
  for (let i = 1; i < points.length; i++) {
    distM += haversineDistanceKm(points[i - 1], points[i]) * 1000
    ms += points[i].t - points[i - 1].t
  }
  return ms > 0 ? distM / (ms / 1000) : 0
}

async function startGps(): Promise<void> {
  if (watcher) return
  recentPoints.length = 0
  lastPointMs = null
  activityNotified = false
  // Fresh probe — a stale streak/buffer from a previous aborted probe must not carry over.
  gaitConfirmCtx = initGaitConfirm()
  probeBuffer.length = 0
  watcher = await startGpsWatcher(onPoint, onWatcherError)
  gpsStartedMs = Date.now()
  publishDiag()
}

// Any watcher error (rejected start, or a per-update error) means the walk
// currently being probed/tracked cannot actually be seen — most commonly a
// missing "Allow all the time" location grant, since the background-geolocation
// plugin only ever requests foreground access. Surface it instead of failing silently.
function onWatcherError(message: string): void {
  console.warn('[auto-detection] GPS watcher error:', message)
  useAutoDetectionStore.getState().setDetectionError(message)
}

async function stopGps(): Promise<void> {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
  if (watcher) { await watcher.stop(); watcher = null }
  gpsStartedMs = null
  lastPointMs = null
  recentPoints.length = 0
  // GPS off = activity over (or a probe timed out); clear the "detected" ping so
  // it never lingers past the session. No-op if none was posted.
  void clearActivityDetected()
  publishDiag()
}

// Feeds an event into the gate and executes whatever side effects it asks for.
// In ungated (no-sensor) mode the gate is bypassed — GPS is simply always on.
/**
 * Q-95-followup. Runs on every gate tick and on resume, so it catches the transition whichever
 * store flips and however the walk was started — no per-store subscription to keep in sync.
 *
 * Discards rather than ends: `endSession()` turns the session into a `pendingSessions` entry,
 * which IS the confirm sheet, so ending here would cause the very popup this removes.
 */
function abortInFlightIfSessionOwned(): void {
  const store = useAutoDetectionStore.getState()
  const sessionActive = store.sessionStartMs !== null
  if (!shouldAbortInFlightDetection({
    gateIdle: ungated || gate.state === 'idle',
    sessionActive,
    workoutActive: isWorkoutInProgress(useWorkoutStore.getState().mode),
    guidedWalkActive: isGuidedWalkActive(useGuidedWalkStore.getState()),
    activityActive: isActivityActive(useActivityStore.getState()),
  })) return
  if (sessionActive) store.discardSession()
  // Collapses probing OR tracking back to idle (stopGps + re-arm the motion trigger). Re-arming
  // during the owning session is safe — dispatchGate already refuses its motionTrigger.
  dispatchGate({ type: 'sessionEnded' })
}

function dispatchGate(event: MotionGateEvent): void {
  if (ungated) return
  // Never let a workout in progress arm GPS probing (see isWorkoutInProgress) — this is the
  // only event type that can transition idle -> probing, so blocking it here covers both
  // trigger sources (phone sensor + ring gate window) and, as a side effect, also prevents the
  // AD-2 gait-confirm block below from ever running (it's gated on gate.state !== 'idle', which
  // now never leaves 'idle' during a workout). An already-probing/tracking session from before
  // the workout started is left alone rather than torn down — a narrow, low-risk edge case.
  // A Guided Walk or a manually-started "Other Activity" session is exactly the same case as a
  // lifting workout — incidental motion during a session the app already knows about is not a
  // second, real walk/run — but neither store was checked here, so auto-detection ran blind to
  // both and could double-log a session covering the same window (Q-95).
  if (
    event.type === 'motionTrigger' &&
    (isWorkoutInProgress(useWorkoutStore.getState().mode) ||
      isGuidedWalkActive(useGuidedWalkStore.getState()) ||
      isActivityActive(useActivityStore.getState()))
  ) return
  const { ctx, commands } = reduceGate(gate, event)
  gate = ctx
  for (const cmd of commands) runCommand(cmd)
  publishDiag()
}

function runCommand(cmd: MotionGateCommand): void {
  switch (cmd) {
    case 'startGps':
      startGps().catch(console.error)
      break
    case 'stopGps':
      stopGps().catch(console.error)
      break
    case 'armMotion':
      // Once the ring is live it's the strictly better trigger — no re-arm
      // needed, disarmMotionTrigger already stopped the sensor when the ring
      // took over (see the gate-feed subscription in startAutoDetection).
      if (triggerSource === 'ring') break
      armMotionTrigger(onMotionTrigger)
      break
  }
}

function onMotionTrigger(): void {
  dispatchGate({ type: 'motionTrigger', now: Date.now() })
}

function onPoint(point: RoutePoint) {
  const now = Date.now()
  // Before runWatchdog below, which calls endSession() and would turn this session into a confirm
  // sheet. Points keep arriving during an owned session because nothing has stopped GPS yet, so
  // the gate tick alone would lose the race (Q-95-followup).
  abortInFlightIfSessionOwned()
  // Evaluate with the PREVIOUS lastPointMs: a >3-min gap between points must
  // finalize the old session before this new point can contaminate it (the
  // stall timer that used to handle this doesn't fire when timers are
  // suspended in the background).
  runWatchdog(now)
  lastPointMs = now
  publishDiag()

  // A real point proves the watcher is working — clear any earlier error.
  if (useAutoDetectionStore.getState().detectionError !== null) {
    useAutoDetectionStore.getState().setDetectionError(null)
  }

  recentPoints.push(point)
  if (recentPoints.length > SPEED_BUFFER_SIZE) recentPoints.shift()

  // AD-2: buffer probe-phase points so a ring-cadence confirmation (which lands ~90s after the
  // true onset) can backdate the session's route to the actual start. Only meaningful while
  // genuinely probing — cleared on every fresh probe in startGps().
  if (gate.state === 'probing') {
    probeBuffer.push(point)
    if (probeBuffer.length > PROBE_BUFFER_CAP) probeBuffer.shift()
  }

  if (stallTimer) clearTimeout(stallTimer)
  stallTimer = setTimeout(() => {
    const s = useAutoDetectionStore.getState()
    if (s.sessionStartMs !== null) {
      s.endSession()
      dispatchGate({ type: 'sessionEnded' })
    }
  }, SESSION_END_GAP_MS)

  const speed = avgSpeedMs(recentPoints)
  const store = useAutoDetectionStore.getState()

  // Motorised speed — end any active walk session immediately (saving the walk
  // portion recorded so far) and skip this point. The stall timer above still
  // fires 3 min after the last point, but sessionStartMs will be null so it's
  // a no-op. A new walking session can start once speed drops back down.
  if (speed > REALTIME_MOTORISED_SPEED_MS) {
    if (store.sessionStartMs !== null) {
      store.endSession()
      dispatchGate({ type: 'sessionEnded' })
    }
    return
  }

  if (speed >= MIN_MOVE_SPEED_MS) {
    // AD-2: GPS speed only confirms (starts) the session in the ring-disconnected fallback path.
    // When the ring is live, confirmation comes from the gait-confirm accumulator in the gate-feed
    // subscription below — a single, real cadence signal, not a speed guess.
    if (store.sessionStartMs === null && triggerSource === 'sensor') {
      store.startSession(point.t)
    }
    if (store.sessionStartMs !== null) {
      // Dispatched unconditionally (not just on first confirm) so a session that
      // survived a mid-walk page reload (deploy) — whose gate never saw its own
      // sessionStarted — doesn't get probe-timed-out; the reducer already ignores
      // this event unless it's in the probing state. Also covers a session started
      // by the ring-confirm path below.
      dispatchGate({ type: 'sessionStarted' })
      store.addPoint(point)
    }
  } else if (store.sessionStartMs !== null) {
    // Still recording while slow — let stall timer decide when to end
    store.addPoint(point)
  }

  // AD-1 fallback notification: ring-disconnected only. When the ring path is live, the
  // notification fires from the gait-confirm accumulator instead (see the gate-feed subscription
  // below) — one consistent "confirmed" moment rather than two gates racing each other.
  if (triggerSource === 'sensor' && !activityNotified) {
    const s = useAutoDetectionStore.getState()
    const pts = s.sessionPoints
    if (s.sessionStartMs !== null && pts.length >= 2) {
      const distanceM = computeTotalDistanceKm(pts) * 1000
      const elapsedSec = (pts[pts.length - 1].t - s.sessionStartMs) / 1000
      if (shouldNotifyActivity({ distanceM, elapsedSec, alreadyNotified: activityNotified })) {
        activityNotified = true
        // Cleared when GPS stops in stopGps().
        void notifyActivityDetected()
      }
    }
  }
}

export async function startAutoDetection(): Promise<void> {
  if (running) return
  running = true

  // Fetch the steps-decoder table once per launch (Q-221). Fire-and-forget: it must never delay
  // detection starting, and until it lands the ring-cadence confirmation below simply does not run.
  // It seeds from the client cache first, so an offline cold start after one online session injects
  // without touching the network.
  void ensureStepsDecoderConstants()

  const store = useAutoDetectionStore.getState()
  store.setDetecting(true)
  store.setDetectionError(null)
  gate = initGate()
  // Reconcile any stale "detected" ping left over from a killed session.
  void clearActivityDetected()
  publishDiag()

  // Ticks and resume both drive the watchdog regardless of mode (harmless in
  // ungated mode — dispatchGate early-returns there and runWatchdog no-ops
  // since it only checks watcher-owned state).
  gateTicker = setInterval(() => {
    const now = Date.now()
    abortInFlightIfSessionOwned()
    dispatchGate({ type: 'tick', now })
    runWatchdog(now)
  }, GATE_TICK_MS)
  resumeHandle = await App.addListener('resume', () => {
    const now = Date.now()
    abortInFlightIfSessionOwned()
    dispatchGate({ type: 'tick', now })
    runWatchdog(now)
  })

  // Prefer the battery-cheap path: keep GPS off and let the significant-motion
  // sensor wake it only when the user starts moving. If the sensor is missing
  // (older device / emulator / web), fall back to always-on GPS so passive
  // detection still works.
  if (isMotionDetectionAvailable()) {
    ungated = false
    armMotionTrigger(onMotionTrigger)
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
      // Repeated walking windows during probing/tracking are no-ops — the
      // reducer only accepts motionTrigger when idle. Non-walking windows do
      // NOT end a session: GPS itself (stall + motorised checks + the
      // watchdog) owns ending, so a standing pause at a traffic light can't
      // kill the walk. (A ring-idle early stop is a possible future battery
      // lever — deliberately YAGNI'd here.)
      if (ev.walking) dispatchGate({ type: 'motionTrigger', now })
      runWatchdog(now)

      // AD-2: ring-cadence confirmation (docs/superpowers/plans/2026-07-23-ring-cadence-activity-detection.md).
      // Only meaningful once GPS is actually probing/tracking — no point classifying gait while
      // fully idle (nothing to confirm into). Confirms via the sustained-window accumulator, not
      // a single reading, so a stationary lifting set's occasional false reading can't confirm.
      // Skip the gait confirmation until the decoder has its table (Q-221 — it is fetched from an
      // authenticated route now, not bundled). Doing nothing is the correct degraded behaviour:
      // auto-detection is already best-effort, and decoding on an absent table would produce
      // plausible wrong cadence rather than no cadence. `ensureStepsDecoderConstants` returns
      // synchronously true once injected, and seeds from cache so an offline cold start still works
      // after one online session.
      if (gate.state !== 'idle' && hasStepsDecoderConstants()) {
        const decoded = runStepsMotionDecoder({ timestamps: [now], data: [ev.columns] })
        const classification = classifyGait({
          strideHz: median(decoded.data.map(row => row[STRIDE_FREQUENCY_COLUMN])),
          strideAmpFrac: median(decoded.data.map(row => row[STRIDE_AMPLITUDE_FRAC_COLUMN])),
          totalAmplitudeMg: median(decoded.data.map(row => row[TOTAL_AMPLITUDE_MG_COLUMN])),
        })
        const result = pushGaitWindow(gaitConfirmCtx, { state: classification.state, atMs: now })
        gaitConfirmCtx = result.ctx
        if (result.confirmed && triggerSource === 'ring' && useAutoDetectionStore.getState().sessionStartMs === null) {
          const { activityType, startMs } = result.confirmed
          useAutoDetectionStore.getState().startSession(startMs, activityType)
          // Backfill probe-phase points from the true (backdated) onset so the route isn't
          // clipped to the ~90s-later confirm instant.
          for (const p of probeBuffer) {
            if (p.t >= startMs) useAutoDetectionStore.getState().addPoint(p)
          }
          probeBuffer.length = 0
          dispatchGate({ type: 'sessionStarted' })
          // Read AFTER the backfill above, so the window judged is the one the confirmation
          // actually covers rather than the ~90s-later confirm instant.
          const pts = useAutoDetectionStore.getState().sessionPoints
          const distanceM = pts.length >= 2 ? computeTotalDistanceKm(pts) * 1000 : 0
          const elapsedSec = pts.length >= 2 ? (pts[pts.length - 1].t - startMs) / 1000 : 0
          if (shouldNotifyRingConfirmedActivity({
            pointCount: pts.length, distanceM, elapsedSec, alreadyNotified: activityNotified,
          })) {
            activityNotified = true
            void notifyActivityDetected()
          }
        }
      }
    })
  } else {
    ungated = true
    await startGps()
  }
}

export async function stopAutoDetection(): Promise<void> {
  running = false
  if (gateTicker) { clearInterval(gateTicker); gateTicker = null }
  resumeHandle?.remove(); resumeHandle = null
  unsubGateFeed?.(); unsubGateFeed = null
  triggerSource = 'sensor'
  disarmMotionTrigger()
  dispatchGate({ type: 'stop' })
  gate = initGate()
  activityNotified = false
  gaitConfirmCtx = initGaitConfirm()
  probeBuffer.length = 0
  await stopGps()

  const store = useAutoDetectionStore.getState()
  store.setDetecting(false)
  if (store.sessionStartMs !== null) store.endSession()
  ungated = false
  store.setDetectionDiag(null)
}

export function isAutoDetectionRunning(): boolean {
  return running
}
