import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
import { StrapSession, type StrapHold } from './StrapSession';

const Context = createContext<StrapSession | null>(null);

/** The chest strap, connected while a workout is active (#2844). */
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
            if (!session.getSnapshot().recording) resources?.invalidate(['/api/oura/hr-data']);
          })
        : null,
    [storage, connection, resources, session],
  );
  useEffect(() => {
    session.setOutbox(outbox);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void outbox?.sync();
    });
    return () => listener.remove();
  }, [session, outbox]);
  const workoutActive = journal.data.workouts.some((workout) => workout.status === 'active');
  useEffect(() => {
    session.hold('workout', workoutActive);
  }, [session, workoutActive]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function useStrap() {
  const session = useContext(Context);
  if (!session) throw new Error('StrapProvider is required.');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return { state, session };
}

/** Holds the strap link while the calling screen is shown. */
export function useStrapHold(reason: StrapHold) {
  const session = useContext(Context);
  useEffect(() => {
    if (!session) return;
    session.hold(reason, true);
    return () => session.hold(reason, false);
  }, [session, reason]);
}
