"use client";

import { WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "@/lib/use-online-status";

export function OfflineIndicator() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="bottom-fab-safe fixed left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-md backdrop-blur-sm"
    >
      <WifiOffIcon className="h-3.5 w-3.5" />
      Offline — showing saved data
    </div>
  );
}
