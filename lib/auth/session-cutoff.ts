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

/**
 * #3829 / #3854, the sign-in cut-off (`users.sign_ins_valid_from`): the strict rule. A sign-in
 * issued before the cut-off is refused, with no same-second survivor.
 *
 * One clock, the database's. The cut-off is written by `endSignInsBefore` from the database clock as
 * a whole second strictly after the moment it is written (and after any earlier cut-off), and every
 * sign-in is stamped from the same clock: a web session by `signInStampFor` at sign-in, a native
 * access token from its refresh row's `created_at`, which the insert sets to no earlier than the
 * account's cut-off. So a stamp taken before the cut-off was written is always below it, and one
 * taken after it is at or above it. The comparison is then exact: `signedInAt < ceil(cut-off)`.
 *
 * The ceiling, not the floor, is what makes a cut-off with a fraction (one written by app code
 * before this, from the app's clock) strict too: a token stamped in the same second as it is refused
 * rather than kept. A token with no usable `signedInAt`, or an unreadable cut-off, is refused.
 */
export function signedInBeforeSignInCutoff(
  signedInAt: number | undefined,
  validFrom: Date | null | undefined,
): boolean {
  if (!validFrom) return false
  const cutoff = signInCutoffSeconds(validFrom)
  if (Number.isNaN(cutoff)) return true
  return typeof signedInAt !== 'number' || !Number.isFinite(signedInAt) || signedInAt < cutoff
}

/** The same rule for a native refresh row, by its `created_at` (database clock, sub-second). */
export function issuedBeforeSignInCutoff(issuedAt: Date, validFrom: Date | null | undefined): boolean {
  if (!validFrom) return false
  const cutoff = signInCutoffSeconds(validFrom)
  const issued = issuedAt.getTime()
  if (Number.isNaN(cutoff) || Number.isNaN(issued)) return true
  return issued < cutoff * 1000
}

/** The sign-in cut-off as a whole second, rounded up. NaN for an invalid date. */
export function signInCutoffSeconds(validFrom: Date): number {
  return Math.ceil(validFrom.getTime() / 1000)
}

/** The cut-off in whole seconds, 0 when the account has none. What a device compares to its own record. */
export function dataEpochOf(validFrom: Date | null | undefined): number {
  return validFrom ? Math.floor(validFrom.getTime() / 1000) : 0
}

/** Stamped into a token at sign-in. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
