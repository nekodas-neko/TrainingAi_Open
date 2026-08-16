# Batch H — Animations & Carousel Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the proven Health-tab drag carousel into a reusable `<SwipeCarousel>`, add edge-swipe navigation between the five bottom-nav tabs via the View Transitions API (keeping routes intact), apply swipe paging to the nutrition date switcher and calendar, and complete reduced-motion coverage plus small motion polish (count-ups, list enter/exit).

**Architecture:** One shared gesture hook built on `@use-gesture/react`'s `useDrag` (installed at ^10.3.1, currently unused) replaces both hand-rolled touch implementations. `<SwipeCarousel>` is a transform-only track (ports the existing constants: 8px axis intent, 0.2× edge resistance, 60px commit). Cross-tab navigation stays route-based: a document-level edge-swipe listener maps to the ordered tab list and wraps `router.push` in `document.startViewTransition` with directional slide CSS — feature-detected, plain push fallback. Reduced motion is solved globally for `motion` components with `<MotionConfig reducedMotion="user">` plus a CSS extension for the two functional keyframe animations.

**Tech Stack:** `motion` v12 (`motion/react`: `MotionConfig`, `AnimatePresence`, `useReducedMotion`), `@use-gesture/react` v10 (`useDrag` — v10 API: `movement`, `last`, `velocity`, `direction`; axis via `axis: 'x'`, native scroll preserved via CSS `touch-action`), View Transitions API (Chromium WebView supports it; zero usages today — greenfield), Next.js App Router `router.push`.

**Gesture-conflict resolution rules (load-bearing — read first):**
1. **Vertical scroll** always wins inside panels: `useDrag` with `axis: 'x'` + CSS `touch-action: pan-y` on the carousel viewport means the browser keeps vertical scrolling native and the hook only claims horizontal drags.
2. **Pull-to-sync** (`components/pull-to-sync.tsx`) owns *vertical* pulls at `scrollTop <= 2` with its own direction-lock — it never claims horizontal movement, so it coexists with all horizontal gestures here. Do not nest two horizontal claimants.
3. **Edge-swipe (Task 3) yields to inner carousels:** the navigator ignores gestures that start inside any `[data-swipe-carousel]` element. Consequence (accepted): on the Health tab the inner Body/Training/Progress carousel owns horizontal — cross-tab navigation there is by bottom-nav tap only.
4. All committed navigations respect the active-workout guard exactly as bottom-nav taps do.

**Ground rules:** pnpm only; `pnpm lint && npx tsc --noEmit` before every commit; human-style commit messages (no AI attribution). startViewTransition + gesture feel MUST be verified on the APK WebView, not just desktop Chrome (final checklist).

---

## Task 1: Shared gesture hook + `<SwipeCarousel>`

**Files:**
- Create: `components/ui/swipe-carousel.tsx`
- Test: `components/ui/swipe-carousel.test.ts` (pure math helpers)

- [ ] **Step 1: Write the failing test for the pure math** (extracted so the drag handler is trivially testable):

```ts
// components/ui/swipe-carousel.test.ts
import { describe, it, expect } from "vitest";
import { applyEdgeResistance, commitTarget } from "./swipe-carousel";

describe("applyEdgeResistance", () => {
  it("dampens drag past the first panel by 0.2x", () => {
    // index 0, dragging right (+dx) has no previous panel: 50 * 0.2 = 10
    expect(applyEdgeResistance(50, 0, 3)).toBe(10);
  });
  it("dampens drag past the last panel by 0.2x", () => {
    // index 2 of 3, dragging left (-dx): -50 * 0.2 = -10
    expect(applyEdgeResistance(-50, 2, 3)).toBe(-10);
  });
  it("passes interior drags through unchanged", () => {
    expect(applyEdgeResistance(-50, 1, 3)).toBe(-50);
  });
});

describe("commitTarget", () => {
  it("advances on a -61px drag (past the 60px threshold)", () => {
    expect(commitTarget(-61, 0, 1, 3)).toBe(1);
  });
  it("stays put under the threshold with no flick", () => {
    expect(commitTarget(-40, 0, 0.1, 3)).toBe(0);
  });
  it("advances on a fast flick even under 60px (velocity > 0.5 px/ms)", () => {
    expect(commitTarget(-30, 0, 0.6, 3)).toBe(1);
  });
  it("clamps at the edges", () => {
    expect(commitTarget(-200, 2, 2, 3)).toBe(2);
    expect(commitTarget(200, 0, 2, 3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm test components/ui/swipe-carousel.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the component** (ports the proven Health-tab constants; `useDrag` replaces the manual listeners; `touch-action: pan-y` replaces the non-passive `preventDefault` dance):

```tsx
// components/ui/swipe-carousel.tsx
"use client";

import { useState } from "react";
import { useDrag } from "@use-gesture/react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const COMMIT_PX = 60;
const FLICK_VELOCITY = 0.5; // px/ms
const EDGE_RESISTANCE = 0.2;

/** Dampen drag beyond the first/last panel. Exported for tests. */
export function applyEdgeResistance(dx: number, index: number, count: number): number {
  const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
  return atEdge ? dx * EDGE_RESISTANCE : dx;
}

/** Decide the landing index from drag distance + flick velocity. Exported for tests. */
export function commitTarget(dx: number, index: number, velocity: number, count: number): number {
  const commit = Math.abs(dx) > COMMIT_PX || (Math.abs(velocity) > FLICK_VELOCITY && Math.abs(dx) > 10);
  if (!commit) return index;
  const next = dx < 0 ? index + 1 : index - 1;
  return Math.min(count - 1, Math.max(0, next));
}

interface SwipeCarouselProps {
  index: number;
  onIndexChange: (index: number) => void;
  children: React.ReactNode[]; // one node per panel, each rendered w-full flex-none
  className?: string;
  lazyMount?: boolean; // only mount current ± 1 panels
}

export function SwipeCarousel({ index, onIndexChange, children, className, lazyMount }: SwipeCarouselProps) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reduced = useReducedMotion();
  const count = children.length;

  const bind = useDrag(
    ({ movement: [mx], velocity: [vx], last, first }) => {
      if (first) setDragging(true);
      if (!last) {
        setDragX(applyEdgeResistance(mx, index, count));
        return;
      }
      setDragging(false);
      setDragX(0);
      const target = commitTarget(mx, index, vx, count);
      if (target !== index) onIndexChange(target);
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );

  return (
    <div
      {...bind()}
      data-swipe-carousel
      className={cn("overflow-hidden", className)}
      style={{ touchAction: "pan-y" }}
    >
      <div
        className="flex h-full"
        style={{
          transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
          transition: dragging || reduced ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          willChange: "transform",
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="w-full flex-none h-full">
            {lazyMount && Math.abs(i - index) > 1 ? null : child}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test** — `pnpm test components/ui/swipe-carousel.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ui/swipe-carousel.tsx components/ui/swipe-carousel.test.ts
git commit -m "Add reusable SwipeCarousel built on use-gesture with tested drag math"
```

## Task 2: Migrate the Health tab onto `<SwipeCarousel>` (behaviour-identical)

**Files:**
- Modify: `app/health/health-content.tsx:225-273` (delete the manual touch `useEffect` + `dragX`/`isDragging`/`lockedRef`/`dragXRef` state) and `:795-806` (viewport/track render)

- [ ] **Step 1:** Delete the touch-listener `useEffect` (lines 225–273) and the `dragX`, `isDragging`, `lockedRef`, `dragXRef`, `carouselRef` declarations it feeds.
- [ ] **Step 2:** Replace the viewport + track markup with:

```tsx
<SwipeCarousel
  className="flex-1"
  index={tabIndex}
  onIndexChange={(i) => setTab(TABS[i])}
>
  {[bodyPanel, trainingPanel, progressPanel]}
</SwipeCarousel>
```

where the three panel JSX blocks are the existing `w-screen flex-none` children moved verbatim (drop their `w-screen` in favour of the carousel's `w-full` wrapper). `tabIndex` already exists; keep `tabIndexRef` only if something else uses it.

- [ ] **Step 3: Verify feel-parity on `pnpm dev`** (S25 viewport, touch emulation): drag follows the finger 1:1 in the middle, resists at the edges, commits past ~60px or on a flick, snaps with the same cubic-bezier; vertical scrolling inside each panel unaffected; each panel's PullToSync still works.
- [ ] **Step 4: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "Drive the Health tab carousel through SwipeCarousel"
```

## Task 3: Edge-swipe navigation between the five tabs (View Transitions)

**Files:**
- Create: `components/shell/tabs.ts`, `components/shell/tab-swipe-navigator.tsx`
- Modify: `components/shell/bottom-nav.tsx:12-18` (import TABS from the new module), `app/layout.tsx` (mount the navigator), `app/globals.css` (view-transition keyframes)

- [ ] **Step 1: Hoist the tab list** — move the `TABS` const from `bottom-nav.tsx:12-18` verbatim into `components/shell/tabs.ts` with `export const TABS = [...] as const;` and a helper:

```ts
export function activeTabIndex(pathname: string): number {
  if (pathname === "/") return 0;
  if (pathname.startsWith("/health")) return 1;
  if (pathname.startsWith("/workout")) return 2;
  if (pathname.startsWith("/nutrition")) return 3;
  if (pathname.startsWith("/more") || pathname.startsWith("/profile/")) return 4;
  return -1; // non-tab route: edge-swipe disabled
}
```

Import both in `bottom-nav.tsx` (its active-matching logic can now call `activeTabIndex` too, or stay as-is — no behaviour change required).

- [ ] **Step 2: Create the navigator** (document-level listener; no wrapper DOM):

```tsx
// components/shell/tab-swipe-navigator.tsx
"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TABS, activeTabIndex } from "./tabs";
import { useWorkoutStore } from "@/lib/stores/workout-store";

const EDGE_PX = 24;       // gesture must start this close to a screen edge
const COMMIT_PX = 70;     // horizontal travel to commit navigation

export function TabSwipeNavigator() {
  const pathname = usePathname();
  const router = useRouter();
  const mode = useWorkoutStore(s => s.mode);
  const workoutStartMs = useWorkoutStore(s => s.workoutStartMs);

  useEffect(() => {
    let startX = 0, startY = 0, fromEdge: "left" | "right" | null = null;

    function navigate(dir: 1 | -1) {
      const idx = activeTabIndex(pathname);
      if (idx < 0) return;
      const target = idx + dir;
      if (target < 0 || target >= TABS.length) return;
      const href = TABS[target].href;
      // Same guard as bottom-nav taps: never swipe-exit an active workout.
      const workoutActive = !!workoutStartMs && mode !== "pre" && mode !== "done";
      if (workoutActive && pathname.startsWith("/workout")) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced && "startViewTransition" in document) {
        document.documentElement.dataset.navDirection = dir === 1 ? "forward" : "back";
        (document as Document & { startViewTransition(cb: () => void): void })
          .startViewTransition(() => router.push(href));
      } else {
        router.push(href);
      }
    }

    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      const inCarousel = (e.target as Element)?.closest?.("[data-swipe-carousel]");
      fromEdge = null;
      if (inCarousel) return; // rule 3: inner carousels own horizontal
      if (t.clientX <= EDGE_PX) fromEdge = "left";
      else if (t.clientX >= window.innerWidth - EDGE_PX) fromEdge = "right";
      startX = t.clientX;
      startY = t.clientY;
    }

    function onEnd(e: TouchEvent) {
      if (!fromEdge) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < COMMIT_PX || Math.abs(dy) > Math.abs(dx)) return;
      if (fromEdge === "left" && dx > 0) navigate(-1);   // swipe right from left edge → previous tab
      if (fromEdge === "right" && dx < 0) navigate(1);   // swipe left from right edge → next tab
      fromEdge = null;
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [pathname, router, mode, workoutStartMs]);

  return null;
}
```

- [ ] **Step 3: Mount it** in `app/layout.tsx` next to `<BottomNav />` (inside the same client boundary the nav already lives in).

- [ ] **Step 4: Add the directional slide CSS** to `app/globals.css`:

```css
/* Cross-tab view transitions (TabSwipeNavigator sets data-nav-direction) */
@keyframes vt-slide-in-right { from { transform: translateX(28px); opacity: 0.6; } to { transform: none; opacity: 1; } }
@keyframes vt-slide-in-left  { from { transform: translateX(-28px); opacity: 0.6; } to { transform: none; opacity: 1; } }
@keyframes vt-fade-out       { to { opacity: 0; } }

html[data-nav-direction] ::view-transition-old(root) {
  animation: vt-fade-out 0.18s ease both;
}
html[data-nav-direction="forward"] ::view-transition-new(root) {
  animation: vt-slide-in-right 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}
html[data-nav-direction="back"] ::view-transition-new(root) {
  animation: vt-slide-in-left 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; }
}
```

- [ ] **Step 5: Verify** (`pnpm dev`, touch emulation): edge-swipe left→right on Home does nothing (no previous tab); right-edge swipe left navigates Home→Health with the slide; on Health, a swipe starting mid-screen moves the inner carousel and a swipe starting at the screen edge still does nothing if it began inside the carousel element (rule 3); mid-workout on `/workout`, edge swipes are inert; bottom-nav taps unchanged.
- [ ] **Step 6: Commit**

```bash
git add components/shell app/layout.tsx app/globals.css components/shell/bottom-nav.tsx
git commit -m "Add edge-swipe navigation between tabs with view-transition slides"
```

## Task 4: Nutrition date switcher — swipe between days

Full side-by-side day panels would triple the per-date fetch/state management (`fetchData(selectedDate)` drives everything), so the chosen approach is **swipe-to-change-date** with an animated content slide — same gesture feel, no data re-architecture.

**Files:**
- Modify: `app/nutrition/nutrition-content.tsx` (~line 300 date-nav area + the scrollable content wrapper)

- [ ] **Step 1:** Add a horizontal `useDrag` on the meal-list content wrapper (the element below the date bar):

```tsx
import { useDrag } from "@use-gesture/react";
// inside the component — reuses the existing prev/next handlers verbatim:
const bindDateSwipe = useDrag(
  ({ movement: [mx], last, velocity: [vx] }) => {
    if (!last) return;
    if (Math.abs(mx) < 60 && vx < 0.5) return;
    if (mx < 0 && selectedDate < todayStr) setSelectedDate(shiftDateStr(selectedDate, 1));
    else if (mx > 0) setSelectedDate(shiftDateStr(selectedDate, -1));
  },
  { axis: "x", filterTaps: true, pointer: { touch: true } },
);
```

Spread `{...bindDateSwipe()}` on the content wrapper with `style={{ touchAction: "pan-y" }}` and `data-swipe-carousel` (so Task 3's navigator yields — rule 3). The `selectedDate < todayStr` guard mirrors the existing next-button's future-date cap (check the button's disabled condition at ~line 302 and reuse it exactly).

- [ ] **Step 2:** Animate the date change — wrap the meal-list content in `AnimatePresence mode="popLayout"` keyed by `selectedDate`, with a subtle directional slide (`initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -dir * 24 }} transition={{ duration: 0.18 }}` where `dir` is +1/-1 stored in a ref by the swipe/button handlers). Transform/opacity only.
- [ ] **Step 3: Verify** — swipe left anywhere on the meal list → yesterday…wait, swipe left = next day (until today), swipe right = previous day; chevron buttons unchanged; vertical scrolling of the list unaffected; logging a food on a swiped-to date still writes to that date.
- [ ] **Step 4: Commit**

```bash
git add app/nutrition/nutrition-content.tsx
git commit -m "Swipe between days on the nutrition screen"
```

## Task 5: Calendar month swipe

**Files:**
- Modify: `components/calendar-widget.tsx` (its month prev/next handlers)

- [ ] **Step 1:** Identical pattern to Task 4: `useDrag` (`axis: 'x'`, 60px/flick commit) on the month grid calling the existing prev/next-month handlers; `touchAction: "pan-y"`; `data-swipe-carousel`.
- [ ] **Step 2: Verify** — swiping the calendar changes month; day taps (filterTaps) still open day details; page scroll unaffected.
- [ ] **Step 3: Commit**

```bash
git add components/calendar-widget.tsx
git commit -m "Swipe between months on the training calendar"
```

## Task 6: Reduced-motion completeness

`useReducedMotion` has zero usages today; `globals.css:357-368` covers only decorative particles and deliberately keeps the functional animations — this task gates those too (a static border/ring still communicates state without motion).

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css:357-368`, `components/workout/timer-ring.tsx:150` (the `<animate>` pulse)

- [ ] **Step 1: Global fix for every `motion` component** — wrap the app tree (same client boundary as other providers) in:

```tsx
import { MotionConfig } from "motion/react";

<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

This makes all `motion.*` transforms/layout animations respect the OS setting app-wide (opacity animations are preserved by design) — covers pull-to-sync, body-battery, readiness-card, achievements, workout-select, and everything added in this batch.

- [ ] **Step 2: Extend the CSS block** — replace the comment + block at `globals.css:357-368` so functional keyframes freeze too:

```css
/* Respect user's reduced-motion preference.
   Decorative particles stop entirely; functional indicators (set-timer border,
   timer-ring pulse) freeze to their static state — state stays visible, motion stops. */
@media (prefers-reduced-motion: reduce) {
  .meteor-particle { animation: none !important; }
  .bg-particle-star,
  .bg-particle-cloud,
  .bg-particle-rain,
  .bg-particle-snow,
  .bg-particle-fog,
  .bg-particle-lightning { animation: none !important; }
  @keyframes ta-marquee { from { transform: none; } to { transform: none; } }
  .border-run { animation: none !important; stroke-dashoffset: 0 !important; }
}
```

- [ ] **Step 3: Gate the SVG pulse** in `timer-ring.tsx` — the active-segment `<animate>` element renders only when motion is allowed:

```tsx
import { useReducedMotion } from "motion/react";
// in the component:
const reduced = useReducedMotion();
// at line ~150, wrap the pulse:
{!reduced && <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />}
```

(Keep the existing `values`/`dur` attributes exactly as currently written — only the conditional wrapper is new.)

- [ ] **Step 4: Verify** — enable "Remove animations" (Android) / devtools `prefers-reduced-motion: reduce` emulation: set-card border renders static, timer ring segment solid, carousels jump without sliding, motion cards appear without transforms; with the setting off, everything animates as before.
- [ ] **Step 5: Commit**

```bash
git add app components
git commit -m "Honor prefers-reduced-motion across motion components and functional animations"
```

## Task 7: Number count-up on stat tiles

**Files:**
- Create: `lib/hooks/use-count-up.ts`, `lib/hooks/use-count-up.test.ts`
- Modify: `components/readiness-card.tsx` (score), `components/workout/done-screen.tsx` (volume stat)

- [ ] **Step 1: Failing test for the easing math**:

```ts
// lib/hooks/use-count-up.test.ts
import { describe, it, expect } from "vitest";
import { easeOutCubicValue } from "./use-count-up";

describe("easeOutCubicValue", () => {
  it("starts at 0", () => expect(easeOutCubicValue(0, 80)).toBe(0));
  it("ends exactly at the target", () => expect(easeOutCubicValue(1, 80)).toBe(80));
  it("is past the midpoint at t=0.5 (ease-out)", () => {
    // easeOutCubic(0.5) = 1 - 0.5^3 = 0.875 → 80 * 0.875 = 70
    expect(easeOutCubicValue(0.5, 80)).toBe(70);
  });
});
```

- [ ] **Step 2:** `pnpm test lib/hooks/use-count-up.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement:**

```ts
// lib/hooks/use-count-up.ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** Eased intermediate value. Exported for tests. */
export function easeOutCubicValue(t: number, target: number): number {
  const eased = 1 - Math.pow(1 - t, 3);
  return Math.round(target * eased * 100) / 100;
}

export function useCountUp(target: number | null, durationMs = 600): number | null {
  const [value, setValue] = useState<number | null>(target);
  const prevRef = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (target === null || reduced || prevRef.current === target) {
      setValue(target);
      prevRef.current = target;
      return;
    }
    prevRef.current = target;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(easeOutCubicValue(t, target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return value;
}
```

- [ ] **Step 4:** `pnpm test lib/hooks/use-count-up.test.ts` → PASS.

- [ ] **Step 5: Apply** — in `readiness-card.tsx`, render the arc's numeric score via `const displayScore = useCountUp(score);` (round for display: `Math.round(displayScore)`); in `done-screen.tsx`, the total-volume stat likewise. Two call sites only — this is polish, not a sweep.
- [ ] **Step 6: Verify** — home readiness score counts up on first paint (and NOT on cached re-renders where the value is unchanged — the `prevRef` guard); done screen volume counts up once.
- [ ] **Step 7: Commit**

```bash
git add lib/hooks components
git commit -m "Count-up animation for readiness score and done-screen volume"
```

## Task 8: List enter/exit on food-log rows + chart/popLayout notes

**Files:**
- Modify: `components/nutrition/meal-card.tsx` (logged-item rows), `app/workout-select/workout-select-content.tsx:284` (verify only)

- [ ] **Step 1:** Wrap the logged-item list in `meal-card.tsx`:

```tsx
import { AnimatePresence, motion } from "motion/react";

<AnimatePresence initial={false}>
  {items.map(item => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18 }}
    >
      {/* existing row JSX verbatim */}
    </motion.div>
  ))}
</AnimatePresence>
```

(`initial={false}` prevents a mount-time cascade; `MotionConfig reducedMotion="user"` from Task 6 covers the a11y side. Height animation is acceptable here — short rows, low frequency; if profiling shows jank switch to opacity-only.)

- [ ] **Step 2:** Verify `popLayout` usage at `workout-select-content.tsx:284` animates transform/opacity only — read its `slideVariants` (lines ~240-245: opacity + y — confirmed compositor-friendly; no change needed, record in commit message).
- [ ] **Step 3:** Chart draw-in: chart.js animates by default; where charts were given `animation: false` for the cache-seed flash fix, leave them — note in the PR body that chart draw-in is intentionally NOT re-enabled (it fights instant cache-seeded paints).
- [ ] **Step 4: Verify** — log a food item: row animates in; delete: collapses out; rapid add/delete doesn't wedge the list.
- [ ] **Step 5: Commit**

```bash
git add components/nutrition/meal-card.tsx
git commit -m "Animate food-log rows in and out"
```

## Task 9 (follow-up, optional): workout-select vertical swipe onto `useDrag`

The session picker's hand-rolled vertical swipe (`workout-select-content.tsx:183-233`: velocity tracking, 50px/0.2 px/ms flick, wrap-around modulo) works; this consolidation is mechanical but touches the workout entry path, so it's last and skippable.

**Files:**
- Modify: `app/workout-select/workout-select-content.tsx:183-233`

- [ ] **Step 1:** Replace `handleTouchStart/Move/End` + the non-passive preventDefault `useEffect` with one `useDrag` (`axis: 'y'`, `pointer: { touch: true }`) whose `last` branch reproduces the exact thresholds: commit when `|my| > 50 || vy > 0.2`, direction from sign, same `setDirection` + modulo `setCurrentIdx` + `hapticTick()` calls. Add `style={{ touchAction: "none" }}` to the container (it's a full-screen pager — vertical scroll is not expected inside it; this matches the current preventDefault behaviour).
- [ ] **Step 2: Verify** — swipe up/down cycles sessions with wrap-around and haptics; flick sensitivity feels unchanged; Start buttons still tap (filterTaps).
- [ ] **Step 3: Commit**

```bash
git add app/workout-select/workout-select-content.tsx
git commit -m "Consolidate workout-select swipe onto the shared gesture library"
```

---

## Final checks (whole batch)

- [ ] `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build` — all green.
- [ ] Desktop pass (`pnpm dev`, touch emulation, S25 viewport): every task's verify step re-run once together — especially the conflict matrix: Health inner carousel vs edge-swipe, nutrition date swipe vs vertical scroll vs pull-to-sync, calendar swipe vs day taps.
- [ ] **APK verification checklist (required before calling this done — WebView is the real target):** edge-swipe tab navigation + view-transition slide; Health carousel feel-parity; nutrition/calendar swipes; reduced-motion behaviour with Android "Remove animations"; no regression to pull-to-sync on Home/Health/More.
- [ ] Open the PR (title: "Swipe navigation: shared carousel, edge-swipe tabs, motion polish") and **ask the user before merging** — deploys code.

## Self-review

- **Coverage:** H1 → Tasks 1–2 (+9 for the second hand-rolled site); H2 → Task 3; H3 → Tasks 4–5 (nutrition approach chosen with rationale; metric-sheet swipe deliberately dropped — see below); H4 → Tasks 6–8. ✔
- **API check:** `@use-gesture/react@^10.3.1` — `useDrag` state fields `movement`, `velocity`, `last`, `first`, options `axis`/`filterTaps`/`pointer.touch` are all v10 API; `motion@^12.40` — `MotionConfig reducedMotion`, `useReducedMotion`, `AnimatePresence mode="popLayout"` all current. ✔
- **Gesture-conflict analysis:** present as the four numbered rules in the header; every task that adds a horizontal gesture tags its element `data-swipe-carousel` so the edge-swipe navigator yields. ✔
- **No placeholders:** all gesture constants ported verbatim (8px intent → handled by use-gesture's intent detection + axis; 0.2× resistance; 60px commit; 50px/0.2 flick for vertical); all code shown. ✔
- **Deliberately out of scope:** swiping between the four Health metric detail *sheets* (each sheet fetches its own data on open; cross-sheet swipe needs a prefetch design — deferred until the sheets are deduped by Batch F's `HealthScoreDetail` work); re-enabling chart draw-in (fights cache-seeded instant paint); a full single-route restructure of the five tabs (rejected — co-mounts all trees; edge-swipe + view transitions achieves the UX at a fraction of the risk).
