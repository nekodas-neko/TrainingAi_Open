// Applying a goal recommendation's steps and water figures (#3643).
//
// `users.steps_goal` and `users.water_goal_ml` hold the DAILY figure in both goal modes; the weekly
// toggle changes only how a reader shows it (every reader multiplies by 7 for the week). Both apps'
// recommendation sheets used to PATCH `recommended × 7` in weekly mode, which stored 70,000 steps as
// the daily goal, and for water pushed anything over 2,857 ml past the 20,000 ml bound so the whole
// PATCH was refused. The sheets now build the write from here and keep the ×7 for the label only.

export type GoalPeriod = 'daily' | 'weekly'

/** A stored (daily) steps or water goal as it reads in the user's chosen mode. */
export function goalShownForPeriod(dailyGoal: number, period: GoalPeriod | string | null | undefined): number {
  return period === 'weekly' ? dailyGoal * 7 : dailyGoal
}

/**
 * The `/api/user/goals` patch for the ticked steps and water rows: the recommended daily figures,
 * unchanged whatever the mode, rounded because both fields are integer-bounded.
 */
export function recommendationGoalsPatch(
  recommended: { stepsGoal: number; waterMl: number },
  selected: { steps: boolean; water: boolean },
): { stepsGoal?: number; waterGoalMl?: number } {
  const patch: { stepsGoal?: number; waterGoalMl?: number } = {}
  if (selected.steps) patch.stepsGoal = Math.round(recommended.stepsGoal)
  if (selected.water) patch.waterGoalMl = Math.round(recommended.waterMl)
  return patch
}
