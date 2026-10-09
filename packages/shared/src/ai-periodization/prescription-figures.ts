// The two whole-session figures a prescription carries — the "~N min of work" estimate and the
// per-muscle weekly volume — computed in ONE place from the rows that will be trained.
//
// They used to be summed by hand at three sites (the whole-session deload builder, the program-as-
// written builder and the budget stage), and #2403 needed a fourth: the same two figures for the
// session `Full` actually trains when the lifter overrides a deload. A fourth copy of the loop is
// how the figures drift, so all four read this.

import { estimateSessionDurationMin } from '@trainingai/shared/workout/duration-model'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import type { ExerciseTimeProfile } from '@trainingai/shared/workout/time-profile'
import type { AiPrescription, AiPrescriptionExercise, PrescriptionFigures } from '@trainingai/shared/types/ai-periodization'

/** The three per-exercise inputs a row is costed with. A full `PrescriptionSignals` satisfies it,
 *  so does the cheap set the re-cost paths load (`loadFigureSignals`). */
export interface FigureSignalExercise {
  sessionExerciseId: string
  muscleAssignments: Array<{ muscle: string; role: 'main' | 'secondary' }>
  timeProfile: ExerciseTimeProfile | null
  transitionSec: number
}
export interface FigureSignals { exercises: ReadonlyArray<FigureSignalExercise> }

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
  signals: FigureSignals,
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

const NUMBERS = ['sets', 'reps', 'pct', 'restSec'] as const

/** True when a row's training numbers differ between two versions of the same prescription (a
 *  deload applied or put back). A note refresh is not a move: it changes no figure. */
export function rowNumbersMoved(
  before: ReadonlyArray<AiPrescriptionExercise>,
  after: ReadonlyArray<AiPrescriptionExercise>,
): boolean {
  const byId = new Map(before.map(ex => [ex.sessionExerciseId, ex]))
  return after.some(ex => {
    const prev = byId.get(ex.sessionExerciseId)
    return !!prev && NUMBERS.some(k => prev[k] !== ex[k])
  })
}

/**
 * A prescription whose rows moved between deloaded and full, with both whole-session figures costed
 * again over the new rows through `prescriptionFigures` — no second estimate. `fullSession` is
 * re-derived from the same rows (a no-op when only deload state moved, since `preDeload` stays
 * equal to the full numbers) and dropped when nothing is left to revert. Returns the input
 * untouched when the result would not be a real number, so a bad input can never store a zero or
 * NaN where a figure was.
 */
export function recostPrescription(prescription: AiPrescription, signals: FigureSignals): AiPrescription {
  const rows = prescription.exercises
  const figures = prescriptionFigures(rows, signals)
  const full = hasFullSessionRevert(rows) ? prescriptionFigures(rows.map(rowUnderFull), signals) : null
  const real = (f: PrescriptionFigures) => Number.isFinite(f.estimatedSessionDurationMin) && f.estimatedSessionDurationMin > 0
  if (!real(figures) || (full && !real(full))) return prescription
  const { fullSession: _stale, ...rest } = prescription
  return { ...rest, ...figures, ...(full && { fullSession: full }) }
}

/**
 * The `Full` figures for a prescription whose stored figures do NOT cover exactly `rows` — the
 * Workout Review apply, whose blob holds only the rows it overlays while the stored minutes are the
 * review's projection of the WHOLE session. Costing the blob alone would undercount, so the
 * difference `Full` makes is costed over `rows` (through `prescriptionFigures`, as everywhere) and
 * added to the stored figures. Null when no row has anything to revert, or the result is not a real
 * number.
 */
export function fullSessionAlongside(
  rows: ReadonlyArray<AiPrescriptionExercise>,
  stored: PrescriptionFigures,
  signals: FigureSignals,
): PrescriptionFigures | null {
  if (!hasFullSessionRevert(rows)) return null
  const asIs = prescriptionFigures(rows, signals)
  const full = prescriptionFigures(rows.map(rowUnderFull), signals)
  const volume: Record<string, number> = { ...stored.weeklyVolumeContribution }
  for (const muscle of new Set([...Object.keys(asIs.weeklyVolumeContribution), ...Object.keys(full.weeklyVolumeContribution)])) {
    const delta = (full.weeklyVolumeContribution[muscle] ?? 0) - (asIs.weeklyVolumeContribution[muscle] ?? 0)
    if (delta !== 0) volume[muscle] = Math.max(0, (volume[muscle] ?? 0) + delta)
  }
  const estimatedSessionDurationMin = Math.round(
    stored.estimatedSessionDurationMin + full.estimatedSessionDurationMin - asIs.estimatedSessionDurationMin)
  if (!Number.isFinite(estimatedSessionDurationMin) || estimatedSessionDurationMin <= 0) return null
  return { estimatedSessionDurationMin, weeklyVolumeContribution: volume }
}
