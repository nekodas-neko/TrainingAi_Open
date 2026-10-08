'use client'
import { useState } from 'react'
import { Activity, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { runRedecodeJob, type RedecodeOutcome } from './redecode-job'
import type { StressBackfillReport } from '@/lib/oura-ble/stress-backfill'

/**
 * What the screen says after a stress-bucket backfill press (issue 2236). The same lesson as the
 * step backfill (issue 2383): every full-history job shares one slot, so the run that finished is
 * not necessarily the one asked for. "Added" is claimed only when the finished job is itself the
 * WRITE kind and its report says it was not a dry run. A dry run never claims a write. Exported
 * for the test.
 */
export function stressBackfillResultText(outcome: RedecodeOutcome, wanted: 'dry-run' | 'write'): string {
  if (outcome.kind === 'refused') return `Not started: ${outcome.message} Nothing was changed.`
  if (outcome.kind === 'failed') return `ERROR: ${outcome.message} Nothing was added unless a report below says so.`
  const phaseError = outcome.phases.aggregateError ?? outcome.phases.redecodeError
  if (phaseError) return `Error: ${phaseError}`
  const report = outcome.phases.stressBackfill
  const kindOk = wanted === 'write' ? outcome.jobKind === 'stress-backfill' : outcome.jobKind === 'stress-backfill-dry-run'
  if (!kindOk || !report) {
    return `Not applied: the run that finished (job ${outcome.jobId}) was not a stress-bucket ${wanted === 'write' ? 'backfill' : 'dry run'}, so this press did nothing. Press again.`
  }
  if (wanted === 'dry-run') {
    return `Dry run only — nothing was written. ${report.bucketsToAdd} bucket(s) over ${report.daysToGain} day(s) would be added.`
  }
  if (report.dryRun) return 'Not applied: the report says this was a dry run.'
  return `Done. ${report.bucketsWritten} bucket(s) added over ${report.daysToGain} day(s). Run the dry run again to confirm 0 remain.`
}

/** The report as plain text for the owner to read and compare before writing. */
export function stressBackfillReportText(r: StressBackfillReport): string {
  const lines = [
    `range: ${r.range ? `${r.range.from} … ${r.range.to}` : 'none'}`,
    `days considered: ${r.daysConsidered}`,
    `days already populated (skipped): ${r.daysSkippedPopulated}`,
    `days not complete (skipped): ${r.daysSkippedNotComplete}`,
    `days that would gain buckets: ${r.daysToGain}`,
    `buckets that would be added: ${r.bucketsToAdd}`,
    `buckets already stored under another day: ${r.bucketsAlreadyPresent}`,
    `days that cannot be computed: ${r.daysCannotCompute}`,
    ...Object.entries(r.cannotComputeByReason).map(([k, v]) => `  ${k}: ${v}`),
    `depth reached: ${r.depth ? `${r.depth.from} … ${r.depth.to}` : 'none'}`,
  ]
  return lines.join('\n')
}

/**
 * Daytime-stress bucket backfill — two steps, dry run first. The forward writer only built buckets
 * for the trailing days it recomputed; this adds the days before that from stored data. It is
 * ADD-ONLY: it never deletes or changes a bucket and skips any day that already has buckets. The
 * dry run writes nothing and can be repeated; the write is offered only after one has run.
 */
export function StressBackfillConsole() {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<StressBackfillReport | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function run(wanted: 'dry-run' | 'write') {
    setConfirmOpen(false)
    setRunning(true)
    setResult(null)
    const outcome = await runRedecodeJob(wanted === 'write' ? 'stressBackfill=1&dryRun=false' : 'stressBackfill=1', setResult)
    setResult(stressBackfillResultText(outcome, wanted))
    // Only a report from the kind of run that was asked for is shown; anything else is already
    // explained by the line above and must not be mistaken for the plan.
    if (outcome.kind === 'done' && outcome.phases.stressBackfill
      && (wanted === 'write' ? outcome.jobKind === 'stress-backfill' : outcome.jobKind === 'stress-backfill-dry-run')) {
      setReport(outcome.phases.stressBackfill)
    }
    setRunning(false)
  }

  return (
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Activity className="h-4 w-4" /> Daytime-stress bucket backfill
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Adds the 30-minute stress buckets for past days the nightly writer never reached, from stored
        data. Add-only: nothing is deleted or changed, and days that already have buckets are skipped.
        Run the dry run first; take a verified snapshot before writing.
      </p>

      <Button size="sm" variant="outline" onClick={() => run('dry-run')} disabled={running}>
        <RefreshCw className={`mr-1 h-4 w-4 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Working…' : 'Dry run'}
      </Button>

      {report && (
        <div className="mt-3 space-y-2">
          <pre className="max-h-64 overflow-auto whitespace-pre rounded-md bg-muted p-2 font-mono text-[11px] leading-tight">
            {stressBackfillReportText(report)}
          </pre>
          {report.dryRun && report.bucketsToAdd > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)} disabled={running}>
              <Play className="mr-1 h-4 w-4" /> Add {report.bucketsToAdd} buckets
            </Button>
          )}
        </div>
      )}

      {result && <p className="mt-2 text-xs">{result}</p>}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Add historical stress buckets?"
        message={report
          ? `This adds ${report.bucketsToAdd} bucket(s) over ${report.daysToGain} day(s). Nothing existing is changed or deleted. Take a verified snapshot first.`
          : ''}
        confirmLabel="Add buckets"
        onConfirm={() => run('write')}
      />
    </section>
  )
}
