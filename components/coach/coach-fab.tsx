"use client";

import Link from "next/link";
import { SparklesIcon } from "lucide-react";

/**
 * Floating entry point to AI Coach.
 *
 * Replaces the FAB the old chat overlay drew for itself when mounted uncontrolled — which is why
 * this entry point was easy to miss: there was no button in the host screen's source to grep for,
 * the control came from inside the overlay component.
 *
 * `bottom-fab-safe` clears the bottom nav plus the safe-area inset. Bare `bottom-6` would put this
 * under the gesture bar on Android.
 */
export function CoachFab() {
  return (
    <Link
      href="/coach"
      aria-label="Open AI Coach"
      className="fixed bottom-fab-safe right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-xl transition active:scale-95"
    >
      <SparklesIcon className="h-6 w-6" />
    </Link>
  );
}
