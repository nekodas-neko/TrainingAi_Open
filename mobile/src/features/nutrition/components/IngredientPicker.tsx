import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AppButton, ListRow, Sheet, StatusIndicator, TextField } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useNutrition } from '../data/NutritionProvider';
import { FoodItemPushSchema, foodSchema, scanSchema, type Food } from '../data/models';
import { NutritionFieldsForm, macroKeys } from './NutritionElements';
export function useSearchTerm(value: string) {
  const [term, setTerm] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value), 350);
    return () => clearTimeout(timer);
  }, [value]);
  return term;
}
export function IngredientPicker({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (food: Food, isNew: boolean) => void;
}) {
  const n = useNutrition();
  const [query, setQuery] = useState('');
  const term = useSearchTerm(query);
  const [manual, setManual] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({ servingSizeG: '100' });
  const [error, setError] = useState<string | null>(null);
  const results = useWorkoutResource(
    {
      path: '/api/nutrition/food-search',
      query: { q: term.trim(), region: n.region },
      ttl: 3600000,
      schema: z.object({ results: z.array(scanSchema), unavailable: z.boolean().optional() }),
    },
    term.trim().length >= 2 && !manual,
  );
  function choose(scan: Partial<Food>) {
    try {
      const input = FoodItemPushSchema.parse({
        ...scan,
        id: randomUUID(),
        brand: scan.brand ?? undefined,
        barcode: scan.barcode ?? undefined,
        source: scan.source ?? 'barcode',
      });
      onChoose(
        foodSchema.parse({ proteinG: 0, carbsG: 0, fatG: 0, servingSizeG: 100, ...input }),
        true,
      );
    } catch {
      setError('Check the ingredient name, serving size and nutrients.');
    }
  }
  return (
    <Sheet
      visible
      fullHeight
      title="Add ingredient"
      onClose={onClose}
      actions={
        <StatusIndicator
          label="Ingredient search"
          busy={results.loading}
          error={error ?? results.error}
        />
      }
    >
      {manual ? (
        <>
          <NutritionFieldsForm value={fields} onChange={setFields} />
          <AppButton
            title="Add ingredient"
            onPress={() =>
              choose({
                name: fields.name,
                brand: fields.brand || undefined,
                source: 'manual',
                servingSizeG: Number(fields.servingSizeG),
                ...Object.fromEntries(macroKeys.map((k) => [k, Number(fields[k] ?? '')])),
              })
            }
          />
          <AppButton title="Back to search" variant="ghost" onPress={() => setManual(false)} />
        </>
      ) : (
        <>
          <TextField label="Search ingredients" value={query} onChangeText={setQuery} />
          {n.view.foods
            .filter((f) => f.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 30)
            .map((f) => (
              <ListRow
                key={f.id}
                title={f.name}
                subtitle={f.servingSizeG + ' g'}
                onPress={() => onChoose(f, false)}
              />
            ))}
          {results.data?.results.map((s, i) => (
            <ListRow
              key={i}
              title={s.name}
              subtitle={s.brand ?? undefined}
              onPress={() => choose(s)}
            />
          ))}
          <AppButton
            title="Enter ingredient by hand"
            variant="surface"
            onPress={() => setManual(true)}
          />
        </>
      )}
    </Sheet>
  );
}
