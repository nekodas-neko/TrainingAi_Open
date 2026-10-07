import { getOuraBle } from '@/lib/oura-ble/plugin'
import {
  runRawRolledUpMaintenance,
  type MarkedHistogram,
  type RawMaintenanceResult,
} from '@/lib/oura-ble/raw-rolled-up-from-server'

/**
 * #2579 — the device wiring for `runRawRolledUpMaintenance`: where the prune flag lives, where the
 * results are logged, and when a pass runs.
 *
 * **The flag is `ta_ring_raw_prune` in `localStorage`, OFF unless it holds exactly `'1'`.** That is the
 * app's existing mechanism for a ring behaviour that belongs to one phone (`ta_ring_auto_capture`,
 * `ta_ring_continuous_capture`): listed in `DEVICE_LOCAL_PREFERENCES`, so it never syncs to another
 * device and survives a sign-out. There is no server-side feature-flag system to use, and a local
 * SQLite setting would need its own table or a method on the local store for one boolean. The owner
 * turns it on from the Raw store card in `/admin/oura-ble`, after reading the would-prune count that
 * card shows. A cleared WebView, a read that throws, or any value but `'1'` is OFF.
 *
 * **The log is local and counts only.** Each pass's result (row counts, cutoffs, bytes — never a
 * frame) goes to `console.info('[oura-raw-maint]', …)` and to the last `DIAG_CAP` results under
 * `ta-oura-ble-raw-maint-diag`, which the Raw store card renders. Nothing is sent to the server.
 */

export const RAW_PRUNE_FLAG_KEY = 'ta_ring_raw_prune'
export const RAW_MAINT_DIAG_KEY = 'ta-oura-ble-raw-maint-diag'
export const RAW_MARKED_HISTOGRAM_KEY = 'ta-oura-ble-raw-marked-by-day'
const DIAG_CAP = 20

/** How often a drain may trigger a pass. A pass after every app-open drain would re-read a page of
 *  raw rows across the bridge each time for at most a few hours' worth of new marks. */
export const RAW_MAINT_MIN_INTERVAL_MS = 60 * 60 * 1000

export function isRawPruneEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(RAW_PRUNE_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function setRawPruneEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(RAW_PRUNE_FLAG_KEY, '1')
    else localStorage.removeItem(RAW_PRUNE_FLAG_KEY)
  } catch { /* a storage failure leaves it off, which is the safe side */ }
}

export function readRawMaintenanceLog(): RawMaintenanceResult[] {
  try {
    const raw = localStorage.getItem(RAW_MAINT_DIAG_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as RawMaintenanceResult[]) : []
  } catch {
    return []
  }
}

function appendLog(r: RawMaintenanceResult): void {
  try {
    const next = [...readRawMaintenanceLog(), r].slice(-DIAG_CAP)
    localStorage.setItem(RAW_MAINT_DIAG_KEY, JSON.stringify(next))
  } catch { /* diagnostics are best-effort */ }
}

function loadHistogram(): MarkedHistogram {
  const raw = localStorage.getItem(RAW_MARKED_HISTOGRAM_KEY)
  const parsed: unknown = raw ? JSON.parse(raw) : {}
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as MarkedHistogram) : {}
}

async function readWatermark(): Promise<{ rolledThroughMs: number | null }> {
  const res = await fetch('/api/oura-ble/rollup-watermark', { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as { rolledThroughMs: number | null }
}

let inFlight: Promise<RawMaintenanceResult | null> | null = null

/**
 * Run one pass, unless one ran within `RAW_MAINT_MIN_INTERVAL_MS` (skipped with `force`). Returns
 * null when skipped. Never throws. Concurrent callers share the pass in flight, so two drains
 * settling together cannot interleave their marks.
 */
export function maintainOuraRawStore(opts: { force?: boolean } = {}): Promise<RawMaintenanceResult | null> {
  if (inFlight) return inFlight
  if (!opts.force) {
    const last = readRawMaintenanceLog().at(-1)
    if (last && Date.now() - last.at < RAW_MAINT_MIN_INTERVAL_MS) return Promise.resolve(null)
  }
  inFlight = (async () => {
    try {
      const ble = await getOuraBle()
      const result = await runRawRolledUpMaintenance({
        plugin: ble?.plugin ?? null,
        readWatermark,
        isPruneEnabled: isRawPruneEnabled,
        now: () => Date.now(),
        loadHistogram,
        saveHistogram: h => localStorage.setItem(RAW_MARKED_HISTOGRAM_KEY, JSON.stringify(h)),
        log: line => console.info('[oura-raw-maint]', line),
      })
      // Off-device there is nothing to record; logging "no plugin" every hour would only bury the
      // passes that did something.
      if (result.outcome !== 'no-plugin') appendLog(result)
      return result
    } catch {
      return null
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
