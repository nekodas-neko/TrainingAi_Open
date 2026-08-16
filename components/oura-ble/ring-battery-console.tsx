'use client'
import { useState } from 'react'
import { BatteryCharging, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Admin R&D probe for the ring's battery telemetry (0x61 debug_data). Answers the owner's three
 * questions — daily drain %, charge-per-session %, average charging time — from the battery events the
 * ring emits over BLE (level changes + device-reported charging-time). History is forward-only from
 * the un-drop: it reads empty until the ring next drains post-deploy. The decoder is reverse-engineered
 * and unvalidated, so a `⚠ decoder values look off` line flags obviously-garbage readings.
 */
export function RingBatteryConsole() {
  const [days, setDays] = useState('7')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setLog('')
    try {
      const n = Math.max(1, Math.min(30, Number(days) || 7))
      const res = await fetch(`/api/oura-ble/battery-analytics?days=${n}`)
      const data = await res.json()
      setLog(res.ok ? formatBattery(data) : `ERROR ${res.status}: ${data?.error ?? 'unknown'}`)
    } catch (err) {
      setLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(log)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <BatteryCharging className="h-4 w-4" /> Ring battery
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Daily drain, charge-per-session and average charging time from the ring&rsquo;s 0x61 battery
        telemetry. History is forward-only from the un-drop — reads empty until the ring next drains
        after this deploys. Decoder is unvalidated; the sanity flag warns on garbage readings.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
          aria-label="Days to look back"
        />
        <span className="text-xs text-muted-foreground">days back</span>
        <Button size="sm" onClick={run} disabled={running}>
          <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Probe'}
        </Button>
        {log && (
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
      {log && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre rounded-md bg-muted p-2 font-mono text-[11px] leading-tight">
          {log}
        </pre>
      )}
    </section>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fmtDuration(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

function formatBattery(d: any): string {
  const lines: string[] = [`Ring battery — last ${d.days} day(s)`, '']
  if (!d.eventCount) {
    lines.push('(no battery events yet — the 0x61 un-drop is forward-only, so wear + drain the ring, then re-run)')
    return lines.join('\n')
  }
  lines.push(
    `events: ${d.eventCount}   level samples: ${d.levelSampleCount}   span: ${d.spanDays != null ? d.spanDays.toFixed(1) : '—'} day(s)`,
    `avg daily drain:        ${d.avgDailyDrainPct != null ? d.avgDailyDrainPct.toFixed(1) + ' %/day' : '—'}`,
    `avg charge per session: ${d.avgChargePerSessionPct != null ? '+' + d.avgChargePerSessionPct.toFixed(0) + ' %' : '—'}`,
    `avg charging time:      ${fmtDuration(d.avgChargingTimeSec)}`,
    '',
    `charge sessions (${d.chargeSessions?.length ?? 0}):`,
  )
  for (const s of d.chargeSessions ?? []) {
    lines.push(`  +${s.deltaPct}% (${s.startPct}→${s.endPct}) over ${fmtDuration(s.durationSec)}  [${s.chargingTimeSource}]`)
  }
  if (d.sane === false) {
    lines.push('', '⚠ decoder values look off (battery_pct out of range or implausible charge time) — the 0x61 decoder is unvalidated; verify against the ring on a real drain+charge cycle')
  }
  lines.push('', 'cross-check: compare avg drain / last level against the Cloud battery chip and the Oura app before trusting these.')
  return lines.join('\n')
}
