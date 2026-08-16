// Keeps the session JWT's `isActive` claim from going stale.
//
// `auth.config.ts`'s jwt callback sets `isActive` only when a `user` object is present
// — i.e. at sign-in — so deactivating someone did not take effect until their token was
// re-minted (maxAge 7 days). `middleware.ts` is the only place the flag is enforced, and
// it trusted that stale claim.
//
// This cannot live in middleware: middleware runs on the Edge runtime and imports
// `auth.config.ts`, which is deliberately Node-free ("no bcrypt, no pg"). It runs in
// `auth.ts` (the Node config) instead, and middleware simply reads the claim it refreshes.

/** A day. Deactivation takes effect within a day of continued use. */
export const ISACTIVE_RECHECK_MS = 24 * 60 * 60 * 1000

export type IsActiveClaim = {
  userId?: string
  isActive?: boolean
  isAdmin?: boolean
  isActiveCheckedAt?: number
}

/**
 * Re-read `isActive` **and `isAdmin`** from the source of truth, at most once per `recheckMs`.
 *
 * `isAdmin` was added 2026-08-10 and has the same staleness bug `isActive` was written to fix, in
 * both directions. Granting admin — which `bootstrapAdmin` now does at boot from `ADMIN_EMAIL` —
 * did not reach a signed-in session until the token was re-minted, so a freshly-granted admin saw
 * no admin UI for up to seven days. Revoking it was the same in reverse, and that direction is a
 * security staleness rather than an inconvenience.
 *
 * This governs the **UI** only: `requireAdmin` reads the row from the database on every call and
 * never trusts this claim. The claim decides whether the admin entry point is drawn.
 *
 * Throttled because NextAuth's jwt callback runs on *every* `auth()` call, not only on
 * its own token rotation — an unthrottled read would be a DB query per request. One read
 * per user per day bounds staleness to a day at negligible cost.
 *
 * This is a claim refresh, never a re-authentication: it rewrites a field inside the
 * existing session, so a continuously-active user is never signed out or re-prompted.
 *
 * Mutates and returns `token`, matching how NextAuth callbacks are written.
 */
export async function refreshIsActiveClaim<T extends IsActiveClaim>(
  token: T,
  lookup: (userId: string) => Promise<{ isActive: boolean; isAdmin?: boolean } | null>,
  now: number = Date.now(),
  recheckMs: number = ISACTIVE_RECHECK_MS,
): Promise<T> {
  if (!token.userId) return token
  if ((token.isActiveCheckedAt ?? 0) + recheckMs > now) return token

  try {
    const user = await lookup(token.userId)
    // A missing row is not evidence of deactivation, so the claim is left alone AND the
    // timestamp is not advanced — the next request retries rather than waiting a day.
    if (!user) return token
    token.isActive = user.isActive
    // Only when the lookup actually supplies it — a lookup that omits `isAdmin` must not be read
    // as "not an admin" and silently strip the claim.
    if (typeof user.isAdmin === 'boolean') token.isAdmin = user.isAdmin
    token.isActiveCheckedAt = now
  } catch {
    // Never fail a session read on this. A DB blip must not sign everyone out; the claim
    // stands and the next request retries.
  }
  return token
}
