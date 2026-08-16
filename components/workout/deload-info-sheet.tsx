"use client";

import { BatteryLowIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { mround125 } from "./utils";
import { isBodyweightType } from "@trainingai/shared/1rm";

interface DeloadInfoSheetProps {
  exercise: WorkoutExercise | null;
  onClose: () => void;
  onToggleRevert: (name: string) => void;
}

function lineFor(
  sets: number | undefined,
  style: WorkoutExercise["progressionStyle"],
  oneRm: number | null | undefined,
  exerciseType?: string | null,
) {
  const s = style?.[0];
  if (!s) return null;
  // A bodyweight `estimated1rm` is a BW_REF-relative index, not kilograms, so scaling it by the
  // set's pct produces a weight the lifter never moved. The sets×reps @ pct line still reads fine
  // without it — the same reasoning as the pre-workout card's bodyweight branch.
  const showKg = oneRm != null && oneRm > 0 && !isBodyweightType(exerciseType);
  const kg = showKg ? ` (~${mround125(oneRm * s.pct / 100)}kg)` : "";
  return `${sets ?? style?.length ?? 0}×${s.reps} @ ${s.pct}%${kg}`;
}

export function DeloadInfoSheet({ exercise, onClose, onToggleRevert }: DeloadInfoSheetProps) {
  const reverted = exercise?.deloadReverted === true;
  // progressionStyle always holds what will actually run: the deload numbers
  // normally, or the original prescription after a revert (the transform swapped it).
  const runningLine = exercise
    ? lineFor(exercise.defaultSets, exercise.progressionStyle, exercise.estimated1rm, exercise.exerciseType)
    : null;
  const originalLine = exercise && !reverted
    ? lineFor(exercise.preDeloadSets, exercise.preDeloadStyle ?? null, exercise.estimated1rm, exercise.exerciseType)
    : null;

  return (
    <Sheet open={exercise != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BatteryLowIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            {exercise?.name}
          </SheetTitle>
        </SheetHeader>
        {exercise && (
          <div className="space-y-4 px-1 pb-2">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {exercise.deloadNote ?? "Deload — sore muscle flagged in your check-in"}
            </p>
            <div className="space-y-1 text-sm tabular-nums">
              <p>
                <span className="text-muted-foreground">{reverted ? "Running (full): " : "Deloaded to: "}</span>
                {runningLine ?? "—"}
              </p>
              {originalLine && (
                <p>
                  <span className="text-muted-foreground">Original plan: </span>
                  {originalLine}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Deloaded sets don&apos;t count toward personal records.
            </p>
            {exercise.preDeloadStyle && (
              <Button
                className="w-full h-12"
                variant={reverted ? "outline" : "default"}
                onClick={() => { onToggleRevert(exercise.name); onClose(); }}
              >
                {reverted ? "Use deload weights" : "Use full weights"}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
