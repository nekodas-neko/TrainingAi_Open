import { KCAL_PER_KG } from '@trainingai/shared/nutrition/tdee-adaptation'

// A single day's calorie delta (actual - target), extrapolated as if every day
// looked like today. Deliberately NOT a rolling average — the daily digest frames
// this as "at today's rate," an honest, simple projection rather than a smoothed
// one that would need its own window-length decision.
export function projectWeeklyWeightChangeKg(dailyDeltaKcal: number): number {
  return (dailyDeltaKcal * 7) / KCAL_PER_KG
}

// Average daily steps needed for the remaining days of the ISO week to hit a
// weekly step-count goal. `daysLeftInWeek` excludes today (today's steps are
// already folded into `stepsLoggedThisWeek`). Returns 0 if the goal is already met.
export function stepsPaceToWeeklyGoal(
  weeklyTarget: number,
  stepsLoggedThisWeek: number,
  daysLeftInWeek: number,
): number {
  const remaining = weeklyTarget - stepsLoggedThisWeek
  if (remaining <= 0) return 0
  if (daysLeftInWeek <= 0) return remaining
  return Math.round(remaining / daysLeftInWeek)
}
