import type { PropsWithChildren } from 'react';
import { WorkoutProvider } from '../../features/workouts/WorkoutProvider';
import { WorkoutJournalProvider } from '../../features/workouts/logging/WorkoutJournalProvider';
import { HealthProvider } from '../../features/health/HealthProvider';
import { ReportsProvider } from '../../development/diagnostics/ReportsProvider';
import { WorkoutDataProvider } from '../../features/workouts/data/WorkoutDataProvider';
import { HistoryQueueProvider } from '../../features/workouts/data/HistoryQueueProvider';
import { HealthDataProvider } from '../../features/health/data/HealthDataProvider';
import { NutritionProvider } from '../../features/nutrition/data/NutritionProvider';
import { HomeProvider } from '../../features/home/data/HomeProvider';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <WorkoutProvider>
      <WorkoutDataProvider>
        <HistoryQueueProvider>
          <WorkoutJournalProvider>
            <HealthProvider>
              <HealthDataProvider>
                <NutritionProvider>
                  <HomeProvider>
                    <ReportsProvider>{children}</ReportsProvider>
                  </HomeProvider>
                </NutritionProvider>
              </HealthDataProvider>
            </HealthProvider>
          </WorkoutJournalProvider>
        </HistoryQueueProvider>
      </WorkoutDataProvider>
    </WorkoutProvider>
  );
}
