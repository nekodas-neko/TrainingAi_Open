/**
 * What the raw store's numbers MEAN (Q-538).
 *
 * The console has printed `total / rolled up / unrolled / on disk / low disk` since Q-33, and the
 * numbers were correct. Nothing said what they were telling you. The owner read the first-ever
 * device measurement on 2026-08-18 — **209,326 rows, 0 rolled up, 31.2 MB** — and it took a source
 * trace to establish that `0 rolled up` is not a curiosity but the fault: `pruneRaw`'s predicate is
 * `rolled_up = 1 AND synced = 1 AND measured_at < ?`, so with nothing marked rolled up the
 * documented 14-day retention window can delete **no row at all**, and the store grows without a
 * bound at the measured ~3.4 MB/day.
 *
 * A readout that needs a source trace to interpret is a readout with a missing half. These are the
 * findings the numbers already support, said out loud.
 *
 * Deliberately a pure function over the plugin's own return shape: the console is native-only
 * (`getOuraBle()` is null in a browser), so this is the part that can be tested at all.
 */

export interface RawStoreStats {
  totalRows: number
  unrolledRows: number
  bytes: number
  lowDisk: boolean
}

export interface RawStoreFinding {
  /** `warn` is a fault to act on; `note` is context that changes how a number should be read. */
  level: 'warn' | 'note'
  text: string
}

/** Android Auto Backup's per-app cloud quota. `allowBackup="true"` is set with no
 *  `dataExtractionRules` (`AndroidManifest.xml:14`), so everything past this is simply not backed
 *  up — measured true for this store within two weeks of a reinstall. */
export const AUTO_BACKUP_QUOTA_BYTES = 25 * 1024 * 1024

export function rawStoreFindings(s: RawStoreStats): RawStoreFinding[] {
  const out: RawStoreFinding[] = []
  const rolled = s.totalRows - s.unrolledRows

  if (s.totalRows > 0 && rolled === 0) {
    out.push({
      level: 'warn',
      text:
        'Nothing is marked rolled up, so the 14-day prune matches no rows and cannot delete any. ' +
        'This store has no upper bound until the rollup consumer sets `rolled_up` (Q-538).',
    })
  }

  if (s.bytes > AUTO_BACKUP_QUOTA_BYTES) {
    out.push({
      level: 'warn',
      text:
        `Past Android Auto Backup's ${Math.round(AUTO_BACKUP_QUOTA_BYTES / 1024 / 1024)} MB per-app ` +
        'quota, so none of this store is backed up by the phone.',
    })
  }

  if (s.lowDisk) {
    out.push({
      level: 'warn',
      text: 'The service is shedding raw rows to stay under the disk floor — frames are being lost.',
    })
  }

  // Said whenever anything is rolled up, because "some" is the state that looks healthy and can
  // still be falling behind — the retention decision's own warning about a silent lag.
  if (s.totalRows > 0 && rolled > 0 && s.unrolledRows > 0) {
    out.push({
      level: 'note',
      text: `${pct(s.unrolledRows, s.totalRows)}% of rows are still unrolled and cannot be pruned yet.`,
    })
  }

  return out
}

function pct(part: number, whole: number): number {
  return Math.round((part / whole) * 100)
}
