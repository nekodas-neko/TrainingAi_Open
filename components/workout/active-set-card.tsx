"use client";

import { memo } from "react";
import { useWorkoutStore } from "@/lib/stores/workout-store";
import { SetCard } from "./set-card";
import type { ExerciseType } from "@trainingai/shared/types/program";

interface ActiveSetCardProps {
  currentSet: number;
  workoutPhase: "rest" | "set";
  intensityPct?: number;
  isBaseline?: boolean;
  lastSetMode?: string;
  exerciseType?: ExerciseType;
  equipment?: string[];
  isBodyweight: boolean;
  onRepChange: (index: number, value: number) => void;
  onWeightChange?: (index: number, value: number) => void;
  onRpeChange?: (value: number) => void;
}

// Self-subscribes the CURRENT set's hot-path slices (weight/reps/lap/rest/RPE) directly from the
// store so a weight-dial detent or rep tap re-renders only this small leaf — never the ~800-line
// ActiveWorkoutScreen above it (which no longer holds these fields in its own subscription). This
// is the leaf half of CLAUDE.md's render-discipline rule: "per-set weight/RPE read by the leaf
// that renders it via its own selector, never threaded through a broad parent pick."
export const ActiveSetCard = memo(function ActiveSetCard({
  currentSet,
  workoutPhase,
  intensityPct,
  isBaseline,
  lastSetMode,
  exerciseType,
  equipment,
  isBodyweight,
  onRepChange,
  onWeightChange,
  onRpeChange,
}: ActiveSetCardProps) {
  const weight = useWorkoutStore((s) => s.perSetWeights[currentSet]) ?? (isBodyweight ? 0 : 60);
  const repValue = useWorkoutStore((s) => s.reps[currentSet]);
  const lapTime = useWorkoutStore((s) => s.lapTimes[currentSet]);
  const restTime = useWorkoutStore((s) => s.restTimes[currentSet]);
  const rpeValue = useWorkoutStore((s) => s.rpeValues?.[currentSet]);
  const setCount = useWorkoutStore((s) => s.reps.length);
  const isAmrap = (isBaseline ?? false) || (lastSetMode === "amrap" && currentSet === setCount - 1);

  return (
    <SetCard
      index={currentSet}
      currentSet={currentSet}
      workoutPhase={workoutPhase}
      repValue={repValue}
      weight={weight}
      lapTime={lapTime}
      restTime={restTime}
      intensityPct={intensityPct}
      onRepChange={onRepChange}
      onWeightChange={onWeightChange}
      isAmrap={isAmrap}
      exerciseType={exerciseType}
      equipment={equipment}
      rpeValue={rpeValue}
      onRpeChange={onRpeChange}
    />
  );
});
