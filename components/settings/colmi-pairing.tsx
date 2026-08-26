// components/settings/colmi-pairing.tsx
// Pair and sync the Colmi R09 ring. LEARNING MODE: what this collects is stored for comparison and
// is read by nothing that produces a score — see docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md.
'use client'
import { useCallback, useEffect, useState } from 'react'
import { CircleDot, Loader2 } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { formatTimeOfDay } from '@trainingai/shared/date-utils'
import { pairColmiRing, forgetColmiRing, syncColmiRing, type ColmiSyncOutcome } from '@/lib/colmi-ble/ble'
import { getPairedRing, type PairedRing } from '@/lib/colmi-ble/paired-ring'

/** Wall-clock parts in the USER's zone — the ring's clock is set from these, never from the
 *  device's own locale, so a phone in another zone cannot mis-stamp the ring's history. */
function nowPartsInTz(tz: string) {
  const [year, month, day, hour, minute, second] =
    formatInTimeZone(new Date(), tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number)
  return { year, month, day, hour, minute, second }
}

export function ColmiPairing() {
  const tz = useUserTimezone()
  const [paired, setPaired] = useState<PairedRing | null>(null)
  const [scanning, setScanning] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ColmiSyncOutcome | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)

  // Seed in an effect, never a useState initializer — a localStorage read in an initializer causes
  // a hydration mismatch (the instant-paint rule).
  useEffect(() => { setPaired(getPairedRing()) }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/colmi/status', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { latestReadingAt: string | null }
      setLastSyncAt(data.latestReadingAt)
    } catch { /* best-effort — the readout just stays as-is */ }
  }, [])

  useEffect(() => { void loadStatus() }, [loadStatus])

  async function scanAndPair() {
    setError(null); setScanning(true)
    try {
      const next = await pairColmiRing()
      if (!next) { setError('Ring pairing is only available in the app.'); return }
      setPaired(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed or was cancelled.')
    } finally {
      setScanning(false)
    }
  }

  async function runSync() {
    setError(null); setOutcome(null); setSyncing(true)
    try {
      const result = await syncColmiRing({
        todayStr: formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'),
        timezone: tz,
        now: nowPartsInTz(tz),
      })
      setOutcome(result)
      if (!result.ok && result.message) setError(result.message)
      if (result.ok) await loadStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  function forget() {
    forgetColmiRing(); setPaired(null); setOutcome(null); setError(null)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <CircleDot className="h-5 w-5 text-accent" aria-hidden />
        <h3 className="font-semibold">Colmi ring</h3>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          Learning mode
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        A second ring, recorded alongside your main one for comparison. It does not change any of
        your scores.
      </p>

      {paired ? (
        <div className="mt-3 space-y-3">
          <div className="text-sm">
            <div className="font-medium">{paired.name}</div>
            <div className="text-muted-foreground">
              {lastSyncAt
                ? `Last reading ${formatTimeOfDay(new Date(lastSyncAt), tz)}`
                : 'No readings yet'}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runSync} disabled={syncing}>
              {syncing ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Syncing…</>) : 'Sync now'}
            </Button>
            <Button variant="outline" onClick={forget} disabled={syncing}>Forget</Button>
          </div>

          {outcome?.ok && (
            <p className="text-sm text-muted-foreground">
              {/* Both numbers on purpose: a repeat sync storing 0 of 400 is deduping, not failing,
                  and without the pair those look identical. */}
              Read {outcome.readings} samples
              {outcome.stored ? `, stored ${outcome.stored.readings} new` : ''}
              {outcome.sleepSegments > 0 ? ` · ${outcome.sleepSegments} sleep segments` : ''}
              {outcome.battery ? ` · battery ${outcome.battery.percent}%` : ''}
            </p>
          )}
        </div>
      ) : (
        <Button className="mt-3" onClick={scanAndPair} disabled={scanning}>
          {scanning ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />Scanning…</>) : 'Pair ring'}
        </Button>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive" role="status">{error}</p>
      )}

      {outcome?.reason === 'silent' && (
        <p className="mt-2 text-xs text-muted-foreground">
          The ring sleeps its sensors when it has been still, and a sleeping ring answers nothing —
          which looks the same as a flat one. Wear it or put it on the charger, then sync again.
        </p>
      )}
    </div>
  )
}
