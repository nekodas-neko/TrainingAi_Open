import { heartHealthRescore } from '@trainingai/shared/running/heart-health';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAccountContext } from '../../account/AccountProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { healthReadPaths } from '../../../core/sync/health-invalidation';
import { ActivityStore, emptyActivity } from './ActivityStore';
import { activityHistorySpec } from '../../health/data/models';
import type { HealthActivity } from '../../health/components/ActivityDetails';

const Context = createContext<ActivityStore | null>(null);
const noSubscribe = () => () => {};
export function ActivityProvider({ children }: PropsWithChildren) {
  const { dataReader } = useAccountContext();
  const storage = useLocalStorage(),
    resources = useWorkoutResources(),
    workouts = useWorkoutContext();
  const store = useMemo(
    () =>
      dataReader
        ? new ActivityStore(
            storage.account(dataReader.origin, dataReader.userId),
            dataReader,
            randomUUID,
            () => {
              resources?.invalidate([
                ...healthReadPaths,
                '/api/day-log',
                '/api/calendar-data',
                '/api/cardio-week',
                '/api/cardio-trends',
                '/api/running-plan',
                '/api/fitness-tests',
                '/api/running-bests',
                '/api/running-plan/run-type-stats',
                '/api/guided-walk/segment-stats',
              ]);
              void resources?.refreshVisible();
              workouts.invalidate();
            },
          )
        : null,
    [dataReader, storage, resources, workouts.invalidate],
  );
  return <ActivityStateProvider store={store}>{children}</ActivityStateProvider>;
}
export function ActivityStateProvider({
  store,
  children,
}: PropsWithChildren<{ store: ActivityStore | null }>) {
  useEffect(() => {
    void store?.initialize();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void store?.sync();
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        void store?.sync();
      }
    }, 60_000);
    return () => {
      listener.remove();
      clearInterval(timer);
      store?.cancel();
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useActivities() {
  const store = useContext(Context);
  const state = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => emptyActivity),
    () => emptyActivity,
  );
  return {
    ...state,
    store,
    pending:
      state.rows.filter((row) => row.pending).length +
      state.tests.filter((row) => row.pending).length +
      state.runs.filter((row) => row.pending).length,
  };
}
export function useActivityLogs(remote: HealthActivity[], from: string, to: string) {
  const activity = useActivities(),
    history = useHistoryQueue();
  const deleted = new Set(
    history.operations
      .filter((op) => op.domain === 'activity_logs')
      .map((op) => String(op.payload.id)),
  );
  const ids = [
    ...remote
      .filter((row) => {
        const saved = activity.rows.find((item) => !item.pending && item.payload.id === row.id);
        return (
          !saved ||
          Object.entries(saved.payload).every(
            ([key, value]) =>
              value === undefined ||
              (key === 'date'
                ? row.date.replace(/\//g, '-') === value
                : JSON.stringify(row[key]) === JSON.stringify(value)),
          )
        );
      })
      .map((row) => row.id),
    ...deleted,
  ]
    .sort()
    .join(',');
  useEffect(() => {
    void activity.store?.reconcile(ids.split(',')).catch(() => {});
  }, [activity.store, ids]);
  const rows = new Map(remote.map((row) => [row.id, row]));
  for (const row of activity.rows) {
    if (
      row.payload.date < from ||
      row.payload.date > to ||
      (!row.pending && ids.split(',').includes(row.payload.id))
    ) {
      continue;
    }
    const p = row.payload;
    rows.set(
      p.id,
      activityHistorySpec.schema.shape.activityLogs.element.parse({
        ...p,
        title: p.title,
        distanceKm: p.distanceKm ?? null,
        durationMin: p.durationMin ?? null,
        caloriesBurned: null,
        source: 'manual',
      }),
    );
  }
  return [...rows.values()]
    .filter((row) => !deleted.has(row.id))
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? ''),
    );
}

export function useMeasuredRunCompletion(
  days:
    | {
        date: string;
        runId: string;
        status: string;
        targetMin?: number | null;
        countedMin: number;
        met: boolean;
        creditedId: string | null;
        activities: {
          id: string;
          title: string;
          activityType: string;
          durationMin: number | null;
          effortMin: number | null;
        }[];
      }[]
    | undefined,
) {
  const activity = useActivities(),
    asked = useRef(new Set<string>());
  useEffect(() => {
    if (!activity.ready || !days) {
      return;
    }
    for (const day of days) {
      const result = heartHealthRescore(
        { status: day.status },
        {
          targetMin: day.targetMin ?? null,
          countedMin: day.countedMin,
          met: day.met,
          credited: day.activities.find((row) => row.id === day.creditedId) ?? null,
        },
      );
      if (result.action !== 'complete' || asked.current.has(day.runId)) {
        continue;
      }
      asked.current.add(day.runId);
      void activity
        .store!.completeRun(day.date, {
          id: day.runId,
          status: 'completed',
          activityLogId: result.activityLogId,
          completedAs: result.completedAs,
        })
        .catch(() => asked.current.delete(day.runId));
    }
  }, [activity.ready, activity.store, days]);
}
