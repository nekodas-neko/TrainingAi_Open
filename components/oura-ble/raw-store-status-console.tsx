'use client'
import { useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOuraBle } from '@/lib/oura-ble/plugin'
import {
  isRawPruneEnabled, maintainOuraRawStore, readRawMaintenanceLog, setRawPruneEnabled,
} from '@/lib/oura-ble/raw-store-maintenance'
import type { RawMaintenanceResult } from '@/lib/oura-ble/raw-rolled-up-from-server'
import { rawStoreFindings, type RawStoreFinding } from './raw-store-health'

/**
 * On-device raw-store health: total and unrolled row counts, bytes on disk, and the two health
 * flags. The native bridge has exposed `rawStats()` since the raw store shipped, but nothing
 * rendered it — so the §4 runbook in `docs/oura-ble-operations.md` documented checks (steps
 * 3b / Task-3-confirm) the admin console could not actually perform (Q-33).
 *
 * Native-only by construction: `getOuraBle()` returns null in a browser, so this reports that
 * plainly rather than rendering zeros that look like real measurements.
 */
export function RawStoreStatusConsole() {
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState('')
  const [findings, setFindings] = useState<RawStoreFinding[]>([])

  async function run() {
    setRunning(true)
    setLog('')
    setFindings([])
    try {
      const ble = await getOuraBle()
      if (!ble) {
        setLog('Not available in the browser — the raw store lives in the native service. Open this on the device.')
        return
      }
      const s = await ble.plugin.rawStats()
      const rolled = s.totalRows - s.unrolledRows
      setLog([
        `total rows      ${s.totalRows.toLocaleString()}`,
        `rolled up       ${rolled.toLocaleString()}`,
        `unrolled        ${s.unrolledRows.toLocaleString()}`,
        `on disk         ${formatBytes(s.bytes)}`,
        `low disk        ${s.lowDisk ? 'YES — the service is shedding raw rows' : 'no'}`,
      ].join('\n'))
      // Q-538: the numbers alone needed a source trace to read. `rolled up 0` is the fault, not a
      // curiosity — it means the retention window can delete nothing.
      setFindings(rawStoreFindings(s))
    } catch (err) {
      setLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
    <section className="rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Database className="h-4 w-4" /> Raw store
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Row counts, disk use and the low-disk flag for the on-device raw sample store. This is what
        the operations runbook&rsquo;s retention checks read.
      </p>
      <Button size="sm" variant="outline" onClick={run} disabled={running}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
        {running ? 'Reading…' : 'Read stats'}
      </Button>
      {log && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
          {log}
        </pre>
      )}
      {findings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {findings.map(f => (
            <li
              key={f.text}
              className={`flex gap-1.5 text-[11px] leading-snug ${
                f.level === 'warn' ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {/* A symbol beside the colour, not colour alone — the repo's own rule, and this card
                  is read on a phone in whatever light the owner happens to be standing in. */}
              <span aria-hidden className="flex-none font-bold">{f.level === 'warn' ? '!' : '·'}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
    <RawStoreMaintenanceConsole />
    </>
  )
}

/**
 * #2579 — the raw-store maintenance pass: marks raw rows "folded on the server" from the server
 * rollup's watermark, and prunes them only once the owner turns the flag on. This card is where the
 * owner reads the would-prune count before deciding, and where the flag is switched.
 */
function RawStoreMaintenanceConsole() {
  const [running, setRunning] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [last, setLast] = useState<RawMaintenanceResult | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setEnabled(isRawPruneEnabled())
    setLast(readRawMaintenanceLog().at(-1) ?? null)
  }, [])

  async function runNow() {
    setRunning(true)
    try {
      const r = await maintainOuraRawStore({ force: true })
      setLast(r ?? readRawMaintenanceLog().at(-1) ?? null)
    } finally {
      setRunning(false)
    }
  }

  function setFlag(on: boolean) {
    setRawPruneEnabled(on)
    setEnabled(isRawPruneEnabled())
    setConfirming(false)
  }

  return (
    <section className="mt-3 rounded-lg border border-border p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Database className="h-4 w-4" /> Raw store maintenance
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Marks raw rows the server&rsquo;s rollup has already folded (6 h behind its watermark), then
        counts what a prune would delete. Pruning keeps 14 days and deletes only rows the server
        holds. It is off until you turn it on.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run now'}
        </Button>
        {enabled ? (
          <Button size="sm" variant="outline" onClick={() => setFlag(false)}>Turn pruning off</Button>
        ) : confirming ? (
          <>
            <Button size="sm" variant="destructive" onClick={() => setFlag(true)}>Yes, prune this phone</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Turn pruning on…</Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Pruning: <span className="font-semibold">{enabled ? 'ON' : 'OFF'}</span>
        {confirming && ' — deletes rows from this phone’s raw store on the next pass. The server keeps its copy.'}
      </p>
      {last && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
          {formatMaintenance(last)}
        </pre>
      )}
    </section>
  )
}

function formatMaintenance(r: RawMaintenanceResult): string {
  // UTC on purpose: these are cutoffs compared against `measured_at`, which is UTC milliseconds, and a
  // diagnostic read beside the server's numbers should not need a timezone conversion to check.
  const when = (ms: number | null) => (ms == null ? '—' : `${new Date(ms).toISOString()}`)
  const lines = [
    `last pass       ${when(r.at)} (${r.outcome})`,
    `server folded   ${when(r.rolledThroughMs)}`,
    `marked to       ${when(r.markCutoffMs)}`,
    `marked now      ${r.marked.toLocaleString()} rows${r.hitPageCap ? ' (page cap — continues next pass)' : ''}`,
    `prune before    ${when(r.pruneCutoffMs)}`,
    r.pruneEnabled
      ? `pruned          ${r.pruned.toLocaleString()} rows`
      : `would prune     ~${(r.wouldPrune ?? 0).toLocaleString()} rows (prune is OFF)`,
  ]
  if (r.statsAfter) {
    lines.push(
      `store now       ${r.statsAfter.totalRows.toLocaleString()} rows, ` +
      `${r.statsAfter.unrolledRows.toLocaleString()} unrolled, ${formatBytes(r.statsAfter.bytes)}`,
    )
  }
  if (r.error) lines.push(`error           ${r.error}`)
  return lines.join('\n')
}

/** Bytes → a human size. Kept local: it is display-only for one card, not a shared formatter. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}
