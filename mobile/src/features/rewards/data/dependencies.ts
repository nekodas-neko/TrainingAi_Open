import { achievementsSpec } from "./models.ts";

// The views whose writes can change an achievement or the XP they pay. They mirror the groups in
// `lib/cache-groups.ts` that evict `achievements:<userId>` in the current app: workouts, logged
// exercises, sleep and body readings, activities and nutrition.
const rewardInputs = [
  "/api/workout-data",
  "/api/exercise-history",
  "/api/personal-records",
  "/api/streak-data",
  "/api/day-log",
  "/api/sleep-sessions",
  "/api/activity-logs",
  "/api/weights-summary",
  "/api/body-metadata",
  "/api/nutrition",
];

/** `paths`, plus the reward view when any of them can change it. Called by every invalidation. */
export function withRewardState(paths: string[]) {
  return paths.includes(achievementsSpec.path) ||
    !paths.some((path) => rewardInputs.some((input) => path.startsWith(input)))
    ? paths
    : [...paths, achievementsSpec.path];
}
