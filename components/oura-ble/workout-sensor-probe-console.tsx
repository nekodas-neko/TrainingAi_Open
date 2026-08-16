'use client'
import { useState } from 'react'
import { Activity, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Admin Phase-B feasibility probe for the neural energy model. Reports what motion/HR the ring
 * captured during a workout's window (accel-chunk coverage, HR count, raw tags) so we can see
 * whether the neural energy heads are buildable, or whether the MET fallback (Phase A) is the
 * ceiling. Run after a worn workout + a drain, then paste the log back.
 */
export function WorkoutSensorProbeConsole() {
  const [sessionId, setSessionId] = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setLog('')
    try {
      const qs = sessionId.trim() ? `?sessionId=${encodeURIComponent(sessionId.trim())}` : ''
      const res = await fetch(`/api/oura-ble/workout-sensors${qs}`)
      const data = await res.json()
      setLog(res.ok ? formatProbe(data) : `ERROR ${res.status}: ${data?.error ?? 'unknown'}`)
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
        <Activity className="h-4 w-4" /> Workout sensor probe (energy Phase B)
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Reports what the ring captured during a workout — accel coverage, HR, raw tags — to check if
        the neural calorie model is feasible. Leave the box empty for your latest workout, or paste a
        session id. Run after a worn workout + a drain, then paste the log back.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="session id (optional — latest)"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
          aria-label="Workout session id (optional)"
        />
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
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-[11px] leading-tight">
          {log}
        </pre>
      )}
    </section>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function formatProbe(p: any): string {
  const lines: string[] = [
    `Workout sensor probe — session ${p.sessionId}`,
    `window: ${p.windowStart} → ${p.windowEnd}  (${p.durationMin} min)`,
    '',
    `accel chunks: ${p.accel.chunks}  samples: ${p.accel.samples}  steps: ${p.accel.steps}  coverage: ${p.accel.coveragePct ?? '—'}%`,
    `HR samples in window: ${p.hrSamples}`,
    p.hasAnchor ? '' : '(no clock anchor — raw-tag counts unavailable)',
    p.rawByTag?.length ? 'raw BLE tags in window:' : 'raw BLE tags in window: (none)',
    ...(p.rawByTag ?? []).map((t: any) => `  ${t.tag}: ${t.count}`),
    '',
    `verdict: ${verdict(p)}`,
  ]
  return lines.filter((l: string) => l !== undefined).join('\n')
}

function verdict(p: any): string {
  const cov = p.accel?.coveragePct ?? 0
  if (cov >= 60 && p.hrSamples > 10) return 'rich motion + HR — neural Phase B looks feasible'
  if (cov >= 20 || p.hrSamples > 5) return 'partial capture — Phase B maybe, needs more data'
  return 'sparse — ring likely power-gated during the workout; Phase A (MET) is the ceiling'
}
