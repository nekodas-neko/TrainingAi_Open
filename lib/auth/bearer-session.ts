import type { Session } from 'next-auth'
import { authConfig } from '@/auth.config'
import { refreshIsActiveClaim } from './is-active-refresh'
import { sessionTokenFrom } from './session-token'

/**
 * Q-1a — resolving a session from `Authorization: Bearer <session jwt>`.
 *
 * A native client cannot rely on a cookie: the moment the app and the API are different origins
 * (Q-1b's static export, or any Compose screen calling the API directly) there is no cookie to
 * send. The credential is deliberately **not a new one** — it is the same NextAuth session JWT the
 * mobile PKCE exchange already mints, per Q-1's Task 1 decision.
 *
 * **Why this lives behind `auth()` rather than beside it.** 222 route files import `auth` from
 * `@/auth` and none construct NextAuth themselves, so that wrapper is the one place identity is
 * established. Resolving a bearer anywhere else would mean a second identity path that has to
 * re-earn every guarantee the first one has — and the entry's own precondition is precisely that
 * `isActive` must be enforced *at the point identity is established*, because the middleware gate
 * (`middleware.ts:33`) reads `req.auth`, which is the COOKIE session, and cannot see a bearer.
 *
 * **What the entry's precondition paragraph gets wrong, checked against `main` 2026-09-18.** It
 * says a deactivated bearer holder would reach "every `/api` route" with the 403 never firing.
 * The 403 indeed never fires — but PS-24 moved the real enforcement into `auth()` itself, which
 * returns `null` for `isActive === false` after re-reading the row. So the route answers 401, not
 * 200, *provided the bearer resolves through that same wrapper*. That is why this returns a
 * session for the wrapper to judge rather than judging for itself, and why the refresh below is
 * not optional: a token minted before deactivation still claims `isActive: true`.
 */
export async function bearerSession(
  headers: Headers,
  lookup: (userId: string) => Promise<{ isActive: boolean; isAdmin?: boolean } | null>,
): Promise<Session | null> {
  // `getToken` prefers the cookie and only falls back to the Authorization header, so a browser
  // request is resolved exactly as it was before this existed. It returns null rather than
  // throwing on a malformed, re-signed or expired token. The call itself now lives in
  // `session-token.ts`, shared with the calendar route — the `secureCookie`/salt pairing is the
  // part that must not drift between them.
  const token = await sessionTokenFrom(headers)
  if (!token?.userId) return null

  await refreshIsActiveClaim(token, lookup)

  // The claim → session mapping is `authConfig`'s, not a copy of it. A claim added there must
  // reach a bearer caller too, and the way to guarantee that is to run the same callback rather
  // than to remember to update a second list.
  const session = {
    user: { name: token.name ?? null, email: token.email ?? null, image: token.picture ?? null },
    expires: typeof token.exp === 'number' ? new Date(token.exp * 1000).toISOString() : '',
  } as unknown as Session
  return (await authConfig.callbacks!.session!({ session, token } as never)) as Session
}
