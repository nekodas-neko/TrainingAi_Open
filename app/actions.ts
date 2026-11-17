"use server";

import { signOut as authSignOut } from "@/auth";

export async function signOut() {
  await authSignOut({ redirectTo: "/sign-in" });
}

/**
 * The same sign-out without the redirect, for a page that reloads itself afterwards: the native
 * sign-in page's "Use another account" (#3854) has to come back to its own sign-in form, which
 * `/sign-in` is not. Called through `signOutAndClearDevice` so the #3806 fence holds.
 */
export async function signOutInPlace() {
  await authSignOut({ redirect: false });
}
