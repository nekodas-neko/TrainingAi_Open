// Pure state machine that decides when the GPS watcher should be running for
// passive activity detection. The point is battery: instead of streaming GPS
// 24/7, we keep it off and only turn it on once the device's significant-motion
// sensor says the user has started moving. GPS is turned back off (and the
// motion sensor re-armed) once the activity ends or a probe times out without a
// real walk/run materialising.
//
// States:
//   idle     — GPS off, motion sensor armed, waiting for a motion trigger
//   probing  — motion detected, GPS on, waiting to confirm a real activity
//   tracking — a walk/run session is in progress, GPS on
//
// Commands are side effects the caller must execute (start/stop the GPS watcher,
// re-arm the one-shot motion sensor). Keeping this reducer pure makes the
// battery-critical on/off logic unit-testable without a device.

export type MotionGateState = 'idle' | 'probing' | 'tracking'

export interface MotionGateContext {
  state: MotionGateState
  probeDeadlineMs: number | null
}

export type MotionGateEvent =
  | { type: 'motionTrigger'; now: number }
  | { type: 'sessionStarted' }
  | { type: 'sessionEnded' }
  | { type: 'tick'; now: number }
  | { type: 'stop' }

export type MotionGateCommand = 'startGps' | 'stopGps' | 'armMotion'

// A significant-motion trigger with no confirmed walk/run within this window is
// treated as a false alarm (phone picked up, jostled in a bag) — GPS is turned
// back off. Long enough to catch a slow walk ramping up to detection speed.
export const PROBE_TIMEOUT_MS = 3 * 60 * 1000

export function initGate(): MotionGateContext {
  return { state: 'idle', probeDeadlineMs: null }
}

interface GateResult {
  ctx: MotionGateContext
  commands: MotionGateCommand[]
}

function toIdle(commands: MotionGateCommand[]): GateResult {
  return { ctx: initGate(), commands }
}

export function reduceGate(ctx: MotionGateContext, event: MotionGateEvent): GateResult {
  switch (event.type) {
    case 'motionTrigger':
      // Only idle listens for the sensor; a stray trigger while GPS is already
      // on is ignored (the sensor is disarmed then anyway).
      if (ctx.state !== 'idle') return { ctx, commands: [] }
      return {
        ctx: { state: 'probing', probeDeadlineMs: event.now + PROBE_TIMEOUT_MS },
        commands: ['startGps'],
      }

    case 'sessionStarted':
      if (ctx.state !== 'probing') return { ctx, commands: [] }
      return { ctx: { state: 'tracking', probeDeadlineMs: null }, commands: [] }

    case 'sessionEnded':
      if (ctx.state === 'idle') return { ctx, commands: [] }
      return toIdle(['stopGps', 'armMotion'])

    case 'tick':
      if (
        ctx.state === 'probing' &&
        ctx.probeDeadlineMs !== null &&
        event.now >= ctx.probeDeadlineMs
      ) {
        return toIdle(['stopGps', 'armMotion'])
      }
      return { ctx, commands: [] }

    case 'stop':
      return toIdle(ctx.state === 'idle' ? [] : ['stopGps'])
  }
}
