"use client";

// Listens for the trainingai://auth-complete?token=... deep link that fires
// after the Chrome Custom Tab OAuth flow completes.  Exchanges the one-time
// token for the session cookie so the WebView is authenticated.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useGuidedWalkStore, isGuidedWalkActive } from "@/lib/stores/guided-walk-store";
import { LeaveWalkDialog } from "@/components/guided-walk/leave-walk-dialog";
import { useActivityStore, isActivityActive } from "@/lib/stores/activity-store";
import { LeaveActivityDialog } from "@/components/activity/leave-activity-dialog";
import { backActionForPath } from "@/components/shell/tabs";
import { hasOpenSurface } from "@/lib/hooks/sheet-back-stack";
import { navigateToTab } from "@/lib/shell-nav";

export function MobileAuthHandler({ hasSession }: { hasSession: boolean }) {
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmLeaveWalkOpen, setConfirmLeaveWalkOpen] = useState(false);
  const [confirmLeaveActivityOpen, setConfirmLeaveActivityOpen] = useState(false);
  // Held in a ref rather than an effect dependency: adding the router to the deps below would
  // re-run the whole listener setup, and that effect also replays the cold-launch deep link.
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      // Back button: pop real history, go Home from a tab (which has nothing to pop —
      // the shell flips tabs with replaceState), minimize (don't close) when already at
      // the root — same behaviour as Messenger/Instagram.
      // Mid-workout, the hardware/gesture back button bypassed every other
      // "leave workout?" guard (the in-screen back arrow and the bottom-nav
      // tabs both confirm, but this global listener didn't) — confirm here too
      // instead of silently discarding the workout screen.
      const backHandle = await App.addListener("backButton", () => {
        if (isWorkoutActive(useWorkoutStore.getState()) && window.location.pathname.startsWith("/workout")) {
          setConfirmLeaveOpen(true);
          return;
        }
        if (isGuidedWalkActive(useGuidedWalkStore.getState()) && window.location.pathname.startsWith("/activity/guided-walk")) {
          setConfirmLeaveWalkOpen(true);
          return;
        }
        if (isActivityActive(useActivityStore.getState()) && window.location.pathname === "/activity") {
          setConfirmLeaveActivityOpen(true);
          return;
        }
        // **An open sheet or dialog is consumed FIRST, and it has to be checked rather than
        // inferred (BF-166).** `SheetContent` and `DialogContent` both render `BackDismiss`, which
        // pushes a history entry while the surface is open — but `pushState` is called with no URL,
        // so `window.location.pathname` does not move, and `backActionForPath` reads nothing else.
        // On a tab route it therefore answers "home" and we navigate away with the sheet still up:
        // the owner's *"nutrition meal creator menu open and you press the back button - it makes
        // the page behind it go back to main."* On "/" it answers "minimize" and the app goes to the
        // background instead. Only "pop" worked, and only because `history.back()` is coincidentally
        // the thing that consumes the entry.
        //
        // Going through `history.back()` here takes the identical path — `handlePop` closes the
        // topmost surface through Radix's own `onOpenChange`, so every guard already on a sheet's
        // close still runs.
        //
        // **AFTER the three mode guards, never before.** Each of them RAISES a dialog
        // (`LeaveWorkoutDialog` and its siblings), and that dialog is itself on this stack. Checking
        // overlays first would make a mid-workout back press close the confirmation instead of
        // answering it, which is the guard it was added to reach.
        if (hasOpenSurface()) {
          window.history.back();
          return;
        }
        switch (backActionForPath(window.location.pathname)) {
          case "minimize":
            App.minimizeApp();
            break;
          case "home":
            // The shell replaced rather than pushed to get here, so there is nothing to pop.
            // Going through navigateToTab keeps the persistent shell — a location assignment
            // would reload the WebView and throw away every mounted tab.
            navigateToTab(routerRef.current, "/");
            break;
          case "pop":
            window.history.back();
            break;
        }
      });

      async function handleAuthUrl(url: string) {
        if (!url.startsWith("trainingai://auth-complete")) return;
        const token = new URL(url).searchParams.get("token");
        if (!token) return;
        const verifier = localStorage.getItem("ta-mobile-auth-verifier");
        try {
          const res = await fetch("/api/auth/exchange-mobile-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, verifier }),
          });
          if (res.ok) localStorage.removeItem("ta-mobile-auth-verifier");
          await Browser.close().catch(() => {});
          // Only land on home if the user hasn't navigated away during the async
          // exchange. A cold-launch that already had a session renders a working
          // app the user may have moved off (e.g. to /admin) — redirecting them
          // back is UB1. The needed-exchange paths are always on /sign-in here.
          if (res.ok && window.location.pathname === "/sign-in") {
            window.location.href = "/";
          }
        } catch {
          // Non-fatal — user can retry sign-in
        }
      }

      // Handle deep link if app was already open when the link fired.
      const handle = await App.addListener("appUrlOpen", (event) => {
        handleAuthUrl(event.url);
      });

      // Handle deep link if app was cold-launched from the link.
      // Skip the redundant exchange when the WebView already had a session at
      // cold-launch: the server-render already authenticated us, so re-running
      // the exchange only risks the UB1 yank-to-home (finding UB1).
      const launch = await App.getLaunchUrl();
      if (!hasSession && launch?.url) handleAuthUrl(launch.url);

      cleanup = () => {
        backHandle.remove();
        handle.remove();
      };
    })();

    return () => cleanup?.();
  }, [hasSession]);

  return (
    <>
      <LeaveWorkoutDialog
        open={confirmLeaveOpen}
        onStay={() => setConfirmLeaveOpen(false)}
        onLeave={() => {
          setConfirmLeaveOpen(false);
          useWorkoutStore.getState().resetSession();
          window.history.back();
        }}
      />
      <LeaveWalkDialog
        open={confirmLeaveWalkOpen}
        onStay={() => setConfirmLeaveWalkOpen(false)}
        onLeave={() => {
          setConfirmLeaveWalkOpen(false);
          useGuidedWalkStore.getState().reset();
          window.history.back();
        }}
      />
      <LeaveActivityDialog
        open={confirmLeaveActivityOpen}
        onStay={() => setConfirmLeaveActivityOpen(false)}
        onLeave={() => {
          setConfirmLeaveActivityOpen(false);
          useActivityStore.getState().resetSession();
          window.history.back();
        }}
      />
    </>
  );
}
