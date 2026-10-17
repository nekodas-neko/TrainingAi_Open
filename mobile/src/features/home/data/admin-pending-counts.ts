/** Signups waiting to be let in: the current app's avatar badge counts these and nothing else. */
export function adminSignupCount(
  data: { count?: number; feedbackCount?: number } | null | undefined,
) {
  return Math.max(0, data?.count ?? 0);
}

/** Signups plus unread feedback: the current app's More-tab dot lights for either. */
export function adminPendingTotal(
  data: { count?: number; feedbackCount?: number } | null | undefined,
) {
  return Math.max(0, (data?.count ?? 0) + (data?.feedbackCount ?? 0));
}
