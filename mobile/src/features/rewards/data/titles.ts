import { profileSpec } from '../../health/data/models.ts';
import type { WorkoutResources } from '../../workouts/data/WorkoutResources.ts';

/**
 * Save the equipped title (null clears it) through the existing route and show it at once. Resolves
 * false when the server refuses or cannot be reached, leaving the profile as it was.
 */
export async function equipTitle(
  resources: Pick<WorkoutResources, 'write' | 'state' | 'replace' | 'refreshVisible'>,
  titleId: string | null,
) {
  try {
    await resources.write('PATCH', '/api/user/equipped-title', { titleId }, [
      '/api/user/profile',
      '/api/friends',
      '/api/profile',
    ]);
  } catch {
    return false;
  }
  // The server has it: show it now, then let the profile and the friends views re-read.
  const profile = resources.state(profileSpec).data;
  if (profile) {
    await resources
      .replace(profileSpec, {
        ...profile,
        user: { ...profile.user, equippedTitle: titleId },
      })
      .catch(() => {});
  }
  void resources.refreshVisible();
  return true;
}
