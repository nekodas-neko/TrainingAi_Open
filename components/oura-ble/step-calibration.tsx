'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCopy } from '@/lib/use-copy'
import { hexToBytes } from '@/lib/oura-ble/decode'
import { pairStepFeatures, type StepFeatureFrame } from '@/lib/oura-ble/step-features'
import {
  estimateSteps,
  WALK_CADENCE_COLUMN,
  WALK_CADENCE_MAX,
  STEPS_PER_WINDOW,
} from '@trainingai/shared/health/step-estimate'

/**
 * Step-calibration capture panel for /admin/oura-ble.
 *
 * The problem it solves: the plain "Dump step frames" button returns the ring's whole
 * recent history buffer (~25 min) with unreliable wall-clock timestamps (anchor drift),
 * so an activity can't be cleanly labelled. This panel brackets a capture by ring
 * timestamp (`ds`, the one reliable monotonic counter): mark the current newest `ds`, do
 * the activity, then compute over only the frames newer than the mark — pairing 0x7e/0x7f
 * via unpack27 and surfacing column 14 (`WALK_CADENCE_COLUMN`, the SHIPPED walk gate —
 * ≤ `WALK_CADENCE_MAX` counts as walking) plus the gate's own verdict (windows classified
 * walking → estimated steps) for the captured span. Capture a NON-walk activity (driving,
 * gym, cooking) with a real step count of 0 and any estimate it shows is pure false-
 * positive inflation — this is the tool for finding where the full-day over-count comes
 * from. The copyable JSON is the exact fixture format for retuning the threshold offline.
 */

interface RawRow {
  ringTimestampDs: number
  tag: number
  bodyHex: string
}

interface CapturePair {
  ds: number
  /** The shipped walk-gate feature (unpack27 column 14). ≤ WALK_CADENCE_MAX = walking. */
  gate: number
  f1: string
  f2: string
  cols: number[]
}

interface Capture {
  label: string
  expectedSteps: number | null
  markDs: number
  pairs: CapturePair[]
  /** Stats over the gate column (col14) across the captured windows. */
  stats: { n: number; min: number; max: number; mean: number } | null
  /** The shipped estimator's verdict for this span. */
  walkingWindows: number
  estimatedSteps: number
}

async function fetchStepRows(): Promise<RawRow[]> {
  const res = await fetch('/api/oura-ble/samples/raw?tags=7e,7f&limit=1000')
  if (!res.ok) throw new Error(`raw fetch failed: ${res.status}`)
  const { rows } = (await res.json()) as { rows: RawRow[] }
  return rows
}

export function StepCalibration({ onSync }: { onSync: () => Promise<void> }) {
  const [label, setLabel] = useState('idle')
  const [expected, setExpected] = useState('')
  const [markDs, setMarkDs] = useState<number | null>(null)
  const [captures, setCaptures] = useState<Capture[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { copied, copy } = useCopy()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Poll the DB until the newest stored step-frame ds stops advancing — i.e. the ring's
  // drained backlog has finished ingesting. POST+store lags the drain by many seconds on a
  // large backlog, so a fixed wait marks mid-backlog and the rest floods in after the mark.
  const waitForIngestSettle = useCallback(async (): Promise<number> => {
    let prev = -1
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const rows = await fetchStepRows()
      const cur = rows.reduce((m, r) => Math.max(m, r.ringTimestampDs), 0)
      if (cur === prev) return cur
      prev = cur
    }
    return prev
  }, [])

  const markStart = useCallback(async () => {
    setBusy(true)
    setNote('Syncing ring & waiting for the backlog to finish landing…')
    try {
      // Drain the ring, then wait until the whole backlog has actually ingested before
      // marking — otherwise the mark lands mid-backlog and pre-test activity floods in
      // behind it, contaminating the capture. Can take 10–30 s after a long gap.
      await onSync()
      const settled = await waitForIngestSettle()
      setMarkDs(settled)
      setNote(`Marked at ds=${settled} (ring fully synced). Now do the activity, then tap "Sync + compute".`)
    } catch (e) {
      setNote(`mark failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [onSync, waitForIngestSettle])

  const compute = useCallback(async () => {
    if (markDs == null) {
      setNote('Tap "Mark start" first.')
      return
    }
    setBusy(true)
    try {
      const rows = await fetchStepRows()
      const fresh = rows.filter((r) => r.ringTimestampDs > markDs)
      const bodyByDs = new Map(fresh.map((r) => [r.ringTimestampDs, r.bodyHex]))
      const frames: StepFeatureFrame[] = fresh.map((r) => ({
        ds: r.ringTimestampDs,
        tag: r.tag,
        body: hexToBytes(r.bodyHex),
      }))
      const paired = pairStepFeatures(frames)
      const pairs: CapturePair[] = paired
        .map((p) => ({
          ds: p.ds,
          gate: p.columns[WALK_CADENCE_COLUMN],
          cols: p.columns,
          f1: bodyByDs.get(p.ds) ?? '',
          f2: bodyByDs.get(p.ds + 1) ?? '',
        }))
        .sort((a, b) => a.ds - b.ds)
      if (!pairs.length) {
        // Keep the mark armed so the retry buttons stay enabled — drained frames can take a
        // few seconds to land in the DB, and the ring may not have flushed the walk yet.
        setNote('No new paired step frames yet — wait ~20 s and tap "Sync + compute" again. The mark is still set, so just retry (nothing was added below).')
        return
      }
      const g = pairs.map((p) => p.gate)
      const stats = { n: g.length, min: Math.min(...g), max: Math.max(...g), mean: Math.round(g.reduce((s, v) => s + v, 0) / g.length) }
      // Run the SHIPPED estimator over the captured span so the panel shows exactly what
      // the rollup would credit — for a non-walk label (real = 0) this is the false-positive count.
      const est = estimateSteps(paired)
      const cap: Capture = {
        label: label.trim() || 'unlabeled',
        expectedSteps: expected.trim() ? Number(expected) : null,
        markDs,
        pairs,
        stats,
        walkingWindows: est.walkingWindows,
        estimatedSteps: est.estimatedSteps,
      }
      setCaptures((prev) => [...prev, cap])
      setNote(`Captured ${pairs.length} window(s) for "${cap.label}" — estimator credited ${est.estimatedSteps} step(s).`)
      setMarkDs(null)
    } catch (e) {
      setNote(`compute failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [markDs, label, expected])

  const syncAndCompute = useCallback(async () => {
    setBusy(true)
    setNote('Syncing ring…')
    try {
      await onSync()
      // Drained frames POST + store asynchronously — wait until ingest settles before reading.
      await waitForIngestSettle()
    } catch {
      /* onSync surfaces its own errors in the log console */
    } finally {
      setBusy(false)
    }
    await compute()
  }, [onSync, compute, waitForIngestSettle])

  const json = useMemo(
    () =>
      JSON.stringify(
        captures.map((c) => ({
          label: c.label,
          expectedSteps: c.expectedSteps,
          estimatedSteps: c.estimatedSteps,
          walkingWindows: c.walkingWindows,
          gateThreshold: WALK_CADENCE_MAX,
          stepsPerWindow: STEPS_PER_WINDOW,
          stats: c.stats,
          // f1/f2 are the archival hex — every unpack27 column is recoverable offline from
          // them; `gate` (col14) is surfaced inline for quick eyeballing.
          pairs: c.pairs.map((p) => ({ ds: p.ds, f1: p.f1, f2: p.f2, gate: p.gate })),
        })),
        null,
        2,
      ),
    [captures],
  )

  const copyJson = useCallback(async () => {
    const ok = await copy(json, textareaRef.current)
    if (!ok) setNote('Auto-copy blocked — the text below is selected, long-press it and tap Copy.')
  }, [copy, json])

  const selectAll = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
  }, [])

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Brackets a capture by ring timestamp and runs the shipped walk gate (col14 ≤ {WALK_CADENCE_MAX})
        over it. Set a label + the real step count, tap <span className="font-medium">Mark start</span>,
        do the activity, then <span className="font-medium">Sync + compute</span>. To hunt the full-day
        over-count, capture NON-walk activities (driving, gym, cooking, TV) with real = 0 — any estimate
        shown is false-positive inflation.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="label (e.g. walk-100)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-sm"
        />
        <input
          type="text"
          inputMode="numeric"
          placeholder="steps (real)"
          value={expected}
          onChange={(e) => setExpected(e.target.value.replace(/[^0-9]/g, ''))}
          className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={markStart} disabled={busy}>
          Mark start
        </Button>
        <Button size="sm" onClick={syncAndCompute} disabled={busy || markDs == null}>
          Sync + compute
        </Button>
        <Button size="sm" variant="ghost" onClick={compute} disabled={busy || markDs == null}>
          Compute only
        </Button>
        {markDs != null && <span className="text-xs text-muted-foreground">mark ds={markDs}</span>}
      </div>

      {note && <div className="text-xs text-muted-foreground">{note}</div>}

      {captures.length > 0 && (
        <div className="space-y-2">
          {captures.map((c, i) => (
            <div key={i} className="rounded-md bg-muted/40 p-2 text-xs">
              <div className="font-medium">
                {c.label}
                {c.expectedSteps != null && <span className="text-muted-foreground"> · real {c.expectedSteps}</span>}
                <span className={c.expectedSteps === 0 && c.estimatedSteps > 0 ? 'text-red-500' : 'text-muted-foreground'}>
                  {' '}· est {c.estimatedSteps} ({c.walkingWindows}/{c.pairs.length} walking)
                </span>
                {c.stats && (
                  <span className="text-muted-foreground">
                    {' '}
                    · col14 {c.stats.min}–{c.stats.max} (mean {c.stats.mean})
                  </span>
                )}
              </div>
              {c.pairs.length > 0 && (
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  col14: {c.pairs.map((p) => p.gate).join(', ')}
                </div>
              )}
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copyJson}>
              {copied ? 'Copied ✓' : 'Copy JSON'}
            </Button>
            <Button size="sm" variant="outline" onClick={selectAll}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCaptures([])} disabled={busy}>
              Clear
            </Button>
          </div>
          <textarea
            ref={textareaRef}
            readOnly
            spellCheck={false}
            value={json}
            onFocus={selectAll}
            className="h-44 w-full rounded-md border border-input bg-transparent p-2 font-mono text-[10px]"
          />
        </div>
      )}
    </div>
  )
}
