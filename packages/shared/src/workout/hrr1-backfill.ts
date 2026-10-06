// The historical fill for `set_hr_stats.hrr1_bpm` (#2457): which stored rows change, and to what.
// Pure — the admin route (`app/api/admin/backfill-set-hrr1`) fetches, this decides, the repo writes.
//
// Each row is re-measured with `deriveHrr60` against the merged HR series around its `logged_at`
// (the set end the row was computed from), and both `hrr1_bpm` and `rest_adequate` are set to what
// the writer produces today — null included. That is the point: the older nearest-reading rule left
// ring verdicts and shortcut-era `true`s that the COALESCE upsert could never clear.
import { deriveHrr60, restAdequateFromHrr60 } from './hrr60'
import type { HrReading } from './hr-analysis'

export interface StoredHrr1Row {
  setLogId: string
  loggedAt: Date | null
  hrr1Bpm: number | null
  restAdequate: boolean | null
}

export interface Hrr1Change {
  setLogId: string
  loggedAt: Date | null
  before: { hrr1Bpm: number | null; restAdequate: boolean | null }
  after: { hrr1Bpm: number | null; restAdequate: boolean | null }
}

/** The rows whose stored `hrr1_bpm` or `rest_adequate` differ from a fresh measurement. */
export function planHrr1Backfill(
  rows: readonly StoredHrr1Row[],
  readings: readonly (HrReading & { source?: string | null })[],
): Hrr1Change[] {
  const out: Hrr1Change[] = []
  for (const r of rows) {
    const hrr1Bpm = deriveHrr60(readings, r.loggedAt?.getTime() ?? null)?.bpm ?? null
    const restAdequate = restAdequateFromHrr60(hrr1Bpm)
    if (hrr1Bpm === r.hrr1Bpm && restAdequate === r.restAdequate) continue
    out.push({
      setLogId: r.setLogId,
      loggedAt: r.loggedAt,
      before: { hrr1Bpm: r.hrr1Bpm, restAdequate: r.restAdequate },
      after: { hrr1Bpm, restAdequate },
    })
  }
  return out
}

const verdict = (v: boolean | null) => (v === true ? 'adequate' : v === false ? 'inadequate' : 'none')

/** Counts for the run's report: rows moved, by verdict transition, and how many gain a measurement. */
export function summariseHrr1Changes(changes: readonly Hrr1Change[]) {
  const transitions: Record<string, number> = {}
  let gainedHrr1 = 0
  for (const c of changes) {
    if (c.before.hrr1Bpm == null && c.after.hrr1Bpm != null) gainedHrr1++
    if (c.before.restAdequate !== c.after.restAdequate) {
      const k = `${verdict(c.before.restAdequate)} -> ${verdict(c.after.restAdequate)}`
      transitions[k] = (transitions[k] ?? 0) + 1
    }
  }
  return { rowsChanged: changes.length, gainedHrr1, verdictTransitions: transitions }
}
