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
/** #2477. How long a CONFIRMED session may run without a single GPS point before it is ended.
 *  The stall rule needs a last point to be old, so a session confirmed by ring cadence with the
 *  phone still indoors (no fix, no point) could never stall and held GPS to the absolute cap.
 *  Measured from when GPS started, and confirmation can land anywhere inside the probe, so this
 *  is the probe's own hard cap plus the stall gap: the confirmed session always gets at least a
 *  stall gap of its own to produce a first point. */
export const NO_FIX_MAX_MS = PROBE_HARD_MAX_MS + STALL_GAP_MS
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
  | { action: 'end-session'; reason: 'stall' | 'no-fix' }
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
  if (sessionActive && lastPointMs === null && nowMs - gpsStartedMs > NO_FIX_MAX_MS) {
    return { action: 'end-session', reason: 'no-fix' }
  }
  return { action: 'none' }
}
