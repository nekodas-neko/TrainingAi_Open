import { z } from 'zod';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { profileSpec } from '../../health/data/models';
import { adminPendingTotal, adminSignupCount } from './admin-pending-counts';

export const adminPendingSpec = {
  path: '/api/admin/pending-count',
  ttl: 300_000,
  schema: z
    .object({ count: z.number().finite().optional(), feedbackCount: z.number().finite().optional() })
    .passthrough(),
};

/** Zeros for anyone who is not an admin, and no request is made for them. */
export function useAdminPending() {
  const profile = useWorkoutResource(profileSpec);
  const admin = profile.data?.user.isAdmin === true;
  const pending = useWorkoutResource(adminPendingSpec, admin);
  return {
    signups: admin ? adminSignupCount(pending.data) : 0,
    total: admin ? adminPendingTotal(pending.data) : 0,
  };
}
