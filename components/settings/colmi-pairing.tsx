// components/settings/colmi-pairing.tsx
// Pair and sync the Colmi R09 ring. LEARNING MODE: what this collects is stored for comparison and
// is read by nothing that produces a score — see docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md.
'use client'
import { useCallback, useEffect, useState } from 'react'
import { CircleDot, Loader2, Check, X } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { formatTimeOfDay } from '@trainingai/shared/date-utils'
import { pairColmiRing, forgetColmiRing, syncColmiRing, type ColmiSyncOutcome } from '@/lib/colmi-ble/ble'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getPairedRing, type PairedRing } from '@/lib/colmi-ble/paired-ring'
import type { AutoMetric } from '@/lib/colmi-ble/protocol'

/** Ordered so the readout reads the same way every sync. */
const AUTO_METRIC_LABELS: [AutoMetric, string][] = [
  ['heart_rate', 'Heart rate'],
  ['hrv', 'HRV'],
  ['spo2', 'Blood oxygen'],
  ['stress', 'Stress'],
  ['temperature', 'Temperature'],
]

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
  // Forget sits beside the button pressed on every visit, and undoing it means re-pairing over
  // Bluetooth with the ring in hand — far more than a mis-tap should cost.
  const [confirmForget, setConfirmForget] = useState(false)
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
    setConfirmForget(false)
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
            <Button variant="outline" onClick={() => setConfirmForget(true)} disabled={syncing}>Forget</Button>
          </div>

          {outcome?.autoPrefs && Object.keys(outcome.autoPrefs).length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Recording automatically</div>
              <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {AUTO_METRIC_LABELS.map(([metric, label]) => {
                  const pref = outcome.autoPrefs?.[metric]
                  if (!pref) return null
                  return (
                    <li key={metric} className="flex items-center gap-1">
                      {/* Never colour alone — the icon carries the state too. */}
                      {pref.enabled
                        ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden />
                        : <X className="h-3.5 w-3.5 text-destructive" aria-hidden />}
                      <span className={pref.enabled ? '' : 'text-muted-foreground'}>{label}</span>
                      {pref.intervalMinutes ? (
                        <span className="text-muted-foreground">· {pref.intervalMinutes}m</span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {Object.values(outcome.autoPrefs).some(p => !p.enabled) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Anything switched off records nothing until it is on — which looks the same as not
                  wearing the ring. Sync again to retry.
                </p>
              )}
            </div>
          )}

          {outcome?.diagnostics && Object.keys(outcome.diagnostics.frameTags).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Sync detail — {outcome.framesSeen} frames from the ring
              </summary>
              <div className="mt-1 space-y-1 text-muted-foreground">
                {/* Tallied by command byte. A history command whose tag is missing here was never
                    answered, which is a different problem from one that answered and did not map. */}
                <div className="font-mono">
                  {Object.entries(outcome.diagnostics.frameTags)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([tag, n]) => `${tag}×${n}`)
                    .join('  ')}
                </div>
                {Object.keys(outcome.diagnostics.hrSubTypes ?? {}).length > 0 && (
                  <div>
                    Heart-rate packets:
                    <div className="mt-0.5 break-all font-mono">
                      {Object.entries(outcome.diagnostics.hrSubTypes)
                        .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)))
                        .map(([k, v]) => `${k}:${v.packets}p/${v.samples}s`)
                        .join('  ')}
                    </div>
                  </div>
                )}
                {outcome.diagnostics.unmapped > 0 && (
                  <div>
                    {outcome.diagnostics.unmapped} frame(s) not understood:
                    <div className="mt-0.5 break-all font-mono">
                      {outcome.diagnostics.unmappedHex.join(' · ')}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}

          {outcome?.ok && (
            <p className="text-sm text-muted-foreground">
              {/* Both numbers on purpose: a repeat sync storing 0 of 400 is deduping, not failing,
                  and without the pair those look identical. */}
              Read {outcome.readings} samples
              {/* Three numbers, because two cannot tell a filter from a de-dup: read minus kept is
                  what the server rejected as implausible or out of window, kept minus new is what
                  it already had. */}
              {outcome.accepted ? `, kept ${outcome.accepted.readings}` : ''}
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

      <ConfirmDialog
        open={confirmForget}
        onOpenChange={setConfirmForget}
        title="Forget this ring?"
        message="Pairing it again needs the ring in your hand and Bluetooth in range. Readings already synced are kept."
        confirmLabel="Forget ring"
        onConfirm={forget}
      />
    </div>
  )
}
