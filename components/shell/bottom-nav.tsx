"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@trainingai/shared/utils";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useGuidedWalkStore, isGuidedWalkActive, walkElapsedSec, MIN_WALK_SEC } from "@/lib/stores/guided-walk-store";
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
  const workoutEndMs = useWorkoutStore(s => s.workoutEndMs);
  const resetSession = useWorkoutStore(s => s.resetSession);
  const walkMode = useGuidedWalkStore(s => s.mode);
  const resetWalk = useGuidedWalkStore(s => s.reset);
  const requestWalkFinish = useGuidedWalkStore(s => s.requestFinish);
  const activityMode = useActivityStore(s => s.mode);
  const resetActivity = useActivityStore(s => s.resetSession);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // The elapsed seconds are SNAPSHOT at the tap, not recomputed per render: the dialog quotes them
  // back and decides whether a save is offered at all, and both must be one reading.
  const [pendingWalk, setPendingWalk] = useState<{ href: string; elapsedSec: number } | null>(null);
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

  const workoutActive = isWorkoutActive({ workoutStartMs, workoutEndMs, mode });
  const walkActive = isGuidedWalkActive({ mode: walkMode });
  const activityActive = isActivityActive({ mode: activityMode });

  const leaveWalkDiscarding = () => {
    const href = pendingWalk!.href;
    setPendingWalk(null);
    resetWalk();
    navigateWithTransition(router, pathname, href);
  };

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
      if (!href.startsWith("/activity/guided-walk")) {
        setPendingWalk({ href, elapsedSec: walkElapsedSec(useGuidedWalkStore.getState().startedAtMs) });
      }
      return;
    }
    if (activityActive && pathname === "/activity") {
      e.preventDefault();
      if (href !== "/activity") setPendingActivityHref(href);
      return;
    }
    e.preventDefault();
    if (onTabChange) onTabChange(key);
    else navigateWithTransition(router, pathname, href);
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
                  className="flex flex-1 flex-col items-center justify-end gap-0.5 pb-1 text-[10px] font-bold transition-colors relative active:[&>div]:scale-95 motion-reduce:active:[&>div]:scale-100"
                  style={{ color: active ? "var(--color-brand)" : undefined }}
                >
                  <div
                    className="absolute -top-4 left-1/2 -translate-x-1/2 w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-[transform,background-color] duration-100 motion-reduce:transition-none"
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
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-[transform,color] duration-100 active:scale-95 motion-reduce:active:scale-100 motion-reduce:transition-none",
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

      {/* LB-141: this used to call reset() with no prompt, so tapping another tab threw away a
          39-minute walk. The owner chose a prompt over a silent save. Two elements rather than one
          with spread props, so `outcome=` stays literal at this call site — BF-191's guard reads the
          source, and a caller that cannot be seen to name its outcome is the regression it catches. */}
      {pendingWalk && pendingWalk.elapsedSec >= MIN_WALK_SEC ? (
        <LeaveWalkDialog
          open
          outcome="choose"
          elapsedSec={pendingWalk.elapsedSec}
          // Deliberately does NOT navigate to the tapped tab. The walk is written by WalkSummary's
          // mount, so leaving the screen here would save nothing — the summary is both the write and
          // the confirmation that it happened.
          onSave={() => { setPendingWalk(null); requestWalkFinish(); }}
          onStay={() => setPendingWalk(null)}
          onLeave={leaveWalkDiscarding}
        />
      ) : (
        /* Under the floor this stays the plain discard confirm the End button shows, rather than
           offering to save a walk too short to record (BF-191). */
        <LeaveWalkDialog
          open={!!pendingWalk}
          outcome="discard"
          elapsedSec={pendingWalk?.elapsedSec}
          onStay={() => setPendingWalk(null)}
          onLeave={leaveWalkDiscarding}
        />
      )}

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
