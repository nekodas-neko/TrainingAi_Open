import { useEffect } from 'react';
import { startupTimings } from '../core/reporting/index.ts';
import { useHealthData } from '../features/health/data/HealthDataProvider';
import { useHomeState } from '../features/home/data/HomeProvider';
import { useWorkoutContext } from '../features/workouts/WorkoutProvider';
import { startupTabStates } from './startup-tab-states';

/** Start-up timings (#3774): the first screen, and when each main tab first has its data. */
export function StartupTimingMarks() {
  const home = useHomeState();
  const health = useHealthData();
  const workout = useWorkoutContext();
  useEffect(() => {
    startupTimings.mark('start', true);
  }, []);
  const tabs = startupTabStates({
    homeReady: home.ready,
    healthReady: health.ready,
    body: health.body !== null,
    sleep: health.hasSleepRecords,
    catalogReady: workout.cacheReady,
    catalog: workout.catalog !== null,
  });
  useEffect(() => {
    for (const tab of tabs) startupTimings.observe(tab.mark, tab.ready, tab.hasData);
  });
  return null;
}
