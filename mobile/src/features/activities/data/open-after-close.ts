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
export function openAfterClose(
  open: () => void,
  fallbackMs = 700,
  timers: Timers = realTimers,
): AfterClose {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    timers.clear(handle);
    open();
  };
  const handle = timers.set(fire, fallbackMs);
  return {
    closed: fire,
    cancel() {
      done = true;
      timers.clear(handle);
    },
  };
}
