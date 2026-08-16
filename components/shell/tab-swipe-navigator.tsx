"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TABS, activeTabIndex } from "./tabs";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { navigateToTab } from "@/lib/shell-nav";

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
      if (isWorkoutActive({ workoutStartMs, mode }) && pathname.startsWith("/workout")) return;

      navigateToTab(router, href);
    }

    function onStart(e: TouchEvent) {
      const t = e.touches[0];
      // A modal sheet/dialog is open — the gesture belongs to it, and switching
      // tabs underneath a kept-alive overlay would strand it on the wrong tab.
      fromEdge = null;
      if (document.querySelector("[data-radix-focus-guard]")) return;
      // Exclude inner carousels (rule 3: they own horizontal) and any scrollable
      // ancestor — an edge-adjacent horizontal scroller (e.g. Home's metric tiles)
      // must not also trigger a tab swipe on the same gesture.
      const inScroller = (e.target as Element)?.closest?.(
        "[data-swipe-carousel], .overflow-x-auto, [data-hscroll]"
      );
      if (inScroller) return;
      if (t.clientX <= EDGE_PX) fromEdge = "left";
      else if (t.clientX >= window.innerWidth - EDGE_PX) fromEdge = "right";
      startX = t.clientX;
      startY = t.clientY;
    }

    function onMove(e: TouchEvent) {
      if (!fromEdge) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Direction-lock mid-gesture: a diagonal edge scroll (dy > dx) bails out of
      // the swipe candidacy immediately, not only at touchend — otherwise it both
      // scrolls the page and switches tabs on release.
      if (Math.abs(dy) > Math.abs(dx)) fromEdge = null;
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
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [pathname, router, mode, workoutStartMs]);

  return null;
}
