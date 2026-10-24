import type {
  PromotionReport,
  WorkoutStatusModule,
  WorkoutStatusPayload,
} from '../../../integrations/workout-status/types.ts';
import { displayLoad } from '../logging/preferences.ts';
import { pipPhaseFor } from '../pip/pip.ts';
import { nextExerciseFlow, workoutFlow } from '../logging/flow.ts';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout.ts';

// The Android ongoing notification / Live Update (#3249): a view of the active workout, derived
// from the durable journal every time it changes. Nothing here is stored; after a process kill the
// next start derives it again.

type WorkoutSet = WorkoutExercise['sets'][number];
const numberIn = (text: string) => {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(value) ? value : null;
};

/** "80 kg × 8" from the set's own values or its plan, naming only what is known. */
export function knownLoad(exercise: WorkoutExercise, set: WorkoutSet | undefined) {
  if (!set) return null;
  const weight = exercise.exerciseType === 'bodyweight' ? null : (numberIn(set.weight) ?? set.plannedWeight);
  const typed = numberIn(set.reps);
  const reps = typed !== null && Number.isInteger(typed) ? typed : (set.planned?.reps ?? null);
  const weightText = weight === null ? null : `${displayLoad(weight, exercise.weightUnit)} ${exercise.weightUnit}`;
  if (weightText && reps !== null) return `${weightText} × ${reps}`;
  return weightText ?? (reps !== null ? `${reps} reps` : null);
}

/**
 * What the notification and the picture-in-picture window show for the workout, or null when
 * there is none open. One payload for both, so they can never disagree.
 */
export function workoutStatusFor(workout: WorkoutRecord | null): WorkoutStatusPayload | null {
  if (!workout || workout.status !== 'active') return null;
  const phase = pipPhaseFor(workout);
  const base = {
    workoutId: workout.id,
    sessionName: workout.sessionName,
    exerciseName: workout.sessionName,
    nextSet: 0,
    sets: 0,
    load: null,
    restEndsAt: null,
    label: null,
    startedAt: workout.startedAt,
    setStartedAt: null,
    restStartedAt: null,
    setsDone: 0,
    nextUp: null,
    hr: null,
  };
  if (phase === 'idle') return null;
  if (phase === 'pre') return { ...base, phase: 'ready', label: 'Warm-up' };
  if (phase === 'done') return { ...base, phase: 'ready', label: 'Finishing up' };
  const flow = workoutFlow(workout);
  const exercise = workout.exercises.find((x) => x.id === flow.exerciseId);
  if (!exercise) return { ...base, phase: 'ready' };
  const named = {
    ...base,
    exerciseName: exercise.name,
    sets: exercise.sets.length,
    setsDone: exercise.sets.filter((set) => set.completedAt !== null).length,
  };
  if (phase === 'set') {
    const index = exercise.sets.findIndex((x) => x.id === workout.runningSet?.setId);
    return {
      ...named,
      phase: 'working',
      nextSet: index + 1,
      load: knownLoad(exercise, exercise.sets[index]),
      setStartedAt: exercise.sets[index]?.startedAt ?? null,
    };
  }
  const next = exercise.sets.findIndex((x) => x.completedAt === null);
  // The rest after an exercise's last set is timed on its summary; there is no next set to name.
  const finished = next === -1;
  const resting = workout.rest !== null;
  const after = phase === 'summary' && !workout.soloExerciseId ? nextExerciseFlow(workout) : null;
  return {
    ...named,
    phase: resting ? 'resting' : 'ready',
    nextSet: finished ? 0 : next + 1,
    load: finished ? null : knownLoad(exercise, exercise.sets[next]),
    restEndsAt: workout.rest?.endsAt ?? null,
    label: finished ? 'Exercise done' : null,
    // With no rest timed, the window counts up from the last set (the current app's rest anchor).
    restStartedAt: workout.rest?.startedAt ?? workout.restAnchor?.startedAt ?? null,
    nextUp:
      after && after.stage !== 'review'
        ? (workout.exercises.find((x) => x.id === after.exerciseId)?.name ?? null)
        : null,
  };
}

/** Never throws: a missing notification must never break the workout that asked for it. */
function safely(run: () => void) {
  try {
    run();
  } catch {}
}

/**
 * Keeps the notification in step with the workout. The first call after the journal loads
 * reconciles against whatever an earlier process left behind: a status for the open workout, or a
 * clear when there is none. After that it sends only on change.
 */
export function createWorkoutStatusReporter(
  native: Pick<WorkoutStatusModule, 'show' | 'update' | 'clear'> | null,
) {
  // undefined: not reconciled yet. null: cleared. A string: the last status sent.
  let last: string | null | undefined;
  return {
    update(workout: WorkoutRecord | null) {
      if (!native) return;
      const status = workoutStatusFor(workout);
      if (!status) {
        if (last === null) return;
        last = null;
        safely(() => native.clear());
        return;
      }
      const key = JSON.stringify(status);
      if (key === last) return;
      const first = last === undefined || last === null;
      last = key;
      safely(() => (first ? native.show(status) : native.update(status)));
    },
    /** Forgets what was sent, so the next update posts again (permission granted, app resumed). */
    invalidate() {
      if (last) last = undefined;
    },
    /** Signing out or switching account: nothing of the old account's workout stays on screen. */
    clear() {
      if (!native || last === null) return;
      last = null;
      safely(() => native.clear());
    },
  };
}

/** Removes the notification whoever posted it, such as an earlier process of the old account. */
export function clearWorkoutStatus(native: Pick<WorkoutStatusModule, 'clear'> | null) {
  safely(() => native?.clear());
}

/**
 * The one line sent to the error reporter once per app start, so the phone check has ground truth
 * on whether Android promoted the notification. Booleans and a named platform level only: the
 * reporter scrubs every digit, and no exercise or weight belongs in it.
 */
export function promotionDiagnostic(report: PromotionReport) {
  const level =
    report.sdkFull >= 3_600_001 ? 'baklava-later' : report.sdkFull >= 3_600_000 ? 'baklava' : 'older';
  return `Workout status promotion: promoted=${report.promoted} posted=${report.posted} level=${level} canpost=${report.canPostPromoted}`;
}
