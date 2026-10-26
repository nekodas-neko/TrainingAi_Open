import { UserFacingError } from '@trainingai/shared/errors'
import { getRepository } from '@/lib/data'

/**
 * #2300. The write-path guard for everything a trainer does to a trainee's account.
 *
 * Reads `trainer_relationships` on EVERY call and requires `status = 'accepted'` with both accounts
 * active. It never consults the JWT or the session beyond the caller's id: a claim can be 30 days
 * stale and a revocation must bite on the next request — `requireAdmin`'s rule, which this copies.
 * `isAdmin` plays no part: admin is the operator role, not a trainee permission.
 *
 * Returns the relationship id. Throws a 403 `UserFacingError` for every way of not being the
 * trainee's accepted trainer — unknown id, someone else's trainee, pending, revoked, an inactive
 * account, yourself — with the same wording, so the route is no oracle for other users' ids. The
 * repository write that follows re-checks inside its own transaction; this is the early, cheap
 * refusal, not the only one.
 */
export async function requireTrainerOf(trainerId: string, traineeId: string): Promise<string> {
  const relationshipId = await (await getRepository()).acceptedTrainerRelationshipId(trainerId, traineeId)
  if (!relationshipId) throw new UserFacingError('Forbidden', 403)
  return relationshipId
}
