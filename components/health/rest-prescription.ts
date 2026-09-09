/**
 * What the plan prescribes for rest, against what actually gets taken (Q-300).
 *
 * **The framing is the finding, and the obvious one is wrong.** Measured over 344 sets across 27
 * sessions, 39.8% are "rushed" against their prescription — but the rushing is *uniform*: no session
 * is rush-free and none is mostly-rushed, mean 0.411 with sd 0.138. "You rushed today" is therefore
 * meaningless, because every day is that day. What the same data does say is sharper:
 *
 * | planned | mean actual |
 * |---|---|
 * | 60 s  | **75 s** — longer than asked |
 * | 90 s  | 65 s |
 * | 120 s | 110 s |
 * | 187 s | 133 s |
 *
 * Prescribed rest spans 60–187 s; actual rest spans 65–133 s. The prescription is **compressed
 * toward a personal pace** rather than followed, and at the shortest one it is exceeded. That is a
 * fact about the plan being unrealistic or unnoticed, not about the lifter running late — which is
 * why this reports the pairs and says nothing about discipline.
 *
 * **No score, no verdict, no recommendation.** The entry is explicit that nothing here licenses a
 * rest term in the RPE model, and the owner asked for a plain fact.
 */

/** Only the two fields this needs, so a caller can pass local rows or server ones. */
export interface RestSet {
  plannedRestSec: number | null
  restTimeSec: number | null
}

export interface RestRow {
  plannedSec: number
  /** Mean rest actually taken at this prescription, seconds. */
  actualSec: number
  sets: number
}

export interface RestPrescriptionSummary {
  rows: RestRow[]
  totalSets: number
  /**
   * True when actual rest spans materially less range than the prescription does — the "compressed
   * toward one pace" reading. Null when there are too few prescriptions to compare a span at all,
   * which is different from "the plan is being followed" and must not print as it.
   */
  compressed: boolean | null
}

/**
 * A prescription needs this many sets before it gets a row.
 *
 * Below it a single unusual rest moves the mean by more than the effect being shown — the 187 s
 * prescription in the production data has 9 sets and is the thinnest one worth printing.
 */
const MIN_SETS_PER_ROW = 5

/** Two prescriptions are the fewest that can have a span to compare. */
const MIN_ROWS_FOR_SPAN = 2

/**
 * Actual span this fraction of the planned span or less reads as compressed.
 *
 * The production figures are a 127 s planned span against 68 s actual — 0.54. Set at two thirds so
 * the sentence appears for a clear compression and stays quiet for a mild one.
 */
const COMPRESSED_AT = 2 / 3

export function restByPrescription(sets: RestSet[]): RestPrescriptionSummary | null {
  const byPlanned = new Map<number, number[]>()
  for (const s of sets) {
    // A prescription of 0 is "no rest planned", not a target to compare against.
    if (typeof s.plannedRestSec !== 'number' || !Number.isFinite(s.plannedRestSec) || s.plannedRestSec <= 0) continue
    if (typeof s.restTimeSec !== 'number' || !Number.isFinite(s.restTimeSec) || s.restTimeSec < 0) continue
    const bucket = byPlanned.get(s.plannedRestSec)
    if (bucket) bucket.push(s.restTimeSec); else byPlanned.set(s.plannedRestSec, [s.restTimeSec])
  }

  const rows: RestRow[] = []
  for (const [plannedSec, taken] of byPlanned) {
    if (taken.length < MIN_SETS_PER_ROW) continue
    rows.push({
      plannedSec,
      actualSec: Math.round(taken.reduce((a, b) => a + b, 0) / taken.length),
      sets: taken.length,
    })
  }
  if (rows.length === 0) return null
  rows.sort((a, b) => a.plannedSec - b.plannedSec)

  return {
    rows,
    totalSets: rows.reduce((n, r) => n + r.sets, 0),
    compressed: compressionOf(rows),
  }
}

/**
 * Null rather than false below two rows.
 *
 * One prescription has no span, and reporting that as "not compressed" would state the opposite of
 * what is known — the difference between "your rest follows the plan" and "there is not enough here
 * to say", which is the whole reason this returns three states.
 */
function compressionOf(rows: RestRow[]): boolean | null {
  if (rows.length < MIN_ROWS_FOR_SPAN) return null
  const plannedSpan = rows[rows.length - 1].plannedSec - rows[0].plannedSec
  if (plannedSpan <= 0) return null
  const actuals = rows.map(r => r.actualSec)
  const actualSpan = Math.max(...actuals) - Math.min(...actuals)
  return actualSpan <= plannedSpan * COMPRESSED_AT
}

/** `+25%` / `−28%` — how far the taken rest sits from what was asked. */
export function deltaPct(row: RestRow): number {
  return Math.round(((row.actualSec - row.plannedSec) / row.plannedSec) * 100)
}
