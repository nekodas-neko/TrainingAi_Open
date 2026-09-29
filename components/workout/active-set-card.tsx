"use client";

import { memo } from "react";
import { useCallback, useState } from "react";
import { useWorkoutStore } from "@/lib/stores/workout-store";
import { rpeLoadSuggestion } from "./rpe-load-suggestion";
import { RpeSuggestionPill } from "./rpe-suggestion-pill";
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
  /** `sessionExerciseId` — the dial remembers its unit against this (BF-141). */
  exerciseId?: string;
  isBodyweight: boolean;
  onRepChange: (index: number, value: number) => void;
  onWeightChange?: (index: number, value: number) => void;
  onRpeChange?: (value: number) => void;
  /** BF-220: the PREVIOUS set's prescription, which only the parent holds the style for. Scalars,
   *  so the memo above survives — an object here would defeat it on every dial detent (Q-490). */
  prevSetPrescribedReps?: number;
  prevSetPct?: number;
  isDeload?: boolean;
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
  exerciseId,
  isBodyweight,
  onRepChange,
  onWeightChange,
  onRpeChange,
  prevSetPrescribedReps,
  prevSetPct,
  isDeload,
}: ActiveSetCardProps) {
  const weight = useWorkoutStore((s) => s.perSetWeights[currentSet]) ?? (isBodyweight ? 0 : 60);
  const repValue = useWorkoutStore((s) => s.reps[currentSet]);
  const lapTime = useWorkoutStore((s) => s.lapTimes[currentSet]);
  const restTime = useWorkoutStore((s) => s.restTimes[currentSet]);
  const rpeValue = useWorkoutStore((s) => s.rpeValues?.[currentSet]);
  const setCount = useWorkoutStore((s) => s.reps.length);
  const isAmrap = (isBaseline ?? false) || (lastSetMode === "amrap" && currentSet === setCount - 1);

  // BF-220. Read the set he JUST logged, not this one: the offer belongs on the next card.
  const prevRpe = useWorkoutStore((s) => (currentSet > 0 ? s.rpeValues?.[currentSet - 1] : undefined));
  const prevReps = useWorkoutStore((s) => (currentSet > 0 ? s.reps[currentSet - 1] : undefined));
  // Dismissal is per set and deliberately local: it is a glance he has already had, not a
  // preference worth persisting, and a rating he changes should be allowed to offer again.
  const [dismissedSet, setDismissedSet] = useState<number | null>(null);
  const suggestion = currentSet > 0 && dismissedSet !== currentSet
    ? rpeLoadSuggestion(
        { loggedRpe: prevRpe, repsDone: prevReps, prescribedReps: prevSetPrescribedReps, pct: prevSetPct },
        weight,
        { isBaseline, isDeload, exerciseType, equipment },
      )
    : null;

  // Hoisted, not inline: `RpeSuggestionPill` is memoised and one inline arrow defeats a shallow
  // prop compare entirely — the rule this component's own docstring cites, and `check:rules` caught
  // it here on the first run rather than letting it ship looking optimised (Q-490).
  const suggestedWeight = suggestion?.weightKg;
  const acceptSuggestion = useCallback(() => {
    if (suggestedWeight !== undefined) onWeightChange?.(currentSet, suggestedWeight);
  }, [onWeightChange, currentSet, suggestedWeight]);
  const dismissSuggestion = useCallback(() => setDismissedSet(currentSet), [currentSet]);

  return (
    <>
      {suggestion && onWeightChange && (
        <RpeSuggestionPill
          weightKg={suggestion.weightKg}
          note={suggestion.note}
          onAccept={acceptSuggestion}
          onDismiss={dismissSuggestion}
        />
      )}
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
      exerciseId={exerciseId}
      rpeValue={rpeValue}
      onRpeChange={onRpeChange}
      />
    </>
  );
});
