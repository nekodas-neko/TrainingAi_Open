import {
  DEFAULT_EFFORT_VS_PLAN,
  type EffortVsPlan,
  type ExerciseEffort,
} from '@trainingai/shared/workout/effort-vs-plan';
import type { WorkoutExercise, WorkoutRecord } from './workout.ts';

// #3745: "how did this exercise feel?", asked once per exercise on the rest card after its last
// set. The question starts on As expected (owner, 20 Nov), stored as `default` until a tap makes it
// `tapped`. An exercise left before its last set, or a workout abandoned with the question still
// open, stores nothing. Nothing reads the answer yet; it is only kept and uploaded.

/** How long the picture-in-picture window offers the three answers, from the rest's start. */
export const EFFORT_PIP_MS = 20_000;

const finished = (exercise: WorkoutExercise) =>
  exercise.sets.every((set) => set.completedAt !== null);

/** The exercises one rest card asks about: the exercise, and its finished superset partners. */
export function effortQuestionExercises(
  workout: WorkoutRecord,
  exerciseId: string,
): WorkoutExercise[] {
  const exercise = workout.exercises.find((x) => x.id === exerciseId);
  if (!exercise || !finished(exercise)) return [];
  if (exercise.supersetGroup == null) return [exercise];
  return workout.exercises.filter(
    (x) =>
      x.id === exercise.id ||
      (x.supersetGroup === exercise.supersetGroup &&
        !x.retired &&
        !x.skipped &&
        x.relogOf === exercise.relogOf &&
        finished(x)),
  );
}

/** The rest card has opened: each exercise it asks about starts on As expected, unless answered. */
export function askEffort(workout: WorkoutRecord, exerciseId: string): WorkoutRecord {
  const asked = new Set(effortQuestionExercises(workout, exerciseId).map((x) => x.id));
  if (!asked.size) return workout;
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) =>
      asked.has(exercise.id) && exercise.effortVsPlan === null
        ? { ...exercise, effortVsPlan: DEFAULT_EFFORT_VS_PLAN, effortSource: 'default' as const }
        : exercise,
    ),
  };
}

/** The lifter's tap, on the rest card or in the window. Only a finished exercise takes one. */
export function answerEffort(
  workout: WorkoutRecord,
  exerciseId: string,
  vsPlan: EffortVsPlan,
): WorkoutRecord {
  if (workout.status !== 'active') {
    throw new Error('This workout is already finished.');
  }
  if (vsPlan !== -1 && vsPlan !== 0 && vsPlan !== 1) {
    throw new Error('Choose easier, as expected or harder.');
  }
  const exercise = workout.exercises.find((x) => x.id === exerciseId);
  if (!exercise || !finished(exercise)) {
    throw new Error('Finish the exercise before saying how it felt.');
  }
  return {
    ...workout,
    exercises: workout.exercises.map((x) =>
      x.id === exerciseId ? { ...x, effortVsPlan: vsPlan, effortSource: 'tapped' as const } : x,
    ),
  };
}

/**
 * A workout saved from stale with a rest card still open: that card's untouched answers were never
 * moved on from, so they are dropped rather than uploaded as a default. A tap is kept.
 */
export function dropOpenDefaults(workout: WorkoutRecord): WorkoutRecord {
  if (workout.flow?.stage !== 'summary') return workout;
  const open = new Set(effortQuestionExercises(workout, workout.flow.exerciseId).map((x) => x.id));
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) =>
      open.has(exercise.id) && exercise.effortSource === 'default'
        ? { ...exercise, effortVsPlan: null, effortSource: null }
        : exercise,
    ),
  };
}

/** What the upload carries: the answer of a finished exercise, else nothing. */
export function effortPayload(exercise: WorkoutExercise): ExerciseEffort | undefined {
  if (!finished(exercise) || exercise.effortVsPlan === null || exercise.effortSource === null) {
    return undefined;
  }
  return { vsPlan: exercise.effortVsPlan, source: exercise.effortSource };
}

/**
 * The window's three answer buttons: for the first `EFFORT_PIP_MS` of the rest after an
 * exercise's last set, until the lifter taps one. Null otherwise.
 */
export function effortQuestionWindow(
  workout: WorkoutRecord | null,
  now: number,
): { exerciseId: string; until: number; answer: EffortVsPlan } | null {
  if (!workout || workout.status !== 'active' || workout.pausedAt !== null) return null;
  const rest = workout.rest;
  if (!rest?.lastSet || workout.flow?.stage !== 'summary') return null;
  const exercise = workout.exercises.find((x) => x.id === workout.flow!.exerciseId);
  if (!exercise || !finished(exercise) || exercise.effortSource === 'tapped') return null;
  const until = rest.startedAt + EFFORT_PIP_MS;
  if (now >= until) return null;
  return {
    exerciseId: exercise.id,
    until,
    answer: exercise.effortVsPlan ?? DEFAULT_EFFORT_VS_PLAN,
  };
}
