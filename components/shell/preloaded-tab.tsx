"use client";

import { useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { reportClientError } from "@/lib/client-error";
import { createTabLoader, type TabLoadState } from "./tab-loader";

// A code-split tab whose first activation renders the real screen, not a fallback, once its chunk
// has been fetched (#2442).
//
// `next/dynamic` could not do that. Its loader returns a promise, React cannot see that the promise
// is already settled, so the lazy boundary suspends on its first render in each page and commits
// the fallback — for the whole of that first render — even when the idle warm-up fetched the chunk
// minutes earlier. This keeps the resolved component in a module-level loader instead: `preload()`
// (called by the shell's idle warm-up and, as a backstop, on mount) fills it, and a render that
// finds it filled returns the real screen in the same commit as the tab flip.
//
// The wrapper's own type never changes, so a tab that mounted on the fallback swaps to the screen
// in place when the chunk lands rather than remounting.
//
// A tab that cannot arrive says so (#2608): a failed import, or one still pending after
// `TAB_IMPORT_SLOW_MS`, is logged, reported to `error_events`, and shown as a "did not load" view
// with a reload, instead of the pulse forever. `tab-loader.ts` holds the states and why.

const IDLE: TabLoadState<never> = { status: "idle", Screen: null };

function reportTabImport(message: string, error?: unknown) {
  console.error(message, error ?? "");
  reportClientError({ message, stack: error instanceof Error ? error.stack : undefined });
}

function TabDidNotLoad({ name }: { name: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-page px-6 pt-safe-or-4 text-center" role="alert">
      <p className="text-base font-semibold">{name} did not load</p>
      <p className="text-sm text-muted-foreground">Reloading the app usually fixes this.</p>
      <button
        type="button"
        className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground active:opacity-80"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

export function createPreloadedTab<P extends object>(
  name: string,
  load: () => Promise<{ default: ComponentType<P> }>,
  fallback: () => ReactNode,
) {
  const loader = createTabLoader(load, { name: name.toLowerCase(), report: reportTabImport });
  const getServerSnapshot = () => IDLE as TabLoadState<ComponentType<P>>;

  function PreloadedTab(props: P) {
    const { status, Screen } = useSyncExternalStore(loader.subscribe, loader.getSnapshot, getServerSnapshot);
    useEffect(() => { void loader.preload(); }, []);
    if (Screen) return <Screen {...props} />;
    if (status === "failed" || status === "slow") return <TabDidNotLoad name={name} />;
    return <>{fallback()}</>;
  }

  return { Tab: PreloadedTab, preload: loader.preload };
}
