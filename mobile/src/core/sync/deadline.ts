/**
 * #3913: Sync now waits on every store at once. Each request is cut off at 15 s, but a store that
 * awaits several in turn could still hold the button busy for minutes. Past this, it says so and
 * stops waiting; the uploads carry on behind it and keep their own retries.
 */
export const SYNC_NOW_LIMIT_MS = 45_000;
export const SYNC_NOW_SLOW =
  'Sync is taking longer than usual. It carries on in the background, and your changes stay saved on this phone.';

/** `work`, or a rejection with `message` once `ms` pass first. `work` itself is not stopped. */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

type SyncNowView = {
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
};
const failureText = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Could not sync. Your saved records are kept.';

/**
 * Sync now, one run at a time (#3923 review). A tap while a run is still going waits on that run
 * rather than starting a second one beside it. A run that outlives the deadline shows
 * `SYNC_NOW_SLOW`, and when it does finish its own outcome replaces that.
 */
export function syncNowRunner(view: SyncNowView, limit = SYNC_NOW_LIMIT_MS) {
  let current: Promise<string> | null = null;
  return async (start: () => Promise<string>) => {
    if (!current) {
      const run = start();
      current = run;
      run.then(
        (message) => {
          view.setError(null);
          view.setMessage(message);
        },
        (cause: unknown) => {
          view.setMessage(null);
          view.setError(failureText(cause));
        },
      );
      void run.catch(() => {}).finally(() => {
        if (current === run) current = null;
      });
    }
    view.setBusy(true);
    view.setError(null);
    view.setMessage(null);
    try {
      await withDeadline(current, limit, SYNC_NOW_SLOW);
    } catch (cause) {
      // The run's own failure is already shown by the handler above.
      if (cause instanceof Error && cause.message === SYNC_NOW_SLOW) view.setError(SYNC_NOW_SLOW);
    } finally {
      view.setBusy(false);
    }
  };
}
