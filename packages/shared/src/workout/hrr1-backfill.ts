// The historical fill for `set_hr_stats.hrr1_bpm` (#2457): which stored rows change, and to what.
// Pure — the admin route (`app/api/admin/backfill-set-hrr1`) fetches, this decides, the repo writes.
//
// Each row is re-measured with `deriveHrr60` against the merged HR series around its set end — the timed
// `set_end_ms` where the set has one, else `logged_at`, the same anchor the live writer uses (#3238), and both `hrr1_bpm` and `rest_adequate` are set to what
// the writer produces today — null included. That is the point: the older nearest-reading rule left
// ring verdicts and shortcut-era `true`s that the COALESCE upsert could never clear.
//
// #2601 (owner 2026-10-07) adds the drop curve: a stored `drop_30s`…`drop_120s` is kept only where the
// dense rule can see that offset (`deriveHrrAt`), and takes the dense value; one it cannot see goes to
// null. A null stays null — whether that offset was inside the set's rest window was decided when
// the row was written, and is not re-decided here. #2299 step 2's personal bar decides the verdict.
import { deriveHrr60, deriveHrrAt, restAdequateFromHrr60, setRestAnchorMs } from './hrr60'
import type { HrReading } from './hr-analysis'

export interface StoredDrops {
  drop30s: number | null
  drop60s: number | null
  drop90s: number | null
  drop120s: number | null
}

export interface StoredHrr1Row extends StoredDrops {
  setLogId: string
  loggedAt: Date | null
  /** `set_logs.set_end_ms` — the timed set end, null on an untimed set. */
  setEndMs: number | null
  hrr1Bpm: number | null
  restAdequate: boolean | null
}

export type Hrr1Values = { hrr1Bpm: number | null; restAdequate: boolean | null } & StoredDrops

export interface Hrr1Change {
  setLogId: string
  loggedAt: Date | null
  before: Hrr1Values
  after: Hrr1Values
}

const DROP_OFFSETS = [['drop30s', 30_000], ['drop60s', 60_000], ['drop90s', 90_000], ['drop120s', 120_000]] as const

/** A row's HRR60 from the series, before any verdict — what the personal bar is fitted on. */
export function measureHrr60(row: Pick<StoredHrr1Row, 'loggedAt' | 'setEndMs'>, readings: readonly (HrReading & { source?: string | null })[]): number | null {
  return deriveHrr60(readings, setRestAnchorMs(row.setEndMs, row.loggedAt))?.bpm ?? null
}

/** The rows whose stored HRR60, verdict or drop curve differ from a fresh measurement. `barBpmFor`
 *  is the person's bar for the row (`personalHrr60Bar`); the population 15 when absent. */
export function planHrr1Backfill(
  rows: readonly StoredHrr1Row[],
  readings: readonly (HrReading & { source?: string | null })[],
  barBpmFor?: (row: StoredHrr1Row) => number,
): Hrr1Change[] {
  const out: Hrr1Change[] = []
  for (const r of rows) {
    const endMs = setRestAnchorMs(r.setEndMs, r.loggedAt)
    const hrr1Bpm = measureHrr60(r, readings)
    const after: Hrr1Values = {
      hrr1Bpm,
      restAdequate: restAdequateFromHrr60(hrr1Bpm, barBpmFor?.(r)),
      drop30s: null, drop60s: null, drop90s: null, drop120s: null,
    }
    for (const [key, offsetMs] of DROP_OFFSETS) {
      after[key] = r[key] == null ? null : deriveHrrAt(readings, endMs, offsetMs)?.bpm ?? null
    }
    const before: Hrr1Values = {
      hrr1Bpm: r.hrr1Bpm, restAdequate: r.restAdequate,
      drop30s: r.drop30s, drop60s: r.drop60s, drop90s: r.drop90s, drop120s: r.drop120s,
    }
    if ((Object.keys(after) as (keyof Hrr1Values)[]).every(k => after[k] === before[k])) continue
    out.push({ setLogId: r.setLogId, loggedAt: r.loggedAt, before, after })
  }
  return out
}

const verdict = (v: boolean | null) => (v === true ? 'adequate' : v === false ? 'inadequate' : 'none')

/** Counts for the run's report: rows moved, by verdict transition, and how many gain a measurement. */
export function summariseHrr1Changes(changes: readonly Hrr1Change[]) {
  const transitions: Record<string, number> = {}
  let gainedHrr1 = 0
  let dropsCleared = 0
  for (const c of changes) {
    if (c.before.hrr1Bpm == null && c.after.hrr1Bpm != null) gainedHrr1++
    if (c.before.drop60s != null && c.after.drop60s == null) dropsCleared++
    if (c.before.restAdequate !== c.after.restAdequate) {
      const k = `${verdict(c.before.restAdequate)} -> ${verdict(c.after.restAdequate)}`
      transitions[k] = (transitions[k] ?? 0) + 1
    }
  }
  return { rowsChanged: changes.length, gainedHrr1, drop60sCleared: dropsCleared, verdictTransitions: transitions }
}
