import { estimateOneRm } from '../1rm'
import { computeIntensityPct } from './set-aggregates'

/**
 * Issue 2357 (owner-signed 2026-10-06, "yes, re-derive"): the stored 1RM of a working set from a
 * styleless slot was computed with the AMRAP discount, which the owner ruled a false premise —
 * those were chosen working sets, not all-out ones. `calculate1RM` no longer applies it; this plans
 * the re-derive of the logs stored before that, through the same `estimateOneRm` every log path
 * calls, so the stored number is exactly what the log path would store today.
 *
 * Pure: the caller (`lib/workout/rederive-styleless-one-rm.ts`) selects the logs and writes the
 * changes. **Upward only**, as signed: a log whose re-derived value is LOWER than the stored one is
 * reported (`wouldLower`) and never written. That can only happen to a row stored under some older
 * formula, and lowering a stored 1RM was not what the owner approved. A log already at its
 * re-derived value is `unchanged`, which is what makes a second run write nothing.
 */

export interface StylelessLogInput {
  exerciseLogId: string
  exerciseName: string
  loggedAt: Date
  estimated1rm: number
  target80: number | null
  sets: { setLogId: string; weightKg: number; reps: number; intensityPct: number | null }[]
}

export interface StylelessLogChange {
  exerciseLogId: string
  exerciseName: string
  loggedAt: Date
  before: { estimated1rm: number; target80: number | null }
  after: { estimated1rm: number; target80: number }
  sets: { setLogId: string; intensityPct: number | null }[]
}

export interface StylelessRederivePlan {
  changes: StylelessLogChange[]
  unchanged: number
  /** Re-derived lower than stored: reported, never written. */
  wouldLower: { exerciseLogId: string; exerciseName: string; loggedAt: Date; stored: number; rederived: number }[]
}

export function planStylelessOneRmRederive(logs: readonly StylelessLogInput[]): StylelessRederivePlan {
  const changes: StylelessLogChange[] = []
  const wouldLower: StylelessRederivePlan['wouldLower'] = []
  let unchanged = 0
  for (const log of logs) {
    if (log.sets.length === 0 || !(log.estimated1rm > 0)) { unchanged++; continue }
    const { estimated1rm, target80 } = estimateOneRm(
      log.sets.map(s => ({ weightKg: s.weightKg, reps: s.reps })),
      { exerciseType: 'weighted', style: null },
    )
    if (estimated1rm === log.estimated1rm) { unchanged++; continue }
    if (estimated1rm < log.estimated1rm) {
      wouldLower.push({ exerciseLogId: log.exerciseLogId, exerciseName: log.exerciseName, loggedAt: log.loggedAt, stored: log.estimated1rm, rederived: estimated1rm })
      continue
    }
    changes.push({
      exerciseLogId: log.exerciseLogId,
      exerciseName: log.exerciseName,
      loggedAt: log.loggedAt,
      before: { estimated1rm: log.estimated1rm, target80: log.target80 },
      after: { estimated1rm, target80 },
      // The same per-set intensity the edit path writes beside a new estimate.
      sets: log.sets.map(s => ({ setLogId: s.setLogId, intensityPct: computeIntensityPct(s.weightKg, estimated1rm) })),
    })
  }
  return { changes, unchanged, wouldLower }
}

/** Median of the relative moves, in percent to one decimal; null with no changes. */
export function medianStylelessMovePct(changes: readonly StylelessLogChange[]): number | null {
  if (changes.length === 0) return null
  const pcts = changes.map(c => (c.after.estimated1rm / c.before.estimated1rm - 1) * 100).sort((a, b) => a - b)
  const mid = Math.floor(pcts.length / 2)
  const m = pcts.length % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2
  return Math.round(m * 10) / 10
}
