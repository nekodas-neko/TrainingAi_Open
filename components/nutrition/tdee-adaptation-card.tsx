"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { invalidateGoalRecommendations } from "@/lib/cache-groups";
import { startOfWeekInTz } from "@trainingai/shared/date-utils";
import type { EnergyBalanceResponse } from "@/app/api/nutrition/energy-balance/route";

interface Props {
  /** The energy-balance payload — carries the calibrated maintenance and the target it implies. */
  energyBalance: EnergyBalanceResponse | null;
  onApplied: () => void;
}

function nudgeStorageKey(): string {
  return `ta_tdee_nudge:${startOfWeekInTz()}`;
}

/**
 * Offers the calorie target implied by the user's CALIBRATED maintenance.
 *
 * Previously this derived its own suggestion from `tdeeAdjustment(goal, weightRate)` — a nudge off
 * the *current target* rather than off measured maintenance. Sitting next to the energy-balance
 * bar it produced a visibly different recommendation for the same user on the same screen
 * (1450 vs 1700 kcal in testing). One recommendation, from the calibrated number.
 *
 * Saves through PUT /api/nutrition/targets, which is the source of truth for the daily target and
 * mirrors into `users.calorie_goal` server-side.
 */
export function TdeeAdaptationCard({ energyBalance, onApplied }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(nudgeStorageKey()) === "handled");
    } catch { /* localStorage unavailable */ }
  }, []);

  const target = energyBalance?.target;
  const maintenance = energyBalance?.maintenance;
  // Only ever suggest off a calibrated maintenance — nudging toward a number derived from the
  // same formula the user already has just moves them sideways with false authority.
  const canSuggest =
    !dismissed &&
    maintenance?.source === "calibrated" &&
    target?.recommendedKcal != null &&
    target.driftsFromRecommendation;

  if (!canSuggest) return null;
  const recommended = target!.recommendedKcal!;
  const current = target!.currentKcal;

  function markHandled() {
    try {
      localStorage.setItem(nudgeStorageKey(), "handled");
    } catch { /* ignore */ }
    setDismissed(true);
  }

  async function handleApply() {
    setApplying(true);
    try {
      const res = await fetch("/api/nutrition/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calories: recommended }),
      });
      if (!res.ok) throw new Error();
      await invalidateGoalRecommendations();
      markHandled();
      onApplied();
      toast.success("Calorie target updated");
    } catch {
      toast.error("Failed to update calorie target");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/60 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Calorie Nudge</p>
      <p className="text-sm">
        Your measured maintenance is {maintenance!.kcal.toLocaleString()} kcal, so your goal works out
        to <span className="font-semibold">{recommended.toLocaleString()} kcal/day</span>
        {current != null && <> — your target is set to {current.toLocaleString()}</>}.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={handleApply}
          disabled={applying}
          className="flex-1 min-h-[48px] rounded-xl bg-foreground text-background py-2 text-sm font-semibold disabled:opacity-40"
        >
          {applying ? "Applying…" : `Use ${recommended.toLocaleString()}`}
        </button>
        <button
          onClick={markHandled}
          className="flex-1 min-h-[48px] rounded-xl bg-muted py-2 text-sm font-semibold hover:bg-muted/80 transition-colors"
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}
