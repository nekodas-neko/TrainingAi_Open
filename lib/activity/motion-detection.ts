// Thin wrapper over the native significant-motion bridge exposed by
// MainActivity as `window.AndroidMotion`. The hardware significant-motion
// sensor is a one-shot, near-zero-power trigger that fires (even with the
// screen off) once the device starts moving, then auto-disarms. We use it to
// wake the GPS watcher only when the user is actually moving instead of
// streaming GPS continuously.
//
// On web / non-native platforms the bridge is absent and every call no-ops —
// `isMotionDetectionAvailable()` returns false so the caller can fall back to
// its previous behaviour.

interface AndroidMotionBridge {
  isAvailable: () => boolean
  arm: () => void
  disarm: () => void
}

function bridge(): AndroidMotionBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { AndroidMotion?: AndroidMotionBridge }).AndroidMotion
}

export function isMotionDetectionAvailable(): boolean {
  const b = bridge()
  return !!b && b.isAvailable()
}

let currentHandler: (() => void) | null = null
let listenerAttached = false

// The native side dispatches a `motionTrigger` window event when the sensor
// fires. Because the sensor is one-shot, the handler is cleared on each fire —
// the caller re-arms via `armMotionTrigger` when it wants to listen again.
function ensureListener(): void {
  if (listenerAttached || typeof window === 'undefined') return
  window.addEventListener('motionTrigger', () => {
    const handler = currentHandler
    currentHandler = null
    handler?.()
  })
  listenerAttached = true
}

// Arms the one-shot sensor. Returns false if native motion detection isn't
// available (web, or a device without the sensor). `onTrigger` fires once.
export function armMotionTrigger(onTrigger: () => void): boolean {
  const b = bridge()
  if (!b || !b.isAvailable()) return false
  ensureListener()
  currentHandler = onTrigger
  b.arm()
  return true
}

export function disarmMotionTrigger(): void {
  currentHandler = null
  bridge()?.disarm()
}
