"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon, WifiOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/shell/bottom-nav";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    setOffline(isOffline);
    // Only report genuine (online) errors — an offline chunk-load failure is
    // expected, and the report fetch would fail anyway.
    if (!isOffline) {
      console.error("Root error boundary caught:", error);
      const body = JSON.stringify({ message: error.message, stack: error.stack, url: window.location.href });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/client-error", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    }
    // Auto-recover when connectivity returns.
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
                This screen needs a connection. Your saved data is on the other tabs.
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
                Your data is safe. Tap below to reload this screen.
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
      {/* Keep a way out — the boundary previously dead-ended with no nav. */}
      <BottomNav />
    </>
  );
}
