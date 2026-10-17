import { plural } from '@trainingai/shared/format/plural';
import {
  AppText,
  Card,
  Grid,
  BarChart,
  MarkdownText,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { WorkoutLayout } from '../../workouts/components/WorkoutLayout';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { digestSpec, monthWindowSpec, metricValue } from '../data/models';
import { HealthViewReady } from '../components/HealthViewReady';
import { HealthMetricCard } from '../components/HealthMetricCard';
import { HealthResourceHeader } from '../components/HealthResourceHeader';
import { MuscleVolumeFigure } from '../components/MuscleVolumeFigure';
import { useCueColor } from '../components/RangeBar';
import {
  fixedValue,
  weekDelta,
  weekdayInitial,
  weekMuscleRows,
  weekRangeLabel,
} from '../data/week-view';
export function HealthWeekScreen({ week, onBack }: { week: string; onBack: () => void }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(digestSpec(week));
  const m = state.data?.metrics;
  const cueColor = useCueColor();
  return (
    <WorkoutLayout
      title="Week in review"
      onBack={onBack}
      backLabel="Back to Health"
      actions={
        <StatusIndicator
          label="Weekly review"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      }
    >
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        {m ? weekRangeLabel(m.weekStart, m.weekEnd) : weekRangeLabel(week, undefined)}
      </AppText>
      <HealthViewReady view="week" requests={[digestSpec(week), monthWindowSpec(week)]}>
        {state.data?.digest && (
          <Card>
            <AppText variant="eyebrow" tone="brand">
              Your week
            </AppText>
            <MarkdownText>{state.data.digest}</MarkdownText>
          </Card>
        )}
        {m && (
          <>
            <Card>
              <AppText variant="heading">Training</AppText>
              <AppText variant="title">{metricValue(m.training.volumeKg, 'kg')}</AppText>
              <AppText variant="caption" tone="muted">
                Over {plural(m.training.sessions, 'session', 'sessions')}
              </AppText>
              <AppText variant="micro" tone="muted">
                {m.training.volumeChangePct == null
                  ? 'First week of data — nothing to compare it against yet'
                  : `${m.training.volumeChangePct >= 0 ? '+' : ''}${Math.round(m.training.volumeChangePct)}% on ${metricValue(m.training.priorVolumeKg, 'kg')} (${plural(m.training.priorSessions ?? 0, 'session', 'sessions')})`}
              </AppText>
              <BarChart
                label="Weekly training volume"
                height={theme.sizes.weekVolumeChart}
                readable
                yAxis
                bars={m.training.byDay.map((d) => ({
                  label: weekdayInitial(d.date),
                  value: d.volumeKg,
                  colors: [theme.colors.brand],
                }))}
              />
            </Card>
            <AppText variant="heading">Recovery</AppText>
            <Grid columns={2}>
              {(
                ['readiness', 'sleepScore', 'sleepHours', 'hrv', 'stressHighMinutes'] as const
              ).map((key) => {
                const metric = m[key];
                const unit =
                  key === 'sleepHours'
                    ? 'h'
                    : key === 'hrv'
                      ? 'ms'
                      : key === 'stressHighMinutes'
                        ? 'min'
                        : '';
                const decimals = key === 'sleepHours' ? 1 : 0;
                const delta = weekDelta(metric.week, metric.priorWeek, {
                  unit,
                  decimals,
                  higherIsBetter: key !== 'stressHighMinutes',
                });
                return (
                  <HealthMetricCard
                    key={key}
                    compactChart
                    title={
                      {
                        readiness: 'Readiness',
                        sleepScore: 'Sleep score',
                        sleepHours: 'Sleep',
                        hrv: 'HRV',
                        stressHighMinutes: 'High stress',
                      }[key]
                    }
                    value={metric.week}
                    unit={unit}
                    valueText={fixedValue(metric.week, decimals)}
                    points={metric.byDay.map((d) => ({ label: d.date, value: d.value }))}
                    chart={{ color: theme.colors.brand, dots: 'isolated' }}
                  >
                    <AppText
                      variant="caption"
                      tone={delta.cue === 'good' || delta.cue === 'bad' ? undefined : 'muted'}
                      style={
                        delta.cue === 'good' || delta.cue === 'bad'
                          ? { color: cueColor(delta.cue) }
                          : undefined
                      }
                    >
                      {delta.text}
                    </AppText>
                    {key === 'hrv' && metric.source === 'body-metrics' && (
                      <AppText variant="micro" tone="muted">
                        From daytime readings
                      </AppText>
                    )}
                  </HealthMetricCard>
                );
              })}
            </Grid>
            {!!m.prs.length && (
              <Card>
                <AppText variant="heading">Personal records</AppText>
                {m.prs.map((pr) => (
                  <Stack key={pr.exerciseName} direction="row" justify="space-between">
                    <AppText variant="caption" style={{ flex: 1 }}>
                      {pr.exerciseName}
                    </AppText>
                    <AppText variant="micro" tone="muted">
                      {pr.description}
                    </AppText>
                  </Stack>
                ))}
              </Card>
            )}
            {!!m.muscleSets.length && (
              <Card>
                <AppText variant="heading">Muscle volume this week</AppText>
                <MuscleVolumeFigure muscles={weekMuscleRows(m.muscleSets)} />
              </Card>
            )}
            <WeekTrends week={m.weekStart} />
          </>
        )}
      </HealthViewReady>
    </WorkoutLayout>
  );
}
function WeekTrends({ week }: { week: string }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(monthWindowSpec(week));
  const data = state.data;
  return (
    <>
      <HealthResourceHeader
        title="Against the last four weeks"
        state={state}
        refresh={state.refresh}
      />
      {data &&
        (['restingHeartRate', 'steps', 'sessionVolumeKg', 'weightKg'] as const).flatMap(
          (key) => {
            const current = data.weeks.at(-1)?.[key];
            const baseline = data.priorAverages[key];
            if (current == null && !data.weeks.some((w) => w[key] != null)) {
              return [];
            }
            const difference = current != null && baseline != null ? current - baseline : null;
            const unit = key === 'restingHeartRate' ? 'bpm' : key === 'steps' ? '' : 'kg';
            return [
              <HealthMetricCard
                key={key}
                title={
                  {
                    restingHeartRate: 'Resting heart rate',
                    steps: 'Steps',
                    sessionVolumeKg: 'Session volume',
                    weightKg: 'Weight',
                  }[key]
                }
                value={current}
                unit={unit}
                decimals={key === 'weightKg' ? 1 : 0}
                caption={
                  difference == null
                    ? 'No comparison available'
                    : Math.abs(difference) < 0.05
                      ? 'Level with the last 4 weeks'
                      : `${metricValue(Math.abs(difference), unit, key === 'weightKg' ? 1 : 0)} ${difference > 0 ? 'above' : 'below'} the last 4 weeks`
                }
                points={data.weeks.map((w) => ({ label: w.weekStart, value: w[key] }))}
                chart={{ color: theme.colors.brand, dots: 'isolated' }}
              />,
            ];
          },
        )}
    </>
  );
}
