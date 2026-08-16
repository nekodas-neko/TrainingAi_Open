// Thin wrapper over the native rest-timer status-bar chip exposed by
// MainActivity as `window.AndroidRestChip`. On Android 16 (One UI Now Bar) it
// posts a promoted ongoing notification whose status-bar pill ticks the rest
// countdown down. The OS renders the chronometer from the finish timestamp, so
// nothing has to tick from the WebView — which matters because the WebView is
// throttled/suspended in the background, exactly when the chip is useful.
// Tapping the chip reopens the app and, if it had navigated away, routes back
// to the workout screen.
//
// Off-device (web / dev sandbox) the bridge is absent and every call no-ops.

interface AndroidRestChipBridge {
  start: (anchorMs: string, label: string, mode: string) => void
  stop: () => void
}

/** "rest" = working-set rest (counts down to `anchorMs`, blue → red count-up once over);
 *  "warmup" = warm-up / bar-load / get-ready prep (counts down to `anchorMs`, green → red
 *  negative "−M:SS" count-down if the prep runs past its target). Both anchor on a FUTURE
 *  finish instant. */
export type RestChipMode = 'rest' | 'warmup'

function bridge(): AndroidRestChipBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { AndroidRestChip?: AndroidRestChipBridge }).AndroidRestChip
}

// Default on — the user can disable it from the Preferences section in Profile.
const PREF_KEY = 'ta_pref_rest_chip'

function chipEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PREF_KEY) !== 'false'
}

/** Post/refresh the chip anchored to `anchorMs` (epoch ms) — the count-down FINISH
 *  instant for both modes. "rest": `lastSetRestStartMs + restSec*1000` (the same the
 *  on-screen ring uses). "warmup": the prep start + its target (whole-workout warm-up
 *  goal, or the equipment bar-load total) — the same target the on-screen bar shows. */
export function startRestChip(anchorMs: number, label: string, mode: RestChipMode = 'rest'): void {
  const b = bridge()
  if (!b || !chipEnabled()) return
  try {
    b.start(String(Math.round(anchorMs)), label, mode)
  } catch {
    /* bridge shape mismatch — ignore */
  }
}

/** Clear the chip (rest ended, workout left, or component unmounted). Always
 *  attempts, regardless of the preference, so a lingering chip is cleared even
 *  if the user just toggled the feature off. */
export function stopRestChip(): void {
  const b = bridge()
  if (!b) return
  try {
    b.stop()
  } catch {
    /* ignore */
  }
}

// The native tap PendingIntent brings the app to the front and dispatches this
// event. Registered once at module load; a no-op on web where it never fires.
if (typeof window !== 'undefined') {
  window.addEventListener('restChipOpen', () => {
    if (!window.location.pathname.startsWith('/workout')) {
      window.location.assign('/workout')
    }
  })
}
