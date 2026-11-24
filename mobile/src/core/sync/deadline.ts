/**
 * #3913, #3906: Sync now waits on every store at once. Each request is cut off at 15 s, but a store
 * that awaits several in turn, or a native call that never answers, could hold the button busy
 * with no outcome. So: every step has its own bound, the "taking longer" notice stays at 45 s, and
 * the whole run has an end after which it says what finished and what is still waiting. Nothing is
 * cancelled when a step is given up on: the work carries on behind it and keeps its own retries,
 * and every change stays saved on this phone.
 */
export const SYNC_NOW_LIMIT_MS = 45_000;
export const SYNC_NOW_END_MS = 90_000;
export const SYNC_STEP_LIMIT_MS = 40_000;
export const SYNC_NOW_SLOW =
  'Sync is taking longer than usual. It carries on in the background, and your changes stay saved on this phone.';
const NO_ANSWER = 'no answer yet';

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

export type SyncWaiting = { label: string; reason: string };

const reasonOf = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause || 'it failed'))
    .replace(/\.+$/, '')
    .toLowerCase();

/** The steps of one run: each ends in done or a stated reason, and none can throw or hang the run. */
export class SyncBoard {
  private readonly failed: SyncWaiting[] = [];
  private readonly running = new Set<string>();
  async step(label: string, work: (() => Promise<unknown>) | null | undefined, ms = SYNC_STEP_LIMIT_MS) {
    if (!work) return;
    this.running.add(label);
    try {
      await withDeadline(Promise.resolve().then(work), ms, NO_ANSWER);
    } catch (cause) {
      this.failed.push({ label, reason: reasonOf(cause) });
    } finally {
      this.running.delete(label);
    }
  }
  /** A step that finished without throwing but left an error on its store. */
  fail(label: string, reason: string | null | undefined) {
    if (reason && !this.failed.some((row) => row.label === label))
      this.failed.push({ label, reason: reasonOf(reason) });
  }
  waiting(): SyncWaiting[] {
    return [
      ...this.failed,
      ...[...this.running].map((label) => ({ label, reason: NO_ANSWER })),
    ];
  }
}

/** Plain words for what did not finish, and what that means for the person's data. */
export function waitingText(waiting: SyncWaiting[]) {
  const list = waiting.map((row) => `${row.label} (${row.reason})`).join(', ');
  return `Not everything uploaded. Still waiting: ${list}. It is saved on this phone and uploads on its own.`;
}
const endedText =
  'Sync stopped waiting. Your changes are saved on this phone and upload on their own.';

type SyncNowView = {
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
};

/**
 * Sync now, one run at a time. A tap while a run is going gets that run, not a second one. The run
 * ends in `view`: the success text `start` returns when every step finished, otherwise the steps
 * that did not. It always ends: past `end` it stops waiting and says what is still outstanding.
 */
export function syncNowRunner(
  view: SyncNowView,
  limits: { slow?: number; end?: number } = {},
) {
  const slow = limits.slow ?? SYNC_NOW_LIMIT_MS,
    end = limits.end ?? SYNC_NOW_END_MS;
  let current: Promise<void> | null = null;
  return (start: (board: SyncBoard) => Promise<string>): Promise<void> => {
    if (current) return current;
    const board = new SyncBoard();
    view.setBusy(true);
    view.setError(null);
    view.setMessage(null);
    const slowTimer = setTimeout(() => view.setMessage(SYNC_NOW_SLOW), slow);
    const run = withDeadline(new Promise<string>((resolve) => resolve(start(board))), end, endedText)
      .then(
        (message) => {
          const waiting = board.waiting();
          view.setMessage(waiting.length ? null : message);
          view.setError(waiting.length ? waitingText(waiting) : null);
        },
        (cause: unknown) => {
          const waiting = board.waiting();
          view.setMessage(null);
          view.setError(
            waiting.length
              ? waitingText(waiting)
              : cause instanceof Error
                ? cause.message
                : 'Could not sync. Your saved records are kept.',
          );
        },
      )
      .finally(() => {
        clearTimeout(slowTimer);
        view.setBusy(false);
        current = null;
      });
    current = run;
    return run;
  };
}
