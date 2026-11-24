// Navigating while a sheet is still closing is what stranded the Log Activity sheet over the
// activity screen (#4099). This holds the navigation until the sheet reports it has closed, and
// runs it once: `closed()` fires it, and so does a timer, in case the close never reports.
export type AfterClose = { closed(): void; cancel(): void };
export type Timers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};
const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
// `settled` runs once when this is over either way (it opened, or it was cancelled), so a caller
// holding a lock for the wait can let go of it.
export function openAfterClose(
  open: () => void,
  fallbackMs = 700,
  timers: Timers = realTimers,
  settled?: () => void,
  // False while the screen is hidden or gone: nothing navigates from there.
  canOpen: () => boolean = () => true,
): AfterClose {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    timers.clear(handle);
    settled?.();
    if (canOpen()) open();
  };
  const handle = timers.set(fire, fallbackMs);
  return {
    closed: fire,
    cancel() {
      if (done) return;
      done = true;
      timers.clear(handle);
      settled?.();
    },
  };
}
