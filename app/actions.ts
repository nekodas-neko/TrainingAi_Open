"use server";

import { signOut as authSignOut } from "@/auth";

export async function signOut() {
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
  await authSignOut({ redirectTo: "/mobile-signin/native" });
}
