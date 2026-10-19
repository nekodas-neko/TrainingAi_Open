/**
 * The level ladder and the badge presentation rules, defined once. `lib/achievements.ts` (the
 * server's XP calculation) and both clients read these; a copy in a component is how the ladder a
 * user sees could drift from the one that awards the level.
 */
export const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5800, 8000]

export function getLevelLabel(level: number): string {
  if (level <= 2) return 'Novice'
  if (level <= 4) return 'Beginner'
  if (level <= 6) return 'Intermediate'
  if (level <= 8) return 'Advanced'
  if (level <= 10) return 'Elite'
  return 'Legend'
}

export type BadgeTier = 'bronze' | 'silver' | 'gold'

export function getBadgeTier(xpReward: number): BadgeTier {
  if (xpReward >= 200) return 'gold'
  if (xpReward >= 50) return 'silver'
  return 'bronze'
}

/** Order the achievement categories are shown in; a category not listed is not shown. */
export const ACHIEVEMENT_CATEGORY_ORDER = [
  'Workouts',
  'Volume',
  'Sets',
  'Streaks',
  'Records',
  'Timing',
  'Consistency',
  'Nutrition',
  'Sleep',
  'Body Metrics',
  'Lift Milestones',
] as const
