import { HealthResourceHeader } from './HealthResourceHeader';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import { AppText, Card, LineChart } from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { stressSpec } from '../data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';

export function StressDayCard({ date, enabled = true }: { date: string; enabled?: boolean }) {
  const { timezone, today } = useHealthData();
  const state = useWorkoutResource(stressSpec(date), enabled);
  const series = [...(state.data?.series ?? [])].sort((a, b) => a.t - b.t);
  const points = series.flatMap((point, index) => {
    const previous = series[index - 1];
    const value = {
      label: formatTimeOfDay(point.t, timezone),
      x: point.t,
      value: -point.level,
    };
    return previous && point.t - previous.t > 75 * 60_000
      ? [{ label: 'Not recorded', x: point.t - 1, value: null }, value]
      : [value];
  });
  if (!enabled || (state.data && !series.length)) {
    return null;
  }
  return (
    <Card>
      <HealthResourceHeader
        title={date === today ? 'When today ran stressed' : 'When the day ran stressed'}
        state={state}
        refresh={state.refresh}
      />

      {!!points.length && (
        <LineChart
          points={points}
          label={`Recorded stress, ${date}`}
          tone="heart"
          domain={[-1, 1]}
        />
      )}
      {!!points.length && (
        <AppText variant="caption" tone="muted">
          Higher means more stress. Gaps weren’t measured.
          {state.data?.throughMs != null
            ? ` Recorded through ${formatTimeOfDay(state.data.throughMs, timezone)}.`
            : ''}
        </AppText>
      )}
    </Card>
  );
}
