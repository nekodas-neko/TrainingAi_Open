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
export function HealthWeekScreen({ week, onBack }: { week: string; onBack: () => void }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(digestSpec(week));
  const m = state.data?.metrics;
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
        {m ? `${m.weekStart} → ${m.weekEnd}` : week}
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
                Over {m.training.sessions} sessions
              </AppText>
              <AppText variant="micro" tone="muted">
                {m.training.volumeChangePct == null
                  ? 'First week of data — nothing to compare it against yet'
                  : `${m.training.volumeChangePct >= 0 ? '+' : ''}${Math.round(m.training.volumeChangePct)}% on ${metricValue(m.training.priorVolumeKg, 'kg')} (${metricValue(m.training.priorSessions)} sessions)`}
              </AppText>
              <BarChart
                label="Weekly training volume"
                height={theme.sizes.weekVolumeChart}
                bars={m.training.byDay.map((d) => ({
                  label: new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, {
                    weekday: 'short',
                    timeZone: 'UTC',
                  }),
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
                const difference =
                  metric.week != null && metric.priorWeek != null
                    ? metric.week - metric.priorWeek
                    : null;
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
                    decimals={key === 'sleepHours' ? 1 : 0}
                    caption={
                      difference == null
                        ? 'No previous-week reading'
                        : `${difference > 0 ? '+' : ''}${metricValue(difference, unit, key === 'sleepHours' ? 1 : 0)} vs previous week${key === 'stressHighMinutes' ? ' · Lower is better' : ''}`
                    }
                    points={metric.byDay.map((d) => ({ label: d.date, value: d.value }))}
                  >
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
                {m.muscleSets.map((row) => (
                  <Stack key={row.muscle} direction="row" justify="space-between">
                    <AppText variant="caption">{row.muscle}</AppText>
                    <AppText variant="caption" tone="muted">
                      {row.sets} sets
                    </AppText>
                  </Stack>
                ))}
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
              />,
            ];
          },
        )}
    </>
  );
}
