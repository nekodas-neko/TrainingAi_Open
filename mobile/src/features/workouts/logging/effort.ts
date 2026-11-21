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

/** The rest card's questions not yet marked seen, for the screen to mark once it is on screen. */
export function unseenEffortQuestions(workout: WorkoutRecord): string[] {
  if (workout.status !== 'active' || workout.flow?.stage !== 'summary') return [];
  return effortQuestionExercises(workout, workout.flow.exerciseId)
    .filter((x) => !x.effortShown)
    .map((x) => x.id);
}

/** Marks the questions about these exercises as seen: on the rest card, or in the window. */
export function showEffort(workout: WorkoutRecord, exerciseIds: readonly string[]): WorkoutRecord {
  const ids = new Set(exerciseIds);
  if (!workout.exercises.some((x) => ids.has(x.id) && !x.effortShown)) return workout;
  return {
    ...workout,
    exercises: workout.exercises.map((x) => (ids.has(x.id) ? { ...x, effortShown: true } : x)),
  };
}

/** Clears the open rest card's untouched defaults, except those `keep` names. */
function openDefaults(workout: WorkoutRecord, keep: (exercise: WorkoutExercise) => boolean) {
  if (workout.flow?.stage !== 'summary') return workout;
  const open = new Set(effortQuestionExercises(workout, workout.flow.exerciseId).map((x) => x.id));
  return clearDefaults(workout, (x) => open.has(x.id) && !keep(x));
}

function clearDefaults(workout: WorkoutRecord, clear: (exercise: WorkoutExercise) => boolean) {
  if (!workout.exercises.some((x) => x.effortSource === 'default' && clear(x))) return workout;
  return {
    ...workout,
    exercises: workout.exercises.map((exercise) =>
      exercise.effortSource === 'default' && clear(exercise)
        ? { ...exercise, effortVsPlan: null, effortSource: null }
        : exercise,
    ),
  };
}

/**
 * A workout saved from stale with a rest card still open: that card's untouched answers were never
 * moved on from, so they are dropped rather than uploaded as a default. A tap is kept.
 */
export function dropOpenDefaults(workout: WorkoutRecord): WorkoutRecord {
  return openDefaults(workout, () => false);
}

/**
 * The rest card is being left (Next, another exercise, the session, finish). A default stays only
 * where its question was on screen: a superset partner finished while the lifter was in the window,
 * which asks about one exercise, never saw its question, so it stores nothing.
 */
export function dropUnseenDefaults(workout: WorkoutRecord): WorkoutRecord {
  return openDefaults(workout, (x) => x.effortShown);
}

/** `dropUnseenDefaults` for a change that has left `before`'s rest card for `after`. */
export function settleLeftEffort(before: WorkoutRecord, after: WorkoutRecord): WorkoutRecord {
  if (before.flow?.stage !== 'summary') return after;
  const stays =
    after.status === 'active' &&
    after.flow?.stage === 'summary' &&
    after.flow.exerciseId === before.flow.exerciseId;
  if (stays) return after;
  const open = new Set(
    effortQuestionExercises(before, before.flow.exerciseId)
      .filter((x) => !x.effortShown)
      .map((x) => x.id),
  );
  const left = clearDefaults(after, (x) => open.has(x.id));
  // A superset's Next can land on its partner's own rest card, which asks again on the same terms.
  return left.status === 'active' && left.flow?.stage === 'summary'
    ? askEffort(left, left.flow.exerciseId)
    : left;
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
