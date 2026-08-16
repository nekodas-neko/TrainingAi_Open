"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

export interface TabVisibility {
  /** True while this tab is the one the persistent shell is showing. */
  visible: boolean;
  /** Increments each time the shell re-shows this tab. 0 = first mount. */
  epoch: number;
}

// Default covers every render outside the shell (full-screen workout route,
// /profile/*, admin, plain dev rendering): always visible, never re-shown.
const TabVisibilityContext = createContext<TabVisibility>({ visible: true, epoch: 0 });

export function TabVisibilityProvider({
  visible,
  epoch,
  children,
}: TabVisibility & { children: React.ReactNode }) {
  const value = useMemo(() => ({ visible, epoch }), [visible, epoch]);
  return <TabVisibilityContext.Provider value={value}>{children}</TabVisibilityContext.Provider>;
}

export function useTabVisibility(): TabVisibility {
  return useContext(TabVisibilityContext);
}

/**
 * Runs `fn` each time the shell re-shows this tab — never on first mount, where the component's
 * own mount effect already ran.
 *
 * All five tabs stay mounted for the life of the app, so a `useEffect(…, [])` fetch runs ONCE per
 * app launch and the screen then shows that snapshot forever. Home/Health/Workout/Nutrition thread
 * `epoch` through their existing effects' dependency arrays; this hook is the same thing for the
 * leaf cards that have their own private load function, so they don't each need the prop or the
 * hand-rolled `epoch > 0` guard.
 *
 * `fn` is held in a ref, so an inline arrow at the call site does not re-fire it.
 */
export function useRefreshOnTabShow(fn: () => void): void {
  const { epoch } = useTabVisibility();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (epoch === 0) return;
    ref.current();
  }, [epoch]);
}
