import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { pictureInPicture } from '../../../integrations/pip/platform';
import type { PictureInPicture } from '../../../integrations/pip/types';
import type { WorkoutStatusPayload } from '../../../integrations/workout-status/types';
import type { WorkoutJournalStore } from '../logging/WorkoutJournalStore';
import type { WorkoutRecord } from '../logging/workout';
import { workoutStatusFor } from '../status/workout-status';
import { pipCommand, pipPhaseFor, pipSetColor, pipSetColors, type PipAction } from './pip';

export type PipHeartRate = NonNullable<WorkoutStatusPayload['hr']>;
/** At most one heart-rate update a second reaches the window (#3266). */
export const HR_PUSH_MS = 1_000;

/**
 * Tells the module what the workout screen shows. Sends only on change, and "idle" once closed:
 * after that a Home press anywhere never opens the window (#2908). One payload feeds the window and
 * the notification, so the two cannot disagree; the strap's reading rides on the window's copy
 * alone, throttled, since a reading a second is not a status change the notification should post.
 */
export function createPipReporter(
  native: Pick<PictureInPicture, 'setPhase'> | null,
  now: () => number = Date.now,
) {
  let last: string | null = null;
  let closed = false;
  let workout: WorkoutRecord | null = null;
  let hr: PipHeartRate | null = null;
  let hrSentAt = 0;
  function send() {
    if (closed || !native || !workout) return;
    const phase = pipPhaseFor(workout);
    const status = workoutStatusFor(workout);
    const setColor = pipSetColor(workout);
    const withHr = status && { ...status, hr, setColors: pipSetColors(workout) };
    const key = JSON.stringify([phase, withHr, setColor]);
    if (key === last) return;
    last = key;
    native.setPhase(phase, withHr, setColor);
  }
  return {
    update(next: WorkoutRecord) {
      workout = next;
      send();
    },
    /** The strap's latest reading, or null when there is none to show. */
    heartRate(next: PipHeartRate | null) {
      if (next === null) {
        if (hr === null) return;
        hr = null;
        send();
        return;
      }
      // A reading inside the last second waits for the next one; nothing here sets a timer, as
      // none would fire while the app is in the window.
      if (hr !== null && now() - hrSentAt < HR_PUSH_MS) return;
      hr = next;
      hrSentAt = now();
      send();
    },
    close() {
      if (closed) return;
      closed = true;
      native?.setPhase('idle', null, null);
    },
  };
}

/**
 * The workout screen's half of picture-in-picture: its phase, and the window's buttons. Returns the
 * reporter, which the strap's heart-rate reader feeds (`PipHeartRate`).
 */
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
  return reporter;
}

export function runPipAction(
  workout: WorkoutRecord,
  controller: Pick<
    WorkoutJournalStore,
    'updateSet' | 'recordSet' | 'startSet' | 'advanceExercise' | 'adjustRest' | 'pause' | 'resume'
  >,
  action: PipAction,
) {
  const command = pipCommand(workout, action);
  if (!command) return;
  if (command.type === 'restPlus') void controller.adjustRest(workout.id, 30);
  else if (command.type === 'pause') void controller.pause(workout.id);
  else if (command.type === 'resume') void controller.resume(workout.id);
  else if (command.type === 'reps')
    controller.updateSet(workout.id, command.exerciseId, command.setId, 'reps', command.value);
  else if (command.type === 'record')
    void controller.recordSet(workout.id, command.exerciseId, command.setId);
  else if (command.type === 'start')
    void controller.startSet(workout.id, command.exerciseId, command.setId);
  else void controller.advanceExercise(workout.id);
}
