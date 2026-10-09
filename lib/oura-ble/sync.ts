// lib/oura-ble/sync.ts
import { getOuraBle, type OuraBlePlugin } from '@/lib/oura-ble/plugin'
import { invalidateOuraSync } from '@/lib/cache-groups'
import { waitForRollup, type RollupState } from '@/lib/oura-ble/rollup-wait'
import { maintainOuraRawStore } from '@/lib/oura-ble/raw-store-maintenance'

// Native ingest lands asynchronously after drainHistory()/startService() resolve — poll
// the `draining` status flag (native-ingest-build-only field; absent on older APKs/web) so
// client caches are invalidated after data actually lands in Postgres, not before. Bounded
// so an APK without the field (or a drain that never settles) can't hang this forever.
const DRAIN_POLL_MS = 3_000
const DRAIN_POLL_MAX = 10

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function readRollupState(): Promise<RollupState | null> {
  try {
    const res = await fetch('/api/oura-ble/rollup-state', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as RollupState
  } catch {
    return null
  }
}

/** Invalidate the Oura-derived caches and tell mounted screens to refetch. The two lines every
 *  path through this module ends with — kept in one place so a new caller cannot end with only
 *  one of them. */
export async function announceOuraSynced(): Promise<void> {
  await invalidateOuraSync().catch(() => {})
  window.dispatchEvent(new Event('ta:oura-ble-synced'))
}

async function afterDrainSettles(plugin: OuraBlePlugin): Promise<void> {
  // Baseline BEFORE waiting, so a rollup that lands while the drain is still finishing still counts
  // as progress against the value from before this sync began.
  const baseline = await readRollupState()

  for (let i = 0; i < DRAIN_POLL_MAX; i++) {
    await sleep(DRAIN_POLL_MS)
    try {
      const status = await plugin.getStatus()
      if (!('draining' in status) || !status.draining) break
    } catch {
      break
    }
  }

  // Q-91-followup: the drain finishing means the rows are INGESTED, not DERIVED. The rollup is a
  // 3 s trailing-edge debounce and then runs off-loop, so invalidating here used to race it — a
  // refetch could land before the rollup wrote and cache a pre-rollup read, which is worse than
  // staleness because it looks fresh and the TTL then holds it. Wait for the watermark instead.
  // A `timeout` is not a failure: a drain carrying nothing the rollup changes never moves it.
  await waitForRollup({ read: readRollupState, sleep, baseline })
  await announceOuraSynced()
  // #2579: the server has just folded (or had its chance to fold) this drain, so this is when its
  // watermark is freshest. Throttled to once an hour; marks device raw rows "folded on the server",
  // and prunes them only if the owner has turned the prune flag on.
  void maintainOuraRawStore()
}

/**
 * Force an immediate Oura ring history drain — best-effort, fire-and-forget. Wired into
 * pull-to-sync so a manual refresh also pulls the ring's latest recorded data (HR, temp,
 * SpO₂, sleep), not just the app's own outbox. Background sync is otherwise hourly.
 *
 * No-op off-device / without the plugin. If the service isn't running it's started (it
 * auto-drains on connect — no permission prompt here, the app requests those on open);
 * otherwise a drain is kicked now. After the drain settles, client caches derived from
 * Oura data are invalidated and a `ta:oura-ble-synced` event fires so mounted screens
 * (e.g. home) know to refetch.
 */
export async function syncOuraRing(): Promise<void> {
  const ble = await getOuraBle()
  if (!ble) return
  try {
    const status = await ble.plugin.getStatus()
    if (status.state === 'stopped') {
      await ble.plugin.startService() // connects, then auto-drains
    } else {
      await ble.plugin.drainHistory()
    }
    void afterDrainSettles(ble.plugin)
  } catch {
    /* not connected / mid-drain / no key — best effort, the hourly drain still runs */
  }
}

/** How recently the ring must have drained for opening the app not to drain it again (BF-187).
 *  Not tuned: it makes the first open of the morning always drain while a burst of tab switches
 *  costs one drain. If it reads wrong in use, that is a finding about the number. */
export const OPEN_DRAIN_MAX_AGE_MS = 10 * 60_000

/**
 * BF-187: the app-open / resume trigger. Asks the service to drain only if it has not drained
 * within `maxAgeMs`, then settles and announces exactly as the pull-to-refresh path does. A no-op
 * on the web, when the service is stopped, and on an APK too old to have the method: the hourly
 * autonomous drain still runs there, which is today's behaviour.
 */
export async function syncOuraRingIfStale(maxAgeMs = OPEN_DRAIN_MAX_AGE_MS): Promise<void> {
  const ble = await getOuraBle()
  if (!ble) return
  try {
    const { result } = await ble.plugin.drainIfStale({ maxAgeMs })
    if (result === 'started') void afterDrainSettles(ble.plugin)
  } catch {
    /* older APK without drainIfStale, or not connected — the hourly drain still runs */
  }
}
