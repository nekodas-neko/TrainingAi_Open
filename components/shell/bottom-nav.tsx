"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { tabTapWouldBeSilent } from "@/components/shell/nav-offline";
import { cn } from "@trainingai/shared/utils";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useGuidedWalkStore, isGuidedWalkActive } from "@/lib/stores/guided-walk-store";
import { LeaveWalkDialog } from "@/components/guided-walk/leave-walk-dialog";
import { useActivityStore, isActivityActive } from "@/lib/stores/activity-store";
import { LeaveActivityDialog } from "@/components/activity/leave-activity-dialog";
import { cachedFetch } from "@/lib/sqlite/cache";
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl';
import { hapticLight } from "@/lib/haptics";
import { navigateWithTransition } from "@/lib/navigate-with-transition";
import { getDeadLetterCount, subscribeDeadLetterCount } from "@/lib/local-store/dead-letter-signal";
import { TABS, type TabKey } from "./tabs";

export function BottomNav({
  isAdmin,
  activeTab,
  onTabChange,
}: { isAdmin?: boolean; activeTab?: TabKey; onTabChange?: (key: TabKey) => void } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const mode = useWorkoutStore(s => s.mode);
  const workoutStartMs = useWorkoutStore(s => s.workoutStartMs);
  const resetSession = useWorkoutStore(s => s.resetSession);
  const walkMode = useGuidedWalkStore(s => s.mode);
  const resetWalk = useGuidedWalkStore(s => s.reset);
  const activityMode = useActivityStore(s => s.mode);
  const resetActivity = useActivityStore(s => s.resetSession);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [pendingWalkHref, setPendingWalkHref] = useState<string | null>(null);
  const [pendingActivityHref, setPendingActivityHref] = useState<string | null>(null);
  const [adminBadge, setAdminBadge] = useState(0);
  // K3: a dead-lettered outbox write drives a persistent dot on the More tab (the
  // SyncHealthCard lives there) so the failure isn't invisible until the user happens
  // to open More.
  const deadLetterCount = useSyncExternalStore(subscribeDeadLetterCount, getDeadLetterCount, () => 0);

  useEffect(() => {
    if (!isAdmin) return;
    cachedFetch<{ count: number; feedbackCount: number }>(
      'admin-pending-count', '/api/admin/pending-count', TTL_MEDIUM,
      d => {
        if (d && (d.count > 0 || d.feedbackCount > 0)) {
          setAdminBadge((d.count ?? 0) + (d.feedbackCount ?? 0));
        }
      },
    ).catch(() => {});
  }, [isAdmin]);

  const workoutActive = isWorkoutActive({ workoutStartMs, mode });
  const walkActive = isGuidedWalkActive({ mode: walkMode });
  const activityActive = isActivityActive({ mode: activityMode });

  const handleNavClick = (key: TabKey, href: string, e: React.MouseEvent) => {
    hapticLight();
    if (workoutActive && pathname.startsWith("/workout")) {
      e.preventDefault();
      if (!href.startsWith("/workout")) setPendingHref(href);
      // else: already mid-workout — swallow the FAB tap instead of remounting the picker.
      return;
    }
    if (walkActive && pathname.startsWith("/activity/guided-walk")) {
      e.preventDefault();
      if (!href.startsWith("/activity/guided-walk")) setPendingWalkHref(href);
      return;
    }
    if (activityActive && pathname === "/activity") {
      e.preventDefault();
      if (href !== "/activity") setPendingActivityHref(href);
      return;
    }
    e.preventDefault();
    if (onTabChange) { onTabChange(key); return; }
    // Q-555: outside the tab shell a tap is `router.push`, and offline with no service worker in
    // control its RSC fetch cannot be served — the push aborts and NOTHING happens. Say so rather
    // than leaving a tap that reads as a frozen app. Keeping the user on the cached screen they can
    // still read beats forcing a navigation to the browser's error page.
    if (tabTapWouldBeSilent()) {
      toast.error("Can't open that tab offline yet — it will work once the app finishes setting up");
      return;
    }
    navigateWithTransition(router, pathname, href);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)] overflow-visible">
        <div className="flex h-14 items-stretch relative">
          {TABS.map(({ key, label, icon: Icon, href }) => {
            const active = activeTab
              ? activeTab === key
              : label === "Home"
                ? pathname === "/"
                : label === "Workout"
                  ? pathname.startsWith("/workout")
                  : label === "More"
                    ? pathname.startsWith("/more") || pathname.startsWith("/profile/")
                    : pathname.startsWith(href);
            const isWorkout = label === "Workout";
            if (isWorkout) {
              return (
                <Link
                  key={label}
                  href={href}
                  prefetch={onTabChange ? false : true}
                  onClick={(e) => handleNavClick(key, href, e)}
                  className="flex flex-1 flex-col items-center justify-end gap-0.5 pb-1 text-[10px] font-bold transition-colors relative"
                  style={{ color: active ? "var(--color-brand)" : undefined }}
                >
                  <div
                    className="absolute -top-4 left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all"
                    style={{
                      background: active
                        ? "var(--color-brand)"
                        : "color-mix(in oklab, var(--color-brand) 85%, #000)",
                    }}
                  >
                    <Icon className="h-7 w-7" style={{ color: "var(--primary-foreground)" }} />
                  </div>
                  <span className="mt-9" style={{ color: active ? "var(--color-brand)" : "var(--color-muted-foreground)" }}>
                    {label}
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={label}
                href={href}
                prefetch={onTabChange ? false : true}
                onClick={(e) => handleNavClick(key, href, e)}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
                  active ? "text-brand" : "text-muted-foreground",
                )}
              >
                <div className="relative">
                  <Icon className="h-5 w-5" />
                  {label === "More" && (adminBadge > 0 || deadLetterCount > 0) && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-destructive" />
                  )}
                </div>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>

      <LeaveWorkoutDialog
        open={!!pendingHref}
        onStay={() => setPendingHref(null)}
        onLeave={() => {
          const href = pendingHref!;
          setPendingHref(null);
          resetSession();
          navigateWithTransition(router, pathname, href);
        }}
      />

      <LeaveWalkDialog
        open={!!pendingWalkHref}
        onStay={() => setPendingWalkHref(null)}
        onLeave={() => {
          const href = pendingWalkHref!;
          setPendingWalkHref(null);
          resetWalk();
          navigateWithTransition(router, pathname, href);
        }}
      />

      <LeaveActivityDialog
        open={!!pendingActivityHref}
        onStay={() => setPendingActivityHref(null)}
        onLeave={() => {
          const href = pendingActivityHref!;
          setPendingActivityHref(null);
          resetActivity();
          navigateWithTransition(router, pathname, href);
        }}
      />
    </>
  );
}
