// Per-goal deload prescription values. Used by the emergency whole-session
// deload and the per-exercise deload — "deloaded" means the same numbers at
// both scales.
export const DELOAD_LOWER_PCT: Record<string, number> = {
  strength: 50,
  hypertrophy: 50,
  power: 55,
  endurance: 40,
  powerbuilding: 52,
  'strength+hypertrophy': 50,
}

export const DELOAD_REPS: Record<string, number> = {
  strength: 6,
  hypertrophy: 10,
  power: 4,
  endurance: 15,
  powerbuilding: 8,
  'strength+hypertrophy': 10,
}

export const DELOAD_SETS = 2
export const DELOAD_REST = 120

export interface DeloadOverride {
  sets: number
  reps: number
  pct: number
  restSec: number
}

export function deloadOverrideForGoal(trainingGoal: string): DeloadOverride {
  return {
    sets: DELOAD_SETS,
    reps: DELOAD_REPS[trainingGoal] ?? 8,
    pct: DELOAD_LOWER_PCT[trainingGoal] ?? 50,
    restSec: DELOAD_REST,
  }
}

/**
 * The deload prescription as a ready StyleSet[] — the one place that turns the per-goal
 * numbers above into sets the workout screen can read.
 *
 * Added for Q-185, which needed the same reduction applied to an exercise the AI prescription
 * does not name. The AI-driven branch reached it through `prescriptionStyleForExercise`, which
 * requires a prescription entry to spread over; an accessory has none. Rather than inline a
 * second copy of the same shape, both paths build it here.
 *
 * `useFor1rm: false` matches `prescriptionStyleForExercise`'s `!presc.deloaded` — a deliberately
 * submaximal set must never feed a 1RM estimate.
 */
export function deloadStyleForGoal(trainingGoal: string): { pct: number; reps: number; restSec: number; useFor1rm: boolean }[] {
  const o = deloadOverrideForGoal(trainingGoal)
  return Array.from({ length: o.sets }, () => ({
    pct: o.pct, reps: o.reps, restSec: o.restSec, useFor1rm: false,
  }))
}

// ── Temperature thresholds ───────────────────────────────────────────────────
//
// These live here, not in `ai-dynamic.ts`, because they are read by client components.
// `ai-dynamic` transitively pulls the ONNX runtime, so importing a bare number from it drags
// `onnxruntime-node` into the browser bundle and fails the build outright (the Q-221 boundary,
// same class as Q-230's `node:path`). A constant with no dependencies belongs in a leaf.

// Minimum nights of accrued temperature baseline before an elevated-temp reading is trusted
// enough to drive a deload — a personal temp normal needs ~a month to be solid, and firing off a
// green/immature baseline produced spurious "body temp elevated" deloads.
export const TEMP_BASELINE_MIN_DAYS = 30

// °C deviation above personal baseline that counts as "elevated" — Oura only exposes a deviation
// from the ring's own baseline, never an absolute value, so this is the only threshold that can
// be shown alongside a real number (Q-105).
export const TEMP_ALERT_THRESHOLD_C = 0.5
