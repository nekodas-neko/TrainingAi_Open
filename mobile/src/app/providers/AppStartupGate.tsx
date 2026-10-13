import { useEffect, useState, type PropsWithChildren } from 'react';
import { useAccountContext } from '../../features/account/AccountProvider';
import { useWorkoutContext } from '../../features/workouts/WorkoutProvider';
import { useWorkoutJournal } from '../../features/workouts/logging/WorkoutJournalProvider';
import { StartupScreen } from './LocalStorageProvider';

export function AppStartupGate({ children }: PropsWithChildren) {
  const account = useAccountContext();
  const workout = useWorkoutContext();
  const journal = useWorkoutJournal();
  const [opened, setOpened] = useState(false);
  const ready =
    account.state.status !== 'loading' &&
    (!workout.signedIn ||
      (workout.cacheReady &&
        (!journal.controller || journal.ready || journal.message !== null)));
  useEffect(() => {
    if (ready) {
      setOpened(true);
    }
  }, [ready]);
  return opened || ready ? children : <StartupScreen error={null} />;
}
