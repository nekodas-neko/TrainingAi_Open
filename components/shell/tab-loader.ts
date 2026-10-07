// The load state behind a preloaded tab (`preloaded-tab.tsx`), kept free of React so it can be
// tested in node.
//
// #2608: before #2507 a tab chunk that failed to import threw into the root error boundary, which
// retried once and reported it. `createPreloadedTab` replaced `next/dynamic` and swallowed the
// rejection, so a failed import — and an import that never settled at all — both read as an endless
// skeleton, with nothing in the console and nothing in `error_events`. That is how the Health tab sat
// on its pulse for a whole device sitting with no clue why. Every way a tab can fail to arrive now
// ends in a state the screen can show and a report the owner can read:
//
// - the import rejects → `failed`, logged and reported with the error;
// - the import resolves to something that is not a component → `failed`, same;
// - the import is still pending after `slowMs` → `slow`, logged and reported once. It is not given
//   up on: if it settles later, the tab swaps to the screen (or to `failed`) in place.

export type TabLoadStatus = "idle" | "loading" | "slow" | "ready" | "failed";

export interface TabLoadState<C> {
  readonly status: TabLoadStatus;
  readonly Screen: C | null;
}

export interface TabLoaderOptions {
  /** Names the tab in logs and reports, e.g. "health". */
  name: string;
  /** How long an import may stay pending before it is reported as hung. */
  slowMs?: number;
  /** Where a failure or hang goes. Called at most once per failure and once per hang. */
  report: (message: string, error?: unknown) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const TAB_IMPORT_SLOW_MS = 10_000;

export function tabImportHungMessage(name: string, ms: number): string {
  return `[tab-import] ${name}: import still pending after ${Math.round(ms / 1000)} s (#2608)`;
}

export function tabImportFailedMessage(name: string, error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `[tab-import] ${name}: import failed: ${detail}`;
}

export function createTabLoader<C>(
  load: () => Promise<{ default: C }>,
  { name, slowMs = TAB_IMPORT_SLOW_MS, report, setTimer = (cb, ms) => setTimeout(cb, ms), clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }: TabLoaderOptions,
) {
  let state: TabLoadState<C> = { status: "idle", Screen: null };
  let pending: Promise<void> | null = null;
  let hangReported = false;
  const listeners = new Set<() => void>();

  const set = (next: TabLoadState<C>) => {
    state = next;
    listeners.forEach((cb) => cb());
  };

  function fail(error: unknown) {
    report(tabImportFailedMessage(name, error), error);
    // Retryable: the next preload (a remount, or the error view's retry) asks again.
    pending = null;
    set({ status: "failed", Screen: null });
  }

  function preload(): Promise<void> {
    if (state.status === "ready") return Promise.resolve();
    if (pending) return pending;

    set({ status: "loading", Screen: null });
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      set({ status: "slow", Screen: null });
      if (!hangReported) {
        hangReported = true;
        report(tabImportHungMessage(name, slowMs));
      }
    }, slowMs);

    let started: Promise<{ default: C }>;
    try {
      started = load();
    } catch (error) {
      settled = true;
      clearTimer(timer);
      fail(error);
      return Promise.resolve();
    }

    const attempt: Promise<void> = started.then(
      (mod) => {
        settled = true;
        clearTimer(timer);
        const Screen = mod?.default;
        if (typeof Screen !== "function" && (typeof Screen !== "object" || Screen === null)) {
          fail(new Error(`module resolved without a default component (got ${typeof Screen})`));
          return;
        }
        set({ status: "ready", Screen });
      },
      (error: unknown) => {
        settled = true;
        clearTimer(timer);
        fail(error);
      },
    );
    pending = attempt;
    return attempt;
  }

  return {
    preload,
    getSnapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
