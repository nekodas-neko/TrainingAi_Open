"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/shell/bottom-nav";
import { reportClientError } from "@/lib/client-error";

export default function WorkoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    if (typeof navigator === "undefined" || navigator.onLine) {
      // K1: report to error_events like the root boundary does — a render crash
      // mid-workout (the most complex state machine in the app) was the only
      // boundary leaving no telemetry row.
      console.error("Workout error boundary caught:", error);
      reportClientError({
        message: error.message,
        stack: error.stack,
        url: (typeof window !== "undefined" ? window.location.href : "") + "#workout-boundary",
      });
    }
    const onOnline = () => reset();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error, reset]);

  return (
    <>
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
        {offline ? (
          <>
            <WifiOffIcon className="h-12 w-12 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-bold">You&apos;re offline</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your workout data has been saved. Reconnect to reload this screen.
              </p>
            </div>
            <Button className="bg-brand text-brand-foreground hover:opacity-90" onClick={reset}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <TriangleAlertIcon className="h-12 w-12 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold">Something went wrong</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your workout data has been saved. Tap below to recover.
              </p>
              <p className="mt-3 max-w-xs break-all font-mono text-xs text-red-400">{error?.message}</p>
            </div>
            <Button className="bg-brand text-brand-foreground hover:opacity-90" onClick={reset}>
              Try again
            </Button>
            <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
              Go to home
            </Link>
          </>
        )}
      </div>
      <BottomNav />
    </>
  );
}
