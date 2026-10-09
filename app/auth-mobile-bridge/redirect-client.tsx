"use client";

import { useEffect } from "react";

export function MobileBridgeRedirect({ returnUrl }: { returnUrl: string }) {
  useEffect(() => {
    window.location.href = returnUrl;
  }, [returnUrl]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground text-sm">Returning to app…</p>
        <a href={returnUrl} className="underline">Return to app</a>
      </div>
    </div>
  );
}
