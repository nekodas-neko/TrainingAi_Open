"use client"

import { useEffect, useState } from "react"
import { Activity, BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, TriangleAlert, Wifi } from "lucide-react"
import { invalidateRingBattery } from "@/lib/cache-groups"
import { isBleDataFresh } from "@/lib/oura/ble-freshness"
import { cachedFetchToday } from "@/lib/sqlite/cache"
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl"
import { useRefreshOnTabShow } from "@/components/shell/tab-visibility"

type LiveBattery = { percent: number; charging: boolean | null; ageMinutes: number }

// Beyond this the BLE reading is still shown, but as a last-known value rather than a
// current one — a confident-looking percentage that is hours stale is what the Cloud
// value was doing wrong. Matches the threshold the Home chip used before Q-203.
const BLE_BATTERY_STALE_AFTER_MIN = 180

const STALE_SYNC_THRESHOLD_MS = 24 * 60 * 60 * 1000

function formatSyncAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function BatteryIcon({ level, charging }: { level: number; charging: boolean | null }) {
  if (charging) return <BatteryCharging className="h-3.5 w-3.5" style={{ color: "var(--color-brand)" }} />
  if (level >= 60) return <BatteryFull className="h-3.5 w-3.5 text-green-400" />
  if (level >= 25) return <BatteryMedium className="h-3.5 w-3.5 text-yellow-400" />
  return <BatteryLow className="h-3.5 w-3.5 text-red-400" />
}

/**
 * The ring's status, read entirely from the direct-BLE pipeline.
 *
 * This card used to be half Cloud: `GET /api/oura/token` supplied "connected", ring colour/size/
 * firmware and a Cloud battery reading, and it carried Connect / Sync Now / Disconnect actions. All
 * of that went with the Cloud integration (owner, 2026-08-13). Nothing is lost that was still true:
 * the ring has been on our own BLE key since the 2026-07-07 re-key, so the Cloud battery was frozen
 * (Q-205), the sync button pulled nothing, and "connected" described a dead credential rather than
 * the ring. Ring colour/size/firmware were the only genuinely Cloud-only facts, and they are
 * cosmetic — the firmware version in particular is pinned on purpose and never changes.
 */
export function OuraConnectionSection() {
  const [liveBattery, setLiveBattery] = useState<LiveBattery | null>(null)
  const [lastMeasuredAt, setLastMeasuredAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void loadBattery()
    void loadFreshness()
  }, [])

  // Ring battery and last-seen age are the two things on this card that are wrong within minutes,
  // and the tab never unmounts to re-fetch them.
  useRefreshOnTabShow(() => { void loadBattery(true); void loadFreshness() })

  // `force` on the tab-show path: TTL_MEDIUM would otherwise serve the cached reading.
  async function loadBattery(force = false) {
    if (force) await invalidateRingBattery()
    await cachedFetchToday<{ latest: LiveBattery | null }>(
      'oura-ble-battery-latest', '/api/oura-ble/battery-latest', TTL_MEDIUM,
      d => { if (d?.latest !== undefined) setLiveBattery(d.latest) },
    ).catch(() => {}).finally(() => setLoading(false))
  }

  async function loadFreshness() {
    try {
      const res = await fetch('/api/oura-ble/freshness')
      if (!res.ok) return
      const { lastMeasuredAt: at } = await res.json() as { lastMeasuredAt: string | null }
      setLastMeasuredAt(at)
    } catch { /* leave the last-known value in place */ }
  }

  const bleBatteryFresh = liveBattery != null && liveBattery.ageMinutes <= BLE_BATTERY_STALE_AFTER_MIN
  const bat = liveBattery?.percent ?? null
  const batStale = liveBattery != null && !bleBatteryFresh
  const bleFresh = isBleDataFresh(lastMeasuredAt, Date.now())
  const isSyncStale = lastMeasuredAt != null && Date.now() - new Date(lastMeasuredAt).getTime() > STALE_SYNC_THRESHOLD_MS

  if (loading && liveBattery == null && lastMeasuredAt == null) {
    return (
      <div>
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Ring
        </p>
        <div className="rounded-2xl bg-muted/40 border border-border h-[68px] animate-pulse" />
      </div>
    )
  }

  const seen = lastMeasuredAt != null || liveBattery != null

  return (
    <div>
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Ring
      </p>
      <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
        <div className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: seen
                ? "color-mix(in oklab, var(--color-brand) 15%, var(--color-muted))"
                : "var(--color-muted)",
            }}
          >
            <Activity
              className="h-4 w-4"
              style={{ color: seen ? "var(--color-brand)" : "var(--color-muted-foreground)" }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Oura Ring 5</p>
            <p className="text-[10px] text-muted-foreground">
              {seen ? "Direct Bluetooth" : "No data yet — wear the ring and open the app nearby"}
            </p>
            {lastMeasuredAt && (
              <p
                className="text-[10px] flex items-center gap-1"
                style={{ color: isSyncStale ? "var(--accent-amber)" : "var(--color-muted-foreground)" }}
              >
                {isSyncStale && <TriangleAlert className="h-3 w-3 flex-none" />}
                Ring synced {formatSyncAge(lastMeasuredAt)}
              </p>
            )}
          </div>
          {seen ? (
            <div className="flex items-center gap-2">
              {/* A real BLE reading that has aged past the live window: show the number, muted,
                  rather than throwing away a true last-known value. */}
              {bat != null && batStale && (
                <div
                  className="flex items-center gap-1"
                  title={`Ring battery ${bat}%, last seen ${Math.round((liveBattery?.ageMinutes ?? 0) / 60)}h ago`}
                >
                  <BatteryMedium className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{bat}%</span>
                </div>
              )}
              {bat != null && !batStale && (
                <div className="flex items-center gap-1">
                  <BatteryIcon level={bat} charging={liveBattery?.charging ?? null} />
                  <span
                    className="text-[10px] font-semibold tabular-nums"
                    style={{ color: bat < 25 ? "rgb(248 113 113)" : bat < 60 ? "rgb(250 204 21)" : "rgb(74 222 128)" }}
                  >
                    {bat}%
                  </span>
                </div>
              )}
              {bleFresh && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1"
                  style={{ background: "color-mix(in oklch, var(--color-brand) 15%, transparent)", color: "var(--color-brand)" }}
                >
                  <Wifi className="h-3 w-3" />
                  Live
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
