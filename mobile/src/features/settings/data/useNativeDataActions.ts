import { useState } from 'react';
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
import type { WorkoutResources } from '../../workouts/data/WorkoutResources';
import { importPermissionNote, importStatusError } from '../../health/data/device-import';
import { deviceHealthName } from '../../../integrations/device-health/platform';
import { syncNowRunner, type SyncBoard } from '../../../core/sync/deadline';
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
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [runSync] = useState(() => syncNowRunner({ setBusy, setError, setMessage }));
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
    await runSync((board) => run(board, resources, restore));
  }
  // Each step is bounded and named, so a store that never answers is given up on and said so.
  async function run(
    board: SyncBoard,
    resources: WorkoutResources,
    restore: boolean,
  ): Promise<string> {
    await Promise.all([
      board.step('Health', health.store && (() => health.store!.sync())),
      board.step('Home', home.store && (() => home.store!.sync())),
      board.step('Nutrition', nutrition.store && (() => nutrition.store!.sync())),
      board.step('Training', training.store && (() => training.store!.sync())),
      board.step('Workouts', journal.controller && (() => journal.controller!.sync())),
      // A sync never opens a system permission sheet: that is the Allow button's job (#3906).
      board.step('Health Connect', () => imported.refresh({ ask: false })),
      board.step('Activities', activities.store && (() => activities.store!.sync())),
      board.step('History edits', history.queue && (() => history.queue!.sync())),
    ]);
    // Counted above, so sent here too; each publishes its own count when its upload settles.
    strap?.sync();
    scale?.sync();
    await Promise.all([
      board.step('Health', async () => health.store?.refresh(true)),
      board.step('Home', async () => {
        await home.store?.refresh('preferences', health.today, true);
        await home.store?.refresh('mood', health.today, true);
      }),
    ]);
    if (restore) {
      await board.step('Nutrition', () =>
        Promise.all(
          (['mealTypes', 'foods', 'meals', 'supplements', 'targets', 'logs'] as const).map(
            (kind) => nutrition.store?.refresh(kind, health.today, true),
          ),
        ),
      );
    }
    workouts.refresh();
    await board.step('Account views', () => refreshAccountViews(resources, restore));
    board.fail('Health', health.store?.getSnapshot().error);
    board.fail('Home', home.store?.getSnapshot().error);
    board.fail('Nutrition', nutrition.store?.getSnapshot().error);
    board.fail(
      'Health Connect',
      imported.store ? importStatusError(imported.store.getSnapshot()) : null,
    );
    board.fail('Activities', activities.store?.getSnapshot().error);
    board.fail('History edits', history.queue?.getSnapshot().error);
    // #3906: switched on with no permission is a note on a finished sync, not a failed one.
    const note = imported.store
      ? importPermissionNote(imported.store.getSnapshot(), deviceHealthName)
      : null;
    return (
      (restore
        ? 'Account data refreshed. Your history is now saving to this phone for offline use.'
        : 'Sync finished. Any changes still waiting to upload remain saved on this phone.') +
      (note ? ` ${note}` : '')
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
