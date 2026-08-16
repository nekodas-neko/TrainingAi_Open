/**
 * Pure state-machine core for the step orchestrator (Chunk B of the step-orchestration
 * plan). Kept separate from the effectful shell (`step-orchestrator.ts`) that owns the
 * plugin listeners, timers, and POSTs — this file has no Capacitor/fetch dependency so
 * it's driven entirely by synthetic gate-window streams in tests.
 *
 * Trigger: a walking gate window (col14 <= WALK_CADENCE_MAX) while idle starts a
 * counting burst. Stop: 2 consecutive non-walking gate windows, a 20-min ds cap, a
 * disconnect, or a live-HR burst starting (radio courtesy — see lib/live-hr/manager.ts
 * `isRunning()`). On stop, the burst's [startDs, endDs] is posted; a 5-min wall-clock
 * cooldown follows before the next auto-trigger.
 */
import { isWalkingWindow } from '@trainingai/shared/health/step-estimate'

export type OrchestratorState = 'idle' | 'counting' | 'cooldown'

export interface GateWindow {
  /** Ring ds of the 0x7e (feature_1) frame — matches PairedStepFeature.ds. */
  ds: number
  columns: number[]
}

export interface OrchestratorSnapshot {
  state: OrchestratorState
  /** ds of the gate window that started the current counting burst. */
  countingStartDs: number | null
  /** ds of the most recently seen gate window while counting (walking or not). */
  lastGateDs: number | null
  /** ds of the most recently seen gate window in ANY state — lets an explicit
   *  startTrackedWalk() trigger even without an in-progress walking burst. */
  lastKnownDs: number | null
  /** Consecutive non-walking gate windows seen while counting. */
  idleStreak: number
  /** Wall-clock ms after which a new auto-trigger is allowed again. */
  cooldownUntilMs: number | null
}

export type OrchestratorEffect =
  | { type: 'startAccel' }
  /** Stop the accel stream and post the burst — the shell fills in `steps` from its
   *  own StepPeakCounter at the moment this effect is executed. */
  | { type: 'stopAndPost'; startDs: number; endDs: number }

/** Consecutive non-walking gate windows that end a counting burst. */
export const IDLE_STOP_STREAK = 2
/** Hard cap on a single counting burst (20 min, in ring deciseconds). */
export const BURST_CAP_DS = 20 * 60 * 10
/** Cooldown between auto-triggered bursts (battery lever). */
export const COOLDOWN_MS = 5 * 60 * 1000
/** Nominal span of one gate window — matches lib/health/step-estimate.ts's
 *  GATE_WINDOW_SPAN_DS (duplicated as a literal here to avoid a cross-module
 *  numeric-constant import cycle; both are the same ~30s gate cadence). */
const GATE_WINDOW_SPAN_DS = 300

export function initialSnapshot(): OrchestratorSnapshot {
  return {
    state: 'idle',
    countingStartDs: null,
    lastGateDs: null,
    lastKnownDs: null,
    idleStreak: 0,
    cooldownUntilMs: null,
  }
}

function stopAndPost(startDs: number, endDs: number): OrchestratorEffect[] {
  return [{ type: 'stopAndPost', startDs, endDs }]
}

/** Called once per accepted (paired) gate window, walking or not. */
export function onGateWindow(
  snap: OrchestratorSnapshot,
  window: GateWindow,
  opts: { liveHrActive: boolean; nowMs: number },
): { snapshot: OrchestratorSnapshot; effects: OrchestratorEffect[] } {
  let s = { ...snap, lastKnownDs: window.ds }
  const walking = isWalkingWindow(window.columns)

  if (s.state === 'cooldown') {
    if (s.cooldownUntilMs != null && opts.nowMs < s.cooldownUntilMs) {
      return { snapshot: s, effects: [] }
    }
    s = { ...s, state: 'idle', cooldownUntilMs: null }
  }

  if (s.state === 'idle') {
    if (walking && !opts.liveHrActive) {
      return {
        snapshot: { ...s, state: 'counting', countingStartDs: window.ds, lastGateDs: window.ds, idleStreak: 0 },
        effects: [{ type: 'startAccel' }],
      }
    }
    return { snapshot: s, effects: [] }
  }

  // state === 'counting'
  if (opts.liveHrActive) {
    // Radio courtesy: yield immediately, regardless of streak/cap.
    const effects = s.countingStartDs != null
      ? stopAndPost(s.countingStartDs, (s.lastGateDs ?? s.countingStartDs) + GATE_WINDOW_SPAN_DS)
      : []
    return { snapshot: { ...initialSnapshot(), lastKnownDs: window.ds, state: 'cooldown', cooldownUntilMs: opts.nowMs + COOLDOWN_MS }, effects }
  }

  const idleStreak = walking ? 0 : s.idleStreak + 1
  const capped = s.countingStartDs != null && (window.ds - s.countingStartDs) >= BURST_CAP_DS
  if (idleStreak >= IDLE_STOP_STREAK || capped) {
    const effects = s.countingStartDs != null ? stopAndPost(s.countingStartDs, window.ds + GATE_WINDOW_SPAN_DS) : []
    return { snapshot: { ...initialSnapshot(), lastKnownDs: window.ds, state: 'cooldown', cooldownUntilMs: opts.nowMs + COOLDOWN_MS }, effects }
  }

  return { snapshot: { ...s, lastGateDs: window.ds, idleStreak }, effects: [] }
}

/** Ring disconnected — stop and post whatever burst was in progress. */
export function onDisconnect(snap: OrchestratorSnapshot): { snapshot: OrchestratorSnapshot; effects: OrchestratorEffect[] } {
  if (snap.state !== 'counting' || snap.countingStartDs == null) return { snapshot: initialSnapshot(), effects: [] }
  return {
    snapshot: initialSnapshot(),
    effects: stopAndPost(snap.countingStartDs, (snap.lastGateDs ?? snap.countingStartDs) + GATE_WINDOW_SPAN_DS),
  }
}

/** Explicit trigger (e.g. a guided walk) — bypasses the gate, shares the burst/POST
 *  machinery. Refuses if already counting, in cooldown, or live-HR is active. */
export function forceStart(
  snap: OrchestratorSnapshot,
  opts: { liveHrActive: boolean },
): { snapshot: OrchestratorSnapshot; effects: OrchestratorEffect[] } {
  if (snap.state !== 'idle' || opts.liveHrActive || snap.lastKnownDs == null) {
    return { snapshot: snap, effects: [] }
  }
  return {
    snapshot: { ...snap, state: 'counting', countingStartDs: snap.lastKnownDs, lastGateDs: snap.lastKnownDs, idleStreak: 0 },
    effects: [{ type: 'startAccel' }],
  }
}

/** Explicit stop (e.g. a guided walk ending) — posts the burst and enters cooldown. */
export function forceStop(
  snap: OrchestratorSnapshot,
  opts: { nowMs: number },
): { snapshot: OrchestratorSnapshot; effects: OrchestratorEffect[] } {
  if (snap.state !== 'counting' || snap.countingStartDs == null) return { snapshot: snap, effects: [] }
  const endDs = (snap.lastGateDs ?? snap.countingStartDs) + GATE_WINDOW_SPAN_DS
  return {
    snapshot: { ...initialSnapshot(), lastKnownDs: snap.lastKnownDs, state: 'cooldown', cooldownUntilMs: opts.nowMs + COOLDOWN_MS },
    effects: stopAndPost(snap.countingStartDs, endDs),
  }
}
