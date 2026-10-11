"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Issue 2750: Full was chosen over a deload and has nothing to put back, so rebuild once. */
  overrideFull?: boolean;
  fullNeedsRebuild?: boolean;
};

/**
 * The per-day time-budget choice (30/45/60/90 minutes around the session own length) and the warm-up countdown that has to
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
  overrideFull = false,
  fullNeedsRebuild = false,
}: Args) {
  // A duration-preset switch is in flight. Separate from aiPrescriptionPending (which is
  // server-derived) because this one is a local, user-initiated regeneration — it drives the
  // same "preparing" affordance so the Start button can't fire on the plan being replaced.
  const [durationSwitching, setDurationSwitching] = useState(false);

  const warmupGoalSec = useMemo(
    () => warmupGoalSecFor(sessionBudgetMin, durationPreset) ?? WARMUP_GOAL_SEC_FALLBACK,
    [sessionBudgetMin, durationPreset],
  );

  const handleDurationPresetChange = useCallback(async (preset: DurationPreset, forFull = false): Promise<boolean> => {
    if (!programSessionId) return false;
    setDurationSwitching(true);
    const failure = forFull ? "Couldn't rebuild for Full — try again" : "Couldn't rebuild for that length — try again";
    try {
      const res = await fetch(`/api/ai-periodization/session/${programSessionId}/prescribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationPreset: preset }),
      });
      if (!res.ok) {
        toast.error(res.status === 429
          ? "Too many plan rebuilds this hour — try again shortly"
          : failure);
        return false;
      }
      await invalidatePrescriptionChanged(programSessionId);
      fetchExercises();
      loadPeriodization({ afterWrite: true });
      return true;
    } catch {
      toast.error(failure);
      return false;
    } finally {
      setDurationSwitching(false);
    }
  }, [programSessionId, fetchExercises, loadPeriodization]);

  // Issue 2750. Choosing Full over a stored deload that recorded no full numbers used to leave the
  // deload on the bar and tell the lifter so, with changing the time preset as the unmentioned way
  // out. Rebuild once per Full choice instead: an exercise with no progression style stays deloaded
  // after the rebuild, and `triedRef` is what stops that becoming a loop of model calls. It resets
  // only when Full is dropped, so choosing Deload and then Full again is a new choice.
  const triedRef = useRef(false);
  useEffect(() => {
    if (!overrideFull) { triedRef.current = false; return; }
    if (!fullNeedsRebuild || triedRef.current || durationSwitching || !programSessionId) return;
    triedRef.current = true;
    void handleDurationPresetChange(durationPreset ?? 'standard', true);
  }, [overrideFull, fullNeedsRebuild, durationSwitching, programSessionId, durationPreset, handleDurationPresetChange]);

  return { warmupGoalSec, durationSwitching, handleDurationPresetChange };
}
