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
  const activities = useActivities(),
    history = useHistoryQueue(),
    download = useHistoryDownload().download;
  const pending =
    health.operations.length +
    home.operations.length +
    nutrition.operations.length +
    nutrition.http.length +
    training.operations.length +
    journal.data.workouts.reduce((sum, row) => sum + row.pending.length, 0) +
    imported.pending +
    activities.pending +
    history.operations.length;
  async function sync(restore = false) {
    if (busy || !resources) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await Promise.all([
        health.store?.sync(),
        home.store?.sync(),
        nutrition.store?.sync(),
        training.store?.sync(),
        journal.controller?.sync(),
        imported.refresh(),
        activities.store?.sync(),
        history.queue?.sync(),
      ]);
      await Promise.all([
        health.store?.refresh(true),
        home.store?.refresh('preferences', health.today, true),
        home.store?.refresh('mood', health.today, true),
      ]);
      if (restore) {
        await Promise.all(
          (['mealTypes', 'foods', 'meals', 'supplements', 'targets', 'logs'] as const).map(
            (kind) => nutrition.store?.refresh(kind, health.today, true),
          ),
        );
      }
      workouts.refresh();
      await refreshAccountViews(resources, restore);
      const failure =
        health.store?.getSnapshot().error ??
        home.store?.getSnapshot().error ??
        nutrition.store?.getSnapshot().error ??
        imported.store?.getSnapshot().error ??
        activities.store?.getSnapshot().error ??
        history.queue?.getSnapshot().error;
      if (failure) {
        throw new Error(failure);
      }
      setMessage(
        restore
          ? 'Saved account data refreshed. Older history loads when you open it.'
          : 'Sync finished. Any changes still waiting to upload remain saved on this phone.',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not sync. Your saved records are kept.',
      );
    } finally {
      setBusy(false);
    }
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
