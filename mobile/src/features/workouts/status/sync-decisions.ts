import type { AccountState } from '../../account/session.ts';

// The decisions behind WorkoutStatusSync and its account guard, as pure functions so each is
// tested without rendering anything (#3249).

export type AccountScope = { userId: string | null; cleared: boolean };
export const startingScope: AccountScope = { userId: null, cleared: false };

/**
 * When the old account's notification must go. Only a signed-out status or a different account
 * counts: while a token refreshes `userId` is briefly null with the status still signed in, and
 * clearing then would drop and re-post a live workout's notification.
 */
export function accountScopeDecision(
  scope: AccountScope,
  status: AccountState['status'],
  userId: string | null,
): { clear: boolean; scope: AccountScope } {
  if (status === 'signedOut') {
    return { clear: !scope.cleared, scope: { userId: null, cleared: true } };
  }
  if (userId === null) return { clear: false, scope };
  const switched = scope.userId !== null && scope.userId !== userId;
  return { clear: switched, scope: { userId, cleared: false } };
}

/**
 * Whether to ask for the notification permission for this workout. Only where the module exists,
 * only for a workout begun in this session (one already open at launch was reconciled without
 * asking), once per workout, and not again once Android will no longer show the prompt.
 */
export function shouldAskPermission(input: {
  moduleAvailable: boolean;
  startedHere: boolean;
  alreadyAsked: boolean;
  canAskAgain: boolean;
}) {
  return (
    input.moduleAvailable && input.startedHere && !input.alreadyAsked && input.canAskAgain
  );
}

/** A tap lands on its workout while that workout is still the active one, else on the Workout tab. */
export function routeOpen(activeId: string | null, requestedId: string): 'workout' | 'tab' {
  return activeId !== null && activeId === requestedId ? 'workout' : 'tab';
}
