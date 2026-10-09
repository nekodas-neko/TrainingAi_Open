"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useActivityStore, isActivityActive } from "@/lib/stores/activity-store";
import { LeaveActivityDialog } from "@/components/activity/leave-activity-dialog";
import { backActionForPath } from "@/components/shell/tabs";
import { hasOpenSurface, releaseAllSurfaceEntries } from "@/lib/hooks/sheet-back-stack";
import { navigateToTab } from "@/lib/shell-nav";
import { useMobileAuth } from '@/components/auth/use-mobile-auth';
import { requestWalkExit } from "@/lib/walk/walk-exit";

function leaveScreen(): void {
  window.history.go(-(1 + releaseAllSurfaceEntries()));
}

export function MobileAuthHandler({ hasSession }: { hasSession: boolean }) {
  useMobileAuth(hasSession);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmLeaveActivityOpen, setConfirmLeaveActivityOpen] = useState(false);
  const workoutActive = useWorkoutStore(isWorkoutActive);
  const activityActive = useActivityStore(isActivityActive);
  useEffect(() => { if (!workoutActive) setConfirmLeaveOpen(false); }, [workoutActive]);
  useEffect(() => { if (!activityActive) setConfirmLeaveActivityOpen(false); }, [activityActive]);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || disposed) return;

      const { App } = await import("@capacitor/app");
      const onWorkoutScreen = () =>
        window.location.pathname === "/workout"
        && new URLSearchParams(window.location.search).has("session");

      const backHandle = await App.addListener("backButton", () => {
        if (disposed) return;
        if (isWorkoutActive(useWorkoutStore.getState()) && onWorkoutScreen()) {
          setConfirmLeaveOpen(true);
          return;
        }
        // The guided walk is immersive (#2134): back is its one Exit, raised by the walk screen
        // itself so the gesture and the button cannot offer different choices. When that screen is
        // not mounted — config, summary, or the route's error boundary — nothing answers and this
        // falls through to the ordinary back below.
        if (requestWalkExit()) return;
        if (isActivityActive(useActivityStore.getState()) && window.location.pathname === "/activity") {
          setConfirmLeaveActivityOpen(true);
          return;
        }
        if (hasOpenSurface()) {
          window.history.back();
          return;
        }
        switch (backActionForPath(window.location.pathname)) {
          case "minimize":
            App.minimizeApp();
            break;
          case "home":
            navigateToTab(routerRef.current, "/");
            break;
          case "pop":
            window.history.back();
            break;
        }
      });

      if (disposed) {
        await backHandle.remove();
        return;
      }
      cleanup = () => { void backHandle.remove(); };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <>
      <LeaveWorkoutDialog
        open={confirmLeaveOpen}
        onStay={() => setConfirmLeaveOpen(false)}
        onLeave={() => {
          setConfirmLeaveOpen(false);
          useWorkoutStore.getState().resetSession();
          leaveScreen();
        }}
      />
      <LeaveActivityDialog
        open={confirmLeaveActivityOpen}
        onStay={() => setConfirmLeaveActivityOpen(false)}
        onLeave={() => {
          setConfirmLeaveActivityOpen(false);
          useActivityStore.getState().resetSession();
          leaveScreen();
        }}
      />
    </>
  );
}
