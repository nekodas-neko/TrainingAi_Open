import type { AccountState } from '../../account/session.ts';

// The decisions behind WorkoutStatusSync and its account guard, as pure functions so each is
// tested without rendering anything (#3249).

export type AccountScope = { userId: string | null; cleared: boolean };
export const startingScope: AccountScope = { userId: null, cleared: false };

/**
 * When the old account's notification must go. Only a signed-out status or a different account
 * counts: while a token refreshes `userId` is briefly null with the status still signed in, and
 * clearing then would drop and re-post a live workout's notification. A sign-out whose secure
 * storage could not be cleared ends in `storageError` with the session already gone: signed out too.
 */
export function accountScopeDecision(
  scope: AccountScope,
  status: AccountState['status'],
  userId: string | null,
  hasSession = true,
): { clear: boolean; scope: AccountScope } {
  if (status === 'signedOut' || (status === 'storageError' && !hasSession)) {
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

/**
 * How long to wait before sending a journal change to the notification: null sends it now. React
 * Native fires no timers while the app is in the background or in picture-in-picture, so a change
 * made there (a window button) would wait until the app came back, leaving the old countdown and
 * its rest-end alarm in place.
 */
export function statusDelay(appState: string, reconciled: boolean, debounceMs: number) {
  if (appState !== 'active') return null;
  return reconciled ? debounceMs : 0;
}
