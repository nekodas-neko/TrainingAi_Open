import type { FitnessGoal } from "../types/user";

// Weekly weight-change targets implied by CALORIE_ADJUSTMENT_BY_GOAL in
// goal-recommendation.ts (kcal/day * 7 / 7700 kcal-per-kg).
export const GOAL_RATE_KG_PER_WEEK: Record<FitnessGoal, number> = {
  lose_weight: -0.45,
  maintain: 0,
  build_muscle: 0.27,
  recomp: -0.18,
};

export const KCAL_PER_KG = 7700;
const DEADBAND_KG_PER_WEEK = 0.1;
const MAX_ADJUST_KCAL = 200;

/** Daily-calorie nudge (kcal, multiple of 50, clamped ±200; 0 inside the deadband). */
export function tdeeAdjustment(goal: FitnessGoal, actualKgPerWeek: number): number {
  const gap = GOAL_RATE_KG_PER_WEEK[goal] - actualKgPerWeek;
  if (Math.abs(gap) < DEADBAND_KG_PER_WEEK) return 0;
  const raw = (gap * KCAL_PER_KG) / 7;
  const clamped = Math.max(-MAX_ADJUST_KCAL, Math.min(MAX_ADJUST_KCAL, raw));
  return Math.round(clamped / 50) * 50;
}
