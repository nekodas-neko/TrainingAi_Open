import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { pictureInPicture } from '../../../integrations/pip/platform';
import type { PictureInPicture } from '../../../integrations/pip/types';
import type { WorkoutJournalStore } from '../logging/WorkoutJournalStore';
import type { WorkoutRecord } from '../logging/workout';
import { workoutStatusFor } from '../status/workout-status';
import { pipCommand, pipPhaseFor, pipSetColor, type PipAction } from './pip';

/**
 * Tells the module what the workout screen shows. Sends only on change, and "idle" once closed:
 * after that a Home press anywhere never opens the window (#2908).
 */
export function createPipReporter(native: Pick<PictureInPicture, 'setPhase'> | null) {
  let last: string | null = null;
  let closed = false;
  return {
    update(workout: WorkoutRecord) {
      if (closed || !native) return;
      const phase = pipPhaseFor(workout);
      const status = workoutStatusFor(workout);
      const setColor = pipSetColor(workout);
      const key = JSON.stringify([phase, status, setColor]);
      if (key === last) return;
      last = key;
      native.setPhase(phase, status, setColor);
    },
    close() {
      if (closed) return;
      closed = true;
      native?.setPhase('idle', null, null);
    },
  };
}

/** The workout screen's half of picture-in-picture: its phase, and the window's buttons. */
export function useWorkoutPip(workout: WorkoutRecord, controller: WorkoutJournalStore) {
  const reporter = useMemo(() => createPipReporter(pictureInPicture), []);
  // A layout effect runs inside the commit, so a change made from a window button reaches the
  // native view without waiting on JS timers, which are paused while the app is in PiP.
  useLayoutEffect(() => reporter.update(workout), [reporter, workout]);
  useEffect(() => () => reporter.close(), [reporter]);
  const latest = useRef({ workout, controller });
  latest.current = { workout, controller };
  useEffect(() => {
    const subscription = pictureInPicture?.addListener('onAction', (event) =>
      runPipAction(latest.current.workout, latest.current.controller, event.action),
    );
    return () => subscription?.remove();
  }, []);
}

export function runPipAction(
  workout: WorkoutRecord,
  controller: Pick<WorkoutJournalStore, 'updateSet' | 'recordSet' | 'startSet' | 'advanceExercise'>,
  action: PipAction,
) {
  const command = pipCommand(workout, action);
  if (!command) return;
  if (command.type === 'reps')
    controller.updateSet(workout.id, command.exerciseId, command.setId, 'reps', command.value);
  else if (command.type === 'record')
    void controller.recordSet(workout.id, command.exerciseId, command.setId);
  else if (command.type === 'start')
    void controller.startSet(workout.id, command.exerciseId, command.setId);
  else void controller.advanceExercise(workout.id);
}
