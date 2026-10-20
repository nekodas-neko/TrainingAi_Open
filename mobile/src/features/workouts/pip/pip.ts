import { CATEGORICAL_PALETTE, categoricalColor } from '@trainingai/shared/chart-colors';
import { workoutFlow } from '../logging/flow.ts';
import { displayLoad } from '../logging/preferences.ts';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout.ts';

// Picture-in-picture for the workout screen (#3064), ported from the current app:
// lib/workout/pip-phase.ts (the phase reported to the shell), components/workout/pip-view.tsx (what
// the window shows, drawn natively by modules/picture-in-picture) and the PiP buttons wired in
// components/workout-screen.tsx.

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
      /** The running set's arc colour, as the current app's setColor(currentSet). */
      setColor: string | null;
    }
  | {
      kind: 'placeholder';
      exerciseName: string;
      /** "Tap Next to continue", only where the window has a Next button. */
      hint: boolean;
    };

type WorkoutSet = WorkoutExercise['sets'][number];
const numberIn = (text: string) => {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(value) ? value : null;
};
/**
 * pip-view.tsx's "60 kg × 8": the set's weight, else the exercise's first, else 60, and the same
 * fallbacks for reps (the plan, the first set, 10), as the current app reads its per-set arrays.
 * The weight is kg; it is shown in the exercise's own unit through the set wheel's `displayLoad`,
 * so a 7.5 kg set on a pound exercise reads "16.53 lb".
 */
function load(exercise: WorkoutExercise, set: WorkoutSet | undefined) {
  const first = exercise.sets[0];
  const weight =
    (set && numberIn(set.weight)) ?? set?.plannedWeight ?? numberIn(first.weight) ?? 60;
  const reps = set ? repsOf(set, first) : repsOf(first, first);
  return `${displayLoad(weight, exercise.weightUnit)} ${exercise.weightUnit} × ${reps}`;
}
function repsOf(set: WorkoutSet, first?: WorkoutSet) {
  const reps = numberIn(set.reps);
  if (reps !== null && Number.isInteger(reps)) return reps;
  const firstReps = first ? numberIn(first.reps) : null;
  return set.planned?.reps ?? (firstReps !== null && Number.isInteger(firstReps) ? firstReps : 10);
}
function setColor(index: number) {
  const color = categoricalColor(index);
  // Past the six-colour table the palette is oklch, which Android cannot parse.
  return /^#[\da-f]{6}$/i.test(color)
    ? color
    : CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
}

/**
 * What the window draws, as the current app's PipView. The native module draws it (React cannot
 * repaint in PiP) and keeps the clock running from these anchors.
 */
export function pipViewFor(workout: WorkoutRecord | null): PipView | null {
  const phase = pipPhaseFor(workout);
  // Next on the last exercise ends the workout while the window may still be open: it shows the
  // placeholder with the session's name and no Next, never a blank window.
  if (workout && phase === 'done')
    return { kind: 'placeholder', exerciseName: workout.sessionName, hint: false };
  if (!workout || !allowsPip(phase)) return null;
  const { exercise } = current(workout);
  if (!exercise) return null;
  // The summary times the last set's rest as a rest, with every set done, as the current app's
  // PipView does; once Next clears it there is nothing to time, so its placeholder (#3111).
  if (phase === 'summary' && !workout.rest) {
    return { kind: 'placeholder', exerciseName: exercise.name, hint: true };
  }
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
      load: load(exercise, set),
      setColor: setColor(base.currentSet),
    };
  }
  return {
    kind: 'timer',
    ...base,
    phase: 'rest',
    restTargetSec: workout.rest
      ? Math.max(0, Math.round((workout.rest.endsAt - workout.rest.startedAt) / 1000))
      : 0,
    restStartMs: workout.rest?.lastSet
      ? workout.rest.startedAt
      : (workout.restAnchor?.startedAt ?? null),
    setStartMs: null,
    load: null,
    setColor: null,
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
