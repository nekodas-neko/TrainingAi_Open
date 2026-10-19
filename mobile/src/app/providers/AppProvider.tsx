import type { PropsWithChildren } from 'react';
import { WorkoutProvider } from '../../features/workouts/WorkoutProvider';
import { WorkoutJournalProvider } from '../../features/workouts/logging/WorkoutJournalProvider';
import { HealthProvider } from '../../features/health/HealthProvider';
import { ReportsProvider } from '../../development/diagnostics/ReportsProvider';
import { WorkoutDataProvider } from '../../features/workouts/data/WorkoutDataProvider';
import { HistoryQueueProvider } from '../../features/workouts/data/HistoryQueueProvider';
import { HealthDataProvider } from '../../features/health/data/HealthDataProvider';
import { NutritionProvider } from '../../features/nutrition/data/NutritionProvider';
import { HistoryDownloadProvider } from '../../features/settings/data/HistoryDownloadProvider';
import { ActivityProvider } from '../../features/activities/data/ActivityProvider';
import { HomeProvider } from '../../features/home/data/HomeProvider';
import { PlatformProvider } from '../../features/platform/PlatformProvider';
import { OuraHandoffProvider } from '../../features/health/OuraHandoffProvider';
import { StrapProvider } from '../../features/devices/strap/StrapProvider';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <WorkoutProvider>
      <WorkoutDataProvider>
        <HistoryQueueProvider>
          <WorkoutJournalProvider>
            <StrapProvider>
              <HealthProvider>
                <HealthDataProvider>
                  <NutritionProvider>
                    <HistoryDownloadProvider>
                      <HomeProvider>
                        <ActivityProvider>
                          <PlatformProvider>
                            <OuraHandoffProvider>
                              <ReportsProvider>{children}</ReportsProvider>
                            </OuraHandoffProvider>
                          </PlatformProvider>
                        </ActivityProvider>
                      </HomeProvider>
                    </HistoryDownloadProvider>
                  </NutritionProvider>
                </HealthDataProvider>
              </HealthProvider>
            </StrapProvider>
          </WorkoutJournalProvider>
        </HistoryQueueProvider>
      </WorkoutDataProvider>
    </WorkoutProvider>
  );
}
