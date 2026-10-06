"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useGuidedWalkStore, isGuidedWalkActive, walkElapsedSec, MIN_WALK_SEC } from "@/lib/stores/guided-walk-store";
import { LeaveWalkDialog } from "@/components/guided-walk/leave-walk-dialog";
import { useActivityStore, isActivityActive } from "@/lib/stores/activity-store";
import { LeaveActivityDialog } from "@/components/activity/leave-activity-dialog";
import { backActionForPath } from "@/components/shell/tabs";
import { hasOpenSurface, releaseAllSurfaceEntries } from "@/lib/hooks/sheet-back-stack";
import { navigateToTab } from "@/lib/shell-nav";
import { useMobileAuth } from '@/components/auth/use-mobile-auth';

function leaveScreen(): void {
  window.history.go(-(1 + releaseAllSurfaceEntries()));
}

export function MobileAuthHandler({ hasSession }: { hasSession: boolean }) {
  useMobileAuth(hasSession);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [leaveWalk, setLeaveWalk] = useState<{ elapsedSec: number } | null>(null);
  const [confirmLeaveActivityOpen, setConfirmLeaveActivityOpen] = useState(false);
  const workoutActive = useWorkoutStore(isWorkoutActive);
  const walkActive = useGuidedWalkStore(isGuidedWalkActive);
  const activityActive = useActivityStore(isActivityActive);
  useEffect(() => { if (!workoutActive) setConfirmLeaveOpen(false); }, [workoutActive]);
  useEffect(() => { if (!walkActive) setLeaveWalk(null); }, [walkActive]);
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
        if (isGuidedWalkActive(useGuidedWalkStore.getState()) && window.location.pathname.startsWith("/activity/guided-walk")) {
          setLeaveWalk({ elapsedSec: walkElapsedSec(useGuidedWalkStore.getState().startedAtMs) });
          return;
        }
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

  const leaveWalkDiscarding = () => {
    setLeaveWalk(null);
    useGuidedWalkStore.getState().reset();
    leaveScreen();
  };

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

      {leaveWalk && leaveWalk.elapsedSec >= MIN_WALK_SEC ? (
        <LeaveWalkDialog
          open
          outcome="choose"
          elapsedSec={leaveWalk.elapsedSec}
          onSave={() => {
            setLeaveWalk(null);
            useGuidedWalkStore.getState().requestFinish();
          }}
          onStay={() => setLeaveWalk(null)}
          onLeave={leaveWalkDiscarding}
        />
      ) : (

        <LeaveWalkDialog
          open={!!leaveWalk}
          outcome="discard"
          elapsedSec={leaveWalk?.elapsedSec}
          onStay={() => setLeaveWalk(null)}
          onLeave={leaveWalkDiscarding}
        />
      )}
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
