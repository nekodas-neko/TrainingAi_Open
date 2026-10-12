import type { PropsWithChildren } from 'react';
import { WorkoutProvider } from '../../features/workouts/WorkoutProvider';
import { WorkoutJournalProvider } from '../../features/workouts/logging/WorkoutJournalProvider';
import { HealthProvider } from '../../features/health/HealthProvider';
import { ReportsProvider } from '../../development/diagnostics/ReportsProvider';
import { WorkoutDataProvider } from '../../features/workouts/data/WorkoutDataProvider';
import { HistoryQueueProvider } from '../../features/workouts/data/HistoryQueueProvider';
import { HealthDataProvider } from '../../features/health/data/HealthDataProvider';
import { NutritionProvider } from '../../features/nutrition/data/NutritionProvider';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <WorkoutProvider>
      <WorkoutDataProvider>
        <HistoryQueueProvider>
          <WorkoutJournalProvider>
            <HealthDataProvider>
              <NutritionProvider>
              <HealthProvider>
                <ReportsProvider>{children}</ReportsProvider>
              </HealthProvider>
              </NutritionProvider>
            </HealthDataProvider>
          </WorkoutJournalProvider>
        </HistoryQueueProvider>
      </WorkoutDataProvider>
    </WorkoutProvider>
  );
}
