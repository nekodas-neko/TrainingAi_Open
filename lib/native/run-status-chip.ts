// Thin wrapper over the native run status-bar chip exposed by MainActivity as
// `window.AndroidRunChip` — the same "promoted ongoing notification" mechanism
// the lifting rest-timer chip uses (see lib/native/rest-timer-chip.ts), on its
// own notification slot so a run and a rest timer never fight over the pill.
//
// Off-device (web / dev sandbox) the bridge is absent and every call no-ops.

interface AndroidRunChipBridge {
  startClock: (anchorMs: string, label: string, mode: string) => void
  updateText: (label: string, text: string) => void
  stop: () => void
}

/** "duration" = counts down to a target finish instant, flips to count-up once
 *  past it (mirrors the rest chip's countdown/overtime behaviour). "elapsed" =
 *  counts up from a fixed start instant, no target, no overtime flip. */
export type RunClockMode = 'duration' | 'elapsed'

function bridge(): AndroidRunChipBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { AndroidRunChip?: AndroidRunChipBridge }).AndroidRunChip
}

// Default on — the user can disable it from the Preferences section in Profile.
const PREF_KEY = 'ta_pref_run_chip'

function chipEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PREF_KEY) !== 'false'
}

/** Duration/elapsed clock chip. `anchorMs` is the count-down finish instant for
 *  "duration" mode, or the count-up base instant for "elapsed" mode. */
export function startRunClockChip(anchorMs: number, label: string, mode: RunClockMode): void {
  const b = bridge()
  if (!b || !chipEnabled()) return
  try {
    b.startClock(String(Math.round(anchorMs)), label, mode)
  } catch {
    /* bridge shape mismatch — ignore */
  }
}

/** Distance-mode static-text chip — re-post on each GPS fix / distance update. */
export function updateRunTextChip(label: string, text: string): void {
  const b = bridge()
  if (!b || !chipEnabled()) return
  try {
    b.updateText(label, text)
  } catch {
    /* ignore */
  }
}

/** Clear the chip (run finished, left, or paused). Always attempts, regardless
 *  of the preference, so a lingering chip is cleared even if the user just
 *  toggled the feature off mid-run. */
export function stopRunChip(): void {
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
  window.addEventListener('runChipOpen', () => {
    if (!window.location.pathname.startsWith('/activity')) {
      window.location.assign('/activity')
    }
  })
}
