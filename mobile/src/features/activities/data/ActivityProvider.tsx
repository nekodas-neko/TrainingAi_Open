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
import { useActivityStrapHold, useStrapSession } from '../../devices/strap/StrapProvider';
import { speedTargetsFromHistory, walkHrTargets } from '@trainingai/shared/walking/walk-pacer';
import { walkPlan } from './guidance';
import { PaceTicker } from './walk-pace';
import { useWorkoutResource, useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutContext } from '../../workouts/WorkoutProvider';
import { useHistoryQueue } from '../../workouts/data/HistoryQueueProvider';
import { healthReadPaths } from '../../../core/sync/health-invalidation';
import { ActivityStore, elapsedMs, emptyActivity, sameActivityValue } from './ActivityStore';
import { activityHistorySpec, hrProfileSpec } from '../../health/data/models';
import { overlayCalories, walkSegmentStatsSpec } from './models';
import { failedItems, waitingCount } from './sync-health';
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
                '/api/streak-data',
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
  return (
    <Context.Provider value={store}>
      <ActivityStrapHold />
      {children}
    </Context.Provider>
  );
}
/** The chest strap is held, and its heart rate saved, from the activity's start to its end (#3527). */
function ActivityStrapHold() {
  const { session, store } = useActivities();
  const strap = useStrapSession();
  useActivityStrapHold(session?.mode === 'active');
  // A guided walk also streams the strap's accelerometer for live cadence, for the walk only
  // (#3525). It lives here, not on the screen, so leaving the screen does not lose readings.
  const startMs = session?.mode === 'active' && session.guidance?.kind === 'walk' ? session.startMs : null;
  // The pacer's fallback rungs (#3549). Speed is paced against the walker's own past blocks, heart
  // rate against a band off their max. Both stay off until they are known, and neither is fetched
  // unless a guided walk is running.
  const stats = useWorkoutResource(walkSegmentStatsSpec, startMs !== null).data;
  const hrProfile = useWorkoutResource(hrProfileSpec, startMs !== null).data;
  const speedTargets = useMemo(() => speedTargetsFromHistory(stats), [stats]);
  const hrTargets = useMemo(
    () =>
      hrProfile?.maxHr != null && hrProfile.restingHr != null
        ? walkHrTargets(hrProfile.maxHr, hrProfile.restingHr)
        : null,
    [hrProfile?.maxHr, hrProfile?.restingHr],
  );
  const targets = useRef({ speed: speedTargets, hr: hrTargets });
  targets.current = { speed: speedTargets, hr: hrTargets };
  useEffect(() => {
    store?.pace?.setTargets({ speed: speedTargets, hr: hrTargets });
  }, [store, startMs, speedTargets, hrTargets]);
  useEffect(() => {
    if (!strap || !store || startMs === null) return;
    const current = store.getSnapshot().session;
    const pace = current ? store.paceFor(current) : null;
    if (!pace || current?.guidance?.kind !== 'walk') return;
    const config = current.guidance.config;
    const segments = walkPlan(config).segments;
    pace.setTargets(targets.current);
    // One tick per wall-clock second, from its own timer (see `WalkPace.tick`).
    const ticker = new PaceTicker();
    const timer = setInterval(() => {
      const at = Date.now();
      const running = store.getSnapshot().session;
      const seconds = running ? elapsedMs(running, at) / 1000 : 0;
      const counted = ticker.step({
        pace,
        paused: running?.pauseStartMs != null,
        at,
        segment: segments.find((block) => seconds >= block.startSec && seconds < block.endSec),
        route: store.getSnapshot().route,
        treadmill: config.treadmill,
        strap: strap.getSnapshot(),
      });
      // The tally goes to the checkpoint, so a kill keeps this walk's adherence (#3549).
      if (counted) store.pacerUpdated();
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [strap, store, startMs]);
  // The pacer's own request for the accelerometer stream, given back while the walk is paused so
  // the strap and phone are not drained for readings nothing counts. A resume drops the old window
  // so the gap is not read as steps. The strap session counts holders, so the cadence readout on
  // the walk screen asks for the same stream without the two switching each other off.
  const paused = session?.pauseStartMs != null;
  useEffect(() => {
    if (!strap || !store || startMs === null || paused) return;
    const current = store.getSnapshot().session;
    const pace = current ? store.paceFor(current) : null;
    if (!pace || current?.guidance?.kind !== 'walk') return;
    pace.resetCadence();
    const release = strap.holdAccelerometer();
    const stop = strap.onAccelerometer((batch) => pace.onBatch(batch));
    return () => {
      stop();
      release();
    };
  }, [strap, store, startMs, paused]);
  return null;
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
    // A dead-lettered row is not waiting to upload; Sync health lists it apart.
    pending: waitingCount(state),
    failed: failedItems(state),
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
            ([key, value]) => value === undefined || sameActivityValue(key, row[key], value),
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
        caloriesBurned: overlayCalories(p, rows.get(p.id)),
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
