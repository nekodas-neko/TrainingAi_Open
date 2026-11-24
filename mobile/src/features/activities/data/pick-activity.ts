import type { ActivityType } from './models';

// What choosing a tile in the Log Activity sheet does (#4099). Kept out of the screen so the order
// is testable: one start at a time, an open session is opened rather than started over, and the
// sheet is told to close before the screen is asked to navigate (the navigation itself waits for
// the sheet's close, in `afterSheet`).
export type PickDeps = {
  store: { start(type: ActivityType): Promise<unknown> } | null;
  hasSession: boolean;
  closeSheet(): void;
  /** Runs `next` once the sheet has closed; `settled` when that is over (ran or dropped). */
  afterSheet(next: () => void, settled: () => void): void;
  openActivity(): void;
  /** An activity is already open: say so instead of starting another. */
  inProgress(): void;
  setBusy(busy: boolean): void;
  setError(message: string | null): void;
};
// The tiles stay locked from the first tap until the navigation has happened or been dropped, not
// just until `start` returns: the sheet takes 180 ms to close and a second tap in that window must
// not start anything.
export async function pickActivity(
  guard: { current: boolean },
  deps: PickDeps,
  type: ActivityType,
) {
  if (!deps.store || guard.current) return;
  guard.current = true;
  deps.setBusy(true);
  deps.setError(null);
  const release = () => {
    guard.current = false;
    deps.setBusy(false);
  };
  if (deps.hasSession) {
    release();
    deps.inProgress();
    return;
  }
  let handedOff = false;
  try {
    await deps.store.start(type);
    deps.afterSheet(deps.openActivity, release);
    handedOff = true;
    deps.closeSheet();
  } catch (cause) {
    deps.setError(cause instanceof Error ? cause.message : 'Could not start activity.');
  } finally {
    if (!handedOff) release();
  }
}
