// #2469. Post `OuraRingService`'s link counters to the server, read-only.
//
// The service counts connects, drops and connected time, and until now kept them in memory, so the
// server could not tell a link that was down from a phone that had no network. They already cross
// the bridge in `getStatus()`, so the WebView posts them and the native service is untouched — no
// APK, and nothing here can change link behaviour: this module only READS status.
//
// The counters go up CUMULATIVE since the service started, never as deltas: a post that fails
// loses nothing, because the next one carries the same totals. They reset when Android restarts
// the service, so each post carries `serviceStartedAt` (now − uptime) as the instance key; the
// server groups by it and differences within a group.
//
// Cadence: on app open and resume, and hourly while the app stays open, at most once per
// `MIN_INTERVAL_MS`. Between two posts of one service instance, the connected-time difference over
// the wall-clock difference is how much of that gap the link was up, wherever the app was.
import { getOuraBle, type OuraBleStatus } from '@/lib/oura-ble/plugin'

export const LINK_STATS_MIN_INTERVAL_MS = 15 * 60_000
export const LINK_STATS_PERIOD_MS = 60 * 60_000

export interface LinkStatsPayload {
  serviceStartedAt: number
  serviceUptimeMs: number
  state: string
  connectCount: number
  dropCount: number
  totalConnectedMs: number
  lastTimeToConnectMs: number | null
  consecutiveFailures: number | null
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The body for one post, or null when there is nothing honest to send: the service is stopped
 *  (its counters are gone, and zeros would read as a fresh instance), or a counter is missing or
 *  not a number (an APK that does not carry it). Never throws. */
export function linkStatsPayload(
  status: OuraBleStatus | { state: 'stopped' } | null | undefined,
  nowMs: number,
): LinkStatsPayload | null {
  if (!status || status.state === 'stopped') return null
  const s = status as Partial<OuraBleStatus>
  if (typeof s.state !== 'string' || s.state.length === 0) return null
  if (!isCount(s.serviceUptimeMs) || !isCount(s.connectCount) || !isCount(s.dropCount) || !isCount(s.totalConnectedMs)) {
    return null
  }
  const serviceStartedAt = Math.round(nowMs - s.serviceUptimeMs)
  if (serviceStartedAt < 0) return null
  return {
    serviceStartedAt,
    serviceUptimeMs: Math.round(s.serviceUptimeMs),
    state: s.state.slice(0, 40),
    connectCount: Math.round(s.connectCount),
    dropCount: Math.round(s.dropCount),
    totalConnectedMs: Math.round(s.totalConnectedMs),
    lastTimeToConnectMs: isCount(s.lastTimeToConnectMs) ? Math.round(s.lastTimeToConnectMs) : null,
    consecutiveFailures: isCount(s.consecutiveFailures) ? Math.round(s.consecutiveFailures) : null,
  }
}

let lastPostedAt = 0

/** Test seam: forget the throttle. */
export function resetLinkStatsThrottle(): void {
  lastPostedAt = 0
}

/** Best-effort: reads status and posts it, at most once per `LINK_STATS_MIN_INTERVAL_MS`. A no-op
 *  on the web, without the plugin, with the service stopped, and on any failure. Never throws. */
export async function reportRingLinkStats(nowMs: number = Date.now()): Promise<void> {
  if (lastPostedAt !== 0 && nowMs - lastPostedAt < LINK_STATS_MIN_INTERVAL_MS) return
  try {
    const ble = await getOuraBle()
    if (!ble) return
    const body = linkStatsPayload(await ble.plugin.getStatus(), nowMs)
    if (!body) return
    // Stamp before the request so a slow or failing endpoint cannot turn open/resume into a burst.
    lastPostedAt = nowMs
    await fetch('/api/oura-ble/link-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    /* telemetry — the next open, resume or hourly tick posts the same cumulative totals */
  }
}
