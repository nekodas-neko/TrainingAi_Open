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

type PendingData = { count?: number; feedbackCount?: number } | null | undefined;

/** Unread feedback only; the server sends 0 to an admin who is not the owner. */
export function adminFeedbackCount(data: PendingData) {
  return Math.max(0, data?.feedbackCount ?? 0);
}

/** The Admin Console row's line, so the row says what the marker is for ("2 accounts waiting · 1 new feedback"). */
export function adminPendingSubtitle(signups: number, feedback: number): string | undefined {
  const parts: string[] = [];
  if (signups > 0) parts.push(`${signups} ${signups === 1 ? 'account' : 'accounts'} waiting`);
  if (feedback > 0) parts.push(`${feedback} new feedback`);
  return parts.length ? parts.join(' · ') : undefined;
}

/** A profile button with a count lands on the Admin Console, where the counted accounts are; without one it opens More. */
export function profileDestination(badge: number): 'admin' | 'more' {
  return badge > 0 ? 'admin' : 'more';
}
