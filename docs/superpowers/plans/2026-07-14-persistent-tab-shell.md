# Persistent Tab Shell — MyFitnessPal-Style Instant Tab Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bottom-nav tab switching a pure client-side visibility flip — zero network, zero remount, scroll and state preserved — by collapsing the five tab routes into one persistent client shell, the way native tab apps (MyFitnessPal, Samsung Health) keep every tab's view alive.

**Architecture:** A new `TabShell` client component owns the active tab as React state and renders all five tab content components; each tab lazy-mounts on first activation and then stays mounted, hidden via CSS (`invisible` + `inert` + absolute stacking) so its DOM, scroll position, and component state survive. All five tab routes render the same shell (with a different `initialTab`), the URL stays in sync via `window.history.replaceState` (Next 15 syncs `usePathname`/`useSearchParams` with native history calls), and a small visibility context (`useTabVisibility` → `{ visible, epoch }`) lets each tab re-run its refresh pass when re-shown — replacing the refresh that route remounting used to provide. Chunk A is the shell mechanics; Chunk B is keep-alive correctness; **A and B ship in one PR** (B is A's correctness half — never land A alone).

**Tech Stack:** Next.js 15 App Router (native-history shallow routing, `next/dynamic`), React 19 (`inert` prop), existing shell components (`bottom-nav.tsx`, `tab-swipe-navigator.tsx`, `tabs.ts`), existing per-screen cache seeding (`lib/sqlite/cache.ts`).

---

## Why (context — read before implementing)

The v1.133.0 instant-nav work (`docs/superpowers/plans/2026-07-11-instant-nav-and-app-open.md`, review `docs/reviews/2026-07-11-offline-feel-performance-review.md`) removed the RSC round-trip from **warm revisits** via `experimental.staleTimes`. The owner still reports a "mini load/delay between pages" (2026-07-14). What remains, in order:

1. **Every tab tap still unmounts and remounts the target tab's entire React tree.** Even a zero-network router-cache hit rebuilds a 1,300+-line screen (`session-select-content.tsx`), re-runs every `useLayoutEffect` cache seed (sessionStorage reads + `JSON.parse`), and re-renders the full card fleet on the WebView — tens to hundreds of ms of main-thread work plus lost scroll position, on the app's most frequent interaction.
2. **The first visit to each tab after every app open is still a network RSC fetch** (all five tab pages are dynamic `await auth()` server components), and the router cache expires after 5 minutes — so an idle-then-tap also pays a full Railway round-trip and shows the `TabLoading` skeleton (the visible "mini load" flash).
3. **The `staleTimes` behaviour was never verified on the S25 WebView** (Known Issues row "Perceived latency … NOT verified on-device") — the warm-revisit fix may not even be fully effective on the real target.

Native tab apps don't have this problem because their tabs are **views kept alive in memory**; switching is a visibility flip. This plan gives the WebView the same structure. It is the review's §5-P4 "cheaper intermediate variant" (single client-side shell, tabs as client state) — the full bundle-shell-into-APK endgame stays a separate unqueued item.

**What this deliberately keeps:** `staleTimes`, the five `loading.tsx` boundaries and `TabLoading` (they still cover cold route entries: app open, deep links, back from `/profile/*`/`/admin`), and the SW behaviour (queued backlog item "SW deploy-skew fix" touches document loads only — no overlap: this plan removes router navigations between tabs entirely, it never touches the SW).

**Ordering constraint:** Chunk A alone would freeze each tab's data at its first mount (no remount = no refresh). Chunk B restores refresh-on-return and date-rollover semantics. One PR, A then B, gate at the end.

---

## Chunk A — shell mechanics

### Task 0: Re-verify this plan against current `main`

**Files:** none (read-only gate)

- [ ] **Step 1: Confirm the anchors below still hold** (plans go stale — per the backlog protocol, reconcile before building):

```bash
grep -n "staleTimes" next.config.ts                          # expect: present (v1.133.0)
ls app/(home)/loading.tsx app/health/loading.tsx             # expect: exist
grep -n "export const TABS" components/shell/tabs.ts         # expect: present, 5 entries
grep -n "handleNavClick" components/shell/bottom-nav.tsx     # expect: present
grep -n "router.push(\"/health?tab=body\")" app/session-select/session-select-content.tsx
grep -n "router.push(\"/more\")" app/session-select/session-select-content.tsx
grep -rn "BottomNav" app --include="page.tsx" -l             # expect: the 5 tab pages + admin/workout-select pages
grep -n '"next"' package.json                                # expect: ^15.x (native-history sync needs ≥14.1)
```

If any anchor has moved, reconcile the affected task against the current file before proceeding. If the tab routes have been restructured entirely, stop and re-plan.

---

### Task 1: Tab keys + visibility context

**Files:**
- Modify: `components/shell/tabs.ts`
- Create: `components/shell/tab-visibility.tsx`

- [ ] **Step 1: Add stable tab keys and href helpers to `tabs.ts`**

Replace the current `TABS` array and add the helpers (keep `activeTabIndex` as-is — the swipe navigator still uses it):

```ts
import { HomeIcon, DumbbellIcon, HeartIcon, UtensilsIcon, MoreHorizontalIcon } from "lucide-react";

export type TabKey = "home" | "health" | "workout" | "nutrition" | "more";

export const TABS = [
  { key: "home",      label: "Home",      icon: HomeIcon,           href: "/"          },
  { key: "health",    label: "Health",    icon: HeartIcon,          href: "/health"    },
  { key: "workout",   label: "Workout",   icon: DumbbellIcon,       href: "/workout"   },
  { key: "nutrition", label: "Nutrition", icon: UtensilsIcon,       href: "/nutrition" },
  { key: "more",      label: "More",      icon: MoreHorizontalIcon, href: "/more"      },
] as const;

export function hrefForTab(key: TabKey): string {
  return TABS.find((t) => t.key === key)!.href;
}

// Maps a tab href (optionally carrying query params, e.g. "/health?tab=body")
// to its tab key. Deliberately returns null for the full-screen workout route
// ("/workout?session=…") — that is a real navigation, never a shell flip.
export function tabKeyForHref(href: string): TabKey | null {
  const [path, query] = href.split("?");
  if (path === "/workout" && query?.includes("session=")) return null;
  const hit = TABS.find((t) => t.href === path);
  return hit ? hit.key : null;
}
```

- [ ] **Step 2: Create the visibility context**

`components/shell/tab-visibility.tsx`:

```tsx
"use client";

import { createContext, useContext, useMemo } from "react";

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
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm exec tsc --noEmit` — expect clean (nothing consumes `key` yet; `activeTabIndex` untouched).

```bash
git add components/shell/tabs.ts components/shell/tab-visibility.tsx
git commit -m "Add tab keys and a tab-visibility context for the persistent shell"
```

---

### Task 2: Cross-tab navigation helper

**Files:**
- Create: `lib/shell-nav.ts`

Call sites deep inside a tab (e.g. Home's "view body stats" → `/health?tab=body`) must switch tabs **through the shell**, not `router.push` (which would tear the whole shell down and remount everything — exactly the cost this plan removes). A cancelable `CustomEvent` reaches the shell without prop-drilling; when no shell is mounted (full-screen workout route, `/profile/*`), the event goes unhandled and the caller falls back to a real navigation.

- [ ] **Step 1: Create the helper**

```ts
export const TAB_NAV_EVENT = "ta:tab-navigate";

/**
 * Switch to another main tab. Handled by the mounted TabShell (instant,
 * client-side, no remount); falls back to a router navigation when no shell
 * is mounted (full-screen workout route, profile/admin pages).
 * `href` is a tab href, optionally with sub-tab params ("/health?tab=body") —
 * never the full-screen workout route ("/workout?session=…").
 */
export function navigateToTab(router: { push(href: string): void }, href: string): void {
  if (typeof window === "undefined") {
    router.push(href);
    return;
  }
  const unhandled = window.dispatchEvent(
    new CustomEvent<string>(TAB_NAV_EVENT, { detail: href, cancelable: true })
  );
  if (unhandled) router.push(href); // dispatchEvent returns false when the shell preventDefault()ed
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm exec tsc --noEmit` — expect clean.

```bash
git add lib/shell-nav.ts
git commit -m "Add navigateToTab helper for shell-aware cross-tab navigation"
```

---

### Task 3: The `TabShell` component

**Files:**
- Create: `components/shell/tab-shell.tsx`

- [ ] **Step 1: Create the shell**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import SessionSelectContent from "@/app/session-select/session-select-content";
import { BottomNav } from "@/components/shell/bottom-nav";
import { TabVisibilityProvider } from "./tab-visibility";
import { hrefForTab, tabKeyForHref, type TabKey } from "./tabs";
import { TAB_NAV_EVENT } from "@/lib/shell-nav";
import { cn } from "@/lib/utils";

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
  activityLevel?: string | null;
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
                // invisible (not display:none / unmount) keeps layout, scroll
                // position, and component state alive; content-visibility lets
                // the compositor skip the hidden trees' rendering work.
                !isActive && "invisible pointer-events-none [content-visibility:hidden]"
              )}
              inert={!isActive || undefined}
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
```

Notes for the implementer:
- Prop shapes: copy the exact prop types from each content component's own interface if `tsc` disagrees (`HealthContentProps` in `app/health/health-content.tsx`, etc.) — do not guess.
- `inert` is a real boolean prop in React 19. If `tsc` rejects it, use `{...(!isActive ? { inert: true } : {})}`.
- If `[content-visibility:hidden]` causes any visual artifact in verification (blank flash on re-show), drop that one class and keep `invisible` — correctness never depends on it.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit` — expect clean (shell not yet rendered anywhere).

- [ ] **Step 3: Commit**

```bash
git add components/shell/tab-shell.tsx
git commit -m "Add persistent TabShell keeping all five tabs mounted

Tab switching becomes a client-side visibility flip: each tab mounts once,
stays alive hidden (scroll + state preserved), and re-shows instantly with
no router navigation, no RSC fetch, and no tree remount."
```

---

### Task 4: Shared server wrapper + the five tab pages render the shell

**Files:**
- Create: `components/shell/tab-page.tsx`
- Modify: `app/(home)/page.tsx`, `app/health/page.tsx`, `app/workout/page.tsx`, `app/nutrition/page.tsx`, `app/more/page.tsx`

- [ ] **Step 1: Create the shared server wrapper**

`components/shell/tab-page.tsx`:

```tsx
import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TabShell } from "./tab-shell";
import type { TabKey } from "./tabs";

// Server half of every tab route: one auth() JWT decode, no DB, then the
// persistent client shell. The Suspense boundary covers the contents'
// useSearchParams reads during prerender.
export async function TabPage({ initialTab }: { initialTab: TabKey }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <Suspense fallback={null}>
      <TabShell
        initialTab={initialTab}
        session={{
          userId: session.user.id,
          isAdmin: session.user.isAdmin,
          friendCode: session.user.friendCode,
          sex: session.user.sex ?? null,
          heightCm: session.user.heightCm ?? null,
          dateOfBirth: session.user.dateOfBirth ?? null,
          activityLevel: session.user.activityLevel ?? null,
        }}
      />
    </Suspense>
  );
}
```

(Field names come from the current tab pages' own `session.user.*` reads — `app/health/page.tsx` and `app/more/page.tsx` are the reference; fix against those if `tsc` flags one.)

- [ ] **Step 2: Rewrite four pages as one-liners**

`app/(home)/page.tsx`:

```tsx
import { TabPage } from "@/components/shell/tab-page";

export default function HomePage() {
  return <TabPage initialTab="home" />;
}
```

`app/health/page.tsx`, `app/nutrition/page.tsx`, `app/more/page.tsx`: identical with `initialTab="health"` / `"nutrition"` / `"more"`. Delete their now-unused imports (`auth`, `redirect`, `Suspense`, the content component, `BottomNav`).

- [ ] **Step 3: Rewrite `app/workout/page.tsx`, keeping the full-screen `?session=` branch**

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import WorkoutScreen from "@/components/workout-screen";
import { TabPage } from "@/components/shell/tab-page";

interface WorkoutPageProps {
  searchParams: Promise<{ session?: string; aiDeload?: string; wasOverride?: string }>;
}

export default async function WorkoutPage({ searchParams }: WorkoutPageProps) {
  const { session: sessionId, aiDeload, wasOverride } = await searchParams;

  if (sessionId) {
    const session = await auth();
    if (!session?.user?.id) redirect("/sign-in");
    return (
      <div className="h-screen w-full">
        <WorkoutScreen
          sessionType={sessionId}
          userId={session.user.id}
          aiDeload={aiDeload === "1"}
          wasOverride={wasOverride === "1"}
        />
      </div>
    );
  }

  return <TabPage initialTab="workout" />;
}
```

- [ ] **Step 4: Dev-server smoke**

Run `pnpm dev`, sign in as `test@local.dev` / `testpass123`, and open `/`, `/health`, `/workout`, `/nutrition`, `/more` directly by URL. Expected: each renders its screen with the bottom nav (tab taps don't switch yet — BottomNav still routes; that's Task 5). `/workout?session=<any-session-id>` still renders the full-screen workout.

- [ ] **Step 5: Commit**

```bash
git add components/shell/tab-page.tsx "app/(home)/page.tsx" app/health/page.tsx app/workout/page.tsx app/nutrition/page.tsx app/more/page.tsx
git commit -m "Render all five tab routes through the persistent TabShell"
```

---

### Task 5: BottomNav — state-driven inside the shell, Link fallback outside

**Files:**
- Modify: `components/shell/bottom-nav.tsx`

`BottomNav` is also rendered by non-shell pages (`app/admin/page.tsx`, `app/admin/oura-ble/page.tsx`, `app/error.tsx`, `app/workout/error.tsx`, `app/workout-select/page.tsx`) — those keep today's Link/router behaviour. Only the shell passes the new props.

- [ ] **Step 1: Add the shell props and switch the click path**

Update the signature and imports:

```tsx
import { TABS, type TabKey } from "./tabs";

export function BottomNav({
  isAdmin,
  activeTab,
  onTabChange,
}: { isAdmin?: boolean; activeTab?: TabKey; onTabChange?: (key: TabKey) => void } = {}) {
```

Replace `handleNavClick` (keep the workout-active guard verbatim — it is pathname-based and pathname stays correct in both modes):

```tsx
  const handleNavClick = (key: TabKey, href: string, e: React.MouseEvent) => {
    hapticLight();
    if (workoutActive && pathname.startsWith("/workout")) {
      e.preventDefault();
      if (!href.startsWith("/workout")) setPendingHref(href);
      // else: already mid-workout — swallow the FAB tap instead of remounting the picker.
      return;
    }
    e.preventDefault();
    if (onTabChange) onTabChange(key);
    else navigateWithTransition(router, pathname, href);
  };
```

In the render loop, destructure `key` from each TABS entry, pass it through both `onClick={(e) => handleNavClick(key, href, e)}` call sites, set `prefetch={onTabChange ? false : true}` on both `<Link>`s (prefetching sibling tab routes is pointless inside the shell), and derive `active` from the prop when present:

```tsx
            const active = activeTab
              ? activeTab === key
              : label === "Home"
                ? pathname === "/"
                : label === "Workout"
                  ? pathname.startsWith("/workout")
                  : label === "More"
                    ? pathname.startsWith("/more") || pathname.startsWith("/profile/")
                    : pathname.startsWith(href);
```

The `LeaveWorkoutDialog`'s `onLeave` keeps using `navigateWithTransition` — leaving an active workout is on the full-screen route, where a real navigation (back into the shell) is correct.

- [ ] **Step 2: Verify tab switching on the dev server**

`pnpm dev`, signed in, devtools Network open with all filters cleared: tap Home → Health → Nutrition → More → Workout → Home.
Expected: **zero network requests from the taps themselves after each tab's first activation** (first activation may fetch that tab's JS chunk + its data), the URL bar updates per tab, the correct tab highlights, scroll position survives leaving and re-entering a scrolled tab, and `/admin` (legacy mode) still navigates via its bottom nav.

- [ ] **Step 3: Commit**

```bash
git add components/shell/bottom-nav.tsx
git commit -m "Drive BottomNav from shell state, keeping router mode for non-shell pages"
```

---

### Task 6: Edge-swipe goes through the shell + modal-open guard

**Files:**
- Modify: `components/shell/tab-swipe-navigator.tsx`

- [ ] **Step 1: Route swipes through `navigateToTab` and skip gestures while a modal is open**

In `navigate()`, replace the `navigateWithTransition(router, pathname, href)` call:

```tsx
      navigateToTab(router, href);
```

with import `import { navigateToTab } from "@/lib/shell-nav";` (drop the now-unused `navigateWithTransition` import). `activeTabIndex(pathname)` keeps working — `replaceState` updates `usePathname`.

In `onStart`, before the scroller check, bail out while any Radix modal (sheet/dialog) is open — previously a route change unmounted an open sheet, but the shell keeps tabs alive, so a swipe under an open sheet would switch tabs behind it:

```tsx
      // A modal sheet/dialog is open — the gesture belongs to it, and switching
      // tabs underneath a kept-alive overlay would strand it on the wrong tab.
      if (document.querySelector("[data-radix-focus-guard]")) return;
```

- [ ] **Step 2: Verify + commit**

Dev server (device-emulation touch mode): edge-swipe left/right switches tabs instantly with no network; opening a bottom sheet and edge-swiping does nothing.

```bash
git add components/shell/tab-swipe-navigator.tsx
git commit -m "Route edge-swipe tab changes through the shell; ignore swipes under open modals"
```

---

## Chunk B — keep-alive correctness

Without remounts, each tab must refresh itself when re-shown (data written from other tabs, background sync, date rollover). The pattern is uniform: read `useTabVisibility()` and re-run the screen's existing mount-refresh functions when `epoch` changes. All of these are `cachedFetch`/local-store reads — cache-fresh calls are near-free, invalidated keys refetch — so this exactly reproduces the old remount semantics minus the tree rebuild.

### Task 7: Home (`session-select-content.tsx`) re-show refresh

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add the epoch effect**

Import: `import { useTabVisibility } from "@/components/shell/tab-visibility";`

At the top of the component body add `const { epoch: tabEpoch } = useTabVisibility();`, and after `loadTodayMood`'s definition (find it: `grep -n "useEffect(() => { loadTodayMood" app/session-select/session-select-content.tsx`, currently ~line 649) add:

```tsx
  // The persistent shell re-shows this tab without remounting it — re-run the
  // mount refresh pass (same cachedFetch-backed reads a remount used to run).
  useEffect(() => {
    if (tabEpoch === 0) return;
    fetchMeta();
    fetchWorkoutData();
    loadTodayMood();
  }, [tabEpoch, fetchMeta, fetchWorkoutData, loadTodayMood]);
```

- [ ] **Step 2: Convert the two cross-tab `router.push` call sites**

Import: `import { navigateToTab } from "@/lib/shell-nav";`

Line ~382: `const handleNavigateHealthBody = useCallback(() => router.push("/health?tab=body"), [router]);`
→ `const handleNavigateHealthBody = useCallback(() => navigateToTab(router, "/health?tab=body"), [router]);`

Line ~971: `onClick={() => router.push("/more")}` → `onClick={() => navigateToTab(router, "/more")}`

- [ ] **Step 3: Verify + commit**

Dev server: from Home tap the body-stats affordance → Health opens **on the Body sub-tab** with no network navigation request; log a food entry in Nutrition, switch back to Home → the day timeline/streak reflect it after the epoch refresh.

```bash
git add app/session-select/session-select-content.tsx
git commit -m "Refresh Home on shell re-show and route its cross-tab links through the shell"
```

---

### Task 8: Health (`health-content.tsx`) re-show refresh

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Add epoch to the three refresh effects**

Import `useTabVisibility`, add `const { epoch: tabEpoch } = useTabVisibility();` at the top of the component, and add `tabEpoch` to the dependency arrays of exactly three existing effects (locate each with grep; do not restructure them):

1. The `fetchMeta` effect — `grep -n "\[fetchMeta, userId\]" app/health/health-content.tsx` → `}, [fetchMeta, userId, tabEpoch]);`
2. The `fetchAllHealthData` effect — `grep -n "\[fetchAllHealthData\]" app/health/health-content.tsx` → `}, [fetchAllHealthData, tabEpoch]);`
3. The Oura auto-sync effect — `grep -n "\[handleSyncOura\]" app/health/health-content.tsx` → `}, [handleSyncOura, tabEpoch]);` — safe to re-run: it's internally throttled by `shouldSyncOura` + the BLE-freshness gate, which is exactly the "Health page opens" semantics it documents.

- [ ] **Step 2: Verify + commit**

Dev server: log a body metric from Home's quick-log (or via Health, switch away, save a weight elsewhere), return to Health → tiles reflect the write without a reload. The `?tab=body` sub-tab from Task 7 still selects correctly (its `[searchParams]` effect fires on the shell's `replaceState`).

```bash
git add app/health/health-content.tsx
git commit -m "Re-run Health's refresh effects when the shell re-shows the tab"
```

---

### Task 9: Nutrition (`nutrition-content.tsx`) re-show refresh + date rollover

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx`

Nutrition keys everything on `selectedDate` (init `todayInTz()` at mount). Kept alive across midnight, a stale "today" would silently show yesterday (the exact bug class CLAUDE.md's cache rules exist for). On re-show: if midnight rolled while hidden **and** the user was on the old "today", follow to the new day; otherwise just refetch the date they were viewing.

- [ ] **Step 1: Add the epoch effect**

Import `useTabVisibility`; in the component body (after `fetchData` is defined — `grep -n "useEffect(() => { fetchData(selectedDate)" app/nutrition/nutrition-content.tsx`, currently ~line 248):

```tsx
  const { epoch: tabEpoch } = useTabVisibility();
  const lastVisibleDayRef = useRef(todayStr);
  useEffect(() => {
    if (tabEpoch === 0) return;
    const today = todayInTz();
    if (lastVisibleDayRef.current !== today && selectedDateRef.current === lastVisibleDayRef.current) {
      // Midnight rolled while hidden and the user was on "today" — follow it,
      // as a fresh mount used to. fetchData re-runs via the [selectedDate] effect.
      lastVisibleDayRef.current = today;
      dateChangeDirRef.current = 1;
      setSelectedDate(today);
      return;
    }
    lastVisibleDayRef.current = today;
    fetchData(selectedDateRef.current);
  }, [tabEpoch, fetchData]);
```

- [ ] **Step 2: Add `tabEpoch` to the supplements effect**

`grep -n "store.getSupplements()" app/nutrition/nutrition-content.tsx` → that effect's dependency array (currently `[userId]`, ~line 250) becomes `[userId, tabEpoch]` (it reads today's supplement logs local-first — re-running on re-show keeps the checklist honest).

- [ ] **Step 3: Verify + commit**

Dev server: log food on Nutrition, switch to Home and back → same date still selected, log present, no full reload. Deep-entry `http://localhost:3000/nutrition?chat=backfill` still auto-opens the chat (route entry, unaffected).

```bash
git add app/nutrition/nutrition-content.tsx
git commit -m "Refresh Nutrition on shell re-show with a midnight-rollover guard"
```

---

### Task 10: Workout picker (`workout-select-content.tsx`) re-show refresh

**Files:**
- Modify: `app/workout-select/workout-select-content.tsx`

- [ ] **Step 1: Add epoch to the data effect**

Import `useTabVisibility`, add `const { epoch: tabEpoch } = useTabVisibility();`, and change the fetch effect (`grep -n "useEffect(() => { fetchData(); }" app/workout-select/workout-select-content.tsx`, currently ~line 182) to:

```tsx
  useEffect(() => { fetchData(); }, [fetchData, tabEpoch]);
```

(Starting a workout keeps its `router.push(`/workout?session=…`)` — the full-screen workout is a real route by design; returning from it re-enters the shell fresh, which is correct after a workout writes new data everywhere. More's content needs no epoch work: its module-level `_user`/`_seasons` caches already made remounts a no-op, so keep-alive is behaviour-identical.)

- [ ] **Step 2: Verify + commit**

Dev server: complete/log an activity from Home, switch to Workout → recovery/next-session cards reflect it on re-show.

```bash
git add app/workout-select/workout-select-content.tsx
git commit -m "Refresh the workout picker when the shell re-shows it"
```

---

## Chunk C — gate, docs, bookkeeping

### Task 11: Full gate + dev-server sweep

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` — all green.

- [ ] **Step 2: Dev-server sweep (signed in, Network tab open)**

1. Tap between all five tabs repeatedly → after each tab's first activation, **zero network requests per tap**, instant paint, correct highlight, URL updates.
2. Scroll Home down, visit Health, return → scroll position preserved.
3. Home → body-stats link → Health/Body sub-tab; Home → profile card → More.
4. Open a bottom sheet, edge-swipe → nothing; close, edge-swipe → tab switches.
5. Direct-URL entry to each of the five routes + `/health?tab=body` + `/nutrition?chat=backfill` + `/workout?session=<id>` (full-screen, no nav) + `/admin` (legacy nav works).
6. Write-then-switch checks from Tasks 7–10.
7. Reload on `/health` → shell reopens on Health.

- [ ] **Step 3: Commit any fixes** (one commit per root cause, no batch "fix review comments" commit).

---

### Task 12: Device-smoke additions, docs, version, backlog/journal

**Files:**
- Modify: `docs/device-smoke-checklist.md`, `docs/module-map.md`, `package.json`, `lib/changelog.ts`, `docs/implementation-backlog.md`, `projectOverview.md`, `docs/overview/history-current.md`

- [ ] **Step 1: Append to `docs/device-smoke-checklist.md`**

```markdown
## Persistent tab shell (2026-07-14 plan)
- [ ] Tab taps: switch between all five tabs repeatedly — every switch after a tab's first open is instant (no skeleton, no repaint of the old screen, no network in remote devtools), including after leaving the app idle >5 min.
- [ ] Scroll: scroll Home to the bottom, visit two other tabs, return — scroll position is exactly where it was.
- [ ] State: open Health's Body sub-tab, switch away and back — still on Body. Nutrition on a past date, switch away and back — still on that date.
- [ ] Cross-midnight: with the app alive across midnight (or device clock rolled), re-showing Nutrition/Home shows the new day, not yesterday.
- [ ] Android back button: from any tab, back exits the app (new intended behaviour — tab flips no longer stack history entries).
- [ ] Full-screen workout: start a workout, confirm tab bar is gone; finish/leave → lands back in the shell; mid-workout tab tap still shows the leave dialog.
- [ ] Memory/jank: after visiting all five tabs, interact with the heaviest screens — no new jank vs. pre-shell build (hidden tabs are content-visibility-skipped).
```

- [ ] **Step 2: Module map + changelog + version**

Add one row to `docs/module-map.md`'s UI/shell section for `components/shell/tab-shell.tsx` (+ `tab-visibility.tsx`, `lib/shell-nav.ts`). Bump `package.json` **minor** and add a `lib/changelog.ts` entry, e.g.: "Tab switching is now instant, always — the five main tabs stay loaded like a native app (MyFitnessPal-style), so switching never refetches, never rebuilds the screen, and keeps your scroll position. Each tab still quietly refreshes its data when you come back to it."

- [ ] **Step 3: Backlog + journal in the same PR**

Remove this item's entry from `docs/implementation-backlog.md` (renumber per its conventions), update the `projectOverview.md` Known-Issues row "Perceived latency / More-tab cache-wipe … NOT verified on-device" to note the shell supersedes the tab-tap half (on-device verification of `staleTimes` now only matters for cold entries), add a Known-Issues row that the shell itself is **not yet device-verified** (web sandbox can't judge WebView feel/memory — the checklist above is the gate), and append the session journal entry.

- [ ] **Step 4: Present per CLAUDE.md**

State explicitly what was NOT exercised: everything on-device (WebView feel, memory pressure with five live trees, back-button behaviour, `content-visibility` rendering, real network absence), and the cross-midnight rollover (only simulatable by clock manipulation). PR is a standard (non-destructive) change: merge on green once the dev-server sweep passed.

---

## Self-review notes (spec coverage)

- Owner symptom "mini load/delay between pages" → Tasks 3–6 remove network *and* remount from every tab switch (the two remaining latency sources after v1.133.0).
- "We should be loading everything locally" → after first activation, a tab switch touches no network and no router; data stays the existing local-first/cache-seeded layer, now without even a tree rebuild in front of it.
- Refresh semantics previously provided by remount → Tasks 7–10 (epoch), incl. midnight rollover (Task 9) per the "today's data across midnight" cache rule.
- Kept-alive-tab hazards enumerated: open-modal edge-swipe (Task 6 guard), portals surviving tab flips (same guard covers the only reachable path — bottom nav sits under Radix overlays), fixed-position overlays (visibility inherits), a11y/focus (`inert` + `aria-hidden`).
- Out of scope, deliberate: full-screen workout route stays a real navigation; `/profile/*`/`/admin` stay routed (BottomNav legacy mode); SW/document-load behaviour untouched (no overlap with the queued deploy-skew item); bundle-shell-into-APK remains the unqueued endgame.
