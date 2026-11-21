"use server";

import { auth, signOut as authSignOut } from "@/auth";
import { getRepository } from "@/lib/data";
import { reportServerError } from "@/lib/observability";

/**
 * #3854 item 1: the server half of a web sign-out. Before the cookie is cleared, the account's
 * sign-in cut-off (`users.sign_ins_valid_from`, #3829) moves to now, so every session signed in
 * before this moment is refused by `refreshIsActiveClaim` from here on, on every route, whatever
 * sets the cookie again later: a beacon whose response lands after the clear, an `<img>` load of
 * `/api/...`, Next's hard-navigation fallback, the service worker's proxy. The phone-side fence
 * (#3806) stays; this closes what it cannot see.
 *
 * It is per account, so it ends the account's other sign-ins too: other browsers' cookies, and
 * native sign-ins made before it (`lib/auth/mobile/session.ts` reads the same column). A sign-in
 * after it is stamped at or after the cut-off and keeps working.
 *
 * Who is signed out is the session's user (`auth()`, which re-reads the row), never anything the
 * client sends. No session, or one already refused, records nothing: there is nothing to end. A
 * failed write is reported and the cookie clear still runs; a sign-out that refused to clear the
 * cookie would leave the browser signed in, which is the outcome this exists to prevent.
 */
async function endSignInsOfThisSession(): Promise<void> {
  let userId: string | undefined;
  try {
    userId = (await auth())?.user?.id;
  } catch {
    userId = undefined;
  }
  if (!userId) return;
  try {
    await (await getRepository()).endSignInsBefore(userId);
  } catch (err) {
    // A deleted account (`lib/account/delete-account.ts` signs out after the delete) has no row to
    // set, and its sessions are already refused by `isActive`.
    reportServerError(err, { userId, url: "action:signOut" });
  }
}

export async function signOut() {
  await endSignInsOfThisSession();
  await authSignOut({ redirectTo: "/sign-in" });
}

/**
 * The same sign-out for the native sign-in page's "Use another account" (#3854): it has to come back
 * to its own sign-in form, which `/sign-in` is not. Called through `signOutAndClearDevice` so the
 * #3806 fence holds. The target is fixed here, never taken from the client.
 *
 * It still redirects. Measured on `pnpm dev`: with `redirect: false`, Next re-renders the calling
 * page inside the action's response, its `auth()` reads the request's old cookie, and the response
 * carries a fresh session cookie instead of the clear, so the browser stayed signed in.
 */
export async function signOutInPlace() {
  await endSignInsOfThisSession();
  await authSignOut({ redirectTo: "/mobile-signin/native" });
}
