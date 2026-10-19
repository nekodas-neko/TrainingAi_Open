import { useEffect, useRef, useState } from 'react';
import { pictureInPicture } from '../../../integrations/pip/platform';
import type { WorkoutJournalStore } from '../logging/WorkoutJournalStore';
import type { WorkoutRecord } from '../logging/workout';
import { pipCommand, pipPhaseFor, type PipAction } from './pip';

/** True while the app shows as the picture-in-picture window. */
export function usePipMode() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const subscription = pictureInPicture?.addListener('onModeChange', (event) =>
      setActive(event.active),
    );
    return () => subscription?.remove();
  }, []);
  return active;
}

/** The window's clock: native ticks in PiP, where JS timers are paused, else a timer. */
export function usePipNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const subscription = pictureInPicture?.addListener('onTick', () => setNow(Date.now()));
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      subscription?.remove();
      clearInterval(timer);
    };
  }, []);
  return now;
}

/**
 * The workout screen reports its phase while it is open, and idle once it closes, so a later
 * Home press elsewhere never opens the window (#2908). The window's buttons act on this workout.
 */
export function useWorkoutPip(workout: WorkoutRecord, controller: WorkoutJournalStore) {
  const phase = pipPhaseFor(workout);
  useEffect(() => {
    pictureInPicture?.setPhase(phase);
  }, [phase]);
  useEffect(() => () => pictureInPicture?.setPhase('idle'), []);
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
