/**
 * Whether an active walk, run or guided walk holds the strap link right now (#3541).
 *
 * With the recording service running, the app is allowed to run with the screen off, so the hold
 * stays regardless of the app state. With no service Android may freeze the app in the background,
 * so a background hold would only drain the battery and leave gaps: hold in the foreground only.
 */
export function activityHoldWanted(serviceRunning: boolean, appState: string): boolean {
  return serviceRunning || appState === 'active';
}

type HoldTarget = { hold: (reason: 'activity', on: boolean) => void };
type AppStateSource = {
  currentState: string;
  addEventListener: (type: 'change', listener: (state: string) => void) => { remove: () => void };
};

/**
 * Holds the strap for one walk, run or guided walk. `update` applies a changed recording-service
 * state as a plain change to the wanted hold, never a release in between: releasing the last hold
 * drops the link and ends the recording, and the service starts a few seconds into a walk (#3541).
 * `release` is for the walk's end only.
 */
export function holdStrapForActivity(
  session: HoldTarget,
  appState: AppStateSource,
  serviceRunning: boolean,
) {
  let running = serviceRunning;
  const apply = (state: string) => session.hold('activity', activityHoldWanted(running, state));
  apply(appState.currentState);
  const listener = appState.addEventListener('change', apply);
  return {
    update(next: boolean) {
      running = next;
      apply(appState.currentState);
    },
    release() {
      listener.remove();
      session.hold('activity', false);
    },
  };
}
