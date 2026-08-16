'use client'
import { useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOuraBle } from '@/lib/oura-ble/plugin'

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

  async function run() {
    setRunning(true)
    setLog('')
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
    } catch (err) {
      setLog(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
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
    </section>
  )
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
