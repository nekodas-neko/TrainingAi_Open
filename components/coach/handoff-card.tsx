"use client";

import Link from "next/link";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import type { HandoffArgs } from "@/lib/coach/widgets";

/**
 * Destinations are a fixed map, not a model-supplied path.
 *
 * The schema restricts `destination` to this set, and the paths live here rather than in the
 * model's arguments — so a handoff can only ever point somewhere the app actually has, and never
 * off-site.
 */
const DESTINATIONS: Record<HandoffArgs["destination"], { href: string; label: string }> = {
  program_builder: { href: "/config", label: "Program builder" },
  log_activity: { href: "/activity", label: "Log an activity" },
  profile: { href: "/more", label: "Profile" },
  nutrition: { href: "/nutrition", label: "Nutrition" },
};

export function HandoffCard({ args }: { args: HandoffArgs }) {
  const dest = DESTINATIONS[args.destination];

  return (
    <Link
      href={dest.href}
      className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 px-3.5 py-3 min-h-[56px]"
    >
      <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0 bg-[color-mix(in_oklch,var(--accent-cyan)_14%,transparent)]">
        <ExternalLinkIcon className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold truncate">{args.title || dest.label}</p>
        {args.subtitle && <p className="text-[11.5px] text-muted-foreground truncate">{args.subtitle}</p>}
      </div>
      <ChevronRightIcon className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
