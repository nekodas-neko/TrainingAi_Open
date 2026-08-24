'use client'
import { useState } from 'react'
import { Footprints, Play, AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { runRedecodeJob } from './redecode-job'

/**
 * D0 historical step backfill — owner-gated, two-step (preview then fire). The rollup's steps step
 * only ever raises a stored day's count; this is the separate lever that corrects the OLD, inflated
 * flat-30-estimate days downward now that step_counter's accuracy is confirmed (owner counted-walk
 * validation). "Preview" is read-only and safe to run any number of times — it computes exactly what
 * would change without writing. "Run backfill now" is the destructive step: it rewrites every day the
 * preview lists. A `manual`-sourced day is never touched by either (protected by the sourceMap rank
 * merge, same as every other Oura write).
 */
interface PreviewRow { date: string; oldSteps: number; oldSource: string | null; newSteps: number }
interface PreviewResult { affectedDays: number; totalOldSteps: number; totalNewSteps: number; rows: PreviewRow[] }

export function StepBackfillConsole() {
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function runPreview() {
    setPreviewing(true)
    setPreviewError(null)
    setRunResult(null)
    try {
      const res = await fetch('/api/oura-ble/samples/step-backfill-preview')
      const data = await res.json()
      if (!res.ok) { setPreviewError(data?.error ?? `HTTP ${res.status}`); setPreview(null) }
      else setPreview(data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewing(false)
    }
  }

  async function fireBackfill() {
    if (!preview || preview.affectedDays === 0) return
    setConfirmOpen(false)
    setRunning(true)
    setRunResult(null)
    // Q-318: the backfill runs as a polled job. Read synchronously it reported "Done. Backfill
    // applied" the moment the request returned — which on real data is a gateway timeout, long
    // before the re-aggregate has written anything.
    const outcome = await runRedecodeJob('allowStepsDecrease=1', setRunResult)
    if (outcome.kind === 'failed') {
      setRunResult(`ERROR: ${outcome.message}`)
    } else if (outcome.phases.aggregateError ?? outcome.phases.redecodeError) {
      setRunResult(`Error: ${outcome.phases.aggregateError ?? outcome.phases.redecodeError}`)
    } else {
      setRunResult('Done. Backfill applied — re-run preview to confirm 0 days remain.')
      setPreview(null)
    }
    setRunning(false)
  }

  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Footprints className="h-4 w-4" /> D0 historical step backfill
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Corrects old, inflated flat-30-estimate step days down to the real step_counter total. Preview
        first (read-only, safe to re-run) — it lists exactly which days would change. Manual entries are
        never affected.
      </p>

      <Button size="sm" variant="outline" onClick={runPreview} disabled={previewing}>
        <RefreshCw className={`mr-1 h-4 w-4 ${previewing ? 'animate-spin' : ''}`} />
        {previewing ? 'Computing…' : 'Preview backfill'}
      </Button>

      {previewError && <p className="mt-2 text-xs text-destructive">Error: {previewError}</p>}

      {preview && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            <strong>{preview.affectedDays}</strong> day(s) would change — total steps{' '}
            <strong>{preview.totalOldSteps.toLocaleString()}</strong> → <strong>{preview.totalNewSteps.toLocaleString()}</strong>
          </p>
          {preview.affectedDays > 0 && (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre rounded-md bg-muted p-2 font-mono text-[11px] leading-tight">
                {preview.rows.map(r => `${r.date}  ${String(r.oldSteps).padStart(6)} → ${String(r.newSteps).padStart(6)}  (was: ${r.oldSource ?? 'none'})`).join('\n')}
              </pre>
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-muted-foreground">This rewrite is not reversible — the old values are gone once applied.</span>
              </div>
              <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)} disabled={running}>
                <Play className="mr-1 h-4 w-4" /> {running ? 'Running…' : 'Run backfill now'}
              </Button>
            </>
          )}
        </div>
      )}

      {runResult && <p className="mt-2 text-xs">{runResult}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Rewrite historical step counts?"
        message={preview
          ? `This rewrites ${preview.affectedDays} historical day(s)' step counts (total ${preview.totalOldSteps.toLocaleString()} → ${preview.totalNewSteps.toLocaleString()}). The old values are NOT recoverable after this. Manual entries are never touched.`
          : ''}
        confirmLabel="Run backfill"
        onConfirm={fireBackfill}
      />
    </section>
  )
}
