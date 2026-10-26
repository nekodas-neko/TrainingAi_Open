import { reportServerError } from '@/lib/observability'
import { disconnectOuraAccount } from '@/lib/oura/cloud/tokens'
import type { getRepository } from '@/lib/data'

/**
 * #2892 — a delete or reset removes the stored Oura tokens through the `users` cascade, but the
 * grant at Oura stays, and TrainingAI would keep showing in the user's connected apps. Revoke it
 * first. Best effort and never in the wipe's way: whatever goes wrong here is logged and the wipe
 * carries on. Only the error is reported, never a token.
 *
 * Shared by the user's own `DELETE /api/account` and the admin's reset and delete (#3369).
 */
export async function revokeOuraGrantBestEffort(
  repo: Awaited<ReturnType<typeof getRepository>>,
  userId: string,
  url: string,
): Promise<void> {
  try {
    await disconnectOuraAccount(repo, userId)
  } catch (err) {
    console.error('[account] Oura revoke failed, wiping anyway', err instanceof Error ? err.name : 'unknown')
    reportServerError(err, { userId, url })
  }
}
