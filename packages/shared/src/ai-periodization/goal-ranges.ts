// Working-phase intensity/rep RANGES per training goal — for display only.
//
// The builder review shows each exercise's base style as a single "4×6 @ 80%", which reads
// like a fixed assignment. For AI-dynamic programs the AI actually varies load and reps by
// phase within a range, so the review should show the range (e.g. "73–93% · 2–8 reps"),
// making clear nothing is locked in. These spans are the min→max across the working phases
// (accumulation → realisation, excluding the deload week) of each goal's INTENSITY_ZONES.

import { pctForExpectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'

export interface GoalRange {
  pctMin: number
  pctMax: number
  repMin: number
  repMax: number
}

const COMPOUND: Record<string, GoalRange> = {
  strength: { pctMin: 70, pctMax: 92.5, repMin: 1, repMax: 8 },
  hypertrophy: { pctMin: 65, pctMax: 85, repMin: 5, repMax: 12 },
  power: { pctMin: 72.5, pctMax: 95, repMin: 1, repMax: 5 },
  endurance: { pctMin: 50, pctMax: 75, repMin: 8, repMax: 20 },
  powerbuilding: { pctMin: 72.5, pctMax: 92.5, repMin: 2, repMax: 8 },
  'strength+hypertrophy': { pctMin: 67.5, pctMax: 87.5, repMin: 4, repMax: 10 },
}

// Accessories are prescribed to a target EFFORT (RPE), not a fixed %1RM — the load floats to
// whatever hits the target at the chosen reps. Goal-flavoured: strength accessories a touch
// heavier/lower-rep, hypertrophy more rep-driven, but ALL genuinely challenging (>= RPE 7.5).
const ACCESSORY_SPEC: Record<string, { repMin: number; repMax: number; targetRpe: number }> = {
  strength:               { repMin: 6,  repMax: 10, targetRpe: 8.0 },
  hypertrophy:            { repMin: 10, repMax: 15, targetRpe: 8.5 },
  power:                  { repMin: 6,  repMax: 10, targetRpe: 7.5 },
  endurance:              { repMin: 12, repMax: 20, targetRpe: 8.0 },
  powerbuilding:          { repMin: 8,  repMax: 12, targetRpe: 8.0 },
  'strength+hypertrophy': { repMin: 8,  repMax: 12, targetRpe: 8.5 },
}
const DEFAULT_ACCESSORY_SPEC = { repMin: 8, repMax: 15, targetRpe: 8.0 }

function accessorySpec(trainingGoal: string) {
  return ACCESSORY_SPEC[trainingGoal] ?? DEFAULT_ACCESSORY_SPEC
}

export function accessoryTargetRpe(trainingGoal: string): number {
  return accessorySpec(trainingGoal).targetRpe
}

// Derived accessory band: pct is computed from the target RPE at the rep-band edges, so the
// target RPE is the single source of truth (One Formula) — no second hand-tuned % to drift.
function accessoryRange(trainingGoal: string): GoalRange {
  const { repMin, repMax, targetRpe } = accessorySpec(trainingGoal)
  return {
    pctMin: pctForExpectedRpe(targetRpe, repMax), // more reps @ target => lighter
    pctMax: pctForExpectedRpe(targetRpe, repMin), // fewer reps @ target => heavier
    repMin,
    repMax,
  }
}

// Goals whose SECONDARY compounds train a moderate step below the primary anchor (kept in sync
// with prompt.ts MODERATE_SECONDARY_GOALS / secondaryIntensityZone). Only listed goals differ;
// everything else falls through to COMPOUND (secondary == primary, e.g. strength).
const SECONDARY: Record<string, GoalRange> = {
  powerbuilding: { pctMin: 65, pctMax: 85, repMin: 6, repMax: 10 },
}

export function goalRange(trainingGoal: string, role: string): GoalRange {
  if (role === 'accessory') return accessoryRange(trainingGoal)
  if (role === 'secondary' && SECONDARY[trainingGoal]) return SECONDARY[trainingGoal]
  return COMPOUND[trainingGoal] ?? COMPOUND.strength
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${n}`
}

export function formatGoalRange(r: GoalRange): string {
  return `${fmtPct(r.pctMin)}–${fmtPct(r.pctMax)}% · ${r.repMin}–${r.repMax} reps`
}
