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

/**
 * `refused`: changes the server turned down. They do not upload on their own; the person decides
 * with Retry or Discard, so the notice words them apart from rows that are only waiting.
 */
export type SyncWaiting = { label: string; reason: string; refused?: number; what?: string };
export type SyncReason = string | { refused: number; what?: string };

const reasonOf = (cause: unknown) =>
  (cause instanceof Error ? cause.message : String(cause || 'it failed'))
    .replace(/\.+$/, '')
    .toLowerCase();

/** What a store's own state says is still not uploaded; `null` when nothing is. Read live. */
export type SyncCheck = () => SyncReason | null | undefined;
type StepOptions = {
  /** Read once the step is given up on or ends: what its own state says is left. */
  check?: SyncCheck;
  /** Why a step still going is going, when more than "no answer yet" is known. */
  still?: () => string | null | undefined;
};

/**
 * The steps of one run: each ends in done or a stated reason, and none can throw or hang the run.
 * It keeps answering after the run's end: a step given up on is listed until it truly settles, and
 * a store's own error or pending count is read live, so a notice built from it never claims
 * something is waiting that is not (#3906 review).
 */
export class SyncBoard {
  private readonly failed = new Map<string, string>();
  private readonly pending = new Set<{ label: string; still: StepOptions['still'] }>();
  private readonly checks = new Map<string, SyncCheck[]>();
  /** Counts read after a store's own checks: they name a store that has no reason of its own. */
  private readonly counts = new Map<string, SyncCheck[]>();
  private readonly alsoNotes: (() => string | null | undefined)[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly watched: ((notify: () => void) => () => void)[] = [];
  private notify = () => this.listeners.forEach((listener) => listener());
  async step(
    label: string,
    work: (() => Promise<unknown>) | null | undefined,
    ms = SYNC_STEP_LIMIT_MS,
    options: StepOptions = {},
  ) {
    if (!work) return;
    if (options.check) this.checks.set(label, [...(this.checks.get(label) ?? []), options.check]);
    const job = Promise.resolve().then(work);
    let settled = false;
    const entry = { label, still: options.still };
    this.pending.add(entry);
    job.then(
      () => {
        settled = true;
        this.release(entry);
      },
      (cause) => {
        settled = true;
        this.failed.set(label, reasonOf(cause));
        this.release(entry);
      },
    );
    try {
      await withDeadline(job, ms, NO_ANSWER);
    } catch {
      // Thrown work is recorded above; a bound that fired leaves the step pending until it settles.
      if (!settled) this.notify();
    }
  }
  private release(entry: object) {
    this.pending.delete(entry as never);
    this.notify();
  }
  /** A step that finished without throwing but left an error on its store. */
  fail(label: string, reason: string | null | undefined) {
    if (reason) this.check(label, () => reason);
  }
  /** What this store's own state says is left, read live each time the board is asked. */
  check(label: string, read: SyncCheck) {
    this.checks.set(label, [...(this.checks.get(label) ?? []), read]);
  }
  /** A store's pending count, as a last check: it only names the store when nothing else did. */
  count(label: string, read: SyncCheck) {
    this.counts.set(label, [...(this.counts.get(label) ?? []), read]);
  }
  /** Something running outside the steps that the result should name while it goes (#3906). */
  also(note: () => string | null | undefined) {
    this.alsoNotes.push(note);
  }
  /** A store's own change feed, so a notice follows it after the run has ended. */
  watch(subscribe: ((notify: () => void) => () => void) | undefined) {
    if (subscribe) this.watched.push(subscribe);
  }
  alsoText() {
    return this.alsoNotes
      .map((note) => note())
      .filter((text): text is string => !!text)
      .join(' ');
  }
  waiting(): SyncWaiting[] {
    const rows = new Map<string, SyncWaiting | string>(this.failed);
    for (const { label, still } of this.pending)
      if (!rows.has(label)) rows.set(label, still?.() || NO_ANSWER);
    const labels = new Set([...this.checks.keys(), ...this.counts.keys()]);
    for (const label of labels) {
      if (rows.has(label)) continue;
      for (const read of [...(this.checks.get(label) ?? []), ...(this.counts.get(label) ?? [])]) {
        const reason = read();
        if (!reason) continue;
        rows.set(
          label,
          typeof reason === 'string'
            ? reasonOf(reason)
            : { label, reason: 'refused', refused: reason.refused, what: reason.what },
        );
        break;
      }
    }
    return [...rows].map(([label, row]) =>
      typeof row === 'string' ? { label, reason: row } : row,
    );
  }
  /** Calls `fn` when a step settles or a watched store changes; returns how to stop. */
  follow(fn: () => void) {
    this.listeners.add(fn);
    const stops = this.watched.map((subscribe) => subscribe(fn));
    return () => {
      this.listeners.delete(fn);
      stops.forEach((stop) => stop());
    };
  }
}

/** Plain words for what did not finish, and what that means for the person's data. */
export function waitingText(waiting: SyncWaiting[]) {
  const queued = waiting.filter((row) => !row.refused);
  const refused = waiting.filter((row) => row.refused);
  const parts = ['Not everything uploaded.'];
  if (queued.length) {
    const list = queued.map((row) => `${row.label} (${row.reason})`).join(', ');
    parts.push(`Still waiting: ${list}. It is saved on this phone and uploads on its own.`);
  }
  // A refused change never uploads by itself: say so, and point to the card that decides.
  for (const row of refused) {
    const count = row.refused ?? 0;
    parts.push(
      `${count} ${row.what ?? row.label} ${count === 1 ? 'change was' : 'changes were'} refused by the server. Use Retry or Discard below.`,
    );
  }
  return parts.join(' ');
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
 * After the end the notice follows what is still outstanding: when it finishes, the notice is
 * replaced by the final state, until a new run takes the screen.
 */
export function syncNowRunner(
  view: SyncNowView,
  limits: { slow?: number; end?: number } = {},
) {
  const slow = limits.slow ?? SYNC_NOW_LIMIT_MS,
    end = limits.end ?? SYNC_NOW_END_MS;
  let current: Promise<void> | null = null;
  let stopFollowing: (() => void) | null = null;
  let generation = 0;
  const run = (start: (board: SyncBoard) => Promise<string>): Promise<void> => {
    if (current) return current;
    stopFollowing?.();
    stopFollowing = null;
    const mine = ++generation;
    const board = new SyncBoard();
    let finished: string | null = null,
      failure: string | null = null,
      over = false;
    const show = () => {
      if (mine !== generation) return;
      const waiting = board.waiting();
      const extra = board.alsoText();
      const tail = extra ? ` ${extra}` : '';
      if (waiting.length) {
        view.setMessage(null);
        view.setError(waitingText(waiting) + tail);
      } else if (finished) {
        view.setMessage(finished + tail);
        view.setError(null);
      } else {
        view.setMessage(null);
        view.setError((failure ?? 'Could not sync. Your saved records are kept.') + tail);
      }
      // Unfollow only when nothing is waiting, the run has its result and no source is still going.
      if (over && !waiting.length && finished && !extra) {
        stopFollowing?.();
        stopFollowing = null;
      }
    };
    view.setBusy(true);
    view.setError(null);
    view.setMessage(null);
    const slowTimer = setTimeout(() => view.setMessage(SYNC_NOW_SLOW), slow);
    const started = new Promise<string>((resolve) => resolve(start(board)));
    // The work itself carries on past the end; when it finally answers, the notice catches up.
    started.then(
      (message) => {
        finished = message;
        if (over) show();
      },
      () => {},
    );
    const run = withDeadline(started, end, endedText)
      .then(
        (message) => {
          finished = message;
        },
        (cause: unknown) => {
          failure = cause instanceof Error ? cause.message : null;
        },
      )
      .finally(() => {
        clearTimeout(slowTimer);
        over = true;
        show();
        view.setBusy(false);
        current = null;
        const waiting = board.waiting();
        if (mine === generation && (waiting.length || !finished || board.alsoText())) {
          stopFollowing = board.follow(show);
        }
      });
    current = run;
    return run;
  };
  /**
   * The account changed: stop following, forget the run, and let nothing the old run emits reach
   * the view. The old work is not cancelled (its own stores keep it saved); a new tap starts a run
   * of its own instead of joining it (#3906 second check).
   */
  run.dispose = () => {
    generation++;
    stopFollowing?.();
    stopFollowing = null;
    current = null;
  };
  return run;
}
