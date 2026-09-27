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
 * **It is iconic on purpose — do not add a label without asking first.** #1730 shipped an extended
 * "Coach" pill on the reading that the owner had asked what this button was. He had not: he was
 * pointing at the moon in the collection pen's backdrop (`BF-208`), and `BF-206` struck the label
 * finding as an unrequested restyle of a working control. It is reverted here rather than left,
 * because a visual change to the screen he opens first is his call and he never made it. The case
 * for a label is real and is filed as `LB-164` for him to take or leave.
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
