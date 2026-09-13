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
  /** BF-151: reps behind `prevEst1rm`, when that number came from a logged set. For a bodyweight
   *  exercise this IS the previous rep max, so the card reads it instead of inverting the estimate
   *  — an inverse that cannot separate 5 reps from 6, which store the identical 1RM. Null when the
   *  basis was a seed or an all-time PR, which have no reps behind them. */
  prevRepMaxReps?: number | null;
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
