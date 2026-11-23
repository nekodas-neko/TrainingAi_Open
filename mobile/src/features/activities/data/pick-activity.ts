import type { ActivityType } from './models';

// What choosing a tile in the Log Activity sheet does (#4099). Kept out of the screen so the order
// is testable: one start at a time, an open session is opened rather than started over, and the
// sheet is told to close before the screen is asked to navigate (the navigation itself waits for
// the sheet's close, in `afterSheet`).
export type PickDeps = {
  store: { start(type: ActivityType): Promise<unknown> } | null;
  hasSession: boolean;
  closeSheet(): void;
  afterSheet(next: () => void): void;
  openActivity(): void;
  setBusy(busy: boolean): void;
  setError(message: string | null): void;
};
export async function pickActivity(
  guard: { current: boolean },
  deps: PickDeps,
  type: ActivityType,
) {
  if (!deps.store || guard.current) return;
  guard.current = true;
  deps.setBusy(true);
  deps.setError(null);
  try {
    if (!deps.hasSession) await deps.store.start(type);
    deps.afterSheet(deps.openActivity);
    deps.closeSheet();
  } catch (cause) {
    deps.setError(cause instanceof Error ? cause.message : 'Could not start activity.');
  } finally {
    guard.current = false;
    deps.setBusy(false);
  }
}
