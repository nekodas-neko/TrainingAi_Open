import { collectionSpec } from '../../collection/data/models.ts';
import { achievementsSpec } from './models.ts';

// Writes that can unlock something and that a person (or a finished workout) makes: the streak,
// exercise-history and personal-record views are what a workout upload or a day-log edit expire,
// and what the health imports never do. Those expire the reward views at once, as the groups in
// `lib/cache-groups.ts` evict `achievements:<userId>` and `collection` in the current app.
//
// A health import (every 60 seconds while the app is open) expires sleep, body and day-log views
// but not these, so it leaves the reward views to their own five-minute lifetime: at most one read
// per five minutes, not one per import.
const rewardWrites = [
  '/api/streak-data',
  '/api/exercise-history',
  '/api/personal-records',
];
// The collection's allowed rest gap comes from the active schedule, so editing the program changes
// how fast it decays (the web's invalidateProgramStructure). A chosen rest day or a confirmed early
// deload also pauses it; those come through Home's own refresh and wait out the five minutes.
const programWrites = ['/api/workout-templates', '/api/phase-sets'];

const touches = (paths: string[], writes: string[]) =>
  paths.some((path) => writes.some((write) => path.startsWith(write)));

/** `paths`, plus each reward view one of them can change. Called by every invalidation. */
export function withRewardState(paths: string[]) {
  const workout = touches(paths, rewardWrites);
  const extra = [
    ...(workout ? [achievementsSpec.path] : []),
    ...(workout || touches(paths, programWrites) ? [collectionSpec.path] : []),
  ].filter((path) => !paths.includes(path));
  return extra.length ? [...paths, ...extra] : paths;
}
