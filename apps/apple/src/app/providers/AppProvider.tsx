import type { PropsWithChildren } from 'react';
import { AccountProvider } from '../../features/account/AccountProvider';
import { WorkoutProvider } from '../../features/workouts/WorkoutProvider';
import { WorkoutJournalProvider } from '../../features/workouts/logging/WorkoutJournalProvider';
import { HealthProvider } from '../../features/health/HealthProvider';
import { ReportsProvider } from '../../development/diagnostics/ReportsProvider';
import { WorkoutDataProvider } from '../../features/workouts/data/WorkoutDataProvider';
import { HistoryQueueProvider } from '../../features/workouts/data/HistoryQueueProvider';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <AccountProvider>
      <WorkoutProvider>
        <WorkoutDataProvider>
          <HistoryQueueProvider>
            <WorkoutJournalProvider>
              <HealthProvider>
                <ReportsProvider>{children}</ReportsProvider>
              </HealthProvider>
            </WorkoutJournalProvider>
          </HistoryQueueProvider>
        </WorkoutDataProvider>
      </WorkoutProvider>
    </AccountProvider>
  );
}
