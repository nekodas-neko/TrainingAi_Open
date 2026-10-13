import { formatDateDisplay } from '@trainingai/shared/date-utils';
import { useState } from 'react';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Disclosure,
  ListRow,
  SegmentedControl,
  Sheet,
  Skeleton,
  Stack,
  StackedBarChart,
  StatusIndicator,
} from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { adherenceSpec, weeklySpec } from '../data/models';
export function WeeklyNutrition({ onDay }: { onDay: (date: string) => void }) {
  const { theme } = useTheme();
  const state = useWorkoutResource(weeklySpec);
  const adherence = useWorkoutResource(adherenceSpec);
  const [metric, setMetric] = useState<'calories' | 'proteinG' | 'carbsG' | 'fatG'>('calories');
  const [info, setInfo] = useState(false);
  const logged = state.data?.filter((d) => d.logged !== false) ?? [];
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
        {logged.length
          ? `${Math.round(logged.reduce((sum, d) => sum + d.calories, 0) / logged.length)} kcal average · ${logged.length} logged days`
          : 'No food logged this week yet.'}
      </AppText>
      <AppButton
        title={`Meal adherence · ${adherence.data?.adherence7d == null ? '—' : Math.round(adherence.data.adherence7d * 100) + '%'}`}
        variant="ghost"
        onPress={() => setInfo(true)}
      />
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
      <Sheet
        visible={info}
        title="Meal adherence"
        onClose={() => setInfo(false)}
        actions={
          <StatusIndicator
            label="Meal adherence"
            busy={adherence.loading}
            error={adherence.error}
            onRetry={adherence.refresh}
          />
        }
      >
        <AppText>
          How consistently you log your required meal groups. Missing days are unlogged, rather
          than days with no food.
        </AppText>
        <ListRow
          title="Last 7 days"
          subtitle={
            adherence.data?.adherence7d == null
              ? 'Unavailable'
              : Math.round(adherence.data.adherence7d * 100) + '%'
          }
        />
        <ListRow
          title="Last 28 days"
          subtitle={
            adherence.data?.adherence28d == null
              ? 'Unavailable'
              : Math.round(adherence.data.adherence28d * 100) + '%'
          }
        />
        <AppText tone="muted">Required groups are configured in Nutrition Settings.</AppText>
      </Sheet>
    </>
  );
}
