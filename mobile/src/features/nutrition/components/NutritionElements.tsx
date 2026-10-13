import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppText,
  Disclosure,
  Grid,
  NumericStepper,
  Stack,
  StatusIndicator,
  TargetBars,
  TextField,
} from '../../../shared/ui';
import type { Food, FoodLog } from '../data/models';
import { useNutrition } from '../data/NutritionProvider';
export const macroKeys = ['calories', 'proteinG', 'carbsG', 'fatG'] as const;
export function MacroComparison({
  actual,
  target,
  label,
}: {
  actual: Pick<Food, 'calories' | 'proteinG' | 'carbsG' | 'fatG'> | null;
  target: {
    targetCalories: number;
    targetProteinG: number;
    targetCarbsG: number;
    targetFatG: number;
  };
  label: string;
}) {
  const { theme } = useTheme();
  return (
    <TargetBars
      label={label}
      rows={[
        {
          label: 'Calories',
          actual: actual?.calories ?? null,
          target: target.targetCalories,
          unit: 'kcal',
          color: theme.colors.brand,
        },
        {
          label: 'Protein',
          actual: actual?.proteinG ?? null,
          target: target.targetProteinG,
          unit: 'g',
          color: theme.macros.protein,
        },
        {
          label: 'Carbs',
          actual: actual?.carbsG ?? null,
          target: target.targetCarbsG,
          unit: 'g',
          color: theme.macros.carbs,
        },
        {
          label: 'Fat',
          actual: actual?.fatG ?? null,
          target: target.targetFatG,
          unit: 'g',
          color: theme.macros.fat,
        },
      ]}
    />
  );
}
export type NutritionFields = Record<string, string>;
export function MacroLine({
  value,
  portion = 1,
}: {
  value: Pick<Food, 'calories' | 'proteinG' | 'carbsG' | 'fatG'>;
  portion?: number;
}) {
  const { theme } = useTheme();
  return (
    <Stack direction="row" wrap justify="space-between">
      {(['proteinG', 'carbsG', 'fatG'] as const).map((key, i) => (
        <AppText
          key={key}
          variant="micro"
          style={{
            color: [theme.macros.protein, theme.macros.carbs, theme.macros.fat][i],
          }}
        >
          {['P', 'C', 'F'][i]} {Math.round(value[key] * portion)} g
        </AppText>
      ))}
      <AppText variant="caption">{Math.round(value.calories * portion)} kcal</AppText>
    </Stack>
  );
}
export function NutritionFieldsForm({
  value,
  onChange,
}: {
  value: NutritionFields;
  onChange: (value: NutritionFields) => void;
}) {
  const set = (key: string, text: string) => onChange({ ...value, [key]: text });
  return (
    <Stack gap="md">
      <TextField
        label="Food name"
        value={value.name ?? ''}
        onChangeText={(text) => set('name', text)}
      />
      <TextField
        label="Brand (optional)"
        value={value.brand ?? ''}
        onChangeText={(text) => set('brand', text)}
      />
      <NumericStepper
        label="Serving size (g)"
        value={value.servingSizeG ?? '100'}
        min={0.1}
        max={5000}
        step={5}
        onChange={(text) => set('servingSizeG', text)}
      />
      <Grid columns={2}>
        {macroKeys.map((key, i) => (
          <TextField
            key={key}
            label={['Calories (kcal)', 'Protein (g)', 'Carbs (g)', 'Fat (g)'][i]}
            keyboardType="decimal-pad"
            value={value[key] ?? '0'}
            placeholder="0"
            onChangeText={(text) => set(key, text)}
          />
        ))}
      </Grid>
      <Disclosure title="Other nutrients">
        <Grid columns={2}>
          {(['fiberG', 'sugarG', 'satFatG', 'sodiumMg'] as const).map((key, i) => (
            <TextField
              key={key}
              label={['Fibre (g)', 'Sugar (g)', 'Saturated fat (g)', 'Sodium (mg)'][i]}
              keyboardType="decimal-pad"
              value={value[key] ?? '0'}
              placeholder="0"
              onChangeText={(text) => set(key, text)}
            />
          ))}
        </Grid>
      </Disclosure>
    </Stack>
  );
}
export function NutritionStatus({ date }: { date?: string }) {
  const n = useNutrition(date);
  const error =
    [...new Set([n.error, ...Object.values(n.errors)].filter(Boolean))].join('\n\n') || null;
  return (
    <StatusIndicator
      label="Nutrition records"
      busy={n.syncing || n.loading.length > 0 || !n.ready}
      error={error}
      message={
        n.operations.length + n.http.length ? 'Saved on this phone. Waiting to sync.' : null
      }
      onRetry={
        error
          ? () => {
              n.refresh(true);
              void n.store?.sync();
            }
          : undefined
      }
    />
  );
}
export function foodFields(food: Partial<Food>): NutritionFields {
  return Object.fromEntries(
    [
      'name',
      'brand',
      'servingSizeG',
      ...macroKeys,
      'fiberG',
      'sugarG',
      'satFatG',
      'sodiumMg',
    ].map((key) => [key, food[key] == null ? '' : String(food[key])]),
  );
}
export function foodAmount(log: FoodLog) {
  return `${Math.round(log.quantityMultiplier * 100) / 100} servings · ${Math.round(log.foodItem.servingSizeG * log.quantityMultiplier)} g`;
}
