import { AppText, Disclosure, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatDuration } from '../../../shared/hooks/useClock';
import {
  aggregateHrRecoveryByExercise,
  formatRecoveryRate,
} from '@trainingai/shared/health/hr-recovery-by-exercise';
import { workoutHrSpec } from '../data/models';
import { exercisesWithoutRest, REST_NOT_MEASURED } from '../data/hr-rest';
import { ResourceCard } from './ResourceCard';
import type { WorkoutRecord } from '../logging/workout';

export function WorkoutHrRecovery({ workout }: { workout: WorkoutRecord }) {
  const { theme } = useTheme();
  return (
    <ResourceCard
      title="HR recovery"
      spec={workoutHrSpec(workout.id)}
      disabled={workout.pending.length > 0}
    >
      {(data) => {
        if (!data.ready) {
          return (
            <AppText variant="caption" tone="muted">
              Recorded HR is still being prepared. Try again shortly.
            </AppText>
          );
        }
        const origin = new Date(data.startedAt ?? workout.startedAt).getTime();
        const readings = data.readings
          .slice()
          .sort((x, y) => Date.parse(x.timestamp) - Date.parse(y.timestamp));
        const points = readings.flatMap((x, index) => {
          const at = Date.parse(x.timestamp);
          if (!Number.isFinite(at)) {
            return [];
          }
          const point = {
            label: `${formatDuration((at - origin) / 1000)} · bpm`,
            x: (at - origin) / 1000,
            value: x.bpm as number | null,
          };
          const previous = readings[index - 1];
          return previous && at - Date.parse(previous.timestamp) > 5000
            ? [{ ...point, value: null }, point]
            : [point];
        });
        const bands = data.setStats.flatMap((x) =>
          x.setStartMs === null || x.setEndMs === null
            ? []
            : [
                {
                  from: (x.setStartMs - origin) / 1000,
                  to: (x.setEndMs - origin) / 1000,
                  label: `${x.exerciseName}, set ${x.setNumber}`,
                  color: theme.colors.brand,
                },
              ],
        );
        return (
          <Stack>
            <AppText variant="caption" tone="muted">
              Recorded cardiovascular observations. They do not establish muscular
              readiness or when you should start.
            </AppText>
            <AppText variant="micro" tone="muted">
              Source: {data.summary?.source ?? 'not supplied'} ·{' '}
              {data.summary?.fromSnapshot
                ? 'saved summary; full trace unavailable'
                : `${readings.length} recorded readings`}
            </AppText>
            {data.summary && (
              <AppText variant="caption">
                Mean {data.summary.avgBpm ?? '—'} bpm · Peak {data.summary.peakBpm ?? '—'}{' '}
                bpm
                {data.workoutHrvMs == null
                  ? ''
                  : ` · Rest HRV ${Math.round(data.workoutHrvMs)} ms`}
              </AppText>
            )}
            {points.length > 0 ? (
              <LineChart
                label="Recorded workout heart rate"
                points={points}
                bands={bands}
                interactive
                tone="heart"
              />
            ) : (
              <AppText variant="caption" tone="muted">
                No recorded HR trace is available for this workout.
              </AppText>
            )}
            {aggregateHrRecoveryByExercise(data.setStats).map((x) => (
              <AppText key={x.exerciseName} variant="caption">
                {x.exerciseName} · {formatRecoveryRate(x.medianHrr1)} · {x.sampleCount}/
                {x.totalSets} sets measured
              </AppText>
            ))}
            {exercisesWithoutRest(data.setStats).map((name) => (
              <AppText key={name} variant="caption" tone="muted">
                {name} · {REST_NOT_MEASURED}
              </AppText>
            ))}
            {data.setStats.map((x, index) => (
              <Disclosure key={index} title={`${x.exerciseName} · set ${x.setNumber}`}>
                <AppText variant="caption">
                  Peak {x.peakBpm ?? '—'} bpm · End {x.bpmAtLog ?? '—'} bpm
                  {x.hrr1 === null ? '' : ` · HRR60 ${x.hrr1} bpm`}
                </AppText>
                {x.hrr1 === null && (
                  <AppText variant="micro" tone="muted">
                    {REST_NOT_MEASURED}
                  </AppText>
                )}
                <AppText variant="micro" tone="muted">
                  {x.setStartMs === null
                    ? 'Start time unavailable'
                    : `Start ${formatDuration((x.setStartMs - origin) / 1000)}`}{' '}
                  ·{' '}
                  {x.setEndMs === null
                    ? 'End time unavailable'
                    : `End ${formatDuration((x.setEndMs - origin) / 1000)}`}
                  . Set shading identifies effort, including superset partners. Gaps stay
                  disconnected.
                </AppText>
              </Disclosure>
            ))}
          </Stack>
        );
      }}
    </ResourceCard>
  );
}
