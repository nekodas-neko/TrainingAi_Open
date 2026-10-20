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
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { bleAdapter } from '../../../integrations/ble/platform';
import { ScaleOutbox } from './ScaleOutbox';
import { ScaleSession, type ScaleHold } from './ScaleSession';
import { scaleWritePaths } from './data';

const Context = createContext<ScaleSession | null>(null);

/** The body-composition scale, connected while the Devices screen is open (#2844). */
export function ScaleProvider({ children }: PropsWithChildren) {
  const storage = useLocalStorage();
  const connection = useAccountContext().dataReader;
  const resources = useWorkoutResources();
  const [session] = useState(
    () => new ScaleSession({ ble: bleAdapter, storage: storage.device() }),
  );
  useEffect(() => {
    void session.initialize();
    return () => session.dispose();
  }, [session]);
  const outbox = useMemo(
    () =>
      connection
        ? new ScaleOutbox(
            storage.account(connection.origin, connection.userId),
            connection,
            (outcome) => {
              session.applyOutcome(outcome);
              // A filed weigh-in changes the weight, the trend and what is derived from them.
              if (outcome.kind === 'verdict') {
                resources?.invalidate(scaleWritePaths);
                void resources?.refreshVisible();
              }
            },
          )
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
    // A weigh-in taken offline is filed once the signal returns.
    const retry = setInterval(() => {
      if (AppState.currentState === 'active') session.sync();
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(retry);
    };
  }, [session, outbox]);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function useScale() {
  const session = useContext(Context);
  if (!session) throw new Error('ScaleProvider is required.');
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { state, session };
}

/**
 * Holds the scale link while the calling screen is shown and the app is in the foreground. A phone
 * left on this screen in a pocket must not keep scanning.
 */
export function useScaleHold(reason: ScaleHold) {
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
