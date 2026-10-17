import { trendRows, deltaSentence } from '@trainingai/shared/nutrition/day-trends';
import { useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  LineChart,
  Stack,
  StatusIndicator,
  TextField,
} from '../../../shared/ui';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { scanSchema } from '../data/models';
import { MealLoggingStatus } from './MealLoggingStatus';
const values = z.object({
  restingHeartRate: z.number().nullable(),
  steps: z.number().nullable(),
  sessionVolumeKg: z.number().nullable(),
  weightKg: z.number().nullable(),
});
const ARROW = { up: '↑', down: '↓', level: '→' } as const;
export function DayReviewTrends({ date }: { date: string }) {
  const state = useWorkoutResource({
    path: '/api/day-review/week-window',
    query: { date },
    ttl: 300000,
    schema: z.object({
      date: z.string(),
      days: z.array(values.extend({ date: z.string() })),
      sevenDayAverages: values,
    }),
  });
  const { theme } = useTheme();
  const data = state.data?.date === date ? state.data : null;
  // The same rows, colours and wording as the current app: the maths is the shared `trendRows`.
  const rows = data ? trendRows(data) : [];
  return (
    <Card>
      <Stack direction="row" justify="space-between">
        <AppText variant="heading">Against the last week</AppText>
        <StatusIndicator
          label="Day comparisons"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
      {rows.map(({ spec, today, delta, series }) => (
        <Card key={spec.key} style={{ padding: theme.spacing.md }}>
          <Stack direction="row" justify="space-between" align="center">
            <Stack gap="xxs" style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="caption" tone="muted">
                {spec.label}
              </AppText>
              {today == null ? (
                <AppText variant="caption" tone="muted">
                  No reading today
                </AppText>
              ) : (
                <AppText variant="label" style={{ color: spec.color }}>
                  {spec.format(today)}
                </AppText>
              )}
            </Stack>
            {series && (
              <View style={{ width: theme.sizes.weightSparkline }}>
                {/* Only the days with a reading are drawn, joined, at their own position in the
                    eight-day window, so a stat recorded on three days is one line, not dots. */}
                <LineChart
                  label={spec.label + ' over eight days'}
                  height={theme.sizes.miniChart}
                  showLabels={false}
                  color={spec.color}
                  xDomain={[0, 7]}
                  points={series.times.map((time, i) => ({
                    label: String(time),
                    x: time,
                    value: series.values[i],
                  }))}
                />
              </View>
            )}
          </Stack>
          {delta && (
            <AppText variant="micro" tone="muted">
              {ARROW[delta.direction]} {deltaSentence(spec, delta)}
            </AppText>
          )}
        </Card>
      ))}
    </Card>
  );
}
export function MealBackfill({
  date,
  onManual,
}: {
  date: string;
  onManual: (id: string) => void;
}) {
  const n = useNutrition(date);
  const resources = useWorkoutResources();
  const draft = useWorkoutDraft('meal-backfill:' + date, z.record(z.string(), z.string()), {});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function log(id: string) {
    if (!resources || busy) {
      return;
    }
    setBusy(id);
    try {
      const scan = scanSchema.parse(
        await resources.connection.post('/api/nutrition/scan', {
          text: draft.value[id],
          region: n.region,
        }),
      );
      const ingredients = scan.ingredients ?? [];
      const entries =
        ingredients.length > 1
          ? ingredients.map((i) => ({
              name: i.name,
              source: 'text',
              servingSizeG: 100,
              calories: i.caloriesPer100g,
              proteinG: i.proteinPer100g,
              carbsG: i.carbsPer100g,
              fatG: i.fatPer100g,
              quantityMultiplier: i.weightG / 100,
            }))
          : [{ ...scan, source: 'text', quantityMultiplier: 1 }];
      await n.store!.logFoods(entries, date, id, { name: scan.name });
      draft.setValue({ ...draft.value, [id]: '' });
      setError(null);
    } catch {
      setError('Could not identify or save the food. Your description is preserved.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <StatusIndicator
        label="Missing meals"
        busy={!!busy || !draft.ready}
        error={error ?? draft.error}
      />
      {n.view.mealTypes.map((mt) => {
        const logs = n.view.logs.filter((l) => l.mealTypeId === mt.id);
        return (
          <Card key={mt.id}>
            <Stack direction="row" justify="space-between">
              <AppText variant="label">
                {mt.emoji} {mt.name}
              </AppText>
            </Stack>
            <MealLoggingStatus
              mealName={mt.name}
              status={n.view.mealStatuses[mt.id] ?? 'not_recorded'}
              busy={!!busy}
              onChange={(skipped) => {
                void n.store
                  ?.setMealSkipped(mt.id, date, skipped)
                  .catch(() => setError('Could not save this meal status.'));
              }}
            />
            {logs.map((l) => (
              <Stack key={l.id} direction="row" justify="space-between">
                <AppText variant="caption" tone="muted">
                  {l.foodItem.name}
                </AppText>
                <AppText variant="caption">{Math.round(l.calories)} kcal</AppText>
              </Stack>
            ))}
            {n.view.mealStatuses[mt.id] !== 'skipped' && (
              <>
                <TextField
                  label={'What did you have for ' + mt.name.toLowerCase() + '?'}
                  value={draft.value[mt.id] ?? ''}
                  onChangeText={(text) => draft.setValue({ ...draft.value, [mt.id]: text })}
                />
                <Stack direction="row">
                  <AppButton
                    title={'Log ' + mt.name}
                    busy={busy === mt.id}
                    disabled={!draft.ready || !!busy || !draft.value[mt.id]?.trim()}
                    onPress={() => void log(mt.id)}
                  />
                  <AppButton
                    title="Choose food"
                    variant="ghost"
                    onPress={() => onManual(mt.id)}
                  />
                </Stack>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
