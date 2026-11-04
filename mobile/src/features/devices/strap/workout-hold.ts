import {
  runServiceClaim,
  type ActivityServiceStarter,
} from '../../activities/data/background-recording.ts';

/**
 * How long an open workout may keep the strap's service: the workout notification's own cutoff
 * (`WorkoutStatusPolicy.MAX_AGE_MS`). A workout still open past it was abandoned (the app was
 * killed mid-session and reopened hours later), and nothing should hold the phone awake for it.
 */
export const WORKOUT_HOLD_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * The service's notification during a gym workout. It names the strap, as the current app's strap
 * service does (`PolarStrapService.kt`: "TrainingAI · Chest strap"); the workout's own status
 * notification already carries the exercise and the rest countdown.
 */
export const WORKOUT_STRAP_NOTIFICATION = {
  title: 'TrainingAI · Chest strap',
  body: 'Keeping your strap connected through the workout',
};

type OpenWorkout = { status: string; startedAt: number };

/**
 * Whether a gym workout holds the connected-device service now (#3627), so the strap's link
 * survives the screen going off between sets. Only for a signed-in account's open workout, with a
 * strap paired, and not one abandoned past the cutoff. Finish, discard and sign-out all make it
 * false; the service stops with the last hold.
 */
export function workoutServiceWanted({
  signedIn,
  workout,
  strapPaired,
  now,
}: {
  signedIn: boolean;
  workout: OpenWorkout | null;
  strapPaired: boolean;
  now: number;
}): boolean {
  return (
    signedIn &&
    strapPaired &&
    workout?.status === 'active' &&
    workoutServiceExpiresIn(workout, now) > 0
  );
}

/** How long until an open workout's hold reaches the cutoff. */
export function workoutServiceExpiresIn(workout: OpenWorkout, now: number) {
  return workout.startedAt + WORKOUT_HOLD_MAX_AGE_MS - now;
}

/**
 * Holds the shared service for one workout and returns the release. A refused or skipped start
 * (Bluetooth permission missing) leaves the workout's hold foreground-only, as before; the strap
 * card says why. The activity flag (`isActivityServiceRunning`) is not touched: it is the activity's.
 */
export function holdServiceForWorkout(service: ActivityServiceStarter) {
  return runServiceClaim(() => service.start({ notification: WORKOUT_STRAP_NOTIFICATION }), () => {});
}
