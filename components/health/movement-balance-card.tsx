"use client";

import { useMemo, useState } from "react";
import type { MuscleSetsWindowResponse } from "@/app/api/muscle-sets/route";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { shiftDateStr, todayInTz } from "@trainingai/shared/date-utils";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { movementBalance, PATTERN_LABEL, type MovementBalanceRow } from "./movement-balance";

/**
 * OR-118 — how the last sixty days split across push, pull and legs.
 *
 * The numbers were only ever reachable by running a query: every other muscle-set route computes
 * the CURRENT week and takes no window, and `muscle-tonnage-trend` is windowed but reports
 * **tonnage**, which is not a substitute — legs move far heavier loads, so a tonnage share
 * overstates them and hides the pull deficit this card exists to show. `/api/muscle-sets` (LB-111)
 * is the read that made this possible, and it counts **across programme changes**, deliberately:
 * the claim is about the lifter's balance, not one programme's adherence.
 *
 * **No verdict and no target.** There is no defensible universal push:pull ratio, and the owner
 * asked to see the split rather than be graded on it. The bar is the comparison.
 */

/** Sixty days, which is the window the finding was measured over. */
const WINDOW_DAYS = 60;

/**
 * Theme tokens, not hex — the palette is defined once in `app/globals.css` and checked for WCAG AA
 * contrast there, which a literal in this file would quietly sit outside of.
 *
 * These are four CATEGORIES, not a scale, so the hues are chosen to be distinguishable rather than
 * ordered: nothing here means "good" or "bad", and colouring push green would imply a verdict the
 * card deliberately does not make.
 */
const PATTERN_COLOR: Record<string, string> = {
  push: "var(--accent-cyan)",
  pull: "var(--accent-purple)",
  legs: "var(--accent-green)",
  other: "var(--color-muted-foreground)",
};

export function MovementBalanceCard({ title = "Movement Balance" }: { title?: string }) {
  const tz = useUserTimezone();
  const [failed, setFailed] = useState(false);

  // Recomputed per render but stable within a day; `to` moving at local midnight is what rolls the
  // window over, and the `today` cache variant treats yesterday's entry as a miss so the key does
  // not need the date spliced into it.
  const { from, to } = useMemo(() => {
    const end = todayInTz(tz);
    return { from: shiftDateStr(end, -(WINDOW_DAYS - 1)), to: end };
  }, [tz]);

  const data = useCachedValue<MuscleSetsWindowResponse>(
    "muscle-sets-window",
    `/api/muscle-sets?from=${from}&to=${to}`,
    TTL_MEDIUM,
    { today: true, onError: () => setFailed(true) },
  );

  const balance = useMemo(
    () => (data ? movementBalance(data.muscles) : null),
    [data],
  );

  if (failed) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
        <EmptyState title="Couldn't load your movement balance" />
      </div>
    );
  }

  if (!balance) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{title}</p>
        <div className="space-y-2.5">
          {[70, 55, 80, 40].map(w => (
            <Skeleton key={w} className="h-5" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (balance.total === 0) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">{title}</p>
        <EmptyState title="No sets logged in the last 60 days" />
      </div>
    );
  }

  // Scaled against the biggest row rather than the total, so the shortest bar is still legible when
  // one pattern dominates.
  const maxSets = Math.max(...balance.rows.map(r => r.sets));

  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
        <p className="text-[10px] text-muted-foreground">Last {WINDOW_DAYS} days</p>
      </div>

      <div className="space-y-2">
        {balance.rows.map((row: MovementBalanceRow) => (
          <div key={row.pattern}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium">{PATTERN_LABEL[row.pattern]}</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {Math.round(row.pct)}%
                </span>
                <span
                  className="text-xs tabular-nums font-semibold"
                  style={{ color: PATTERN_COLOR[row.pattern] }}
                >
                  {Math.round(row.sets)} set{Math.round(row.sets) !== 1 ? "s" : ""}
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${maxSets > 0 ? (row.sets / maxSets) * 100 : 0}%`,
                  backgroundColor: PATTERN_COLOR[row.pattern],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
