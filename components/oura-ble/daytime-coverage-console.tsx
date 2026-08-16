'use client'
import { useState } from 'react'
import { Sun, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Admin feasibility probe for the daytime-signal model builds (steps, activity-detection, awake-HR,
 * daytime stress). Buckets raw BLE samples by tag × local hour over the last N days so we can see
 * whether the ring streams motion/temp/MET during the day (worn-idle) or only around sleep. Wear
 * the ring through a normal day, drain it, then run this and paste the log back.
 */
export function DaytimeCoverageConsole() {
  const [days, setDays] = useState('7')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setLog('')
    try {
      const n = Math.max(1, Math.min(30, Number(days) || 7))
      const res = await fetch(`/api/oura-ble/daytime-coverage?days=${n}`)
      const data = await res.json()
      setLog(res.ok ? formatCoverage(data) : `ERROR ${res.status}: ${data?.error ?? 'unknown'}`)
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
        <Sun className="h-4 w-4" /> Daytime signal coverage
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Does the ring stream daytime motion/temp/MET when worn-idle? Buckets raw BLE tags by local
        hour so you can see if they fire during the day or only around sleep — the gate on the steps,
        activity-detection, awake-HR and daytime-stress model builds. Wear the ring through a normal
        day, drain it, then run.
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
const BARS = ' ▁▂▃▄▅▆▇█'

function hourBar(byHour: number[]): string {
  const max = Math.max(...byHour, 1)
  return byHour.map((c) => BARS[Math.min(BARS.length - 1, Math.round((c / max) * (BARS.length - 1)))]).join('')
}

function formatCoverage(c: any): string {
  if (!c.hasAnchor) {
    return 'Daytime signal coverage\n\n(no ring clock anchor yet — drain the ring at least once so ds↔utc is known, then re-run)'
  }
  const [dStart, dEnd] = c.daytimeHours ?? [9, 21]
  const header = Array.from({ length: 24 }, (_, h) => (h >= dStart && h < dEnd ? '·' : ' ')).join('')
  const lines: string[] = [
    `Daytime signal coverage — last ${c.days} day(s), tz ${c.tz}`,
    `daytime window = ${dStart}:00–${dEnd}:00 local  (·= daytime hour below)`,
    '',
    `           hour 0         12        23`,
    `                ${header}`,
  ]
  if (!c.tags?.length) {
    lines.push('', '(no motion/temp/MET/HRV tags stored in this window — ring likely power-gated worn-idle)')
    return lines.join('\n')
  }
  for (const t of c.tags) {
    const pct = t.total ? Math.round((t.daytime / t.total) * 100) : 0
    lines.push(
      `${(t.label + ' ' + t.tag).padEnd(11)}[${hourBar(t.byHour)}]  ${String(t.total).padStart(5)} tot  ${String(t.daytime).padStart(5)} day (${pct}%)`,
    )
  }
  lines.push('', `verdict: ${verdict(c)}`)
  return lines.join('\n')
}

// The daytime-signal builds need motion/temp/MET during the day. Verdict keys off those tags' daytime share.
function verdict(c: any): string {
  const key = (c.tags ?? []).filter((t: any) => ['MET', 'Temp', 'Motion', 'Steps'].includes(t.label))
  const dayTotal = key.reduce((a: number, t: any) => a + t.daytime, 0)
  const allTotal = key.reduce((a: number, t: any) => a + t.total, 0)
  if (allTotal === 0) return 'no motion/temp/MET/step samples at all — those tags are not being drained; check the ring sync'
  if (dayTotal === 0) return 'those tags fire only outside daytime hours — ring power-gates worn-idle; daytime-signal models NOT feasible as-is'
  const share = Math.round((dayTotal / allTotal) * 100)
  if (share >= 30) return `${share}% of motion/temp/MET/step samples land in daytime hours — daytime-signal models look FEASIBLE`
  return `only ${share}% of those samples are daytime — sparse; feasibility marginal, capture more days`
}
