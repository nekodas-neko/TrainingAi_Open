import { reportServerError } from '@/lib/observability'
import { readOuraAccessTokenForRevoke, revokeOuraAccessToken } from '@/lib/oura/cloud/tokens'
import type { getRepository } from '@/lib/data'

/**
 * #2892 — a delete or reset removes the stored Oura tokens through the `users` cascade, but the
 * grant at Oura stays, and TrainingAI would keep showing in the user's connected apps.
 *
 * **Two steps, in this order: read before the wipe, revoke after it commits.** The revoke at Oura
 * cannot be put back, and the wipe can fail and roll back. Revoking first (as this once did, and
 * deleting the stored tokens itself) left a person disconnected from Oura by a wipe that then did
 * nothing. Now a failed wipe changes nothing at Oura or in `oura_tokens`.
 *
 * Both steps are best effort and never in the wipe's way: whatever goes wrong is logged and the wipe
 * carries on. Only the error is reported, never a token.
 *
 * Shared by the user's own `DELETE /api/account` and the admin's reset and delete (#3369).
 */
export async function readOuraGrantBestEffort(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string,
  url: string,
): Promise<string | null> {
  try {
    return await readOuraAccessTokenForRevoke(repo, userId)
  } catch (err) {
    console.error('[account] Oura token read failed, wiping anyway', err instanceof Error ? err.name : 'unknown')
    reportServerError(err, { userId, url })
    return null
  }
}

/** Call only after the wipe has committed. */
export async function revokeOuraGrantAfterCommit(accessToken: string | null, userId: string, url: string): Promise<void> {
  if (!accessToken) return
  try {
    await revokeOuraAccessToken(accessToken)
  } catch (err) {
    console.error('[account] Oura revoke failed after the wipe', err instanceof Error ? err.name : 'unknown')
    reportServerError(err, { userId, url })
  }
}
