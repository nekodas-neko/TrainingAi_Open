'use client'

import { useCallback, useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface PackableCount {
  buckets: number
  sealBelowDs: number | null
}

interface PackRunResult {
  buckets: { epoch: number; tag: number; dsBucket: number; frames: number; bytes: number; refused?: string }[]
  packed: number
  refused: number
  framesMoved: number
  bytesWritten: number
  remaining: number
  ms: number
}

interface Stats {
  tables: { table: string; rows: number; bytes: number }[]
  rawSamples: { totalRows: number; decodedRows: number; decodedBytes: number; bodyHexBytes: number }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

// DB-footprint readout (Sub-plan G-2). Measures what the ingestion-culling levers reclaim before
// running the destructive ones — the row/byte cost per Oura table, and the reclaimable `decoded`
// JSONB vs archival `body_hex` split on oura_raw_samples. Read-only; fetched on demand.
export function DbFootprintCard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null)
  const [vacuuming, setVacuuming] = useState(false)
  const [vacuumMsg, setVacuumMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'backfill' | 'vacuum' | 'pack' | null>(null)
  const [packable, setPackable] = useState<PackableCount | null>(null)
  const [packing, setPacking] = useState(false)
  const [packMsg, setPackMsg] = useState<string | null>(null)
  const [packRefusals, setPackRefusals] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/oura-ble/db-stats')
      if (!res.ok) { setError(`db-stats failed: ${res.status}`); return }
      setStats(await res.json())
      const packRes = await fetch('/api/oura-ble/samples/pack')
      if (packRes.ok) setPackable(await packRes.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Culling Lever 1b — data-dropping (nulls the decoded JSONB on historical rows; body_hex is
  // untouched). Confirm-gated, admin-triggered only. Defaults to clearing the whole backlog in one
  // press (owner-requested); `remaining` will still be non-zero if the backlog somehow exceeds the
  // server's per-call ceiling, in which case pressing again continues from where it left off.
  const runBackfill = useCallback(async () => {
    setConfirm(null)
    setBackfilling(true)
    setBackfillMsg(null)
    try {
      const res = await fetch('/api/oura-ble/samples/backfill-null-decoded', { method: 'POST' })
      if (!res.ok) { setBackfillMsg(`backfill failed: ${res.status}`); return }
      const j = await res.json() as { nulled: number; remaining: number }
      setBackfillMsg(j.remaining > 0
        ? `nulled ${j.nulled.toLocaleString()} rows · ${j.remaining.toLocaleString()} still remaining — press again`
        : `nulled ${j.nulled.toLocaleString()} rows · backlog cleared`)
      await load()
    } catch (err) {
      setBackfillMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBackfilling(false)
    }
  }, [stats, load])

  // Culling Lever 1c — physically reclaim the disk Lever 1b freed only logically. VACUUM FULL
  // rewrites oura_raw_samples into a smaller file (Postgres MVCC leaves dead tuples until then; see
  // docs/oura-ble-operations.md I17). No data is dropped — body_hex and every row are preserved; the
  // table is briefly locked during the rewrite. Useful right after a Lever 1b run.
  const runVacuum = useCallback(async () => {
    setConfirm(null)
    setVacuuming(true)
    setVacuumMsg(null)
    try {
      const res = await fetch('/api/oura-ble/samples/vacuum', { method: 'POST' })
      if (!res.ok) { setVacuumMsg(`vacuum failed: ${res.status}`); return }
      const j = await res.json() as { beforeBytes: number; afterBytes: number; reclaimedBytes: number; ms: number }
      setVacuumMsg(`reclaimed ${fmtBytes(j.reclaimedBytes)} (${fmtBytes(j.beforeBytes)} → ${fmtBytes(j.afterBytes)}) in ${(j.ms / 1000).toFixed(1)}s`)
      await load()
    } catch (err) {
      setVacuumMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setVacuuming(false)
    }
  }, [load])

  // Q-541 Task 4 / Q-316 — move sealed buckets of raw frames into compact blobs. This is the one
  // control in the app that issues a DELETE against archival frames, so its refusals are surfaced
  // rather than folded into a count: `refused > 0` means a bucket could not be proven equal after
  // the re-read and was left intact, which is a finding, not a no-op.
  const runPack = useCallback(async () => {
    setConfirm(null)
    setPacking(true)
    setPackMsg(null)
    setPackRefusals([])
    try {
      const res = await fetch('/api/oura-ble/samples/pack', { method: 'POST' })
      if (!res.ok) { setPackMsg(`pack failed: ${res.status}`); return }
      const j = await res.json() as PackRunResult
      const parts = [
        `packed ${fmtNum(j.packed)} bucket(s) · ${fmtNum(j.framesMoved)} frames → ${fmtBytes(j.bytesWritten)}`,
        j.remaining > 0 ? `${fmtNum(j.remaining)} still packable — press again` : 'nothing left to pack',
        `${(j.ms / 1000).toFixed(1)}s`,
      ]
      if (j.refused > 0) parts.splice(1, 0, `⚠ ${fmtNum(j.refused)} refused and left intact`)
      setPackMsg(parts.join(' · '))
      setPackRefusals(
        j.buckets
          .filter(b => b.refused)
          .map(b => `epoch ${b.epoch} tag ${b.tag} bucket ${b.dsBucket} (${fmtNum(b.frames)} frames): ${b.refused}`),
      )
      await load()
    } catch (err) {
      setPackMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setPacking(false)
    }
  }, [load])

  const raw = stats?.rawSamples
  const totalBytes = stats?.tables.reduce((s, t) => s + t.bytes, 0) ?? 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">DB footprint</span>
        {stats && <span className="text-xs text-muted-foreground">· {fmtBytes(totalBytes)} total</span>}
        <button onClick={() => void load()} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {raw && (
        <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-xs">
          <p className="font-medium">oura_raw_samples — culling targets</p>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
            <dt>Rows still carrying <code>decoded</code></dt>
            <dd className="tabular-nums text-foreground">{fmtNum(raw.decodedRows)} / {fmtNum(raw.totalRows)}</dd>
            <dt><code>decoded</code> JSONB (reclaimable — Lever 1b)</dt>
            <dd className="tabular-nums text-foreground">{fmtBytes(raw.decodedBytes)}</dd>
            <dt><code>body_hex</code> (archival — Lever 5)</dt>
            <dd className="tabular-nums text-foreground">{fmtBytes(raw.bodyHexBytes)}</dd>
          </dl>
          <div className="mt-2 flex flex-col gap-2 border-t border-border/40 pt-2">
            {raw.decodedRows > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="destructive" disabled={backfilling} onClick={() => setConfirm('backfill')}>
                  {backfilling ? 'Nulling…' : 'Null historical decoded (Lever 1b)'}
                </Button>
                {backfillMsg && <span className="text-muted-foreground">{backfillMsg}</span>}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={vacuuming} onClick={() => setConfirm('vacuum')}>
                {vacuuming ? 'Vacuuming…' : 'Reclaim disk — VACUUM FULL (Lever 1c)'}
              </Button>
              {vacuumMsg && <span className="text-muted-foreground">{vacuumMsg}</span>}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="destructive" disabled={packing || packable?.buckets === 0} onClick={() => setConfirm('pack')}>
                  {packing ? 'Packing…' : 'Pack sealed frames (Lever 5)'}
                </Button>
                <span className="text-muted-foreground">
                  {packable == null
                    ? 'checking…'
                    : packable.buckets === 0
                      ? 'no sealed buckets to pack'
                      : `${fmtNum(packable.buckets)} bucket(s) packable`}
                </span>
              </div>
              {packMsg && <span className="text-muted-foreground">{packMsg}</span>}
              {packRefusals.length > 0 && (
                <ul className="ml-1 list-disc pl-4 text-destructive">
                  {packRefusals.map(r => <li key={r}>{r}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {stats && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1 text-left font-medium">Table</th>
              <th className="py-1 text-right font-medium">Rows</th>
              <th className="py-1 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {stats.tables.map(t => (
              <tr key={t.table} className="border-t border-border/40">
                <td className="py-1 pr-2 font-mono">{t.table}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{fmtNum(t.rows)}</td>
                <td className="py-1 text-right tabular-nums">{fmtBytes(t.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!stats && !error && <p className="text-xs text-muted-foreground">Loading…</p>}

      <ConfirmDialog
        open={confirm === 'backfill'}
        onOpenChange={o => !o && setConfirm(null)}
        title="Null the decoded JSONB?"
        message={`Null the "decoded" JSONB on all ${(stats?.rawSamples.decodedRows ?? 0).toLocaleString()} historical oura_raw_samples rows that still carry it? body_hex stays untouched and every row still redecodes from it. This cannot be undone automatically.`}
        confirmLabel="Null decoded"
        onConfirm={() => void runBackfill()}
      />
      <ConfirmDialog
        open={confirm === 'pack'}
        onOpenChange={o => !o && setConfirm(null)}
        title="Pack sealed raw frames?"
        message={`Move sealed buckets older than 7 days out of oura_raw_samples and into compact blobs in oura_raw_packed${packable?.buckets ? ` (${packable.buckets.toLocaleString()} eligible now)` : ''}. Each blob is re-read and its frames proved identical before the originals are deleted; a bucket that cannot be proved equal is left intact and reported. The frames are moved, not discarded — but this is the only control here that deletes archival frames at all.`}
        confirmLabel="Pack frames"
        onConfirm={() => void runPack()}
      />
      <ConfirmDialog
        open={confirm === 'vacuum'}
        onOpenChange={o => !o && setConfirm(null)}
        title="Run VACUUM FULL?"
        message='Run VACUUM FULL on oura_raw_samples to physically reclaim disk freed by nulling "decoded"? This rewrites the table and briefly locks it (usually seconds). No data is lost — body_hex and all rows are preserved.'
        confirmLabel="Run VACUUM"
        variant="default"
        onConfirm={() => void runVacuum()}
      />
    </div>
  )
}
