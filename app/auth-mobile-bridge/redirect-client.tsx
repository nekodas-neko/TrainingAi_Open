"use client";

import { useEffect } from "react";

export function MobileBridgeRedirect({ token, returnUrl }: { token?: string; returnUrl?: string }) {
  const target = returnUrl ?? `trainingai://auth-complete?token=${token}`;
  useEffect(() => {
    // Next.js redirect() silently ignores custom URL schemes.
    // window.location.href is the only reliable way to trigger the deep link
    // from inside a Chrome Custom Tab.
    window.location.href = target;
  }, [target]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="space-y-4 text-center"><p className="text-muted-foreground text-sm">Returning to app…</p><a href={target} className="underline">Return to app</a></div>
    </div>
  );
}
