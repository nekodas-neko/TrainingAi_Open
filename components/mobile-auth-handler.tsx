"use client";

// Listens for the trainingai://auth-complete?token=... deep link that fires
// after the Chrome Custom Tab OAuth flow completes.  Exchanges the one-time
// token for the session cookie so the WebView is authenticated.

import { useEffect, useState } from "react";
import { useWorkoutStore, isWorkoutActive } from "@/lib/stores/workout-store";
import { LeaveWorkoutDialog } from "@/components/workout/leave-workout-dialog";
import { useGuidedWalkStore, isGuidedWalkActive } from "@/lib/stores/guided-walk-store";
import { LeaveWalkDialog } from "@/components/guided-walk/leave-walk-dialog";
import { useActivityStore, isActivityActive } from "@/lib/stores/activity-store";
import { LeaveActivityDialog } from "@/components/activity/leave-activity-dialog";

export function MobileAuthHandler({ hasSession }: { hasSession: boolean }) {
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmLeaveWalkOpen, setConfirmLeaveWalkOpen] = useState(false);
  const [confirmLeaveActivityOpen, setConfirmLeaveActivityOpen] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      // Back button: navigate back through history, minimize (don't close)
      // when already at the root — same behaviour as Messenger/Instagram.
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
        if (window.location.pathname === "/") {
          App.minimizeApp();
        } else {
          window.history.back();
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
