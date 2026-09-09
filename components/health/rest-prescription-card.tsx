"use client";

import { useEffect, useState } from "react";
import { getLocalStore } from "@/lib/local-store";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { shiftDateStr, todayInTz } from "@trainingai/shared/date-utils";
import { restByPrescription, deltaPct, type RestPrescriptionSummary, type RestSet } from "./rest-prescription";

/**
 * The plain half of Q-300, under the Rest discipline trend.
 *
 * The bars above answer *"does resting to plan go with lifting better?"*. This answers the question
 * the measurement said was the useful one: **what does the plan ask, and what do you actually take?**
 * Prescribed rest spans 60–187 s in production and actual spans 65–133 s, with the shortest
 * prescription **exceeded** — so the plan is compressed toward a personal pace rather than followed.
 *
 * **No score and no verdict.** 39.8% of sets are "rushed" against their prescription, uniformly:
 * every session rushes something and none is mostly rushed. A discipline reading of that is
 * meaningless, and the owner asked for a fact rather than a nudge.
 *
 * **Local-first, and here that means device-only.** `planned_rest_sec` is the snapshot taken when
 * the set was logged — the honest number, because a later style edit would silently rewrite what
 * "prescribed" meant for a past set. It lives in the local store's set logs and no route publishes
 * it, so `getLocalStore` returning null in a browser leaves this card absent rather than wrong. See
 * LB-98.
 */
export function RestPrescriptionCard({ userId }: { userId?: string }) {
  const tz = useUserTimezone();
  const [summary, setSummary] = useState<RestPrescriptionSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const store = userId ? getLocalStore(userId) : null;
    if (!store) { setSummary(null); return () => { alive = false } }
    // Ninety days, matching the window the trend above is built over, so the two halves of the card
    // are describing the same stretch of training.
    const cutoff = shiftDateStr(todayInTz(tz), -90);
    store.getWorkoutHistory(cutoff)
      .then(history => {
        if (!alive) return;
        const sets: RestSet[] = history.flatMap(h => h.exerciseLogs.flatMap(ex => ex.sets));
        setSummary(restByPrescription(sets));
      })
      .catch(() => { if (alive) setSummary(null) });
    return () => { alive = false };
  }, [userId, tz]);

  if (!summary) return null;

  const taken = summary.rows.map(r => r.actualSec);
  const planned = summary.rows.map(r => r.plannedSec);

  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/40 overflow-hidden">
      <div className="flex items-baseline gap-3 px-3 pt-2.5 pb-1">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Your rest vs the plan
        </p>
        <p className="text-[10px] text-muted-foreground tabular-nums">{summary.totalSets} sets · 90 days</p>
      </div>

      <div className="grid grid-cols-[3.25rem_1fr_3rem_3.25rem] gap-x-2 px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Planned</span>
        <span>You take</span>
        <span className="text-right">Diff</span>
        <span className="text-right">Sets</span>
      </div>

      <div className="divide-y divide-border/60">
        {summary.rows.map(row => {
          const d = deltaPct(row);
          return (
            <div
              key={row.plannedSec}
              className="grid grid-cols-[3.25rem_1fr_3rem_3.25rem] items-baseline gap-x-2 px-3 py-2"
            >
              <span className="text-sm tabular-nums text-muted-foreground">{row.plannedSec}s</span>
              <span className="text-sm font-semibold tabular-nums">{row.actualSec}s</span>
              {/* Signed but not coloured. Red for "less rest" would make this a scorecard, which is
                  the framing the measurement rules out. */}
              <span className="text-sm tabular-nums text-muted-foreground text-right">
                {d > 0 ? '+' : d < 0 ? '−' : ''}{Math.abs(d)}%
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground text-right">{row.sets}</span>
            </div>
          );
        })}
      </div>

      {/* Only when it is true. `compressed` is null on a single prescription, and printing "your
          rest follows the plan" there would state the opposite of what is known. */}
      {summary.compressed === true && (
        <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground border-t border-border/60">
          Your rest sits in a narrower range than the plan asks for — {Math.min(...taken)}–{Math.max(...taken)}s
          taken against {Math.min(...planned)}–{Math.max(...planned)}s planned. Worth checking whether the
          prescriptions are the ones you want.
        </p>
      )}
    </div>
  );
}
