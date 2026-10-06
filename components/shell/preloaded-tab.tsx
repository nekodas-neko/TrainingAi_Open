"use client";

import { useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from "react";

// A code-split tab whose first activation renders the real screen, not a fallback, once its chunk
// has been fetched (#2442).
//
// `next/dynamic` could not do that. Its loader returns a promise, React cannot see that the promise
// is already settled, so the lazy boundary suspends on its first render in each page and commits
// the fallback — for the whole of that first render — even when the idle warm-up fetched the chunk
// minutes earlier. This keeps the resolved component in a module variable instead: `preload()`
// (called by the shell's idle warm-up and, as a backstop, on mount) fills it, and a render that
// finds it filled returns the real screen in the same commit as the tab flip.
//
// The wrapper's own type never changes, so a tab that mounted on the fallback swaps to the screen
// in place when the chunk lands rather than remounting.
export function createPreloadedTab<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  fallback: () => ReactNode,
) {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };
  const getSnapshot = () => Loaded;
  const getServerSnapshot = () => null;

  function preload(): Promise<void> {
    pending ??= load().then(
      (mod) => {
        Loaded = mod.default;
        listeners.forEach((cb) => cb());
      },
      () => {
        // A failed fetch must be retryable: the next preload or mount asks again.
        pending = null;
      },
    );
    return pending;
  }

  function PreloadedTab(props: P) {
    const Screen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    useEffect(() => { void preload(); }, []);
    return Screen ? <Screen {...props} /> : <>{fallback()}</>;
  }

  return { Tab: PreloadedTab, preload };
}
