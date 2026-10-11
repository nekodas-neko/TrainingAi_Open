import { workoutFlow } from './flow.ts';
import type { WorkoutRecord } from './workout.ts';

export function workoutActivity(workout: WorkoutRecord, now: number) {
  const flow = workoutFlow(workout);
  const exercise = workout.exercises.find(
    (exercise) => exercise.id === (workout.runningSet?.exerciseId ?? flow.exerciseId),
  );
  if (workout.runningSet && exercise) {
    const index = exercise.sets.findIndex((set) => set.id === workout.runningSet!.setId);
    const set = exercise.sets[index];
    return {
      label: `${exercise.name} · Set ${index + 1}/${exercise.sets.length}`,
      seconds: set?.startedAt == null ? null : Math.max(0, (now - set.startedAt) / 1000),
      timer: 'Set',
    };
  }
  if (workout.rest && flow.stage !== 'warmup' && flow.stage !== 'review') {
    const remaining = Math.ceil((workout.rest.endsAt - now) / 1000);
    return {
      label: exercise?.name ?? workout.sessionName,
      seconds: Math.abs(remaining),
      timer: remaining < 0 ? 'Overtime' : 'Rest',
    };
  }
  return {
    label:
      flow.stage === 'warmup'
        ? 'Warm-up'
        : flow.stage === 'review'
          ? 'Session overview'
          : flow.stage === 'summary'
            ? `${exercise?.name ?? 'Exercise'} · Summary`
            : `Prepare ${exercise?.name ?? 'exercise'}`,
    seconds: null,
    timer: '',
  };
}
