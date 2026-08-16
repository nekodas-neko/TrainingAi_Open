"use client";

import { useSyncExternalStore } from "react";
import { DatabaseZapIcon } from "lucide-react";
import { isLocalStoreDeadSignal, subscribeLocalStoreDead } from "@/lib/local-store/dead-store-signal";

// K4: shown only on the canonical runtime when the on-device DB failed to open.
// In that state the app runs online-only (writes take the API fallback), so the
// user needs to know a no-signal moment can lose a save. Static after mount — the
// signal only ever flips false → true within a session.
export function LocalStoreDeadBanner() {
  const dead = useSyncExternalStore(
    subscribeLocalStoreDead,
    isLocalStoreDeadSignal,
    () => false, // server snapshot — never dead during SSR
  );
  if (!dead) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pt-safe fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-1.5 bg-amber-500/95 px-3 py-1.5 text-center text-xs font-medium text-amber-950 shadow-md backdrop-blur-sm"
    >
      <DatabaseZapIcon className="h-3.5 w-3.5 shrink-0" />
      Local storage unavailable — saving online only
    </div>
  );
}
