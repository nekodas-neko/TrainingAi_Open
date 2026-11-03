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
