import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { plural } from '@trainingai/shared/format/plural';
import { useState } from 'react';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppText,
  Disclosure,
  ListRow,
  SegmentedControl,
  Skeleton,
  Stack,
  StackedBarChart,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { adherenceSpec, weeklySpec } from '../data/models';
const percent = (value: number | null | undefined) =>
  value == null ? '—' : Math.round(value * 100) + '%';
export function WeeklyNutrition({
  onDay,
  calorieTarget,
}: {
  onDay: (date: string) => void;
  /** The day's calorie budget as the energy card shows it, so the chart's line agrees with it. */
  calorieTarget?: number | null;
}) {
  const { theme } = useTheme();
  const state = useWorkoutResource(weeklySpec);
  const adherence = useWorkoutResource(adherenceSpec);
  const [metric, setMetric] = useState<'calories' | 'proteinG' | 'carbsG' | 'fatG'>('calories');
  const logged = state.data?.filter((d) => d.logged !== false) ?? [];
  const average = logged.length
    ? Math.round(logged.reduce((sum, d) => sum + d.calories, 0) / logged.length)
    : null;
  const target =
    metric === 'calories' && calorieTarget != null && calorieTarget > 0
      ? { value: calorieTarget, label: `Target: ${Math.round(calorieTarget).toLocaleString()} kcal/day` }
      : undefined;
  const color = {
    calories: theme.colors.brand,
    proteinG: theme.macros.protein,
    carbsG: theme.macros.carbs,
    fatG: theme.macros.fat,
  }[metric];
  return (
    <>
      <Stack direction="row" justify="space-between" align="center">
        <AppText variant="eyebrow" tone="muted">
          7-day nutrition
        </AppText>
        <StatusIndicator
          label="Weekly nutrition"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
      <SegmentedControl
        label="Nutrition chart metric"
        value={metric}
        options={[
          { value: 'calories', label: 'Calories' },
          { value: 'proteinG', label: 'Protein' },
          { value: 'carbsG', label: 'Carbs' },
          { value: 'fatG', label: 'Fat' },
        ]}
        onChange={setMetric}
      />
      {state.data ? (
        <StackedBarChart
          label="Seven days of nutrition"
          unit={metric === 'calories' ? 'kcal' : 'g'}
          readable
          gridlines
          yAxis
          target={target}
          bars={state.data.map((d) => ({
            label: formatDateDisplay(d.date, 'weekday'),
            segments:
              d.logged === false
                ? []
                : [
                    {
                      label: metric,
                      value: d[metric],
                      color: d.isToday ? color : color + '99',
                    },
                  ],
          }))}
        />
      ) : (
        <Skeleton style={{ height: theme.sizes.chartHeight + theme.spacing.xxl }} />
      )}
      <AppText variant="caption" tone="muted">
        {average == null
          ? 'No food logged this week yet.'
          : `${target ? `Target: ${Math.round(calorieTarget!).toLocaleString()} kcal/day · ` : ''}avg of ${plural(logged.length, 'logged day', 'logged days')}: ${average.toLocaleString()} kcal`}
      </AppText>
      {adherence.data && adherence.data.requiredMealTypeCount > 0 && (
        <Stack gap="xs">
          <Stack direction="row" justify="space-between" align="center">
            <AppText variant="caption" tone="muted">
              Adherence · last 7 days
            </AppText>
            <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {percent(adherence.data.adherence7d)}
            </AppText>
          </Stack>
          <Stack direction="row" justify="space-between" align="center">
            <AppText variant="caption" tone="muted">
              Adherence · last 28 days
            </AppText>
            <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {percent(adherence.data.adherence28d)}
            </AppText>
          </Stack>
          <AppText variant="micro" tone="muted">
            % of days every required meal ({adherence.data.requiredMealTypeCount}) was logged
          </AppText>
        </Stack>
      )}
      {adherence.error && (
        <StatusIndicator
          label="Meal adherence"
          busy={adherence.loading}
          error={adherence.error}
          onRetry={adherence.refresh}
        />
      )}
      <Disclosure title="View daily totals">
        {state.data?.map((d) => (
          <ListRow
            key={d.date}
            title={formatDateDisplay(d.date, 'short')}
            subtitle={
              d.logged === false
                ? 'Not logged'
                : `${Math.round(d.calories)} kcal · P ${Math.round(d.proteinG)} · C ${Math.round(d.carbsG)} · F ${Math.round(d.fatG)}`
            }
            onPress={() => onDay(d.date)}
          />
        ))}
      </Disclosure>
    </>
  );
}
