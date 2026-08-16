import type { ExerciseType } from "@trainingai/shared/types/program";

export type WorkoutMode = "pre" | "warmup" | "active" | "exercise-summary" | "done";

export interface ExerciseSummaryData {
  exName: string;
  setWeights: number[];
  sets: number;
  reps: number[];
  lapTimes: number[];
  restSec: number;
  prevEst1rm: number | null;
  // All-time PR 1RM the "New Personal Record!" badge must beat (E1-7) — distinct
  // from prevEst1rm (last session). null when the exercise has no PR yet.
  allTimePr1rm: number | null;
  newEst1rm: number;
  target80: number;
  progressionStyle?: { pct: number; reps: number }[];
  exerciseType?: ExerciseType;
  // What's coming up during the rest countdown (Q-87) — null when this was the last
  // exercise of the session. startingWeight is the same computeInitialWeights() output
  // the set actually opens with, not last-logged weight.
  nextExercise: { name: string; startingWeight: number; exerciseType?: ExerciseType } | null;
}

export interface SessionLogEntry {
  name: string;
  setWeights: number[];
  reps: number[];
}
