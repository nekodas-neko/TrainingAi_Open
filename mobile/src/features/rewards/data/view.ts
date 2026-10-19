import {
  ACHIEVEMENT_CATEGORY_ORDER,
  LEVEL_THRESHOLDS,
  getBadgeTier,
  getLevelLabel,
  type BadgeTier,
} from "@trainingai/shared/achievement-display";
import type { Achievement, Rewards } from "./models.ts";

type Level = Pick<Rewards, "level" | "xp" | "currentLevelXp" | "nextLevelXp">;

/** Fraction of the way from this level's XP to the next level's, as the current app draws it. */
export function levelProgress({
  xp,
  currentLevelXp,
  nextLevelXp,
}: Omit<Level, "level">) {
  return nextLevelXp > currentLevelXp
    ? Math.min(
        1,
        Math.max(0, (xp - currentLevelXp) / (nextLevelXp - currentLevelXp)),
      )
    : 1;
}

/** The More screen's level badge and XP bar text. */
export function levelHeadline(rewards: Level & { levelLabel?: string }) {
  const { level, xp, nextLevelXp } = rewards;
  return {
    title: `Level ${level} · ${rewards.levelLabel ?? getLevelLabel(level)}`,
    detail: `${xp.toLocaleString()} XP total · tap for details`,
    barStart: `${xp.toLocaleString()} XP`,
    barEnd:
      nextLevelXp > xp
        ? `${(nextLevelXp - xp).toLocaleString()} to next level`
        : "Max level",
  };
}

/** The Level & XP sheet's hero: XP into this level, and what the level asks for in all. */
export function levelSheetHero({
  level,
  xp,
  currentLevelXp,
  nextLevelXp,
}: Level) {
  return {
    label: `Level ${level} · ${getLevelLabel(level)}`,
    total: `${xp} XP total`,
    start: `${xp - currentLevelXp} XP`,
    end: `${nextLevelXp - currentLevelXp} XP to Level ${level + 1}`,
  };
}

export type LevelRow = {
  level: number;
  label: string;
  threshold: number;
  state: "past" | "current" | "upcoming";
};
export function levelRows(level: number): LevelRow[] {
  return LEVEL_THRESHOLDS.map((threshold, index) => {
    const row = index + 1;
    return {
      level: row,
      label: getLevelLabel(row),
      threshold,
      state: row === level ? "current" : row < level ? "past" : "upcoming",
    };
  });
}

/** Unlocked achievements, biggest reward first (the sheet's "XP Sources"). */
export function xpSources(achievements: Achievement[]) {
  return achievements
    .filter((row) => row.unlocked)
    .sort((a, b) => b.xpReward - a.xpReward);
}

export type AchievementGroup = {
  category: string;
  items: Achievement[];
  unlocked: number;
};
/** Categories in the current app's order; one the app does not list is not shown. */
export function achievementGroups(
  achievements: Achievement[],
): AchievementGroup[] {
  return ACHIEVEMENT_CATEGORY_ORDER.flatMap((category) => {
    const items = achievements.filter((row) => row.category === category);
    return items.length
      ? [
          {
            category,
            items,
            unlocked: items.filter((row) => row.unlocked).length,
          },
        ]
      : [];
  });
}

/** The collapsed preview: the four most recently listed unlocks, newest first. */
export function recentUnlocked(achievements: Achievement[]) {
  return achievements
    .filter((row) => row.unlocked)
    .slice(-4)
    .reverse();
}

export function achievementCounts(achievements: Achievement[]) {
  return {
    unlocked: achievements.filter((row) => row.unlocked).length,
    total: achievements.length,
  };
}

export function tierOf(row: Achievement): BadgeTier | null {
  return row.unlocked ? getBadgeTier(row.xpReward) : null;
}

/** Unlocked and not yet seen on this account, in list order. */
export function unseenUnlocks(
  achievements: Achievement[],
  seen: readonly string[],
) {
  const known = new Set(seen);
  return achievements
    .filter((row) => row.unlocked && !known.has(row.id))
    .map((row) => row.id);
}

/** XP gained by a workout: the server's total after minus its total before. Null when either is unknown. */
export function xpGained(
  before: number | null | undefined,
  after: number | null | undefined,
) {
  return before == null || after == null ? null : Math.max(0, after - before);
}
