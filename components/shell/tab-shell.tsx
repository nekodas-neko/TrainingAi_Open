"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import SessionSelectContent from "@/app/session-select/session-select-content";
import { BottomNav } from "@/components/shell/bottom-nav";
import { TabVisibilityProvider } from "./tab-visibility";
import { hrefForTab, tabKeyForHref, type TabKey } from "./tabs";
import { TAB_NAV_EVENT } from "@/lib/shell-nav";
import { cn } from "@trainingai/shared/utils";
import type { ActivityLevel } from "@trainingai/shared/types/user";

// Shown only on a tab's FIRST activation while its chunk loads (SW-cached →
// near-instant when warm). Never shown again for the life of the shell.
function TabChunkPulse() {
  return (
    <div className="flex flex-col bg-page min-h-screen pt-safe-or-4 px-4 gap-4" aria-busy="true">
      <div className="h-8 w-40 rounded-lg bg-muted/60 animate-pulse" />
      <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />
    </div>
  );
}

// Home is the entry screen — static import so first paint never waits on a
// second chunk. The other four load on first activation (code-split per tab).
const HealthContent = dynamic(() => import("@/app/health/health-content"), {
  ssr: false, loading: () => <TabChunkPulse />,
});
const WorkoutSelectContent = dynamic(() => import("@/app/workout-select/workout-select-content"), {
  ssr: false, loading: () => <TabChunkPulse />,
});
const NutritionContent = dynamic(() => import("@/app/nutrition/nutrition-content"), {
  ssr: false, loading: () => <TabChunkPulse />,
});
const MoreContent = dynamic(() => import("@/app/more/more-content"), {
  ssr: false, loading: () => <TabChunkPulse />,
});

export interface TabShellSession {
  userId: string;
  isAdmin?: boolean;
  friendCode?: string | null;
  sex?: string | null;
  heightCm?: number | null;
  dateOfBirth?: string | null;
  activityLevel?: ActivityLevel | null;
}

interface ShellState {
  active: TabKey;
  mounted: TabKey[];
  epochs: Record<TabKey, number>;
}

export function TabShell({ initialTab, session }: { initialTab: TabKey; session: TabShellSession }) {
  const [state, setState] = useState<ShellState>({
    active: initialTab,
    mounted: [initialTab],
    epochs: { home: 0, health: 0, workout: 0, nutrition: 0, more: 0 },
  });

  const show = useCallback((key: TabKey, href?: string) => {
    setState((s) => {
      if (s.active === key) return s;
      const seen = s.mounted.includes(key);
      return {
        active: key,
        mounted: seen ? s.mounted : [...s.mounted, key],
        // Re-shown tabs get a new epoch so they re-run their refresh pass;
        // a first mount runs its normal mount effects instead (epoch stays 0).
        epochs: seen ? { ...s.epochs, [key]: s.epochs[key] + 1 } : s.epochs,
      };
    });
    // Keep the URL honest for refresh/deep-links/back. replaceState (not push):
    // tab flips are peers, not a history trail — Android back exits the app
    // like a native tab app, instead of unwinding every tab visit.
    window.history.replaceState(null, "", href ?? hrefForTab(key));
  }, []);

  // Warm the other four tabs' JS chunks once the browser is idle, so the first switch to each is a
  // render rather than a chunk fetch + render. Home stays a static import (see above), so this only
  // covers the four that are code-split.
  //
  // CHUNKS, NOT DATA — deliberately. Each tab fetches its own data from mount effects, and those do
  // not run here because nothing is being rendered; only the module is downloaded and evaluated.
  // Warming the four tabs' *fetches* on load would put five screens' worth of requests on the
  // critical path and make cold start worse, which is the opposite of the point.
  //
  // `requestIdleCallback` is what keeps this off the critical path: it waits for the main thread to
  // be free, which on this screen means after home has painted and settled. The timeout is a
  // backstop for a device that never goes idle; the setTimeout branch is for any runtime without
  // the API (Chromium has it, so the S25 takes the idle path).
  useEffect(() => {
    let cancelled = false
    const warm = () => {
      if (cancelled) return
      // Re-importing a module webpack has already resolved is a no-op, so this is safe regardless
      // of which tab the shell opened on.
      void import("@/app/health/health-content")
      void import("@/app/workout-select/workout-select-content")
      void import("@/app/nutrition/nutrition-content")
      void import("@/app/more/more-content")
    }
    const ric = (window as Window & typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    })
    if (typeof ric.requestIdleCallback === "function") {
      const id = ric.requestIdleCallback(warm, { timeout: 4000 })
      return () => { cancelled = true; ric.cancelIdleCallback?.(id) }
    }
    const id = window.setTimeout(warm, 2000)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, []);

  // Cross-tab navigations from inside a tab (navigateToTab in lib/shell-nav.ts).
  useEffect(() => {
    function onNav(e: Event) {
      const href = (e as CustomEvent<string>).detail;
      const key = tabKeyForHref(href);
      if (!key) return; // full-screen workout route etc. — let the caller router.push
      e.preventDefault();
      show(key, href);
    }
    window.addEventListener(TAB_NAV_EVENT, onNav);
    return () => window.removeEventListener(TAB_NAV_EVENT, onNav);
  }, [show]);

  function renderTab(key: TabKey) {
    switch (key) {
      case "home":
        return <SessionSelectContent userId={session.userId} isAdmin={session.isAdmin} />;
      case "health":
        return (
          <HealthContent
            userId={session.userId}
            sex={session.sex ?? null}
            heightCm={session.heightCm ?? null}
            dateOfBirth={session.dateOfBirth ?? null}
            activityLevel={session.activityLevel ?? null}
          />
        );
      case "workout":
        return <WorkoutSelectContent />;
      case "nutrition":
        return <NutritionContent userId={session.userId} />;
      case "more":
        return <MoreContent friendCode={session.friendCode} />;
    }
  }

  return (
    <>
      <div className="relative h-full">
        {state.mounted.map((key) => {
          const isActive = key === state.active;
          return (
            <div
              key={key}
              className={cn(
                "absolute inset-0",
                // Short opacity crossfade on the incoming panel. A tab swap has
                // no network wait — every panel is already mounted — so this
                // animates content that is genuinely there, which is why it reads
                // as smooth rather than as a stall. A slide would be wrong here:
                // tabs are peers, not a hierarchy, so lateral motion implies a
                // depth relationship that doesn't exist.
                isActive && "tab-panel-enter",
                // invisible (not display:none / unmount) keeps layout, scroll
                // position, and component state alive; content-visibility lets
                // the compositor skip the hidden trees' rendering work.
                // tab-panel-idle pauses every CSS animation inside a hidden panel
                // (see globals.css). All five tabs stay mounted for scroll position
                // and state, so without this the four you are NOT looking at keep
                // animating forever — 49 components use animate-pulse and 46 use
                // animate-spin, both `infinite` in Tailwind, plus Home's meteors.
                // A device profile with the wallpaper disabled still showed
                // animationiteration at 21.3% of main-thread time, which is what
                // this is: loops running in panels nobody can see.
                !isActive && "invisible pointer-events-none [content-visibility:hidden] tab-panel-idle"
              )}
              {...(!isActive ? { inert: true } : {})}
              aria-hidden={!isActive}
            >
              <TabVisibilityProvider visible={isActive} epoch={state.epochs[key]}>
                {renderTab(key)}
              </TabVisibilityProvider>
            </div>
          );
        })}
      </div>
      <BottomNav isAdmin={session.isAdmin} activeTab={state.active} onTabChange={show} />
    </>
  );
}
