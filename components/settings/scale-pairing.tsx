// components/settings/scale-pairing.tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { useUserTimezone } from '@/components/shell/user-timezone-provider';
import { Scale as ScaleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  getPairedScale, setPairedScale, getScaleBackgroundSyncEnabled, setScaleBackgroundSyncEnabled,
  type PairedScale,
} from '@/lib/scale-ble/paired-scale'
import { getScaleBle } from '@/lib/scale-ble/plugin'
import { useRefreshOnTabShow } from '@/components/shell/tab-visibility'
import { invalidateBodyMetricWrite, invalidateReadinessInputs } from '@/lib/cache-groups'
import { formatKg } from '@trainingai/shared/format/units'

// Matches ScaleProtocol.SCALE_SERVICE (android) — Phase 0 capture confirmed the scale
// advertises this custom 16-bit UUID (0xFFE0), same family as many generic BLE scales.
const SCALE_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb'

interface PendingReading {
  id: number
  measuredAt: string
  weightKg: number | null
}

interface TodayReading {
  id: number
  measuredAt: string
  isTrend: boolean
  weightKg?: number
  bodyFatPct?: number
}

export function ScalePairing() {
  const userTz = useUserTimezone()
  const [paired, setPaired] = useState<PairedScale | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bgSyncEnabled, setBgSyncEnabled] = useState(false)
  const [bgSyncBusy, setBgSyncBusy] = useState(false)
  const [pending, setPending] = useState<PendingReading[]>([])
  // LA-108. Same shape as `pending`, and deliberately a separate list rather than a flag on one
  // array: the two have different actions, and the order the server sends them means different
  // things (see the render).
  const [dismissed, setDismissed] = useState<PendingReading[]>([])
  const [pendingBusyId, setPendingBusyId] = useState<number | null>(null)
  const [today, setToday] = useState<TodayReading[]>([])

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/scale-ble/pending')
      if (!res.ok) return
      const data = await res.json() as { pending: PendingReading[]; dismissed?: PendingReading[] }
      setPending(data.pending)
      // `?? []` because this component ships to a WebView that may still be running against an
      // older deploy of the route for one refresh — an absent key must read as "none", not crash.
      setDismissed(data.dismissed ?? [])
    } catch { /* best-effort — the list just stays as-is */ }
  }, [])

  const loadToday = useCallback(async () => {
    try {
      const res = await fetch('/api/scale-ble/today')
      if (!res.ok) return
      const data = await res.json() as { readings: TodayReading[] }
      setToday(data.readings)
    } catch { /* best-effort — the list just stays as-is */ }
  }, [])

  useEffect(() => {
    setPaired(getPairedScale())
    setBgSyncEnabled(getScaleBackgroundSyncEnabled())
    loadPending()
    loadToday()
  }, [loadPending, loadToday])

  useRefreshOnTabShow(() => {
    setPaired(getPairedScale())
    loadPending()
    loadToday()
  })

  async function scanAndPair() {
    setError(null); setScanning(true)
    try {
      const { Capacitor } = await import('@capacitor/core')
      if (!Capacitor.isNativePlatform()) { setError('Scale pairing is only available in the app.'); return }
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize()
      const device = await BleClient.requestDevice({ services: [SCALE_SERVICE] })
      const next = { deviceId: device.deviceId, name: device.name ?? 'Scale' }
      setPairedScale(next); setPaired(next)
      // Hand the deviceId to the native plugin too, so the background service (once
      // enabled) can connect without needing the pairing screen open.
      const ref = await getScaleBle()
      if (ref) await ref.plugin.setDevice({ deviceId: next.deviceId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed or cancelled.')
    } finally {
      setScanning(false)
    }
  }

  function forget() {
    setPairedScale(null); setPaired(null)
    setScaleBackgroundSyncEnabled(false); setBgSyncEnabled(false)
    getScaleBle().then(ref => ref?.plugin.stopService()).catch(() => {})
  }

  async function toggleBackgroundSync(enabled: boolean) {
    setError(null); setBgSyncBusy(true)
    try {
      const ref = await getScaleBle()
      if (!ref) { setError('Background sync is only available in the app.'); return }
      const { plugin } = ref
      if (enabled) {
        const { granted } = await plugin.ensurePermissions()
        if (!granted) { setError('Bluetooth permission is required for background sync.'); return }
        await plugin.setIngestUrl({ url: window.location.origin })
        await plugin.startService()
      } else {
        await plugin.stopService()
      }
      setScaleBackgroundSyncEnabled(enabled)
      setBgSyncEnabled(enabled)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change background sync.')
    } finally {
      setBgSyncBusy(false)
    }
  }

  // BF-53 — both of these were `if (res.ok)` with no else, and that is why a route returning 400 to
  // every press read as *"doesn't actually remove it or do anything"* rather than as an error. The
  // route bug is fixed; this is the half that made it survive, so it stays fixed independently.
  async function pendingActionFailed(res: Response, verb: string) {
    const detail = await res.json().then(d => (d as { error?: string }).error).catch(() => null)
    setError(detail ? `Could not ${verb} the reading: ${detail}` : `Could not ${verb} the reading.`)
  }

  async function confirmReading(id: number) {
    setPendingBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/scale-ble/pending/${id}/confirm`, { method: 'POST' })
      if (!res.ok) return pendingActionFailed(res, 'confirm')
      setPending(p => p.filter(r => r.id !== id))
      // Q-126: confirming writes weight/composition to body_metrics (confirm/route.ts →
      // applyScaleReadingToBodyMetrics), so the same pair a manual metric log uses must fire —
      // otherwise the weight card, Progress card and nutrition TDEE header keep the old weight.
      // Before the refetch, per the invalidate-then-refetch ordering rule.
      await Promise.all([invalidateBodyMetricWrite(), invalidateReadinessInputs()]).catch(() => {})
      loadToday()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the reading.')
    } finally {
      setPendingBusyId(null)
    }
  }

  async function dismissReading(id: number) {
    setPendingBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/scale-ble/pending/${id}/dismiss`, { method: 'POST' })
      if (!res.ok) return pendingActionFailed(res, 'dismiss')
      setPending(p => p.filter(r => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not dismiss the reading.')
    } finally {
      setPendingBusyId(null)
    }
  }

  // LA-108 — claim back a reading that was declined, by accident or by someone else's tap.
  //
  // **It POSTs the SAME confirm route the pending rows use, and that is the point.** The engine half
  // widened `confirmScaleSample` to match `pending` OR `dismissed` (never `confirmed`, so claiming
  // twice cannot double-apply), and the route already files the weight against the reading's own
  // `measuredAt` and re-anchors the band. So there is no second write path to keep in step.
  //
  // The invalidation pair is the same one `confirmReading` fires, for the same reason (Q-126): this
  // writes to `body_metrics`, so the weight card, Progress card and nutrition TDEE header are stale
  // without it. Invalidate before the refetch, per the ordering rule.
  async function claimReading(id: number) {
    setPendingBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/scale-ble/pending/${id}/confirm`, { method: 'POST' })
      if (!res.ok) return pendingActionFailed(res, 'claim')
      setDismissed(d => d.filter(r => r.id !== id))
      await Promise.all([invalidateBodyMetricWrite(), invalidateReadinessInputs()]).catch(() => {})
      loadToday()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not claim the reading.')
    } finally {
      setPendingBusyId(null)
    }
  }

  return (
    <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        <ScaleIcon className="h-3.5 w-3.5" /> Body-composition scale
      </p>

      {paired ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">{paired.name}</span>
            <Button variant="outline" size="sm" onClick={forget}>Forget</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={scanAndPair} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Pair a scale'}
        </Button>
      )}

      {paired && (
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-sm">Sync in background</p>
            <p className="text-[10px] text-muted-foreground">
              Weigh in without opening the app first — no ongoing notification, minimal battery cost.
            </p>
          </div>
          <Button
            variant={bgSyncEnabled ? 'default' : 'outline'}
            size="sm"
            disabled={bgSyncBusy}
            onClick={() => toggleBackgroundSync(!bgSyncEnabled)}
          >
            {bgSyncEnabled ? 'On' : 'Off'}
          </Button>
        </div>
      )}

      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}

      {today.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pt-2">
            Today&apos;s weigh-ins
          </p>
          {today.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span>
                {formatTimeOfDay(r.measuredAt, userTz)}
                {' — '}
                {r.weightKg != null ? formatKg(r.weightKg) : 'unknown'}
                {r.bodyFatPct != null && ` · ${r.bodyFatPct}% fat`}
              </span>
              {r.isTrend && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Trend</span>
              )}
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pt-2">
            Pending weigh-ins
          </p>
          {pending.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span>{r.weightKg != null ? formatKg(r.weightKg) : 'Unknown weight'}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pendingBusyId === r.id} onClick={() => dismissReading(r.id)}>
                  Not me
                </Button>
                <Button size="sm" disabled={pendingBusyId === r.id} onClick={() => confirmReading(r.id)}>
                  It&apos;s me
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LA-108 — the recovery path for a declined reading, which until now had no screen.
          The band anchors on the last CONFIRMED weight and only a confirmed reading moves it, so an
          accidental *Not me* tap was irreversible: a real change bigger than the anomaly threshold
          put the owner outside his own band with nothing able to move it, and every reading after
          that was outside too. Silent and self-sustaining.

          **Server order is preserved — do not sort.** The list is newest-first on purpose: in the
          lockout this exists for, the readings at the top ARE the wrongly-declined ones, because the
          scale is mostly his.

          **No dismiss action here.** These are already dismissed; the only move is to claim one
          back. */}
      {dismissed.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-border">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pt-2">
            Declined weigh-ins
          </p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Declined by mistake? Claiming one files it and re-anchors your weight range.
          </p>
          {dismissed.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                {/* A declined reading can be days old, unlike a pending one, so the time is what
                    tells you which is which. `formatTimeOfDay` with the user's tz, never the
                    device's. A frame that would not decode is archived too, so `weightKg` may be
                    null — it still lists. */}
                {r.weightKg != null ? formatKg(r.weightKg) : 'Unknown weight'}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  {formatTimeOfDay(r.measuredAt, userTz)}
                </span>
              </span>
              <Button size="sm" className="flex-none" disabled={pendingBusyId === r.id} onClick={() => claimReading(r.id)}>
                It&apos;s me
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
