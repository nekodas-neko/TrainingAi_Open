import { z } from 'zod';
import { ApiError } from '../../account/api/client.ts';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';

/**
 * The opt-in for a friend's meal library (#2218): `shareMealLibrary` on the account's preferences,
 * which the server reads, so a cached copy never widens who can see a meal.
 *
 * It is a statement to other people, so it is the one preference here that is NOT saved on the
 * phone and replayed later. A withdrawal queued while offline would leave the friend's library
 * readable until the phone next connected, and the switch would say "off" the whole time (found
 * reviewing #3404). So the switch shows only what the server has said: what it answered to a read,
 * or to the change just made. A change that does not reach the server is refused, and the switch
 * stays where it was.
 *
 * Its own `partition`, so this view never shares a saved copy with another reader of the
 * preferences, and `cache: () => false`, so no copy of it is ever written to the phone.
 */
export const mealSharingSpec = {
  path: '/api/user/preferences',
  partition: 'meal-sharing',
  ttl: 0,
  cache: () => false,
  schema: z.object({ shareMealLibrary: z.unknown().optional() }).strip(),
};
type Sharing = z.infer<typeof mealSharingSpec.schema>;

/** Strictly `true`, as the route reads it: absent, false or anything else is off. */
export function isSharing(data: Sharing | null | undefined) {
  return data?.shareMealLibrary === true;
}

export class MealSharingNotConfirmed extends Error {
  constructor() {
    super('The server did not confirm the change.');
  }
}

/**
 * Turns sharing on or off and resolves only when the server has said it is so. The view is replaced
 * with the server's answer (the merged preferences), not with what was asked for.
 */
export async function saveMealSharing(
  resources: Pick<WorkoutResources, 'write' | 'replace'>,
  next: boolean,
): Promise<boolean> {
  const response = await resources.write(
    'PATCH',
    mealSharingSpec.path,
    { shareMealLibrary: next },
    [mealSharingSpec.path],
  );
  const answered = mealSharingSpec.schema.parse(response);
  await resources.replace(mealSharingSpec, answered);
  if (isSharing(answered) !== next) {
    throw new MealSharingNotConfirmed();
  }
  return next;
}

/** What to say when a change did not reach the server. Turning it off is the one that matters. */
export function mealSharingFailure(next: boolean, cause: unknown) {
  if (cause instanceof ApiError && cause.status === 429) {
    return 'Too many requests. Wait a moment and try again. Nothing was changed.';
  }
  return next
    ? 'Could not turn this on. Nothing was changed. Check your connection and try again.'
    : 'Could not turn this off, so your friends can still see your meals. Check your connection and try again.';
}
