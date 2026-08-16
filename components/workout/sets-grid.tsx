"use client";

import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkoutStore } from "@/lib/stores/workout-store";
import { formatSetLoad, formatTime } from "./utils";
import { RPE_COLORS, RPE_LABELS } from "./rpe-strip";
import type { ExerciseType } from "@trainingai/shared/types/program";

interface SetsGridProps {
  currentSet: number;
  allSetsLogged: boolean;
  workoutPhase: "rest" | "set";
  exerciseType?: ExerciseType;
  isBodyweight: boolean;
}

// The per-set recap grid. Self-subscribes the hot-path arrays (reps/weights/lap/rest/RPE) via
// shallow-compared selectors so a weight-dial detent — which updates the active cell's live load —
// re-renders only this grid, not the ~800-line ActiveWorkoutScreen. Extracted from that screen as
// part of the workout render-perf pass (also trims the file below the size guidance).
export const SetsGrid = memo(function SetsGrid({
  currentSet,
  allSetsLogged,
  workoutPhase,
  exerciseType,
  isBodyweight,
}: SetsGridProps) {
  const reps = useWorkoutStore(useShallow((s) => s.reps));
  const perSetWeights = useWorkoutStore(useShallow((s) => s.perSetWeights));
  const lapTimes = useWorkoutStore(useShallow((s) => s.lapTimes));
  const restTimes = useWorkoutStore(useShallow((s) => s.restTimes));
  const rpeValues = useWorkoutStore(useShallow((s) => s.rpeValues));
  const weightFor = (i: number) => perSetWeights[i] ?? (isBodyweight ? 0 : 60);

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {reps.map((repVal, i) => {
        const isDone = i < currentSet;
        const isActive = i === currentSet && !allSetsLogged;
        const rpe = rpeValues?.[i];
        const lap = lapTimes[i];
        const rest = restTimes[i];

        if (isDone) {
          return (
            <div
              key={i}
              className="rounded-xl px-2.5 py-2"
              style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.16)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-green-500 text-[10px] font-bold">{i + 1}✓</span>
                {lap !== undefined && (
                  <span className="text-[9px] text-muted-foreground tabular-nums">{formatTime(lap)}</span>
                )}
              </div>
              <p className="text-[12px] font-semibold tabular-nums mt-0.5 text-foreground">
                {formatSetLoad(weightFor(i), repVal, exerciseType)}
              </p>
              <div className="flex items-center justify-between mt-0.5">
                {rpe != null ? (
                  <p className="text-[10px] font-bold leading-none" style={{ color: RPE_COLORS[rpe] }}>
                    {rpe} · {RPE_LABELS[rpe]}
                  </p>
                ) : <span />}
                {rest !== undefined && (
                  <span className="text-[9px] text-muted-foreground tabular-nums">{rest}s rest</span>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="rounded-xl px-2.5 py-2"
            style={{
              background: isActive
                ? "color-mix(in oklch, var(--color-brand) 8%, transparent)"
                : "transparent",
              border: `1px solid ${isActive ? "color-mix(in oklch, var(--color-brand) 20%, transparent)" : "var(--color-border)"}`,
              opacity: i > currentSet + 1 ? 0.25 : isActive ? 1 : 0.45,
            }}
          >
            <span
              className="text-[10px] font-bold"
              style={{ color: isActive ? "var(--color-brand)" : "var(--color-muted-foreground)" }}
            >
              {i + 1}
            </span>
            <p className="text-[12px] font-semibold tabular-nums mt-0.5 text-muted-foreground">
              {formatSetLoad(weightFor(i), repVal, exerciseType)}
            </p>
            <p className="text-[10px] mt-0.5 leading-none" style={{ color: isActive ? "var(--color-brand)" : "transparent" }}>
              {isActive && workoutPhase === "set" ? "▶ active" : isActive ? "↑ up next" : "·"}
            </p>
          </div>
        );
      })}
    </div>
  );
});
