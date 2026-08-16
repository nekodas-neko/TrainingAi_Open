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
  const [pendingBusyId, setPendingBusyId] = useState<number | null>(null)
  const [today, setToday] = useState<TodayReading[]>([])

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/scale-ble/pending')
      if (!res.ok) return
      const data = await res.json() as { pending: PendingReading[] }
      setPending(data.pending)
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

  async function confirmReading(id: number) {
    setPendingBusyId(id)
    try {
      const res = await fetch(`/api/scale-ble/pending/${id}/confirm`, { method: 'POST' })
      if (res.ok) {
        setPending(p => p.filter(r => r.id !== id))
        // Q-126: confirming writes weight/composition to body_metrics (confirm/route.ts →
        // applyScaleReadingToBodyMetrics), so the same pair a manual metric log uses must fire —
        // otherwise the weight card, Progress card and nutrition TDEE header keep the old weight.
        // Before the refetch, per the invalidate-then-refetch ordering rule.
        await Promise.all([invalidateBodyMetricWrite(), invalidateReadinessInputs()]).catch(() => {})
        loadToday()
      }
    } finally {
      setPendingBusyId(null)
    }
  }

  async function dismissReading(id: number) {
    setPendingBusyId(id)
    try {
      const res = await fetch(`/api/scale-ble/pending/${id}/dismiss`, { method: 'POST' })
      if (res.ok) setPending(p => p.filter(r => r.id !== id))
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
                {r.weightKg != null ? `${r.weightKg.toFixed(1)} kg` : 'unknown'}
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
              <span>{r.weightKg != null ? `${r.weightKg.toFixed(1)} kg` : 'Unknown weight'}</span>
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
    </div>
  )
}
