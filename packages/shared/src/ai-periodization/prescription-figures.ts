// The two whole-session figures a prescription carries — the "~N min of work" estimate and the
// per-muscle weekly volume — computed in ONE place from the rows that will be trained.
//
// They used to be summed by hand at three sites (the whole-session deload builder, the program-as-
// written builder and the budget stage), and #2403 needed a fourth: the same two figures for the
// session `Full` actually trains when the lifter overrides a deload. A fourth copy of the loop is
// how the figures drift, so all four read this.

import { estimateSessionDurationMin } from '@trainingai/shared/workout/duration-model'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { AiPrescriptionExercise, PrescriptionFigures } from '@trainingai/shared/types/ai-periodization'

/** One row to cost: the shape that will be trained for one session exercise. */
export interface FigureRow {
  sessionExerciseId: string
  sets: number
  reps: number
  pct: number
  restSec: number
  /** The measured rest the duration model should plan on. Omitted, it is resolved from the
   *  exercise's time profile at this row's `pct`. The budget stage passes its own, because on a
   *  shorter day it scales the measured rest with the shortened timer (#2284). */
  measuredRestSec?: number | null
}

/**
 * Duration and weekly volume over `rows`. Rows with no signal still cost time on the constant
 * model (a 240 s transition, no measured overrides) but contribute no volume — they have no
 * muscle assignments to credit. Volume is keyed by `muscle.toLowerCase()`, the way every
 * consumer of `weeklyVolumeContribution` reads it.
 */
export function prescriptionFigures(
  rows: readonly FigureRow[],
  signals: Pick<PrescriptionSignals, 'exercises'>,
): PrescriptionFigures {
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))

  const estimatedSessionDurationMin = estimateSessionDurationMin(
    rows.map(row => {
      const sig = sigById.get(row.sessionExerciseId)
      return {
        sets: row.sets, reps: row.reps, restSec: row.restSec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: row.measuredRestSec !== undefined
          ? row.measuredRestSec
          : sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, row.pct) : null,
      }
    }),
  )

  const weeklyVolumeContribution: Record<string, number> = {}
  for (const row of rows) {
    const sig = sigById.get(row.sessionExerciseId)
    if (!sig) continue
    for (const ma of sig.muscleAssignments) {
      const weight = ma.role === 'main' ? 1.0 : 0.5
      const muscle = ma.muscle.toLowerCase()
      weeklyVolumeContribution[muscle] = (weeklyVolumeContribution[muscle] ?? 0) + row.sets * weight
    }
  }

  return { estimatedSessionDurationMin, weeklyVolumeContribution }
}

/**
 * A prescription row as `Full` trains it: a deloaded exercise with recorded full numbers
 * (`preDeload`) goes back to them; one with no record stays deloaded. The one definition of what
 * the override loads — the card's rows (`prescriptionRowAsTrained`) and the stored `fullSession`
 * figures both read it, so the numbers on the card and the minutes above them describe one session.
 */
export function rowUnderFull<T extends Pick<AiPrescriptionExercise, 'deloaded' | 'preDeload'>>(ex: T): T {
  return ex.deloaded && ex.preDeload ? { ...ex, ...ex.preDeload, deloaded: false } : ex
}

/** True when `Full` would change any of these rows — the only case a `fullSession` block is worth
 *  storing. Without one the stored figures already describe what runs. */
export function hasFullSessionRevert(exercises: ReadonlyArray<Pick<AiPrescriptionExercise, 'deloaded' | 'preDeload'>>): boolean {
  return exercises.some(ex => ex.deloaded === true && !!ex.preDeload)
}
