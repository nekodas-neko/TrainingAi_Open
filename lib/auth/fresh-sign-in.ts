/**
 * #3797 — a "fresh" sign-in, which setting a FIRST password requires.
 *
 * An account with no password can be given one without knowing a current one. Linking Google onto a
 * password account clears the password (RV-192), so without this check a cookie someone held from
 * before the link (signed in with the password the link just cleared) could set a new password and
 * keep the account. Changing an existing password is not gated: it already needs the current one.
 *
 * Fresh means both:
 * - **signed in within `FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS`.** Ten minutes: long enough to sign
 *   in, open Profile and type a password twice; short enough that a session left signed in on a
 *   shared or lost device cannot do it. It is the window GitHub and Google use for "confirm access"
 *   (sudo mode) on account-security changes.
 * - **signed in no earlier than the account's newest sign-in method was linked.** A session from
 *   before the link is from before the password was cleared, however recent it is, so a cookie
 *   from a password sign-in one minute before the link does not count.
 *
 * `signedInAt` is the session's whole-second sign-in stamp (`auth.config.ts`); a session without one
 * predates the stamp and is not fresh. Compared in whole seconds with the link floored, so a sign-in
 * in the same second as its own link counts (the link happens inside that sign-in).
 */
export const FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS = 10 * 60

export function freshForFirstPassword(
  signedInAt: number | undefined,
  latestIdentityLinkedAt: Date | null,
  nowSeconds: number,
): boolean {
  if (typeof signedInAt !== 'number' || !Number.isFinite(signedInAt)) return false
  if (nowSeconds - signedInAt > FIRST_PASSWORD_SIGN_IN_MAX_AGE_SECONDS) return false
  if (latestIdentityLinkedAt) {
    const linked = Math.floor(latestIdentityLinkedAt.getTime() / 1000)
    if (Number.isNaN(linked) || signedInAt < linked) return false
  }
  return true
}

export const FRESH_SIGN_IN_ERROR = 'To set a password, sign out and sign in again first, then set it within 10 minutes.'
