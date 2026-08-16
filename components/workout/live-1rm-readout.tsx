import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkoutStore } from "@/lib/stores/workout-store";
import { mround, runningEstimate1RM, oneRmTrendStatus, type RMStyleSet } from "@trainingai/shared/1rm";

interface Live1rmReadoutProps {
  /** Number of sets logged so far — the readout reflects weights/reps[0..currentSet-1]. */
  currentSet: number;
  isBodyweight: boolean;
  style: RMStyleSet[] | null;
  previousEst1rm: number | null;
}

const TREND_COLOR = {
  up: "#22c55e",
  down: "#ef4444",
  even: "var(--color-brand)",
  none: "var(--color-brand)",
} as const;

// Self-subscribes its own weight/rep slices from the store (via a shallow-compared selector) so the
// live estimate updates independently as the user dials a weight — without re-rendering the
// ~800-line ActiveWorkoutScreen that hosts it.
export const Live1rmReadout = memo(function Live1rmReadout({ currentSet, isBodyweight, style, previousEst1rm }: Live1rmReadoutProps) {
  const weights = useWorkoutStore(
    useShallow((s) => Array.from({ length: currentSet }, (_, i) => s.perSetWeights[i] ?? (isBodyweight ? 0 : 60))),
  );
  const reps = useWorkoutStore(useShallow((s) => s.reps.slice(0, currentSet)));

  if (weights.length === 0) return null;
  const projected = runningEstimate1RM(weights, reps, style);
  if (projected <= 0) return null;

  const avgWeight = mround(weights.reduce((a, b) => a + b, 0) / weights.length, 0.25);
  const avgRepsRaw = reps.reduce((a, b) => a + b, 0) / reps.length;
  const avgReps = Number.isInteger(avgRepsRaw) ? `${avgRepsRaw}` : avgRepsRaw.toFixed(1);

  const status = oneRmTrendStatus(projected, previousEst1rm);
  const color = TREND_COLOR[status];
  const diff = previousEst1rm != null ? projected - previousEst1rm : null;
  const showDelta = diff != null && status !== "none" && Math.abs(diff) > 0.5;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px]">
      <span className="text-muted-foreground tabular-nums">
        Ø {avgWeight} kg × {avgReps} reps
      </span>
      <span className="text-muted-foreground">=</span>
      <span className="font-bold tabular-nums" style={{ color }}>
        {projected} kg
      </span>
      {showDelta && (
        <span className="font-semibold tabular-nums" style={{ color }}>
          {status === "up" ? "▲" : "▼"} {diff! > 0 ? "+" : "−"}
          {Math.abs(diff!).toFixed(2)} kg
        </span>
      )}
    </div>
  );
});
