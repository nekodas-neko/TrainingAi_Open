import {
  balanceZone,
  barProgress,
  budgetProvenance,
} from '@trainingai/shared/nutrition/calorie-balance';
import { DEFAULT_WATER_GOAL_ML } from '@trainingai/shared/nutrition/goal-recommendation';
import { secondsSinceLocalMidnight } from '@trainingai/shared/date-utils';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import { trimLeadingGaps } from '@trainingai/shared/health/series-gaps';
import { weekOverWeekChange } from '@trainingai/shared/health/trend-delta';
import {
  AppButton,
  AppText,
  Card,
  Disclosure,
  GradientProgressBar,
  Grid,
  LineChart,
  MetricTile,
  ProgressBar,
  Stack,
  StableContent,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { balanceProvenance, budgetLine } from '../../nutrition/data/budget-line';
import { useRecordedIntake } from '../../nutrition/data/useRecordedIntake';
import { useHealthData } from '../data/HealthDataProvider';
import { energySpec, goalsSpec, trendsSpec } from '../data/models';
import { ouraStatsSpec, ringBatterySpec } from '../data/body-models';
import { waterGoalText, waterText, weekdayAxis, wornSeconds } from '../data/body-view';
import type { HealthDetail } from '../screens/HealthDetailScreen';
import { HealthMetricCard } from './HealthMetricCard';
import { HealthResourceHeader } from './HealthResourceHeader';
import { useCueColor } from './RangeBar';

const signed = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString()}`;

/**
 * Energy Balance: kcal left today and the "Well under so far" style verdict, the budget bar, the
 * Eaten, Burned and Net tiles, the maintenance estimate and an explanation behind a toggle.
 */
export function EnergyBalanceCard() {
  const { today } = useHealthData();
  const energy = useWorkoutResource(energySpec(today));
  const balance = energy.data?.balance ?? null;
  const intake = useRecordedIntake(today, balance);
  const maintenance = energy.data?.maintenance ?? null;
  const budget = balance?.budgetKcal ?? null;
  const zone =
    intake.intake !== null && budget !== null
      ? balanceZone(Math.round(intake.intake) - Math.round(budget))
      : null;
  const provenance = balanceProvenance(balance);
  const bar =
    intake.intake !== null && budget !== null
      ? barProgress({ intakeKcal: intake.intake, budgetKcal: budget })
      : null;
  const remaining = intake.remaining;
  return (
    <Card>
      <HealthResourceHeader title="Energy Balance" state={energy} refresh={energy.refresh} />
      {balance ? (
        <>
          {remaining !== null && (
            <Stack gap="xxs">
              <AppText variant="title" style={{ fontVariant: ['tabular-nums'] }}>
                {Math.round(Math.abs(remaining)).toLocaleString()}{' '}
                <AppText variant="caption" tone="muted">
                  kcal {remaining < 0 ? 'over target' : 'left today'}
                </AppText>
              </AppText>
              {intake.zoneLabel && (
                <AppText
                  variant="label"
                  style={zone ? { color: zone.color } : undefined}
                  tone={zone ? undefined : 'muted'}
                >
                  {intake.zoneLabel} so far
                </AppText>
              )}
            </Stack>
          )}
          {bar && (
            <GradientProgressBar
              value={bar.fillPct}
              notch={bar.notchPct}
              stops={bar.stops}
              label="Calories toward the daily budget"
            />
          )}
          <Grid columns={3} gap="sm">
            <MetricTile
              compact
              label="Eaten"
              value={intake.intake === null ? null : Math.round(intake.intake).toLocaleString()}
            />
            <MetricTile
              compact
              label="Burned"
              value={
                balance.expenditureKcal == null
                  ? null
                  : Math.round(balance.expenditureKcal).toLocaleString()
              }
            />
            <MetricTile
              compact
              label="Net"
              value={intake.net === null ? null : signed(intake.net)}
            />
          </Grid>
          {maintenance && (
            <AppText variant="caption" tone="muted">
              {maintenance.source === 'calibrated'
                ? `Your measured maintenance is ${Math.round(maintenance.kcal).toLocaleString()} kcal (${maintenance.confidence} confidence, ${maintenance.daysLogged} of ${maintenance.daysInWindow} days logged)${
                    maintenance.weightRateKgPerWeek != null && maintenance.weightRateKgPerWeek !== 0
                      ? ` — trending ${maintenance.weightRateKgPerWeek > 0 ? '+' : ''}${maintenance.weightRateKgPerWeek} kg/week`
                      : ''
                  }.`
                : `Estimated maintenance ${Math.round(maintenance.kcal).toLocaleString()} kcal — ${maintenance.gapMessage ?? 'the profile-based estimate is used until there is enough logged history'}.`}
            </AppText>
          )}
          <Disclosure title="How your energy balance is calculated">
            <AppText variant="caption" tone="muted">
              Calories out = your resting burn (
              {Math.round(balance.restingBaseKcal ?? 0).toLocaleString()} kcal) plus measured
              movement ({Math.round(balance.activeKcal ?? 0).toLocaleString()} kcal from workouts,
              activities and every step you take). Your resting burn already has habitual daily
              movement taken out of it, so the movement you record is added once, not counted twice.
            </AppText>
            {provenance && (
              <AppText variant="caption" tone="muted">
                {budgetLine(provenance, balance)}.
              </AppText>
            )}
            <AppText variant="caption" tone="muted">
              “On target” means within 150 kcal of the day’s budget.
            </AppText>
          </Disclosure>
        </>
      ) : (
        energy.data && (
          <AppText variant="caption" tone="muted">
            {energy.data.missingProfileFields.length
              ? `Add your ${energy.data.missingProfileFields.join(', ')} in Profile to see calories in vs out.`
              : 'No energy budget available yet'}
          </AppText>
        )
      )}
    </Card>
  );
}

/** Water: today's amount in L or ml, the goal line, a progress bar and a Log control. */
export function WaterCard({
  waterMl,
  goalMl,
  onOpen,
  onLog,
}: {
  waterMl: number | null;
  goalMl: number | null;
  onOpen: () => void;
  onLog: () => void;
}) {
  const goal = goalMl ?? DEFAULT_WATER_GOAL_ML;
  return (
    <HealthMetricCard
      title="Water"
      valueText={waterText(waterMl) ?? '—'}
      tone="recovery"
      caption={waterGoalText(goal) ?? 'Today'}
      onOpen={onOpen}
      onLog={onLog}
    >
      {waterMl !== null && goal > 0 && <ProgressBar value={waterMl / goal} />}
    </HealthMetricCard>
  );
}

/**
 * The 14-day Protein, Steps and Water charts: weekday labels, value axis, gridlines, a goal line
 * where there is a goal, and the "vs last week" change.
 */
export function ActivityTrendCharts() {
  const { today } = useHealthData();
  const { theme } = useTheme();
  const cueColor = useCueColor();
  const state = useWorkoutResource(trendsSpec(today));
  const goals = useWorkoutResource(goalsSpec);
  const trends = state.data?.trends ?? [];
  const defs = [
    {
      key: 'proteinPerKg',
      title: 'Protein per kg Bodyweight',
      caption: 'g/kg',
      color: theme.anatomy.main,
      goal: null,
    },
    {
      key: 'steps',
      title: 'Steps',
      caption: '',
      color: theme.tones.activity.foreground,
      goal: goals.data?.stepsGoal ?? null,
    },
    {
      key: 'waterMl',
      title: 'Water',
      caption: 'ml',
      color: theme.tones.recovery.foreground,
      goal: goals.data?.waterGoalMl ?? null,
    },
  ] as const;
  return (
    <StableContent loading={state.data === null && state.loading}>
      {defs
        .filter((def) => trends.some((day) => day[def.key] !== null))
        .map((def) => {
          const shown = trimLeadingGaps(trends, (day) => day[def.key]) ?? [];
          const change = weekOverWeekChange(trends.map((day) => day[def.key]));
          return (
            <HealthMetricCard
              key={def.key}
              title={def.title}
              caption={`${def.caption ? `${def.caption} · ` : ''}last 14 days`}
              points={shown.map((day, index) => ({
                label: day.date,
                value: day[def.key],
                x: index,
              }))}
              chart={{
                readable: true,
                gridlines: true,
                yAxis: true,
                fill: true,
                dots: 'isolated',
                color: def.color,
                axisLabels: weekdayAxis(shown.map((day) => day.date)),
                target: def.goal ? { value: def.goal, label: 'Goal' } : undefined,
              }}
              status={
                <ResourceStatus
                  inline
                  label="Activity trends"
                  state={state}
                  refresh={state.refresh}
                />
              }
            >
              {change && (
                <AppText
                  variant="label"
                  tone={change.direction === 'same' ? 'muted' : undefined}
                  style={
                    change.direction === 'same'
                      ? undefined
                      : { color: cueColor(change.direction === 'up' ? 'good' : 'bad') }
                  }
                >
                  {change.text}
                </AppText>
              )}
            </HealthMetricCard>
          );
        })}
    </StableContent>
  );
}

/**
 * The Ring group: battery and time worn, the wear-time chart with its change since last week, and
 * the two contributors links. Shown only once the ring has produced data, as in the current app.
 */
export function RingCards({ openDetail }: { openDetail: (detail: HealthDetail) => void }) {
  const { today, timezone } = useHealthData();
  const { theme } = useTheme();
  const cueColor = useCueColor();
  const stats = useWorkoutResource(ouraStatsSpec(today));
  const battery = useWorkoutResource(ringBatterySpec);
  const trendsState = useWorkoutResource(trendsSpec(today));
  if (stats.error && !stats.data) {
    return (
      <Card>
        <AppText variant="caption" tone="muted">
          Couldn't load your ring data
        </AppText>
      </Card>
    );
  }
  if (!stats.data?.connected) return null;
  const level = battery.data?.latest?.percent ?? null;
  const worn = wornSeconds(
    stats.data.daily?.nonWearTimeSec ?? null,
    secondsSinceLocalMidnight(timezone),
  );
  const days = trendsState.data?.trends ?? [];
  const shown = trimLeadingGaps(days, (day) => day.wornHours) ?? [];
  const change = weekOverWeekChange(days.map((day) => day.wornHours));
  return (
    <>
      <AppText variant="groupTitle" tone="muted" accessibilityRole="header" style={{ marginTop: theme.spacing.sm }}>
        Ring
      </AppText>
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Ring Status
        </AppText>
        {(level !== null || worn !== null) && (
          <Grid columns={2} gap="sm">
            {level !== null && (
              <MetricTile
                compact
                label="Battery"
                value={`${Math.round(level)}%`}
                caption={battery.data?.latest?.charging ? 'Charging' : undefined}
                color={cueColor(level >= 60 ? 'good' : level >= 25 ? 'watch' : 'bad')}
              />
            )}
            {worn !== null && (
              <MetricTile
                compact
                label="Time Worn"
                value={formatHoursMinutes(worn / 60)}
                color={theme.colors.brandText}
              />
            )}
          </Grid>
        )}
        {shown.length > 0 ? (
          <Stack>
            <AppText variant="caption" tone="muted">
              Wear Time · h · last 14 days
            </AppText>
            <LineChart
              label="Wear time"
              points={shown.map((day, index) => ({
                label: day.date,
                value: day.wornHours,
                x: index,
              }))}
              readable
              gridlines
              yAxis
              fill
              dots="isolated"
              axisLabels={weekdayAxis(shown.map((day) => day.date))}
            />
            {change && (
              <AppText
                variant="label"
                tone={change.direction === 'same' ? 'muted' : undefined}
                style={
                  change.direction === 'same'
                    ? undefined
                    : { color: cueColor(change.direction === 'up' ? 'good' : 'bad') }
                }
              >
                {change.text}
              </AppText>
            )}
          </Stack>
        ) : (
          <AppText variant="caption" tone="muted">
            No wear time in the last 14 days. It is recorded while a ring is worn.
          </AppText>
        )}
      </Card>
      <AppButton
        title="Readiness contributors →"
        variant="ghost"
        onPress={() => openDetail('readiness')}
      />
      <AppButton title="Sleep contributors →" variant="ghost" onPress={() => openDetail('sleep')} />
    </>
  );
}
