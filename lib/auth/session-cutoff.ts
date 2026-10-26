/**
 * #3369 — the cut-off an admin's data reset sets on an account (`users.sessions_valid_from`).
 *
 * A session or native access token records when its sign-in happened (`signedInAt`, whole seconds).
 * **Not `iat`:** Auth.js re-issues the web cookie with a fresh `iat` as a session ages, so a cookie a
 * phone has held since before the reset would pass an `iat` test the first time it was used after
 * it. `signedInAt` is stamped once, at sign-in, and every re-issue carries it through unchanged.
 *
 * Refused when the account has a cut-off and the sign-in is not at or after it. A token with no
 * `signedInAt` at all (issued before this existed) is refused too: with a cut-off set it cannot
 * prove it is newer, and an account with no cut-off never reaches this test. The comparison is in
 * whole seconds with the cut-off floored, so a sign-in in the same second as the reset is kept.
 */
export function signedInBeforeCutoff(
  signedInAt: number | undefined,
  validFrom: Date | null | undefined,
): boolean {
  if (!validFrom) return false
  const cutoff = Math.floor(validFrom.getTime() / 1000)
  if (Number.isNaN(cutoff)) return true
  return typeof signedInAt !== 'number' || !Number.isFinite(signedInAt) || signedInAt < cutoff
}

/** The cut-off in whole seconds, 0 when the account has none. What a device compares to its own record. */
export function dataEpochOf(validFrom: Date | null | undefined): number {
  return validFrom ? Math.floor(validFrom.getTime() / 1000) : 0
}

/** Stamped into a token at sign-in. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
