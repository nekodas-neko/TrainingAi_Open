import { normalizeMuscle } from '@trainingai/shared/muscles'

// Weekly per-muscle set landmarks for AI-dynamic programs — MEV (minimum effective volume),
// MAV (maximum adaptive volume, the sweet spot most programs target), MRV (maximum recoverable
// volume) — approximating published RP/Schoenfeld-style guidance, expressed in weekly direct
// working sets (secondary-muscle sets count at 0.5, matching getWeeklySetsByMuscleGroup).
//
// This is the single source of truth for volume targets: computeDefaultVolumeTargets (seeds a
// program's targets at creation) and volumeLandmarks (the live MEV/MAV/MRV band used to steer
// and trim sessions) both derive from the same table, so they can't drift apart.
//
// Landmarks are per-muscle rather than a large/small binary — muscle size alone doesn't predict
// volume tolerance. Biceps/calves are small but recover fast and tolerate a wide MEV-MRV band;
// glutes/hamstrings sit lower than their mass implies because most of their stimulus comes
// indirectly from squats/hinges; back tolerates the most volume of any group (large AND
// resilient).
const MUSCLE_LANDMARKS: Record<string, VolumeLandmarks> = {
  chest: { mev: 8, mav: 16, mrv: 22 },
  back: { mev: 10, mav: 18, mrv: 25 },
  lats: { mev: 10, mav: 16, mrv: 22 },
  'upper back': { mev: 8, mav: 14, mrv: 20 },
  'lower back': { mev: 4, mav: 8, mrv: 12 },
  quads: { mev: 8, mav: 14, mrv: 20 },
  hamstrings: { mev: 6, mav: 12, mrv: 18 },
  glutes: { mev: 4, mav: 10, mrv: 18 },
  shoulders: { mev: 8, mav: 16, mrv: 22 },
  biceps: { mev: 6, mav: 14, mrv: 22 },
  triceps: { mev: 6, mav: 12, mrv: 20 },
  calves: { mev: 8, mav: 14, mrv: 20 },
  traps: { mev: 4, mav: 10, mrv: 18 },
  forearms: { mev: 4, mav: 8, mrv: 16 },
  abs: { mev: 0, mav: 16, mrv: 24 },
  obliques: { mev: 0, mav: 12, mrv: 20 },
  'hip flexors': { mev: 2, mav: 6, mrv: 12 },
  adductors: { mev: 2, mav: 6, mrv: 12 },
  abductors: { mev: 2, mav: 6, mrv: 12 },
}

// Fallback for any muscle name not in the table above (e.g. a custom user exercise tagging an
// unlisted muscle) — a conservative small-muscle-shaped default rather than a crash.
const DEFAULT_LANDMARKS: VolumeLandmarks = { mev: 6, mav: 10, mrv: 16 }

// Scales the hypertrophy-baseline table for other goals. Strength/power sessions spend their
// recovery budget on intensity rather than volume, so they run fewer weekly sets per muscle;
// powerbuilding and strength+hypertrophy blends sit between the two poles.
const GOAL_MULTIPLIER: Record<string, number> = {
  strength: 0.65,
  power: 0.55,
  powerbuilding: 0.8,
  'strength+hypertrophy': 0.9,
  hypertrophy: 1.0,
  endurance: 0.85,
}

export interface VolumeLandmarks { mev: number; mav: number; mrv: number }

// BF-59. How much of the accumulation-baseline volume a phase is MEANT to carry.
//
// The owner trained a full week and the screen painted it red; their own explanation was the cause:
// *"oh yes cause its realization phase its been less sets."* MAV is an ACCUMULATION target, and
// showing it during a peak tells an athlete that doing the right thing is wrong — which is worse
// than a wrong number, because a wrong number is at least ignorable.
//
// **These four numbers are a calibration, not a formula**, and they are the owner's (chosen
// 2026-09-01). `explain.ts` calls realisation *"peak strength — heaviest load, lowest reps"* and
// `autoregulation.ts` already refuses rep pushes in it, so the ladder follows behaviour the engine
// has always had rather than inventing a stance. `baseline` sits at 1.0 deliberately: it is a
// testing phase with no volume prescription of its own, and scaling it down would invent one.
export const PHASE_VOLUME_MULTIPLIER: Record<string, number> = {
  baseline: 1.0,
  accumulation: 1.0,
  intensification: 0.8,
  realisation: 0.6,
  deload: 0.5,
}

export interface PhaseVolumeScale {
  /** The multiplier to apply to a muscle's MAV for this week. 1 when nothing is known. */
  scale: number
  /** The phase carrying the most sessions, for the sentence the card prints. Null when unknown. */
  dominant: string | null
  /** How many sessions sat in each phase — what makes the scale explicable rather than magic. */
  counts: Record<string, number>
}

/**
 * The volume scale for a week, from the phases of the sessions it actually contains.
 *
 * **Averaged rather than taken from one phase, because a week is not in one phase.** Phase lives in
 * `session_periodization` **per program session**, and production shows the owner's ten sessions
 * spanning three at once — six accumulation, three realisation, one intensification. So there is no
 * "this week's phase" to store anywhere; there is only the mix of what was trained.
 *
 * An empty list scales by 1: with nothing trained yet, the accumulation baseline is the honest
 * default, and it is what the card showed before this existed.
 */
export function phaseVolumeScale(phases: readonly string[]): PhaseVolumeScale {
  const counts: Record<string, number> = {}
  for (const p of phases) counts[p] = (counts[p] ?? 0) + 1
  if (phases.length === 0) return { scale: 1, dominant: null, counts }

  const total = phases.reduce((sum, p) => sum + (PHASE_VOLUME_MULTIPLIER[p] ?? 1), 0)
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  return { scale: total / phases.length, dominant, counts }
}

/**
 * The weekly set target for one muscle: the landmark table, the program's goal, and the week's
 * phase mix — the one place all three meet (BF-59).
 *
 * **This replaces `program_volume_targets` as what the screen reads.** Those rows were seeded once
 * and never corrected, so production holds a flat 14/10 binary that the landmark table's own
 * comment says it does not do, and that ignores the program's `powerbuilding` ×0.8 entirely.
 * Deriving means the displayed target cannot drift from the formula again, because there is no
 * second copy to drift.
 *
 * Floored at 1: a heavily-scaled small muscle must not round to a target of zero, which would read
 * as "no volume wanted" rather than "a little".
 */
export function weeklyVolumeTarget(trainingGoal: string, muscle: string, phases: readonly string[]): number {
  const { mav } = volumeLandmarks(trainingGoal, muscle)
  return Math.max(1, Math.round(mav * phaseVolumeScale(phases).scale))
}


export function volumeLandmarks(trainingGoal: string, muscle: string): VolumeLandmarks {
  const base = MUSCLE_LANDMARKS[normalizeMuscle(muscle)] ?? DEFAULT_LANDMARKS
  const mult = GOAL_MULTIPLIER[trainingGoal] ?? GOAL_MULTIPLIER.strength
  return {
    mev: Math.round(base.mev * mult),
    mav: Math.round(base.mav * mult),
    mrv: Math.round(base.mrv * mult),
  }
}

export function computeDefaultVolumeTargets(
  trainingGoal: string,
  sessions: Array<{ exercises?: Array<{ muscleGroups?: string[] | null }> }>,
): Array<{ muscleGroup: string; targetSetsPerWeek: number }> {
  const muscles = new Set<string>()
  for (const session of sessions) {
    for (const ex of session.exercises ?? []) {
      for (const mg of ex.muscleGroups ?? []) {
        const m = normalizeMuscle(mg)
        if (m) muscles.add(m)
      }
    }
  }

  return [...muscles].map(muscle => ({
    muscleGroup: muscle,
    targetSetsPerWeek: volumeLandmarks(trainingGoal, muscle).mav,
  }))
}
