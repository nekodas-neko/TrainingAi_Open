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
