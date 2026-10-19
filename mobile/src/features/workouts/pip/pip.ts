import { formatLoadKg } from '@trainingai/shared/format/units';
import { workoutFlow } from '../logging/flow.ts';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout.ts';

// Picture-in-picture for the workout screen (#3064), ported from the current app:
// lib/workout/pip-phase.ts (the phase reported to the shell), components/workout/pip-view.tsx (what
// the window shows) and the PiP buttons wired in components/workout-screen.tsx.

/** Only the four active phases open the window on leave; the shell starts in, and returns to, idle. */
export type PipPhase = 'idle' | 'pre' | 'set' | 'rest' | 'complete' | 'summary' | 'done';
export const ACTIVE_PIP_PHASES: readonly PipPhase[] = ['set', 'rest', 'complete', 'summary'];
export type PipAction = 'repsDown' | 'repsUp' | 'log';

export function allowsPip(phase: PipPhase) {
  return ACTIVE_PIP_PHASES.includes(phase);
}

function current(workout: WorkoutRecord) {
  const flow = workoutFlow(workout);
  const exercise = workout.exercises.find((x) => x.id === flow.exerciseId) ?? null;
  return { flow, exercise };
}
const done = (exercise: WorkoutExercise) =>
  exercise.sets.filter((set) => set.completedAt !== null).length;

/** The phase of the workout on screen; null (nothing open) is idle. */
export function pipPhaseFor(workout: WorkoutRecord | null): PipPhase {
  if (!workout || workout.status !== 'active') return 'idle';
  const { flow, exercise } = current(workout);
  if (flow.stage === 'review') return 'done';
  if (flow.stage === 'summary') return 'summary';
  if (flow.stage === 'warmup' || !exercise) return 'pre';
  if (workout.runningSet) return 'set';
  return done(exercise) >= exercise.sets.length ? 'complete' : 'rest';
}

export type PipView =
  | {
      kind: 'timer';
      exerciseName: string;
      phase: 'rest' | 'set';
      /** Sets recorded so far: "rest · 2/4" after two, "set 3/4" while the third runs. */
      currentSet: number;
      sets: number;
      /** The rest's target in seconds; 0 when the set had none. */
      restTargetSec: number;
      restStartMs: number | null;
      setStartMs: number | null;
      /** "60 kg × 8" during a set. */
      load: string | null;
    }
  | { kind: 'placeholder'; exerciseName: string };

function lastRecorded(exercise: WorkoutExercise) {
  return exercise.sets
    .filter((set) => set.completedAt !== null)
    .reduce<
      WorkoutExercise['sets'][number] | null
    >((latest, set) => (latest && latest.completedAt! >= set.completedAt! ? latest : set), null);
}

function load(exercise: WorkoutExercise, set: WorkoutExercise['sets'][number]) {
  const weight = Number(set.weight.trim().replace(',', '.'));
  const reps = repsOf(set);
  const shown =
    set.weight.trim() && Number.isFinite(weight) ? formatLoadKg(weight, { unit: false }) : '—';
  return `${shown} ${exercise.weightUnit} × ${reps}`;
}
function repsOf(set: WorkoutExercise['sets'][number]) {
  const reps = Number(set.reps);
  return set.reps.trim() && Number.isInteger(reps) ? reps : (set.planned?.reps ?? 10);
}

/** What the window draws, as the current app's PipView and its summary branch. */
export function pipViewFor(workout: WorkoutRecord | null): PipView | null {
  const phase = pipPhaseFor(workout);
  if (!workout || !allowsPip(phase)) return null;
  const { exercise } = current(workout);
  if (!exercise) return null;
  const base = {
    exerciseName: exercise.name,
    sets: exercise.sets.length,
    currentSet: done(exercise),
  };
  if (phase === 'set') {
    const set = exercise.sets.find((x) => x.id === workout.runningSet?.setId);
    return {
      kind: 'timer',
      ...base,
      phase: 'set',
      restTargetSec: 0,
      restStartMs: null,
      setStartMs: set?.startedAt ?? null,
      load: set ? load(exercise, set) : null,
    };
  }
  if (phase === 'summary') {
    // The last set's rest still counts in the window; with nothing recorded there is nothing to time.
    const last = lastRecorded(exercise);
    if (!last) return { kind: 'placeholder', exerciseName: exercise.name };
    const planned = last.planned?.restSeconds ?? 0;
    return {
      kind: 'timer',
      ...base,
      phase: 'rest',
      restTargetSec: planned > 0 ? Math.max(0, planned + workout.restAdjustmentSeconds) : 0,
      restStartMs: last.completedAt,
      setStartMs: null,
      load: null,
    };
  }
  return {
    kind: 'timer',
    ...base,
    phase: 'rest',
    restTargetSec: workout.rest
      ? Math.max(0, Math.round((workout.rest.endsAt - workout.rest.startedAt) / 1000))
      : 0,
    restStartMs: workout.restAnchor?.startedAt ?? null,
    setStartMs: null,
    load: null,
  };
}

/** The window's clock, as PipView computes it at one instant. */
export function pipClock(view: Extract<PipView, { kind: 'timer' }>, now: number) {
  const restElapsed =
    view.phase === 'rest' && view.restStartMs !== null
      ? Math.max(0, Math.floor((now - view.restStartMs) / 1000))
      : 0;
  const setElapsed =
    view.phase === 'set' && view.setStartMs !== null
      ? Math.max(0, Math.floor((now - view.setStartMs) / 1000))
      : 0;
  const overTime =
    view.phase === 'rest' && view.restTargetSec > 0 && restElapsed >= view.restTargetSec;
  return {
    seconds: view.phase === 'rest' ? restElapsed : setElapsed,
    overTime,
    over: overTime ? restElapsed - view.restTargetSec : 0,
    // Rest fills toward its target and stays full; a set grows to a three-minute visual cap.
    fraction:
      view.phase === 'rest'
        ? view.restTargetSec > 0
          ? Math.min(restElapsed / view.restTargetSec, 1)
          : 0
        : Math.min(setElapsed / 180, 1),
    label:
      view.phase === 'rest'
        ? view.currentSet >= view.sets
          ? 'done'
          : `rest · ${view.currentSet}/${view.sets}`
        : `set ${view.currentSet + 1}/${view.sets}`,
  };
}

export type PipCommand =
  | { type: 'reps'; exerciseId: string; setId: string; value: string }
  | { type: 'record'; exerciseId: string; setId: string }
  | { type: 'start'; exerciseId: string; setId: string }
  | { type: 'advance' };

/** What a window button does, as the current app's usePipActions handlers. */
export function pipCommand(workout: WorkoutRecord | null, action: PipAction): PipCommand | null {
  const phase = pipPhaseFor(workout);
  if (!workout || !allowsPip(phase)) return null;
  const { exercise } = current(workout);
  if (!exercise) return null;
  if (phase === 'set') {
    const set = exercise.sets.find((x) => x.id === workout.runningSet?.setId);
    if (!set) return null;
    if (action === 'log') return { type: 'record', exerciseId: exercise.id, setId: set.id };
    const reps = repsOf(set);
    const value = action === 'repsUp' ? reps + 1 : Math.max(1, reps - 1);
    return { type: 'reps', exerciseId: exercise.id, setId: set.id, value: String(value) };
  }
  if (action !== 'log') return null;
  if (phase === 'rest') {
    const next = exercise.sets.find((set) => set.completedAt === null);
    return next ? { type: 'start', exerciseId: exercise.id, setId: next.id } : null;
  }
  // "Complete" and "Next" both move on from a finished exercise.
  return { type: 'advance' };
}
