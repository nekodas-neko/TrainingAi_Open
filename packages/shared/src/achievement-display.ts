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
  'Steps',
  'Lift Milestones',
] as const

/** How far through the current level `xp` is, 0 to 1. A top level with nothing above it reads as full. */
export function levelProgress(xp: number, currentLevelXp: number, nextLevelXp: number): number {
  return nextLevelXp > currentLevelXp
    ? Math.min(1, Math.max(0, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp)))
    : 1
}

/** A title a player can equip, and the achievement that unlocks it. Icons are each client's own. */
export interface TitleEntry {
  display: string
  unlockedBy: string
}

export const TITLE_CATALOGUE: Record<string, TitleEntry> = {
  iron_will:       { display: 'Iron Will',        unlockedBy: 'streak_60'       },
  unbroken:        { display: 'Unbroken',         unlockedBy: 'streak_30'       },
  powerhouse:      { display: 'Powerhouse',       unlockedBy: 'volume_100k'     },
  iron_beast:      { display: 'Iron Beast',       unlockedBy: 'volume_50k'      },
  the_veteran:     { display: 'The Veteran',      unlockedBy: 'sessions_250'    },
  century_club:    { display: 'Century Club',     unlockedBy: 'sessions_100'    },
  set_machine:     { display: 'Set Machine',      unlockedBy: 'sets_5000'       },
  pr_machine:      { display: 'PR Machine',       unlockedBy: 'prs_25'          },
  dawn_warrior:    { display: 'Dawn Warrior',     unlockedBy: 'early_bird_5'    },
  ghost:           { display: 'Ghost',            unlockedBy: 'night_owl'       },
  macro_master:    { display: 'Macro Master',     unlockedBy: 'calorie_goal_30' },
  well_rested:     { display: 'Well Rested',      unlockedBy: 'sleep_streak_30' },
  relentless:      { display: 'Relentless',       unlockedBy: 'months_12'       },
  road_runner:     { display: 'Road Runner',      unlockedBy: 'steps_30k'       },
  ultramarathon:   { display: 'Ultramarathon',    unlockedBy: 'steps_50k'       },
  built_different: { display: 'Built Different',  unlockedBy: 'months_6'        },
}

/** The titles whose unlocking achievement is among `unlockedIds`, in catalogue order. */
export function availableTitles(unlockedIds: readonly string[]): [string, TitleEntry][] {
  return Object.entries(TITLE_CATALOGUE).filter(([, def]) => unlockedIds.includes(def.unlockedBy))
}

/** How many achievements the trophy case holds. */
export const TROPHY_SLOTS = 3

/** Pin `id`: the oldest pin makes way when the case is full. Pinning one already pinned changes nothing. */
export function pinTrophy(pinned: readonly string[], id: string): string[] {
  if (pinned.includes(id)) return [...pinned]
  return [...pinned, id].slice(-TROPHY_SLOTS)
}

/** The case's slots in order: the pinned achievement in each, or undefined for an empty one. */
export function trophySlots<T extends { id: string }>(
  achievements: readonly T[],
  pinned: readonly string[],
): (T | undefined)[] {
  return Array.from({ length: TROPHY_SLOTS }, (_, i) => {
    const id = pinned[i]
    return id ? achievements.find(a => a.id === id) : undefined
  })
}

export function unpinTrophy(pinned: readonly string[], id: string): string[] {
  return pinned.filter(p => p !== id)
}

/** The medal a season result is drawn in; anything that is not Gold or Silver is Bronze. */
export function seasonBadgeTier(badgeLabel: string): BadgeTier {
  return badgeLabel === 'Gold' ? 'gold' : badgeLabel === 'Silver' ? 'silver' : 'bronze'
}
