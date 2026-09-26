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
 * under the gesture bar on Android. The screen mounting it reserves the button's own height with
 * `pb-fab-safe` — `pb-nav-safe` reserves the nav and nothing else, and this sits 56 px above that
 * (BF-206).
 *
 * **It is extended rather than iconic, and that is the fix rather than a style choice.** The owner
 * asked what *"that button on the widget, the white circle"* was. A sparkle is this app's generic
 * AI mark — it is also on the weekly-recap banner, the meal-source row and the profile tab — so it
 * names a category, not a destination. A one-time tooltip was the alternative and it only teaches
 * the person who does not dismiss it.
 */
export function CoachFab() {
  return (
    <Link
      href="/coach"
      aria-label="Open AI Coach"
      className="fixed bottom-fab-safe right-6 z-50 flex h-14 items-center gap-2 rounded-full bg-foreground pl-4 pr-5 text-background shadow-xl transition active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <SparklesIcon className="h-6 w-6 flex-none" />
      <span className="text-sm font-semibold">Coach</span>
    </Link>
  );
}
