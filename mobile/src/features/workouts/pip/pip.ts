import { CATEGORICAL_PALETTE, categoricalColor } from '@trainingai/shared/chart-colors';
import { workoutFlow } from '../logging/flow.ts';
import type { WorkoutExercise, WorkoutRecord } from '../logging/workout.ts';

// Picture-in-picture for the workout screen (#3064), ported from the current app:
// lib/workout/pip-phase.ts (the phase reported to the shell) and the PiP buttons wired in
// components/workout-screen.tsx. What the window shows is the workout status payload, drawn natively
// by modules/picture-in-picture.

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

type WorkoutSet = WorkoutExercise['sets'][number];
const numberIn = (text: string) => {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(value) ? value : null;
};
function repsOf(set: WorkoutSet, first?: WorkoutSet) {
  const reps = numberIn(set.reps);
  if (reps !== null && Number.isInteger(reps)) return reps;
  const firstReps = first ? numberIn(first.reps) : null;
  return set.planned?.reps ?? (firstReps !== null && Number.isInteger(firstReps) ? firstReps : 10);
}

/**
 * The running set's arc colour, as the current app's setColor(currentSet); null outside a set.
 * Everything else the window draws comes from the workout status payload (workoutStatusFor), the
 * same one the notification reads (#3266).
 */
export function pipSetColor(workout: WorkoutRecord | null): string | null {
  if (!workout || pipPhaseFor(workout) !== 'set') return null;
  const { exercise } = current(workout);
  if (!exercise) return null;
  const color = categoricalColor(done(exercise));
  // Past the six-colour table the palette is oklch, which Android cannot parse.
  return /^#[\da-f]{6}$/i.test(color)
    ? color
    : CATEGORICAL_PALETTE[done(exercise) % CATEGORICAL_PALETTE.length];
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
