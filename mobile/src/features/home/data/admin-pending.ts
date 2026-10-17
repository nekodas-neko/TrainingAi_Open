import { z } from 'zod';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { profileSpec } from '../../health/data/models';

export const adminPendingSpec = {
  path: '/api/admin/pending-count',
  ttl: 300_000,
  schema: z
    .object({ count: z.number().finite().optional(), feedbackCount: z.number().finite().optional() })
    .passthrough(),
};

/** Signups waiting to be let in plus unread feedback, as the current app's avatar badge counts them. */
export function adminPendingTotal(
  data: { count?: number; feedbackCount?: number } | null | undefined,
) {
  return Math.max(0, (data?.count ?? 0) + (data?.feedbackCount ?? 0));
}

/** Zero for anyone who is not an admin, and no request is made for them. */
export function useAdminPending() {
  const profile = useWorkoutResource(profileSpec);
  const admin = profile.data?.user.isAdmin === true;
  const pending = useWorkoutResource(adminPendingSpec, admin);
  return admin ? adminPendingTotal(pending.data) : 0;
}
