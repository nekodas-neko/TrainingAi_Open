import { achievementsSpec } from './models.ts';

// Writes that can unlock something and that a person (or a finished workout) makes: the streak,
// exercise-history and personal-record views are what a workout upload or a day-log edit expire,
// and what the health imports never do. Those expire the reward view at once, as the groups in
// `lib/cache-groups.ts` evict `achievements:<userId>` in the current app.
//
// A health import (every 60 seconds while the app is open) expires sleep, body and day-log views
// but not these, so it leaves the reward view to its own five-minute lifetime: at most one read
// per five minutes, not one per import.
const rewardWrites = [
  '/api/streak-data',
  '/api/exercise-history',
  '/api/personal-records',
];

/** `paths`, plus the reward view when one of them is a write that can change it. */
export function withRewardState(paths: string[]) {
  return paths.includes(achievementsSpec.path) ||
    !paths.some((path) => rewardWrites.some((write) => path.startsWith(write)))
    ? paths
    : [...paths, achievementsSpec.path];
}
