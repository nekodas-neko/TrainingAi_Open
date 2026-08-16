"use client";

import { useEffect } from "react";

export function MobileBridgeRedirect({ token }: { token: string }) {
  useEffect(() => {
    // Next.js redirect() silently ignores custom URL schemes.
    // window.location.href is the only reliable way to trigger the deep link
    // from inside a Chrome Custom Tab.
    window.location.href = `trainingai://auth-complete?token=${token}`;
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-muted-foreground text-sm">Returning to app…</p>
    </div>
  );
}
