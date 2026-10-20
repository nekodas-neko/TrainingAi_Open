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
// how fast it decays (the web's invalidateProgramStructure). A chosen rest day also pauses it, and
// Home's write expires the view itself (`homeWritePaths`).
//
// A manual night, steps or weight entry (HealthStore's saveNight, removeNight and logMetric) and
// the early-deload confirm expire the collection from their own invalidation lists, as the web's
// writes do. The automatic device-health imports and Oura syncs do not: they run about once a minute
// and each expiry costs a replay of all history on the server, so they leave the view to its
// five-minute lifetime, the same bound the web's cached copy has.
const programWrites = ['/api/workout-templates', '/api/phase-sets'];

/**
 * Both reward views, for a write that can change either and is not one of the paths above: a food
 * log (food streaks, the Health ladder's food points) is the case. The web clears `achievements:` and
 * `collection` in `invalidateNutritionWrite`; Preview's nutrition store spreads this into its list.
 */
export const rewardViewPaths = [achievementsSpec.path, collectionSpec.path];

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
