'use client'
import { useState } from 'react'
import { Brain, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Admin device-validation harness for the neural SleepNet stager. Runs the model over a chosen
 * night's real BLE samples (via the redecode route's debug path — production staging is untouched)
 * and renders a copy-pasteable log: assembled-input counts + the model's hypnogram / stage %s.
 *
 * The owner runs this on-device after a worn-overnight drain and pastes the log back, so the raw-
 * night assembler and the model's REM% can be validated against real data before the neural stager
 * replaces the heuristic in production.
 */
export function SleepNetDumpConsole() {
  const [date, setDate] = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    if (!date) return
    setRunning(true)
    setLog('')
    try {
      // dump=1: lightweight path — skip the full-table re-decode and keep the 35-day bound, so the
      // dump doesn't outlive the gateway timeout (which returned a plain-text "upstream error" body
      // that the old bare res.json() then failed to parse). The neural sleepNet dump still runs.
      const res = await fetch(`/api/oura-ble/samples/redecode?date=${encodeURIComponent(date)}&dump=1`, { method: 'POST' })
      const text = await res.text().catch(() => '')
      let data: unknown = null
      try { data = text ? JSON.parse(text) : null } catch { /* non-JSON gateway error (timeout/upstream) */ }
      if (!data) { setLog(`ERROR: server returned a non-JSON response (HTTP ${res.status})${text ? ` — ${text.slice(0, 120)}` : ''}`); return }
      setLog(formatDump(date, data))
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
        <Brain className="h-4 w-4" /> SleepNet neural stager — dump
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Runs the neural sleep model over the chosen night&apos;s real BLE samples and logs the assembled
        inputs + hypnogram. Does not change the staging stored for the night. Run on-device after an
        overnight drain, then paste the log back.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          aria-label="Night date (wake-up day)"
        />
        <Button size="sm" onClick={run} disabled={!date || running}>
          <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Run dump'}
        </Button>
        {log && (
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
      </div>
      {log && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-tight">
          {log}
        </pre>
      )}
    </section>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function formatDump(date: string, data: any): string {
  const lines: string[] = [`SleepNet dump — night ${date}`, '']
  if (data?.aggregateError) lines.push(`aggregateError: ${data.aggregateError}`)
  if (data?.redecodeError) lines.push(`redecodeError: ${data.redecodeError}`)
  const dn = data?.aggregated?.debugNight
  if (!dn) {
    lines.push('No debugNight for this date (no sleep window found — pick a wake-up date with data).')
    return lines.join('\n')
  }
  lines.push(`window: ${dn.windowStart}–${dn.windowEnd}   heuristic onsetEpoch=${dn.onsetEpoch} settleHr=${dn.settleHr}`)
  // heuristic stage tally for comparison
  const h = { deep: 0, light: 0, rem: 0, awake: 0 } as Record<string, number>
  for (const e of dn.epochs ?? []) if (e.stage) h[e.stage] = (h[e.stage] ?? 0) + 1
  const hTot = (dn.epochs ?? []).length || 1
  const hp = (n: number) => `${Math.round((n / hTot) * 1000) / 10}%`
  lines.push(`heuristic %: deep ${hp(h.deep)}  light ${hp(h.light)}  rem ${hp(h.rem)}  wake ${hp(h.awake)}  (epochs ${hTot})`)
  lines.push('')
  const sn = dn.sleepNet
  if (!sn) {
    lines.push('SleepNet: (no dump — model unavailable)')
    return lines.join('\n')
  }
  lines.push(`SleepNet inputs: durationH=${sn.durationH}`)
  lines.push(`  ibiBeats=${sn.counts.ibiBeats}  motion=${sn.counts.motion}  spo2=${sn.counts.spo2}`)
  lines.push(`  ibiMeanMs=${sn.ibiMeanMs}  ibiSpanMin=${sn.ibiSpanMin}`)
  if (!sn.staging) {
    lines.push(`SleepNet staging: FELL BACK — ${sn.fallbackReason}`)
    return lines.join('\n')
  }
  const s = sn.staging
  lines.push('')
  lines.push(`SleepNet % (of night, ${s.epochs} epochs): deep ${s.stagePct.deep}%  light ${s.stagePct.light}%  rem ${s.stagePct.rem}%  wake ${s.stagePct.awake}%`)
  lines.push(`SleepNet REM (of sleep): ${s.remPct}%   [Cloud baseline ~23–28%]`)
  if (sn.apnea) {
    lines.push('')
    lines.push(`Breathing disturbance (observational, not a diagnosis; now persisted as bdi_derived):`)
    lines.push(`  disturbedEpochs=${sn.apnea.disturbedEpochs}  index=${sn.apnea.perHour}/h  (${sn.apnea.pctOfSleep}% of sleep)`)
  }
  lines.push('')
  lines.push(`hypnogram (code x epochs; 1=deep 2=light 3=rem 4=wake):`)
  lines.push(s.hypnogramRle)
  return lines.join('\n')
}
