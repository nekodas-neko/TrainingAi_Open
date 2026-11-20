// The post-completion heart-rate pass for `POST /api/complete-workout`: looks up the repository and
// runs `syncAndAttributeSessionHrWithRepo` (`./post-completion-hr-core`), which the outbox push calls
// with its own (#3916). The rest of the module is re-exported unchanged.
import { getRepositoryAsync } from '@/lib/data'
import { syncAndAttributeSessionHrWithRepo } from './post-completion-hr-core'

export {
  syncAndAttributeSessionHrWithRepo, REATTRIBUTE_MAX_SESSIONS, reattributeWorkoutsHrInWindow, workoutHrReattributor,
} from './post-completion-hr-core'

export async function syncAndAttributeSessionHr(
  userId: string,
  workoutSessionId: string,
  tz?: string,
): ReturnType<typeof syncAndAttributeSessionHrWithRepo> {
  return syncAndAttributeSessionHrWithRepo(await getRepositoryAsync(), userId, workoutSessionId, tz)
}
