'use client'
import { useState } from 'react'
import { Footprints, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Admin validation console for the real-data step pipeline
 * (0x7e/0x7f → steps_motion_decoder → step_counter). Runs the ported models over the newest stored
 * ring frames and reports the step count + decoded stride-frequency summary so the owner can compare
 * against a phone's count and confirm the unpack27 → data_columns column mapping on-device.
 *
 * This is a VALIDATION tool, not a trusted count: step_counter's motion input is best-effort (0x47,
 * often absent daytime → zeroed) and the column mapping is exactly what this checks. Trust the
 * golden-verified decoded stride-frequency (walking ≈ 1.5–3 Hz) as the physical sanity signal, and
 * the Tier-1 gate estimate as an independent cross-check.
 */
export function StepCounterExportConsole() {
  const [limit, setLimit] = useState('1000')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setLog('')
    try {
      const n = Math.max(50, Math.min(1000, Number(limit) || 1000))
      const res = await fetch(`/api/oura-ble/step-counter-export?limit=${n}`)
      const data = await res.json()
      setLog(res.ok ? formatResult(data) : `ERROR ${res.status}: ${data?.error ?? 'unknown'}`)
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
        <Footprints className="h-4 w-4" /> Step-counter export (validation)
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Runs our ported step pipeline (0x7e/0x7f → steps_motion_decoder → step_counter) over the
        newest stored ring frames. Do a counted walk, sync the ring, then run and compare the total
        to your phone. Decoded stride-frequency (~1.5–3&nbsp;Hz when walking) is the golden-verified
        sanity signal; the step_counter total is experimental (motion input + column mapping still
        being validated).
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={50}
          max={1000}
          step={50}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
          aria-label="Frames to analyze"
        />
        <span className="text-xs text-muted-foreground">frames</span>
        <Button size="sm" onClick={run} disabled={running}>
          <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Run'}
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
function formatResult(d: any): string {
  if (d.hasAnchor === false) {
    return 'Step-counter export\n\n(no ring clock anchor yet — drain the ring at least once so ds↔utc is known, then re-run)'
  }
  if (!d.pairedWindows) {
    return `Step-counter export\n\n${d.message ?? 'No paired 0x7e/0x7f step windows in the stored frames.'}`
  }
  const s = d.strideFrequencyHz ?? {}
  const fmt = (v: number | null) => (typeof v === 'number' ? v.toFixed(2) : '—')
  const lines: string[] = [
    'Step-counter export (validation)',
    '',
    `step frames (0x7e/0x7f):  ${d.stepFrames}`,
    `paired windows:           ${d.pairedWindows}`,
    `motion frames used (0x47): ${d.motionFramesUsed}${d.motionFramesUsed === 0 ? '  (none — motion stream zeroed)' : ''}`,
    '',
    `step_counter total:       ${d.stepCounterTotal}  steps   ← compare to your phone`,
    `Tier-1 gate estimate:     ${d.gateEstimateSteps}  steps   (independent cross-check)`,
    '',
    `stride frequency (Hz), ${s.subRows} sub-rows:`,
    `  min ${fmt(s.min)}   median ${fmt(s.median)}   max ${fmt(s.max)}`,
    `  in walking band (1.5–3 Hz): ${s.inWalkingBand}/${s.subRows}`,
    '',
    `step windows (${d.stepWindows?.length ?? 0}):`,
  ]
  for (const w of (d.stepWindows ?? []).slice(0, 40)) {
    const t = new Date(w.startMs).toLocaleTimeString('en-GB', { hour12: false }) // local time-of-day
    lines.push(`  ${t}  ${String(w.steps).padStart(7)} steps`)
  }
  if ((d.stepWindows?.length ?? 0) > 40) lines.push(`  … ${d.stepWindows.length - 40} more`)
  return lines.join('\n')
}
