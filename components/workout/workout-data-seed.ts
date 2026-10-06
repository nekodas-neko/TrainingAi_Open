import { isWorkoutDataToday } from "@/lib/sqlite/cache";
import type { WorkoutExercise, PhaseStatus } from "@/app/api/workout-data/route";
import { payloadNumbersSource, type NumbersSource } from "./numbers-source";

/**
 * The `/api/workout-data` payload as the workout screen consumes it — the same shape whether it
 * arrived over the network, from this screen's own cache, or from Home's card prefetch.
 */
export type WorkoutDataSeed = {
  dataDate?: string;
  exercises: WorkoutExercise[];
  session?: { id: string; name: string; timeBudgetMinutes?: number };
  phaseStatus?: PhaseStatus;
  program?: { phaseMode?: string };
  aiPrescriptionPending?: boolean;
  /** Which engine built the prescription driving these numbers, when one does (#2110). */
  prescriptionSource?: "model" | "rules";
  sessionNotFound?: boolean;
};

/**
 * `workout-data`/`workout-card` is a date-less, 6h-TTL cache — a payload built before midnight can
 * still be served after it. `loggedTodayInSession` is only meaningful for the day it was computed,
 * so a stale-dated payload has it stripped here, at the single point every downstream consumer
 * (the workout screen, the pre-workout screen and the done screen all read the same `exercises`
 * state) derives from.
 */
export function freshExercises(data: WorkoutDataSeed, tz?: string): WorkoutExercise[] {
  return isWorkoutDataToday(data, tz)
    ? (data.exercises ?? [])
    : (data.exercises ?? []).map(ex => ({ ...ex, loggedTodayInSession: false }));
}

/**
 * The same payload's provenance label (RV-202 ③) — `null` when it is today's coached plan and
 * needs none; `rules` when today's plan was built from the program because the model failed (#2110).
 * Paired with `freshExercises` on purpose: both ask "is this payload today's", and a caller that
 * strips the flag without labelling the numbers leaves the screen quietly presenting a previous
 * day's sets as "Recommended".
 */
export function seedNumbersSource(data: WorkoutDataSeed, tz?: string): NumbersSource | null {
  return payloadNumbersSource(data, isWorkoutDataToday(data, tz));
}
