import { plural } from '@trainingai/shared/format/plural';
import { trendRowsFor, TREND_WEEK_TIME_DOMAIN } from '@trainingai/shared/nutrition/day-trends';
import { weekDelta } from '@trainingai/shared/health/week-delta';
import {
  AppText,
  Card,
  Grid,
  Icon,
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
import { TrendRowCard } from '../components/TrendRowCard';
import { WeekMetricTile } from '../components/WeekMetricTile';
import { MuscleVolumeFigure, muscleVolumeCaption } from '../components/MuscleVolumeFigure';
import {
  fixedValue,
  weekdayInitial,
  weekdayName,
  weekMuscleRows,
  weekRangeLabel,
} from '../data/week-view';
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
              <Stack direction="row" align="center" gap="xs">
                <Icon name="upper" size={theme.sizes.iconCompact} tone="brand" />
                <AppText variant="subheading">Training</AppText>
              </Stack>
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
                tickCount={4}
                bars={m.training.byDay.map((d) => ({
                  label: weekdayInitial(d.date),
                  accessibleLabel: weekdayName(d.date),
                  value: d.volumeKg,
                  colors: [theme.colors.brand],
                }))}
              />
            </Card>
            <AppText variant="subheading">Recovery</AppText>
            <Grid columns={2} gap="sm">
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
                        ? 'm'
                        : '';
                const decimals = key === 'sleepHours' ? 1 : 0;
                const delta = weekDelta(metric.week, metric.priorWeek, {
                  unit,
                  decimals,
                  higherIsBetter: key !== 'stressHighMinutes',
                });
                return (
                  <WeekMetricTile
                    key={key}
                    label={
                      {
                        readiness: 'Readiness',
                        sleepScore: 'Sleep score',
                        sleepHours: 'Sleep',
                        hrv: 'HRV',
                        stressHighMinutes: 'High stress',
                      }[key]
                    }
                    valueText={fixedValue(metric.week, decimals)}
                    unit={unit}
                    delta={delta.text}
                    deltaColor={
                      delta.cue === 'good'
                        ? theme.progress.trendUp
                        : delta.cue === 'bad'
                          ? theme.tones.checkin.foreground
                          : undefined
                    }
                    note={
                      key === 'hrv' && metric.source === 'body-metrics'
                        ? 'From daytime readings'
                        : undefined
                    }
                    days={metric.byDay}
                  />
                );
              })}
            </Grid>
            {!!m.prs.length && (
              <Card>
                <Stack direction="row" align="center" gap="xs">
                  <Icon name="trophy" size={theme.sizes.iconCompact} tone="brand" />
                  <AppText variant="subheading">Personal records</AppText>
                </Stack>
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
                <Stack direction="row" justify="space-between" align="baseline">
                  <AppText variant="heading" style={{ flex: 1 }}>
                    Muscle volume this week
                  </AppText>
                  <AppText variant="micro" tone="muted">
                    {muscleVolumeCaption(weekMuscleRows(m.muscleSets))}
                  </AppText>
                </Stack>
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
  const state = useWorkoutResource(monthWindowSpec(week));
  const data = state.data;
  // The same rows the day review draws, over five weekly points against the four weeks before.
  const rows = data ? trendRowsFor({ points: data.weeks, priorAverages: data.priorAverages }) : [];
  // The current app draws nothing when no stat has a reading; Preview keeps the heading only
  // while the request is open or failed, so that state can still be retried.
  if (data && rows.length === 0) return null;
  return (
    <Stack gap="sm">
      <Stack direction="row" justify="space-between" align="center">
        <AppText variant="caption" tone="muted" style={{ fontWeight: '600', flex: 1 }}>
          Against the last four weeks
        </AppText>
        <StatusIndicator
          label="Four-week comparison"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
      {rows.map((row) => (
        <TrendRowCard
          key={row.spec.key}
          row={row}
          timeDomain={TREND_WEEK_TIME_DOMAIN}
          comparison="the last 4 weeks"
          absentLabel="No reading this week"
        />
      ))}
    </Stack>
  );
}
