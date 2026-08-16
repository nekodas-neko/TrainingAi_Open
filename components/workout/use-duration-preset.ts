"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { invalidatePrescriptionChanged } from "@/lib/cache-groups";
import { warmupGoalSecFor } from "@trainingai/shared/workout/duration-model";
import type { DurationPreset } from "@trainingai/shared/workout/duration-model";
import { WARMUP_GOAL_SEC_FALLBACK } from "@/components/workout/warmup-screen";

type Args = {
  programSessionId: string | undefined;
  sessionBudgetMin: number | undefined;
  durationPreset: DurationPreset | undefined;
  fetchExercises: () => void;
  loadPeriodization: (opts?: { afterWrite?: boolean }) => void;
};

/**
 * The per-day time-budget choice (short / standard / long) and the warm-up countdown that has to
 * agree with it.
 *
 * Changing the preset regenerates today's prescription against that budget and swaps it in — the
 * choice is never written to the program, it only tags the plan it produced. Reuses the same
 * invalidate-then-refetch path as accept/dismiss so every cached surface (workout-data, the card,
 * the pre-workout list) re-reads.
 *
 * `warmupGoalSec` must be the SAME number the plan was trimmed against — a flat 600 s was what made
 * a 30-min Quick session show a 10-min warm-up while its exercise list had been built for ~5
 * (Q-212). It falls back only while the budget is unknown (workout-data not landed yet).
 */
export function useDurationPreset({
  programSessionId,
  sessionBudgetMin,
  durationPreset,
  fetchExercises,
  loadPeriodization,
}: Args) {
  // A duration-preset switch is in flight. Separate from aiPrescriptionPending (which is
  // server-derived) because this one is a local, user-initiated regeneration — it drives the
  // same "preparing" affordance so the Start button can't fire on the plan being replaced.
  const [durationSwitching, setDurationSwitching] = useState(false);

  const warmupGoalSec = useMemo(
    () => warmupGoalSecFor(sessionBudgetMin, durationPreset) ?? WARMUP_GOAL_SEC_FALLBACK,
    [sessionBudgetMin, durationPreset],
  );

  const handleDurationPresetChange = useCallback(async (preset: DurationPreset) => {
    if (!programSessionId) return;
    setDurationSwitching(true);
    try {
      const res = await fetch(`/api/ai-periodization/session/${programSessionId}/prescribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationPreset: preset }),
      });
      if (!res.ok) {
        toast.error(res.status === 429
          ? "Too many plan rebuilds this hour — try again shortly"
          : "Couldn't rebuild for that length — try again");
        return;
      }
      await invalidatePrescriptionChanged(programSessionId);
      fetchExercises();
      loadPeriodization({ afterWrite: true });
    } catch {
      toast.error("Couldn't rebuild for that length — try again");
    } finally {
      setDurationSwitching(false);
    }
  }, [programSessionId, fetchExercises, loadPeriodization]);

  return { warmupGoalSec, durationSwitching, handleDurationPresetChange };
}
