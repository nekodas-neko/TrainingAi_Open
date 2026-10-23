import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { Image } from 'react-native';
import { z } from 'zod';
import { PhotoPreparationError } from '../../../integrations/nutrition/image-encoding';
import { pickNutritionImage, pickNutritionThumbnail } from '../../../integrations/nutrition/photo';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
  Disclosure,
  IconButton,
  ListRow,
  MultiChoice,
  NumericStepper,
  Picker,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
  Thumbnail,
} from '../../../shared/ui';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useWorkoutResources } from '../../workouts/data/WorkoutDataProvider';
import { foodSchema, type SavedMeal, type Scan } from '../data/models';
import { useNutrition } from '../data/NutritionProvider';
import { ingredientAmountLabel, qtyFromInput } from '../data/quantities';
import { recipeDuplicate, recipeTotals, scanRecipe } from '../data/recipes';
import { IngredientPicker } from './IngredientPicker';
import { MealLabelSheet } from './MealLabelSheet';
import { recipeCountLine } from '../data/display';
import { MacroLine } from './NutritionElements';
import { aiFailureText } from '../../account/api/client';
import { readRecipeScan, recipePhotoError } from '../data/scan-response';
import { failureNotice } from '../../../core/reporting/index.ts';
const editorSchema = z.object({
  name: z.string(),
  servings: z.string(),
  imageDataUri: z.string().nullable(),
  mealTypeIds: z.array(z.string()),
  items: z.array(
    z.object({
      foodItemId: z.string(),
      quantityMultiplier: z.number(),
      food: foodSchema.nullish(),
    }),
  ),
  url: z.string(),
});
const initial: z.infer<typeof editorSchema> = {
  name: '',
  servings: '1',
  imageDataUri: null,
  mealTypeIds: [],
  items: [],
  url: '',
};
export function RecipesSheet({
  date,
  onClose,
  onLog,
  initialSelected,
}: {
  initialSelected?: SavedMeal | null;
  date: string;
  onClose: () => void;
  onLog: (meal: SavedMeal, mealTypeId: string, portions: number) => Promise<void>;
}) {
  const n = useNutrition(date);
  const resources = useWorkoutResources();
  const [editor, setEditor] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedMeal | null>(initialSelected ?? null);
  const [remove, setRemove] = useState<SavedMeal[] | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [bulk, setBulk] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bucket, setBucket] = useState(n.view.mealTypes[0]?.id ?? '');
  const [portions, setPortions] = useState('1');
  const [seed, setSeed] = useState(initial);
  const [copy, setCopy] = useState(false);
  const [label, setLabel] = useState<SavedMeal | null>(null);
  const [ingredient, setIngredient] = useState(false);
  const [candidates, setCandidates] = useState<Scan[]>([]);
  const [choices, setChoices] = useState<string[]>([]);
  const [yieldCount, setYieldCount] = useState(1);
  const { theme } = useTheme();
  const draft = useWorkoutDraft(`recipe-editor:${editor ?? 'closed'}`, editorSchema, seed);
  const d = draft.value;
  function edit(meal?: SavedMeal, duplicate = false) {
    setCopy(duplicate);
    setSeed(
      meal
        ? {
            name: meal.name + (duplicate ? ' copy' : ''),
            servings: String(meal.servings),
            imageDataUri: meal.imageDataUri ?? null,
            mealTypeIds: meal.mealTypeIds,
            items: meal.items.map((i) => ({
              foodItemId: i.foodItemId,
              quantityMultiplier: i.quantityMultiplier,
            })),
            url: '',
          }
        : initial,
    );
    setEditor(meal ? (duplicate ? 'copy:' + meal.id : meal.id) : 'new');
    setSelected(null);
  }
  const items = d.items.flatMap((item) => {
    const food = item.food ?? n.view.foods.find((x) => x.id === item.foodItemId);
    return food ? [{ ...item, food }] : [];
  });
  const aggregate = recipeTotals(d.items, n.view.foods);
  async function save(force = false) {
    if (!n.store || busy) {
      return;
    }
    const duplicate =
      editor === 'new' || copy
        ? recipeDuplicate(d.name, Number(d.servings), d.items, n.view.foods, n.view.meals)
        : null;
    if (duplicate && !force) {
      setError(`${duplicate.name} already exists. Edit that meal, or choose “Save a copy”.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await n.store.saveMeal(
        {
          ...(editor !== 'new' && !copy ? { id: editor! } : {}),
          name: d.name.trim(),
          servings: Number(d.servings),
          imageDataUri: d.imageDataUri,
          mealTypeIds: d.mealTypeIds,
          items: d.items.map((i) => ({
            foodItemId: i.foodItemId,
            quantityMultiplier: i.quantityMultiplier,
          })),
        },
        date,
        d.items.flatMap((i) => (i.food ? [{ ...i.food, quantityMultiplier: 1 }] : [])),
      );
      await resources?.clearDraft(`recipe-editor:${editor}`);
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this meal.');
    } finally {
      setBusy(false);
    }
  }
  function applyImport(response: ReturnType<typeof readRecipeScan>, thumbnail?: string) {
    const count = response.recipeYield && response.recipeYield > 0 ? response.recipeYield : 1;
    setYieldCount(count);
    if ((response.candidates?.length ?? 0) > 1) {
      setCandidates(
        thumbnail
          ? response.candidates!.map((c) => ({ ...c, imageDataUri: thumbnail }))
          : response.candidates!,
      );
      setChoices([]);
    } else {
      const recipe = scanRecipe(response, count, randomUUID);
      draft.setValue({
        ...d,
        ...recipe,
        imageDataUri: thumbnail ?? recipe.imageDataUri,
      });
      if (!response.recipeYield) {
        setError('Recipe yield was not stated. Review the portions before saving.');
      }
    }
  }
  async function importRecipe() {
    if (!resources || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = await resources.connection.post('/api/nutrition/scan', {
        url: d.url,
        region: n.region,
      });
      applyImport(readRecipeScan(raw));
    } catch (cause) {
      setError(aiFailureText(cause, 'Could not import this recipe. Your draft is preserved.'));
    } finally {
      setBusy(false);
    }
  }
  async function importRecipePhoto(camera: boolean) {
    if (!resources || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    let image: Awaited<ReturnType<typeof pickNutritionImage>>;
    try {
      image = await pickNutritionImage(camera);
    } catch (cause) {
      setError(
        cause instanceof PhotoPreparationError
          ? cause.message
          : 'Could not prepare the photo. Check camera/photo permission and the latest development build, then try again.',
      );
      setBusy(false);
      return;
    }
    if (!image) {
      setBusy(false);
      return;
    }
    try {
      const raw = await resources.connection.post('/api/nutrition/scan', {
        image: image.base64,
        mimeType: image.mimeType,
        imageKind: 'recipe',
        region: n.region,
      });
      applyImport(readRecipeScan(raw), image.thumbnail);
    } catch (cause) {
      setError(recipePhotoError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function photo() {
    try {
      const image = await pickNutritionThumbnail();
      if (image) {
        draft.setValue({ ...d, imageDataUri: image.thumbnail });
      }
    } catch {
      setError('Photo selection needs the latest development build and permission.');
    }
  }
  return (
    <>
      <Sheet
        visible
        fullHeight
        title={editor ? (editor === 'new' ? 'Build a meal' : 'Edit meal') : 'My Foods'}
        onClose={onClose}
        onBack={editor ? () => setEditor(null) : undefined}
        actions={
          <StatusIndicator
            label="Saved meals"
            busy={busy || (editor !== null && !draft.ready)}
            error={error ?? draft.error ?? n.errors.meals}
          />
        }
        footer={
          editor ? (
            <Stack direction="row">
              <AppButton title="Back" variant="secondary" onPress={() => setEditor(null)} />
              <AppButton
                title="Save meal"
                busy={busy}
                disabled={!draft.ready || !d.name.trim() || !d.items.length}
                onPress={() => void save()}
              />
            </Stack>
          ) : undefined
        }
      >
        {!editor ? (
          <>
            <TextField label="Search my foods" value={search} onChangeText={setSearch} />
            <Stack direction="row">
              <AppButton title="Build a meal" onPress={() => edit()} />
              <AppButton
                title={selecting ? 'Done' : 'Select'}
                variant="ghost"
                onPress={() => {
                  setSelecting(!selecting);
                  setBulk([]);
                }}
              />
            </Stack>
            {selecting && (
              <>
                <MultiChoice
                  label="Meals to delete"
                  value={bulk}
                  options={n.view.meals.map((m) => ({ value: m.id, label: m.name }))}
                  onChange={setBulk}
                />
                <AppButton
                  title={'Delete selected (' + bulk.length + ')'}
                  variant="danger"
                  disabled={!bulk.length}
                  onPress={() => setRemove(n.view.meals.filter((m) => bulk.includes(m.id)))}
                />
              </>
            )}

            {n.view.meals
              .filter((meal) => meal.name.toLowerCase().includes(search.toLowerCase()))
              .map((meal) => (
                <Card key={meal.id}>
                  <ListRow
                    density="compact"
                    leading={<Thumbnail uri={meal.imageDataUri} label={meal.name} />}
                    title={meal.name}
                    subtitle={recipeCountLine(meal.items.length, meal.servings)}
                    onPress={() => {
                      setSelected(meal);
                      setPortions('1');
                    }}
                  />
                  <MacroLine value={meal.totals} portion={1 / meal.servings} />
                </Card>
              ))}
          </>
        ) : (
          <>
            <TextField
              label="Meal name"
              value={d.name}
              onChangeText={(name) => draft.setValue({ ...d, name })}
            />
            <NumericStepper
              label="Portions this recipe makes"
              value={d.servings}
              min={0.25}
              max={50}
              step={1}
              onChange={(servings) => draft.setValue({ ...d, servings })}
            />
            <MacroLine value={aggregate} portion={1 / (Number(d.servings) || 1)} />
            <MultiChoice
              label="Suitable meal groups"
              value={d.mealTypeIds}
              options={n.view.mealTypes.map((mt) => ({ value: mt.id, label: mt.name }))}
              onChange={(mealTypeIds) => draft.setValue({ ...d, mealTypeIds })}
            />
            <AppButton
              title={d.imageDataUri ? 'Replace photo' : 'Add photo'}
              variant="surface"
              onPress={() => void photo()}
            />
            {d.imageDataUri && (
              <AppButton
                title="Remove photo"
                variant="ghost"
                onPress={() => draft.setValue({ ...d, imageDataUri: null })}
              />
            )}
            {items.map((item, index) => (
              <Card key={item.foodItemId + index}>
                <Stack direction="row" align="center">
                  <AppText variant="label" style={{ flex: 1 }}>
                    {item.food.name}
                  </AppText>
                  <IconButton
                    icon="delete"
                    label={`Remove ${item.food.name}`}
                    onPress={() =>
                      draft.setValue({ ...d, items: d.items.filter((_, i) => i !== index) })
                    }
                  />
                </Stack>
                <NumericStepper
                  label={`${item.food.name} grams`}
                  value={String(Math.round(item.food.servingSizeG * item.quantityMultiplier))}
                  min={0.1}
                  max={5000}
                  step={5}
                  onChange={(raw) => {
                    const q = qtyFromInput(raw, 'g', item.food.servingSizeG);
                    if (q != null) {
                      draft.setValue({
                        ...d,
                        items: d.items.map((x, i) =>
                          i === index ? { ...x, quantityMultiplier: q } : x,
                        ),
                      });
                    }
                  }}
                />
              </Card>
            ))}
            <AppButton
              title="Add ingredient"
              variant="surface"
              onPress={() => setIngredient(true)}
            />
            <Disclosure title="Import a recipe">
              <TextField
                label="Recipe URL"
                value={d.url}
                keyboardType="url"
                autoCapitalize="none"
                onChangeText={(url) => draft.setValue({ ...d, url })}
              />
              <AppButton
                title="Import recipe"
                busy={busy}
                disabled={!d.url.trim()}
                onPress={() => void importRecipe()}
              />
              <Stack direction="row">
                <AppButton
                  title="Take photo"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void importRecipePhoto(true)}
                />
                <AppButton
                  title="Choose photo"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void importRecipePhoto(false)}
                />
              </Stack>
            </Disclosure>
            {error?.includes('already exists') && (
              <AppButton title="Save a copy" onPress={() => void save(true)} />
            )}
          </>
        )}
      </Sheet>
      {ingredient && (
        <IngredientPicker
          onClose={() => setIngredient(false)}
          onChoose={(food, isNew) => {
            draft.setValue({
              ...d,
              items: [
                ...d.items,
                { foodItemId: food.id, quantityMultiplier: 1, food: isNew ? food : undefined },
              ],
            });
            setIngredient(false);
          }}
        />
      )}
      {label && <MealLabelSheet meal={label} onClose={() => setLabel(null)} />}
      <Sheet
        visible={candidates.length > 0}
        fullHeight
        title="Recipes on this page"
        onClose={() => setCandidates([])}
        actions={<StatusIndicator label="Recipe import" busy={busy} error={error} />}
      >
        <AppText tone="muted">Review one recipe or select several to save.</AppText>
        <MultiChoice
          label="Recipes to save"
          value={choices}
          options={candidates.map((s, i) => ({ value: String(i), label: s.name }))}
          onChange={setChoices}
        />
        {candidates.map((s, i) => (
          <ListRow
            key={i}
            title={'Review ' + s.name}
            onPress={() => {
              draft.setValue({ ...d, ...scanRecipe(s, yieldCount, randomUUID) });
              setCandidates([]);
            }}
          />
        ))}
        <AppButton
          title="Save selected recipes"
          busy={busy}
          disabled={!choices.length}
          onPress={async () => {
            setBusy(true);
            try {
              let skipped = 0;
              for (const choice of choices) {
                const value = scanRecipe(candidates[Number(choice)], yieldCount, randomUUID);
                const view = n.store!.view(date);
                if (
                  recipeDuplicate(
                    value.name,
                    Number(value.servings),
                    value.items,
                    view.foods,
                    view.meals,
                  )
                ) {
                  skipped++;
                  continue;
                }
                await n.store!.saveMeal(
                  {
                    name: value.name,
                    servings: Number(value.servings),
                    mealTypeIds: [],
                    items: value.items.map((i) => ({
                      foodItemId: i.foodItemId,
                      quantityMultiplier: i.quantityMultiplier,
                    })),
                  },
                  date,
                  value.items.flatMap((i) =>
                    i.food ? [{ ...i.food, quantityMultiplier: 1 }] : [],
                  ),
                );
              }
              setCandidates([]);
              setError(skipped ? `${skipped} matching recipes already saved.` : null);
            } catch (failure) {
              setError(
                failureNotice(
                  'Some recipes could not save. Matching saved recipes are skipped on retry.',
                  failure,
                ),
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      </Sheet>
      <Sheet
        visible={selected !== null}
        fullHeight
        title={selected?.name ?? 'Meal'}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            {selected.imageDataUri && (
              <Image
                source={{ uri: selected.imageDataUri }}
                accessibilityLabel="Meal photo"
                style={{ height: theme.sizes.chartHeight * 2, borderRadius: theme.radii.card }}
              />
            )}
            <MacroLine value={selected.totals} portion={Number(portions) / selected.servings} />
            <AppText variant="caption" tone="muted">
              One portion is 1/{selected.servings} of the whole recipe.
            </AppText>
            <NumericStepper
              label="Portions"
              value={portions}
              min={0.25}
              max={50}
              step={0.5}
              onChange={setPortions}
            />
            <Picker
              label="Meal group"
              value={bucket}
              options={n.view.mealTypes.map((mt) => ({ value: mt.id, label: mt.name }))}
              onChange={setBucket}
            />
            <AppButton
              title="Log meal"
              disabled={!bucket}
              busy={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await onLog(selected, bucket, Number(portions));
                  setSelected(null);
                } catch (failure) {
                  setError(failureNotice('Could not log this meal.', failure));
                } finally {
                  setBusy(false);
                }
              }}
            />
            {selected.items.map((item) => (
              <ListRow
                key={item.foodItemId}
                title={item.foodItem.name}
                subtitle={ingredientAmountLabel(
                  item.foodItem.servingSizeG,
                  (item.quantityMultiplier / selected.servings) * Number(portions),
                )}
              />
            ))}
            <AppButton
              title="Label & QR"
              variant="surface"
              onPress={() => setLabel(selected)}
            />
            <Stack direction="row">
              <AppButton title="Edit meal" variant="secondary" onPress={() => edit(selected)} />
              <AppButton
                title="Duplicate"
                variant="secondary"
                onPress={() => edit(selected, true)}
              />
              <AppButton
                title="Delete"
                variant="danger"
                onPress={() => setRemove([selected])}
              />
            </Stack>
          </>
        )}
      </Sheet>
      <Sheet visible={remove !== null} title="Delete meal" onClose={() => setRemove(null)}>
        {remove && (
          <ConfirmationCard
            title={`Delete ${remove.length === 1 ? remove[0].name : remove.length + ' meals'}?`}
            message="Logged history is kept."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            onCancel={() => setRemove(null)}
            onConfirm={async () => {
              try {
                await n.store?.enqueue(
                  remove.map((m) => ({
                    domain: 'saved_meals',
                    date,
                    payload: { id: m.id, deleted: true },
                  })),
                );
                setBulk([]);
                setRemove(null);
                setSelected(null);
              } catch (failure) {
                setError(failureNotice('Could not delete this meal.', failure));
              }
            }}
          />
        )}
      </Sheet>
    </>
  );
}
