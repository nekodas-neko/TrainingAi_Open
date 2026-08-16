// lib/oura-ble/sync.ts
import { getOuraBle, type OuraBlePlugin } from '@/lib/oura-ble/plugin'
import { invalidateOuraSync } from '@/lib/cache-groups'

// Native ingest lands asynchronously after drainHistory()/startService() resolve — poll
// the `draining` status flag (native-ingest-build-only field; absent on older APKs/web) so
// client caches are invalidated after data actually lands in Postgres, not before. Bounded
// so an APK without the field (or a drain that never settles) can't hang this forever.
const DRAIN_POLL_MS = 3_000
const DRAIN_POLL_MAX = 10

async function afterDrainSettles(plugin: OuraBlePlugin): Promise<void> {
  for (let i = 0; i < DRAIN_POLL_MAX; i++) {
    await new Promise(r => setTimeout(r, DRAIN_POLL_MS))
    try {
      const status = await plugin.getStatus()
      if (!('draining' in status) || !status.draining) break
    } catch {
      break
    }
  }
  await invalidateOuraSync().catch(() => {})
  window.dispatchEvent(new Event('ta:oura-ble-synced'))
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
