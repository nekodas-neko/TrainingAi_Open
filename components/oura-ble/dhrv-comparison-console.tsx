'use client'
import { useState } from 'react'
import { HeartPulse, Copy, Check, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * D5 admin spot-check: our own daytime-HRV regression vs the Polar H10's RR-derived rMSSD over a
 * recent window, bucketed 5-min. Wear both the ring and the H10 for a short burst, then run this
 * to see whether they roughly agree — the actual D5 validation gate, not the sandbox tests.
 * Empty until the model has had its first successful refit (needs a few days of real overnight
 * ring wear post-merge — see docs/superpowers/plans/2026-07-27-d5-own-daytime-hrv.md).
 */
export function DhrvComparisonConsole() {
  const [minutes, setMinutes] = useState('30')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [copied, setCopied] = useState(false)

  async function run() {
    setRunning(true)
    setLog('')
    try {
      const n = Math.max(1, Math.min(24 * 60, Number(minutes) || 30))
      const res = await fetch(`/api/oura-ble/comparison-harness?minutes=${n}&metric=hrv`)
      const data = await res.json()
      setLog(res.ok ? formatComparison(data) : `ERROR ${res.status}: ${data?.error ?? 'unknown'}`)
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
        <HeartPulse className="h-4 w-4" /> Comparison harness — own daytime-HRV vs Polar H10
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Wear both the ring and the H10 chest strap for a short burst, then run this over that
        window to see whether our own daytime-HRV estimate agrees with the strap&apos;s RR-derived
        rMSSD, per 5-min bucket. Empty until the model has fitted at least once (needs a few days
        of overnight ring wear).
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={24 * 60}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
          aria-label="Minutes to look back"
        />
        <span className="text-xs text-muted-foreground">minutes back</span>
        <Button size="sm" onClick={run} disabled={running}>
          <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Compare'}
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
function formatComparison(r: any): string {
  const { withinCount, outOfBandCount, meanAbsDelta } = r.summary ?? {}
  const scored = (withinCount ?? 0) + (outOfBandCount ?? 0)
  const lines: string[] = [
    `${r.metric} — ours (own model) vs reference (H10 RR→rMSSD), tolerance ±${r.toleranceBand}${r.unit}`,
    scored > 0
      ? `${withinCount}/${scored} within ±${r.toleranceBand}${r.unit}, mean |Δ| = ${meanAbsDelta?.toFixed(1)}${r.unit}`
      : '(no bucket has both sides present — no fitted model yet, or wear both devices and re-run)',
    '',
    'bucket (local)         ours    ref     Δ',
  ]
  for (const p of r.points ?? []) {
    const local = new Date(p.bucketStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const ours = p.ours === null ? '   —' : p.ours.toFixed(1).padStart(5)
    const ref = p.reference === null ? '   —' : p.reference.toFixed(1).padStart(5)
    const hasBoth = p.ours !== null && p.reference !== null
    const delta = hasBoth ? Math.abs(p.ours - p.reference) : null
    const deltaStr = delta === null ? '   —' : delta.toFixed(1).padStart(5)
    const flag = hasBoth && delta! > r.toleranceBand ? '  ⚠ out of band' : ''
    lines.push(`${local.padEnd(20)}${ours}   ${ref}   ${deltaStr}${flag}`)
  }
  return lines.join('\n')
}
