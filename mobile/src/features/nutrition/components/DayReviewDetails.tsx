import { useState } from 'react';
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
const metrics = {
  restingHeartRate: { label: 'Resting heart rate', unit: 'bpm' },
  steps: { label: 'Steps', unit: '' },
  sessionVolumeKg: { label: 'Training volume', unit: 'kg' },
  weightKg: { label: 'Weight', unit: 'kg' },
};
const values = z.object({
  restingHeartRate: z.number().nullable(),
  steps: z.number().nullable(),
  sessionVolumeKg: z.number().nullable(),
  weightKg: z.number().nullable(),
});
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
  return (
    <Card>
      <Stack direction="row" justify="space-between">
        <AppText variant="heading">Compared with last week</AppText>
        <StatusIndicator
          label="Day comparisons"
          busy={state.loading}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
      {(Object.keys(metrics) as (keyof typeof metrics)[]).map((key) => {
        const item = metrics[key];
        const today = data?.days.at(-1)?.[key];
        const prior = data?.sevenDayAverages[key];
        return (
          <Stack key={key}>
            <Stack direction="row" justify="space-between">
              <AppText variant="caption">{item.label}</AppText>
              <AppText variant="caption" tone="muted">
                {today == null
                  ? 'No reading today'
                  : `${today.toFixed(key === 'weightKg' ? 1 : 0)} ${item.unit}`}
              </AppText>
            </Stack>
            <LineChart
              label={item.label + ' over eight days'}
              height={theme.sizes.miniChart}
              showLabels={false}
              points={(data?.days ?? []).map((d) => ({ label: d.date, value: d[key] }))}
            />
            <AppText variant="micro" tone="muted">
              {today == null || prior == null
                ? 'No comparison available'
                : `${today > prior ? '↑' : today < prior ? '↓' : '→'} ${Math.abs(today - prior).toFixed(key === 'weightKg' ? 1 : 0)} ${item.unit} ${today >= prior ? 'above' : 'below'} your previous 7-day average`}
            </AppText>
          </Stack>
        );
      })}
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
