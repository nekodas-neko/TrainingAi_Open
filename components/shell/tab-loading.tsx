"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "@/components/shell/bottom-nav";
import { tabKeyForHref } from "@/components/shell/tabs";

// Instant fallback for the tab routes' loading.tsx boundaries. Neutral pulse
// blocks only — per-screen cache-seeded content paints as soon as the client
// component mounts, so this is visible for one network round-trip at most
// (and, with staleTimes retention, usually never).
//
// A loading.tsx covers every route beneath its segment, not just the tab's own
// page, so this also renders while a PUSHED full-screen route (/health/day,
// /more/settings, /workout?session=…) waits for its server payload. Those
// screens have no bottom nav, so the nav is drawn only when the route being
// loaded is a tab itself (#2441).
export function TabLoading({ search = "" }: { search?: string } = {}) {
  const pathname = usePathname();
  const isTab = tabKeyForHref(search ? `${pathname}?${search}` : pathname) !== null;
  return (
    <>
      <div className="flex flex-col bg-page min-h-screen pt-safe-or-4 px-4 gap-4" aria-busy="true">
        <div className="h-8 w-40 rounded-lg bg-muted/60 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted/40 animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted/40 animate-pulse" />
      </div>
      {isTab && <BottomNav />}
    </>
  );
}
