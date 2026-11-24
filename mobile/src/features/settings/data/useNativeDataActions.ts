import { useSyncExternalStore } from 'react';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { useHome } from '../../home/data/HomeProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useWorkoutJournal } from '../../workouts/logging/WorkoutJournalProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useWorkoutResources, useTrainingSync } from '../../workouts/data/WorkoutDataProvider';
import { useAppleImport } from '../../health/HealthProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useAccountContext } from '../../account/AccountProvider';
import { refreshAccountViews } from './refreshAccountViews';
import { useActivities } from '../../activities/data/ActivityProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { useHistoryDownload } from './HistoryDownloadProvider';
import { useStrapSession } from '../../devices/strap/StrapProvider';
import { useScaleSession } from '../../devices/scale/ScaleProvider';
import { deviceUploadsWaiting, useQueued } from './device-uploads';
import { deviceHealthName } from '../../../integrations/device-health/platform';
import { runSyncNow } from './sync-now-steps';
import { syncNowShared } from './sync-now-state';
export function useNativeDataActions() {
  const health = useHealthData(),
    home = useHome(),
    nutrition = useNutrition(),
    journal = useWorkoutJournal(),
    training = useTrainingSync(),
    imported = useAppleImport();
  const workouts = useWorkoutContext(),
    resources = useWorkoutResources(),
    storage = useLocalStorage(),
    account = useAccountContext();
  const { busy, error, message } = useSyncExternalStore(
    syncNowShared.subscribe,
    syncNowShared.getSnapshot,
    syncNowShared.getSnapshot,
  );
  const activities = useActivities(),
    history = useHistoryQueue(),
    download = useHistoryDownload().download;
  const strap = useStrapSession(),
    scale = useScaleSession();
  const strapSamples = useQueued(strap),
    scaleReadings = useQueued(scale);
  const pending =
    health.operations.length +
    home.operations.length +
    nutrition.operations.length +
    nutrition.http.length +
    training.operations.length +
    journal.data.workouts.reduce((sum, row) => sum + row.pending.length, 0) +
    imported.pending +
    activities.pending +
    history.operations.length +
    deviceUploadsWaiting({ strapSamples, scaleReadings });
  async function sync(restore = false) {
    if (!resources) {
      return;
    }
    // Live reads, never this render's copies: the run outlives the render that started it.
    await syncNowShared.run((board) =>
      runSyncNow(
        board,
        {
          health: health.store,
          home: home.store,
          nutrition: nutrition.store,
          training: training.store,
          journal: journal.controller,
          imported,
          activities: activities.store,
          history: history.queue,
          strap,
          scale,
          download,
          today: health.today,
          deviceHealthName,
          refreshWorkouts: workouts.refresh,
          refreshAccountViews: (restoring) => refreshAccountViews(resources, restoring),
        },
        restore,
      ),
    );
  }
  async function clearAccount() {
    const connection = account.dataReader;
    if (!connection) {
      return;
    }
    health.store?.cancel();
    home.store?.cancel();
    nutrition.store?.cancel();
    training.store?.cancel();
    journal.controller?.cancel();
    imported.store?.cancel();
    activities.store?.cancel();
    history.queue?.cancel();
    download?.stop();
    resources?.cancel();
    await storage.clearAccount(connection.origin, connection.userId);
  }
  return { pending, busy, error, message, sync, clearAccount };
}
