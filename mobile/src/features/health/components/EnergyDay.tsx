import { useRecordedIntake } from '../../nutrition/data/useRecordedIntake';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { dateStrMidnightInTz, formatMinutesOfDay } from '@trainingai/shared/date-utils';
import Svg, { Rect, Polyline } from 'react-native-svg';
import type { z } from 'zod';
import { AppText, Card, Grid, KeyValueGrid, MetricTile, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { energySpec, foodTimelineSpec, hrProfileSpec, metricValue } from '../data/models';
import { buildEnergyTimeline } from '../data/energy-timeline';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { HealthResourceHeader } from './HealthResourceHeader';
type Energy = z.infer<ReturnType<typeof energySpec>['schema']>;
export function EnergyDay({
  date,
  energy,
  hr,
}: {
  date: string;
  energy: Energy | null;
  hr: { minute: number; bpm: number }[];
}) {
  const { timezone } = useHealthData();
  const { theme } = useTheme();
  const food = useWorkoutResource(foodTimelineSpec(date));
  const profile = useWorkoutResource(hrProfileSpec);
  const savedBalance = energy?.balance;
  const resolved = useRecordedIntake(date, savedBalance);
  const nutrition = useNutrition(date);
  const balance = savedBalance
    ? { ...savedBalance, intakeKcal: resolved.intake, netKcal: resolved.net }
    : null;
  const active = energy?.activeBreakdown;
  if (
    !balance ||
    !active ||
    balance.intakeKcal == null ||
    balance.expenditureKcal == null ||
    balance.netKcal == null ||
    balance.restingBaseKcal == null ||
    balance.activeKcal == null ||
    (balance.intakeKcal <= 0 &&
      active.workoutKcal + active.activityKcal + active.stepsKcal <= 0)
  ) {
    return null;
  }
  const timeline = buildEnergyTimeline({
    dayStartMs: dateStrMidnightInTz(date, timezone).getTime(),
    restingHr: profile.data?.restingHr ?? Infinity,
    restingBaseKcal: balance.restingBaseKcal,
    activeKcal: balance.activeKcal,
    hr,
    intake: (nutrition.loaded.includes('logs:' + date)
      ? nutrition.view.logs
      : (food.data ?? [])
    ).map((f) => ({ atMs: Date.parse(f.loggedAt), kcal: f.calories })),
  });
  const peak = Math.max(timeline.totals.intakeKcal, timeline.totals.burnKcal, 1);
  const barPeak = Math.max(...timeline.buckets.map((b) => b.intakeKcal), 1);
  const x = (i: number) => (i / (timeline.buckets.length - 1)) * 320;
  const y = (kcal: number) => 90 - (kcal / peak) * 90;
  return (
    <>
      <AppText variant="eyebrow" tone="muted">
        Energy
      </AppText>
      <Card>
        <Grid columns={3}>
          <MetricTile label="Eaten" value={metricValue(balance.intakeKcal, 'kcal')} />
          <MetricTile label="Burned" value={metricValue(balance.expenditureKcal, 'kcal')} />
          <MetricTile
            label={balance.netKcal > 0 ? 'Surplus' : 'Deficit'}
            value={`${balance.netKcal > 0 ? '+' : balance.netKcal < 0 ? '−' : ''}${metricValue(Math.abs(balance.netKcal), 'kcal')}`}
          />
        </Grid>
        <KeyValueGrid
          rows={[
            { label: 'Workouts', value: metricValue(active.workoutKcal, 'kcal') },
            { label: 'Activity', value: metricValue(active.activityKcal, 'kcal') },
            { label: 'Steps', value: metricValue(active.stepsKcal, 'kcal') },
            { label: 'Resting', value: metricValue(balance.restingBaseKcal, 'kcal') },
          ]}
        />
      </Card>
      <Card>
        <HealthResourceHeader
          title="Energy across the day"
          state={food}
          refresh={food.refresh}
        />
        {food.data !== null && (
          <>
            <Svg
              viewBox="0 0 320 90"
              width="100%"
              height={theme.sizes.chartHeight}
              accessibilityLabel="Recorded eating events and estimated expenditure timing"
            >
              {timeline.buckets.map((b, i) =>
                b.intakeKcal > 0 ? (
                  <Rect
                    key={i}
                    x={x(i) - 5}
                    y={90 - (b.intakeKcal / barPeak) * 40}
                    width={10}
                    height={(b.intakeKcal / barPeak) * 40}
                    fill={theme.tones.activity.foreground}
                    opacity={0.5}
                  />
                ) : null,
              )}
              <Polyline
                points={timeline.buckets.map((b, i) => `${x(i)},${y(b.burnCumKcal)}`).join(' ')}
                stroke={theme.tones.nutrition.foreground}
                strokeWidth={2}
                fill="none"
              />
              <Polyline
                points={timeline.buckets
                  .map((b, i) => `${x(i)},${y(b.intakeCumKcal)}`)
                  .join(' ')}
                stroke={theme.tones.activity.foreground}
                strokeWidth={2}
                fill="none"
              />
            </Svg>
            <Stack direction="row" justify="space-between">
              {[0, 360, 720, 1080, 1440].map((minute) => (
                <AppText key={minute} variant="micro" tone="muted">
                  {formatMinutesOfDay(minute)}
                </AppText>
              ))}
            </Stack>
            {/* #2863. The counted intake, the tile's figure above. `timeline.totals.intakeKcal` is the
                logged food the curve is drawn from, so printing it said 600 under a tile saying 1,250. */}
            <AppText variant="micro" style={{ color: theme.tones.activity.foreground }}>
              Eaten {metricValue(balance.intakeKcal, 'kcal')}
            </AppText>
            <AppText variant="micro" style={{ color: theme.tones.nutrition.foreground }}>
              Burned {metricValue(timeline.totals.burnKcal, 'kcal')}
            </AppText>
          </>
        )}
        <AppText variant="micro" tone="muted">
          Totals are the day’s figures; the shape comes from heart rate, so treat the timing as
          an estimate. No heart-rate data for {timeline.hrGapBuckets} hours.
        </AppText>
      </Card>
    </>
  );
}
