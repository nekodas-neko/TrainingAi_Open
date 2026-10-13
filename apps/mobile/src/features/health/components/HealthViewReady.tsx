import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from 'react';
import { shiftDateStr } from '@trainingai/shared/date-utils';
import { Card, Skeleton, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { calendarSpec, injurySpec, strengthSpec, weeklySpec } from '../../workouts/data/models';
import type { ResourceSpec } from '../../workouts/data/WorkoutResources';
import { useHealthData } from '../data/HealthDataProvider';
import {
  goalsSpec,
  profileSpec,
  progressSpec,
  readinessSpec,
  energySpec,
  loadSpec,
  recoverySpec,
  hrSpec,
  stressSpec,
  healthDaySpec,
  zoneSpec,
  sleepCorrelationSpec,
  trendsSpec,
  hrProfileSpec,
  overviewSpec,
  muscleSetsSpec,
  movementSpec,
  activityHistorySpec,
  correlationSpec,
  weightsSpec,
  doseVitalsSpec,
} from '../data/models';

type HealthView =
  | 'body'
  | 'training'
  | 'progress'
  | 'sleep'
  | 'readiness'
  | 'activity'
  | 'heart-rate'
  | 'day'
  | 'week'
  | 'clinical';
const noSubscribe = () => () => {};
export function HealthViewReady({
  view,
  requests,
  children,
}: PropsWithChildren<{
  view: HealthView;
  requests?: readonly ResourceSpec<unknown>[];
}>) {
  const health = useHealthData();
  const resources = useWorkoutResources();
  const { theme } = useTheme();
  const [opened, setOpened] = useState(false);
  const specs = useMemo<readonly ResourceSpec<unknown>[]>(() => {
    if (requests) {
      return requests;
    }
    const today = health.today;
    switch (view) {
      case 'body':
        return [
          goalsSpec,
          profileSpec,
          progressSpec,
          readinessSpec(today),
          energySpec(today),
          loadSpec,
          injurySpec,
          recoverySpec,
          hrSpec(today),
          zoneSpec(shiftDateStr(today, -6), today),
          sleepCorrelationSpec,
          trendsSpec(today),
        ];
      case 'training': {
        const [year, month] = today.split('-').map(Number);
        return [
          calendarSpec(year, month),
          weeklySpec,
          overviewSpec,
          muscleSetsSpec,
          movementSpec(shiftDateStr(today, -59), today),
          activityHistorySpec,
          trendsSpec(today),
        ];
      }
      case 'progress':
        return [
          strengthSpec,
          correlationSpec('subjective-recovery'),
          weightsSpec,
          goalsSpec,
          progressSpec,
          energySpec(today),
        ];
      case 'heart-rate':
        return [
          readinessSpec(today),
          trendsSpec(today),
          hrProfileSpec,
          hrSpec(today),
          stressSpec(today),
          healthDaySpec(today),
        ];
      case 'readiness':
        return [readinessSpec(today), trendsSpec(today), doseVitalsSpec];
      default:
        return [readinessSpec(today), trendsSpec(today)];
    }
  }, [
    view,
    health.today,
    JSON.stringify(requests?.map((spec) => [spec.path, spec.query, spec.partition])),
  ]);
  useEffect(() => {
    if (opened) {
      return;
    }
    for (const spec of specs) {
      void resources?.load(spec);
    }
  }, [resources, specs, opened]);
  const settled = useSyncExternalStore(
    resources?.subscribe ?? noSubscribe,
    () =>
      !resources ||
      specs.every((spec) => {
        const state = resources.state(spec);
        return state.data !== null || (!state.loading && state.error !== null);
      }),
    () => false,
  );
  const recordsReady =
    !['body', 'progress', 'sleep'].includes(view) ||
    !health.connected ||
    health.denied ||
    !!health.error ||
    (health.ready
      ? (view === 'sleep' || health.body !== null || !!health.bodyError) &&
        (view === 'progress' || health.hasSleepRecords || !!health.sleepError)
      : !!health.error);
  const ready = settled && recordsReady;
  useEffect(() => {
    if (ready) {
      setOpened(true);
    }
  }, [ready]);
  if (opened || ready) {
    return children;
  }
  return (
    <Stack
      gap="lg"
      accessibilityLabel={`Loading ${view} view`}
      accessibilityState={{ busy: true }}
    >
      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <Skeleton style={{ width: '45%', height: theme.typography.label.lineHeight }} />
          <Skeleton
            style={{
              height:
                index === 0 && view === 'body'
                  ? theme.sizes.chartHeight * 3
                  : theme.sizes.chartHeight,
            }}
          />
          <Skeleton style={{ width: '70%', height: theme.typography.caption.lineHeight }} />
        </Card>
      ))}
    </Stack>
  );
}
