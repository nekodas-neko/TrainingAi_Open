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
 * ONE hue for every pattern — RV-208 ③.
 *
 * **Why not four hues: the wheel is over-subscribed, and this was measured rather than judged.**
 * A category hue has to stay clear of two separate systems. `SESSION_PALETTE`
 * (`packages/shared/src/session-palette.ts`) is indexed by session POSITION over six Tailwind hues
 * — red ≈27°, amber ≈70°, green ≈145°, blue ≈255°, indigo ≈275°, purple ≈305° — and this app's own
 * accent tokens hold four more. Nine constraints on a 360° wheel. The previous map collided with
 * both: **`legs` was `--accent-green`, 0° from session green**, and `pull` was `--accent-purple`,
 * **10°** from session purple — so on Health → Training the same three words carried two different
 * colour maps within a thumb's scroll, transposed rather than merely different.
 *
 * Scanning the wheel for replacements, the only band clear of all nine at a comfortable 40°
 * separation is ~345–347°. That is room for **one** hue, not the two the entry assumed, and a
 * three-hue set only exists if you accept 30° gaps — one of which sits wedged exactly between amber
 * and green. There is no good four-colour answer while sessions own six hues by position.
 *
 * **So the colour stops carrying the identity, because it never had to.** Every row already renders
 * `PATTERN_LABEL[row.pattern]` beside its bar; the rows are stacked and individually labelled, so
 * hue was redundant encoding. One accent for all of them cannot collide with a session colour, and
 * it stays correct if the owner reorders his sessions — which the previous map could not.
 *
 * **`other` stays muted**, and no row is green or red: these are four CATEGORIES, not a scale, and
 * nothing here means "good" or "bad". A lightness ramp would imply exactly the ordering this card
 * refuses to assert, which is why the fix is one flat hue rather than three shades of one.
 *
 * Theme tokens, not hex — the palette is defined once in `app/globals.css` and checked for WCAG AA
 * contrast there, which a literal in this file would quietly sit outside of.
 */
const PATTERN_COLOR: Record<string, string> = {
  push: "var(--accent-cyan)",
  pull: "var(--accent-cyan)",
  legs: "var(--accent-cyan)",
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
