// Sync the Colmi ring without being asked.
//
// The ring answers HRV, stress, SpO2 and temperature for the CURRENT DAY ONLY — those commands take
// no date, unlike heart rate and activity which are addressed by day and therefore back-fill. So a
// day whose evening is never synced loses four metrics permanently: the ring overwrites them and
// even the raw archive cannot help, because those bytes were never sent. That happened twice in the
// first three days of the baseline week, the second time AFTER the owner had been told to sync in
// the evening — which is what makes this code rather than a habit.
import { getPairedRing } from '@/lib/colmi-ble/paired-ring'

const LAST_KEY = 'ta_colmi_last_auto_sync_v1'

/** Long enough that opening the app repeatedly costs nothing, short enough that an evening in the
 *  app cannot pass without one. The ring's own metrics move at 30-minute granularity. */
export const AUTO_SYNC_INTERVAL_MS = 30 * 60_000

/** A sync takes seconds and holds the radio; two at once is a guaranteed failure, and the app can
 *  have this hook mounted while the Devices card runs one by hand. Module scope, not state — the
 *  point is that it is shared across every caller in the tab. */
let inFlight = false

export function isColmiSyncInFlight(): boolean { return inFlight }

function lastAutoSyncAt(): number {
  if (typeof window === 'undefined') return 0
  try { return Number(window.localStorage.getItem(LAST_KEY) ?? 0) || 0 } catch { return 0 }
}

function markSynced(at: number): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(LAST_KEY, String(at)) } catch { /* storage unavailable */ }
}

/** Whether enough time has passed. Separate from the run so the decision is testable without BLE. */
export function shouldAutoSync(now: number, last: number, intervalMs = AUTO_SYNC_INTERVAL_MS): boolean {
  // A clock that went backwards (timezone change, NTP correction) must not lock syncing out until
  // the stored future time passes.
  if (last > now) return true
  return now - last >= intervalMs
}

export interface AutoSyncDeps {
  now: () => number
  isPaired: () => boolean
  runSync: () => Promise<{ ok: boolean }>
}

/**
 * One attempt. Returns why it did not run, so a caller can log it rather than guess.
 *
 * A failed sync still marks the time. The ring sleeps its radio when worn-idle and answers nothing,
 * which is normal rather than an error — retrying every render against a sleeping ring would drain
 * the phone and the ring both, and the next interval is soon enough.
 */
export async function attemptAutoSync(deps: AutoSyncDeps): Promise<'ran' | 'not-paired' | 'too-soon' | 'busy'> {
  if (!deps.isPaired()) return 'not-paired'
  if (inFlight) return 'busy'
  const now = deps.now()
  if (!shouldAutoSync(now, lastAutoSyncAt())) return 'too-soon'
  inFlight = true
  try {
    await deps.runSync()
  } catch {
    // Swallowed on purpose: this runs unattended, and a ring out of range is the common case.
  } finally {
    markSynced(deps.now())
    inFlight = false
  }
  return 'ran'
}

export const colmiAutoSyncDeps = {
  now: () => Date.now(),
  isPaired: () => getPairedRing() !== null,
}
