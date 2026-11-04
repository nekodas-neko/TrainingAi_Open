import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useAccountContext } from '../../account/AccountProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { bleAdapter } from '../../../integrations/ble/platform';
import { deviceAlert } from '../../../integrations/notifications/platform';
import { HrOutbox } from './HrOutbox';
import { useActivityServiceRunning } from '../../activities/data/background-recording';
import { holdStrapForActivity } from './activity-hold';
import { workoutStrapService } from '../../../integrations/activity-service/platform';
import {
  holdServiceForWorkout,
  workoutServiceExpiresIn,
  workoutServiceWanted,
} from './workout-hold';
import { StrapSession, type StrapHold } from './StrapSession';

const Context = createContext<StrapSession | null>(null);

/** The chest strap, connected while a workout or an activity is active (#2844, #3527). */
export function StrapProvider({ children }: PropsWithChildren) {
  const storage = useLocalStorage();
  const connection = useAccountContext().dataReader;
  const resources = useWorkoutResources();
  const journal = useWorkoutJournal();
  const [session] = useState(
    () =>
      new StrapSession({
        ble: bleAdapter,
        storage: storage.device(),
        notifyLowBattery: (percent) =>
          deviceAlert(
            'Chest strap battery low',
            `${percent}% remaining — worth replacing the coin cell.`,
          ),
      }),
  );
  useEffect(() => {
    void session.initialize();
    return () => session.dispose();
  }, [session]);
  const outbox = useMemo(
    () =>
      connection
        ? new HrOutbox(storage.account(connection.origin, connection.userId), connection, () => {
            // The recap computes from these samples on read. During the workout nothing shows it.
            if (!session.getSnapshot().recording) resources?.invalidate(['/api/oura/hr-data', '/api/oura/hr-window']);
          })
        : null,
    [storage, connection, resources, session],
  );
  useEffect(() => {
    session.setOutbox(outbox);
    const listener = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // A permission granted in Android Settings, or Bluetooth turned on, is noticed here.
      void session.retry();
      session.sync();
    });
    // The training sync's cadence: a workout finished offline uploads once the signal returns.
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') session.sync();
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
    };
  }, [session, outbox]);
  const workoutActive = journal.data.workouts.some((workout) => workout.status === 'active');
  useEffect(() => {
    session.hold('workout', workoutActive);
  }, [session, workoutActive]);
  // The hold above keeps the link while the app runs; with the screen locked between sets Android
  // would freeze the app and drop it. A paired strap holds the connected-device service for the
  // workout (#3627), the same one an indoor activity holds, until finish, discard or sign-out.
  const openWorkout = journal.data.workouts.find((workout) => workout.status === 'active') ?? null;
  const strapPaired = useSyncExternalStore(
    session.subscribe,
    () => !!session.getSnapshot().paired,
    () => !!session.getSnapshot().paired,
  );
  // The workout whose hold reached the cutoff while it ran: it stays released.
  const [agedOut, setAgedOut] = useState<string | null>(null);
  const serviceWanted =
    !!openWorkout &&
    agedOut !== openWorkout.id &&
    workoutServiceWanted({ signedIn: !!connection, workout: openWorkout, strapPaired, now: Date.now() });
  const serviceWorkout = serviceWanted ? openWorkout : null;
  useEffect(() => {
    if (!serviceWorkout || !workoutStrapService) return;
    const release = holdServiceForWorkout(workoutStrapService);
    const timer = setTimeout(
      () => setAgedOut(serviceWorkout.id),
      Math.max(0, workoutServiceExpiresIn(serviceWorkout, Date.now())),
    );
    return () => {
      clearTimeout(timer);
      release();
    };
  }, [serviceWorkout?.id, serviceWorkout?.startedAt]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

/** The strap session where one is provided, else null: for features that use the strap only if present. */
export function useStrapSession() {
  return useContext(Context);
}

export function useStrap() {
  const session = useContext(Context);
  if (!session) throw new Error('StrapProvider is required.');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { state, session };
}

/**
 * Holds the strap link, and records its readings, for the whole of a walk, run or guided walk. It
 * survives the app going to the background only while the recording service is running (see
 * `activityHoldWanted`); without the service it is a foreground hold, as a screen's is.
 */
export function useActivityStrapHold(active: boolean) {
  const session = useContext(Context);
  const serviceRunning = useActivityServiceRunning();
  const holdRef = useRef<ReturnType<typeof holdStrapForActivity> | null>(null);
  const serviceRef = useRef(serviceRunning);
  serviceRef.current = serviceRunning;
  // Held for the walk only: the service starting or stopping goes through `update` below and must
  // not release the hold, which would drop the link and reset the trace.
  useEffect(() => {
    if (!session || !active) return;
    const hold = holdStrapForActivity(session, AppState, serviceRef.current);
    holdRef.current = hold;
    return () => {
      holdRef.current = null;
      hold.release();
    };
  }, [session, active]);
  useEffect(() => {
    holdRef.current?.update(serviceRunning);
  }, [serviceRunning]);
}

/**
 * Holds the strap link while the calling screen is shown and the app is in the foreground. A
 * phone left on this screen in a pocket must not keep reconnecting; a workout holds its own.
 */
export function useStrapHold(reason: StrapHold) {
  const session = useContext(Context);
  useEffect(() => {
    if (!session) return;
    session.hold(reason, AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', (state) =>
      session.hold(reason, state === 'active'),
    );
    return () => {
      listener.remove();
      session.hold(reason, false);
    };
  }, [session, reason]);
}
