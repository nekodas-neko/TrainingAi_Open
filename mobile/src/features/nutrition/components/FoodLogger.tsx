import { feedback } from '../../../integrations/feedback/haptics';
import { decodeMealLabelScan } from '@trainingai/shared/nutrition/label-payload';
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals';
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient';
import { plural } from '@trainingai/shared/format/plural';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';
import { pickNutritionImage } from '../../../integrations/nutrition/photo';
import { PhotoPreparationError } from '../../../integrations/nutrition/image-encoding';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Disclosure,
  Grid,
  ListRow,
  NumericStepper,
  Picker,
  ProgressBar,
  SegmentedControl,
  Sheet,
  Stack,
  StatusIndicator,
  TextField,
  Thumbnail,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { energySpec } from '../../health/data/models';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { useNutrition } from '../data/NutritionProvider';
import { foodValidationMessage, normaliseFood } from '../data/food-values';
import { countedIntakeKcal, readEstimateRows } from '@trainingai/shared/nutrition/counted-intake';
import {
  FoodItemPushSchema,
  foodSchema,
  scanSchema,
  type Food,
  type SavedMeal,
  type Scan,
} from '../data/models';
import { qtyFromInput, type QtyUnit } from '../data/quantities';
import { ingredientItems, sharedMealIngredients } from '../data/recipes';
import { useSearchTerm } from './IngredientPicker';
import { foodScanError, readFoodScan } from '../data/scan-response';
import { photoDraftSchema } from '../data/photo-draft';
import { MacroLine, NutritionFieldsForm, foodFields, macroKeys } from './NutritionElements';
const draftSchema = z.object({
  step: z.enum(['capture', 'review', 'assign']),
  recipeServings: z.number().default(1),
  shared: z.boolean().default(false),
  fields: z.record(z.string(), z.string()),
  itemId: z.string().nullable(),
  source: z.string(),
  barcode: z.string().nullable(),
  imageDataUri: z.string().nullable(),
  ingredients: NutritionIngredientsSchema,
  quantity: z.string(),
  mealTypeId: z.string(),
  text: z.string(),
  url: z.string(),
  tab: z.enum(['recent', 'meals', 'search']),
  scanCandidates: z.array(scanSchema).default([]),
});
const initial: z.infer<typeof draftSchema> = {
  recipeServings: 1,
  shared: false,
  step: 'capture',
  fields: { servingSizeG: '100' },
  itemId: null,
  source: 'manual',
  barcode: null,
  imageDataUri: null,
  ingredients: [],
  quantity: '1',
  mealTypeId: '',
  text: '',
  url: '',
  tab: 'recent',
  scanCandidates: [],
};
// A food with no brand has no leading dot: "125 g · 80 kcal", not " · 125 g · 80 kcal".
function foodLine(brand: string | null | undefined, servingSizeG: number, calories: number) {
  return [brand?.trim(), `${servingSizeG} g`, `${Math.round(calories)} kcal`]
    .filter(Boolean)
    .join(' · ');
}
export function FoodLogger({
  date,
  mealTypeId,
  onClose,
  onRecipes,
  library = false,
}: {
  date: string;
  mealTypeId?: string;
  onClose: () => void;
  onRecipes: (meal?: SavedMeal) => void;
  library?: boolean;
}) {
  const n = useNutrition(date);
  const resources = useWorkoutResources();
  const loggerKey = `food-logger:${date}:${library ? 'library' : 'log'}`;
  const photoKey = `food-photo:${date}:${library ? 'library' : 'log'}`;
  const photoScope = resources
    ? JSON.stringify([resources.connection.origin, resources.connection.userId, photoKey])
    : '';
  const draft = useWorkoutDraft(loggerKey, draftSchema, {
    ...initial,
    mealTypeId: mealTypeId ?? n.view.mealTypes[0]?.id ?? '',
    tab: library ? 'meals' : 'recent',
  });
  const d = draft.value;
  const latestDraft = useRef({ value: d, setValue: draft.setValue });
  latestDraft.current = { value: d, setValue: draft.setValue };
  const energy = useWorkoutResource(energySpec(date), d.step === 'assign');
  useEffect(() => {
    const latest = latestDraft.current;
    if (draft.ready && mealTypeId && latest.value.mealTypeId !== mealTypeId) {
      latest.setValue({ ...latest.value, mealTypeId });
    }
  }, [draft.ready, mealTypeId]);
  const update = (patch: Partial<typeof d>) => draft.setValue({ ...d, ...patch });
  const [busy, setBusy] = useState(false);
  const [captureStage, setCaptureStage] = useState<string | null>(null);
  const capturedPhoto = useRef<Awaited<ReturnType<typeof pickNutritionImage>>>(null);
  const capturedResult = useRef<{ image: string; scans: Scan[] } | null>(null);
  const [photoRetry, setPhotoRetry] = useState(false);
  const [photoLoadedScope, setPhotoLoadedScope] = useState<string | null>(null);
  const photoReady = photoLoadedScope === photoScope && !!resources;
  const [failure, setFailure] = useState<{ message: string; retryPhoto: boolean } | null>(null);
  const error = failure?.message ?? null;
  function setError(message: string | null, retryPhoto = false) {
    setFailure(message ? { message, retryPhoto } : null);
  }
  const [query, setQuery] = useState('');
  const [mealQuery, setMealQuery] = useState('');
  const { theme } = useTheme();
  const mealNeedle = mealQuery.trim().toLowerCase();
  const meals = n.view.meals.filter(
    (meal) =>
      !mealNeedle ||
      meal.name.toLowerCase().includes(mealNeedle) ||
      meal.items.some((item) => item.foodItem.name.toLowerCase().includes(mealNeedle)),
  );
  const term = useSearchTerm(query);
  const [unit, setUnit] = useState<QtyUnit>('serving');
  const recent = useWorkoutResource(
    { path: '/api/nutrition/recent-for-meal', ttl: 300000, schema: z.array(foodSchema) },
    d.tab === 'recent',
  );
  const [barcode, setBarcode] = useState('');
  const [scanner, setScanner] = useState(false);
  const candidates = d.scanCandidates;
  const setCandidates = (scanCandidates: Scan[]) => update({ scanCandidates });
  useEffect(() => {
    let current = true;
    capturedPhoto.current = null;
    capturedResult.current = null;
    setPhotoRetry(false);
    setPhotoLoadedScope(null);
    if (resources) {
      void resources
        .draft(photoKey, photoDraftSchema)
        .then((saved) => {
          if (current) {
            capturedPhoto.current = saved;
            setPhotoRetry(!!saved);
            setPhotoLoadedScope(photoScope);
          }
        })
        .catch(() => {
          if (current) {
            setError(
              'Could not read your saved photo. Close and reopen food logging to retry.',
            );
          }
        });
    }
    return () => {
      current = false;
    };
  }, [photoScope, photoKey, resources]);
  const database = useWorkoutResource(
    {
      path: '/api/nutrition/food-search',
      query: { q: term.trim(), region: n.region },
      ttl: 3600000,
      schema: z.object({ results: z.array(scanSchema), unavailable: z.boolean().optional() }),
    },
    term.trim().length >= 2 && d.tab === 'search',
  );
  function pick(food: Food) {
    if (!draft.ready || busy) {
      return;
    }
    setError(null);
    update({
      fields: foodFields(food),
      itemId: food.id,
      source: food.source,
      imageDataUri: food.imageDataUri ?? null,
      ingredients: [],
      quantity: '1',
      step: 'assign',
    });
  }
  function review(scan: Scan, thumbnail?: string | null) {
    setError(null);
    const fields = foodFields(scan as Partial<Food>);
    const next = {
      ...d,
      itemId: null,
      fields,
      source:
        scan.origin === 'barcode' || scan.origin === 'search'
          ? 'barcode'
          : scan.origin === 'text'
            ? 'text'
            : scan.origin === 'url'
              ? 'text'
              : 'ai',
      barcode: scan.barcode ?? null,
      imageDataUri: thumbnail ?? scan.imageDataUri ?? d.imageDataUri,
      ingredients: scan.ingredients ?? [],
      scanCandidates: [],
      step: 'review' as const,
    };
    draft.setValue(next);
    return next;
  }
  async function analyse(
    input: Record<string, unknown>,
    thumbnail?: string | null,
    capturing = false,
  ) {
    if (!resources || !draft.ready || !photoReady || (busy && !capturing)) {
      return;
    }
    setBusy(true);
    setError(null);
    setPhotoRetry(false);
    setCaptureStage('Analysing food…');
    let savingResult = false;
    try {
      const cached =
        typeof input.image === 'string' && capturedResult.current?.image === input.image
          ? capturedResult.current.scans
          : null;
      const scans =
        cached ??
        readFoodScan(
          await resources.connection.post('/api/nutrition/scan', {
            ...input,
            region: n.region,
          }),
        );
      if (typeof input.image === 'string') {
        capturedResult.current = { image: input.image, scans };
      }
      let next: typeof d;
      if (scans.length > 1) {
        next = {
          ...d,
          imageDataUri: thumbnail ?? d.imageDataUri,
          scanCandidates: scans.map((scan) => ({
            ...scan,
            imageDataUri: thumbnail ?? scan.imageDataUri,
          })),
        };
        draft.setValue(next);
      } else {
        next = review(scans[0], thumbnail);
      }
      savingResult = true;
      await resources.saveDraft(loggerKey, next);
      await resources.clearDraft(photoKey);
      capturedPhoto.current = null;
      capturedResult.current = null;
    } catch (error) {
      setError(
        savingResult
          ? 'Analysis finished, but the result could not be saved on this phone. Retry to save it without analysing the photo again.'
          : foodScanError(error),
        typeof input.image === 'string' && !!capturedPhoto.current,
      );
      setPhotoRetry(typeof input.image === 'string' && !!capturedPhoto.current);
    } finally {
      setBusy(false);
      setCaptureStage(null);
    }
  }
  async function lookup(code: string) {
    if (!resources || busy) {
      return;
    }
    setScanner(false);
    const label = decodeMealLabelScan(code);
    if (label?.kind === 'meal-id') {
      const meal = n.view.meals.find((m) => m.id === label.mealId);
      if (meal) {
        onRecipes(meal);
      } else {
        setError('This label belongs to a saved meal that is not available in your library.');
      }
      return;
    }
    if (label?.kind === 'shared-meal') {
      const ingredients = sharedMealIngredients(label.meal);
      const totals = sumIngredients(ingredients);
      update({
        step: 'review',
        fields: foodFields({ ...totals, name: label.meal.name }),
        itemId: null,
        ingredients,
        source: 'text',
        shared: true,
        recipeServings: label.meal.servings,
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      review(
        scanSchema.parse(
          await resources.connection.get('/api/nutrition/barcode', { barcode: code }),
        ),
      );
    } catch {
      setError('The barcode could not be found. Try a photo, description or manual entry.');
    } finally {
      setBusy(false);
    }
  }
  async function photo(camera: boolean) {
    if (!draft.ready || !photoReady || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setPhotoRetry(false);
    setCaptureStage(camera ? 'Opening camera…' : 'Opening photos…');
    try {
      const image = await pickNutritionImage(camera, () => setCaptureStage('Preparing photo…'));
      if (image) {
        setCaptureStage('Saving photo…');
        await resources!.saveDraft(photoKey, photoDraftSchema.parse(image));
        capturedPhoto.current = image;
        capturedResult.current = null;
        update({ imageDataUri: image.thumbnail });
        await analyse({ image: image.base64, mimeType: image.mimeType }, image.thumbnail, true);
      }
    } catch (error) {
      setError(
        error instanceof PhotoPreparationError
          ? error.message
          : 'Could not prepare or save the photo. Check camera/photo permission and the latest development build, then try again.',
      );
    } finally {
      setBusy(false);
      setCaptureStage(null);
    }
  }
  function value() {
    const food = {
      id: '10000000-0000-4000-8000-000000000001',
      name: d.fields.name?.trim(),
      brand: d.fields.brand?.trim() || undefined,
      servingSizeG: Number(d.fields.servingSizeG),
      source: d.source,
      barcode: d.barcode ?? undefined,
      imageDataUri: d.imageDataUri,
    };
    for (const key of [...macroKeys, 'fiberG', 'sugarG', 'sodiumMg', 'satFatG']) {
      Object.assign(food, {
        [key]: Number(d.fields[key] ?? ''),
      });
    }
    const valid = FoodItemPushSchema.parse(food);
    return normaliseFood(
      {
        ...valid,
        servingSizeG: valid.servingSizeG ?? 100,
        proteinG: valid.proteinG ?? 0,
        carbsG: valid.carbsG ?? 0,
        fatG: valid.fatG ?? 0,
        source: valid.source ?? 'manual',
        quantityMultiplier: 1,
      },
      valid.id,
    );
  }
  async function save() {
    if (!n.store || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const food = value();
      const entries =
        d.ingredients.length > 1
          ? d.ingredients.map((ingredient) => ({
              name: ingredient.name,
              servingSizeG: 100,
              calories: ingredient.caloriesPer100g,
              proteinG: ingredient.proteinPer100g,
              carbsG: ingredient.carbsPer100g,
              fatG: ingredient.fatPer100g,
              source: d.source,
              quantityMultiplier: (ingredient.weightG / 100) * Number(d.quantity),
            }))
          : [
              {
                ...food,
                id: d.itemId ?? undefined,
                source: d.source,
                servingSizeG: food.servingSizeG ?? 100,
                proteinG: food.proteinG ?? 0,
                carbsG: food.carbsG ?? 0,
                fatG: food.fatG ?? 0,
                quantityMultiplier: Number(d.quantity),
              },
            ];
      await n.store.logFoods(entries, date, d.mealTypeId, { name: food.name });
      feedback('success');
      await resources?.clearDraft(photoKey);
      await resources?.clearDraft(loggerKey);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? foodValidationMessage(cause)
          : cause instanceof Error
            ? cause.message
            : 'Could not save.',
      );
    } finally {
      setBusy(false);
    }
  }
  const title =
    d.step === 'capture' ? 'Log Food' : d.step === 'review' ? 'Review' : 'Assign to Meal';
  return (
    <>
      <Sheet
        visible
        fullHeight
        title={captureStage ?? title}
        onClose={onClose}
        actions={
          <StatusIndicator
            label="Food logging"
            busy={busy || !draft.ready || (!!resources && !photoReady && !error)}
            error={error ?? draft.error}
            message={
              photoRetry && photoReady && d.step === 'capture'
                ? 'Your photo is saved on this phone and ready to analyse.'
                : null
            }
            actionLabel={error ? 'Retry photo' : 'Analyse saved photo'}
            onRetry={
              photoRetry &&
              photoReady &&
              !draft.error &&
              (error ? failure?.retryPhoto : d.step === 'capture')
                ? () => {
                    const image = capturedPhoto.current;
                    if (image) {
                      void analyse(
                        { image: image.base64, mimeType: image.mimeType },
                        image.thumbnail,
                      );
                    }
                  }
                : undefined
            }
          />
        }
        footer={
          d.step !== 'capture' ? (
            <Stack direction="row">
              <AppButton
                title="Previous"
                variant="secondary"
                onPress={() =>
                  update({
                    step:
                      d.step === 'assign' && d.itemId
                        ? 'capture'
                        : d.step === 'assign'
                          ? 'review'
                          : 'capture',
                  })
                }
              />
              <AppButton
                title={d.step === 'review' ? 'Next' : 'Log Food'}
                busy={busy}
                disabled={!draft.ready}
                onPress={() => {
                  if (d.step === 'review') {
                    try {
                      const valid = value();
                      update({ step: 'assign', fields: foodFields(valid) });
                      setError(null);
                    } catch (cause) {
                      setError(
                        cause instanceof z.ZodError
                          ? foodValidationMessage(cause)
                          : 'Check the food details and amounts.',
                      );
                    }
                  } else {
                    void save();
                  }
                }}
              />
            </Stack>
          ) : undefined
        }
      >
        {d.step === 'capture' ? (
          <>
            <SegmentedControl
              label="Food library"
              value={d.tab}
              onChange={(tab) => update({ tab })}
              options={[
                { value: 'recent', label: 'Recent' },
                { value: 'meals', label: 'My Foods' },
                { value: 'search', label: 'Search' },
              ]}
            />
            <Grid columns={2}>
              <AppButton
                title="Scan barcode"
                disabled={busy || !draft.ready}
                variant="surface"
                onPress={() => setScanner(true)}
              />
              <AppButton
                title="Take photo"
                disabled={busy || !draft.ready || !photoReady}
                variant="surface"
                onPress={() => void photo(true)}
              />
              <AppButton
                title="Choose photo"
                disabled={busy || !draft.ready || !photoReady}
                variant="surface"
                onPress={() => void photo(false)}
              />
              <AppButton
                title="Add by hand"
                disabled={busy || !draft.ready}
                variant="surface"
                onPress={() => {
                  setError(null);
                  update({
                    step: 'review',
                    fields: { servingSizeG: '100' },
                    source: 'manual',
                    itemId: null,
                    ingredients: [],
                    barcode: null,
                    imageDataUri: null,
                    scanCandidates: [],
                    shared: false,
                  });
                }}
              />
            </Grid>
            <Disclosure title="Describe food">
              <TextField
                label="What did you eat?"
                value={d.text}
                multiline
                onChangeText={(text) => update({ text })}
              />
              <AppButton
                title="Analyse description"
                disabled={!d.text.trim()}
                busy={busy}
                onPress={() => void analyse({ text: d.text })}
              />
            </Disclosure>
            {d.tab === 'meals' ? (
              <>
                <AppButton
                  title="Build or import a recipe"
                  variant="secondary"
                  onPress={() => onRecipes()}
                />
                {n.view.meals.length > 0 && (
                  <TextField
                    label="Filter your meals"
                    hideLabel
                    placeholder="Filter your meals"
                    leadingIcon="search"
                    value={mealQuery}
                    onChangeText={setMealQuery}
                  />
                )}
                {meals.length > 0 && (
                  <AppText variant="eyebrow" tone="muted">
                    {plural(meals.length, 'item', 'items')}
                  </AppText>
                )}
                {n.view.meals.length > 0 && meals.length === 0 && (
                  <AppText tone="muted">Nothing matches “{mealQuery.trim()}”.</AppText>
                )}
                {meals.length > 0 && (
                  <Card padded={false}>
                    {meals.map((meal, index) => {
                      const tags = n.view.mealTypes.filter((mt) =>
                        meal.mealTypeIds.includes(mt.id),
                      );
                      return (
                        <View
                          key={meal.id}
                          style={{
                            borderTopWidth: index === 0 ? 0 : 1,
                            borderTopColor: theme.colors.border,
                          }}
                        >
                          <ListRow
                            leading={<Thumbnail uri={meal.imageDataUri} label={meal.name} />}
                            density="compact"
                            title={meal.name}
                            subtitle={`${plural(meal.servings, 'portion', 'portions')} · ${Math.round(meal.totals.calories / meal.servings)} kcal per portion`}
                            onPress={() => onRecipes(meal)}
                          />
                          {tags.length > 0 && (
                            <Stack
                              direction="row"
                              wrap
                              gap="xs"
                              style={{
                                paddingHorizontal: theme.spacing.lg,
                                paddingBottom: theme.spacing.sm,
                              }}
                            >
                              {tags.slice(0, 4).map((mt) => (
                                <Badge key={mt.id} label={mt.name} />
                              ))}
                              {tags.length > 4 && <Badge label={`+${tags.length - 4}`} />}
                            </Stack>
                          )}
                        </View>
                      );
                    })}
                  </Card>
                )}
                {n.view.meals.length > 0 && (
                  <AppText variant="caption" tone="muted">
                    Meal calories are per portion.
                  </AppText>
                )}
              </>
            ) : (
              <>
                <TextField
                  label={
                    d.tab === 'search' ? 'Search the food database' : 'Search recent foods'
                  }
                  hideLabel
                  placeholder={
                    d.tab === 'search' ? 'Search the food database…' : 'Search recent foods'
                  }
                  leadingIcon="search"
                  value={query}
                  onChangeText={setQuery}
                />
                {(d.tab === 'recent'
                  ? (recent.data ?? n.view.logs.map((log) => log.foodItem))
                  : n.view.foods
                )
                  .filter((food) => food.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 50)
                  .map((food) => (
                    <ListRow
                      key={food.id}
                      leading={<Thumbnail uri={food.imageDataUri} label={food.name} />}
                      density="compact"
                      title={food.name}
                      subtitle={foodLine(food.brand, food.servingSizeG, food.calories)}
                      onPress={() => pick(food)}
                    />
                  ))}
                {d.tab === 'search' && (
                  <>
                    <StatusIndicator
                      label="Food search"
                      busy={database.loading && query.length >= 2}
                      error={database.error}
                      onRetry={database.refresh}
                    />
                    {database.data?.unavailable && (
                      <AppText tone="muted">
                        The food database is temporarily unavailable.
                      </AppText>
                    )}
                    {database.data?.results.map((scan, index) => (
                      <ListRow
                        key={scan.barcode ?? index}
                        title={scan.name}
                        subtitle={foodLine(scan.brand, scan.servingSizeG, scan.calories)}
                        onPress={() => review(scan)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </>
        ) : d.step === 'review' ? (
          <>
            {d.source !== 'manual' && (
              <Badge
                label={
                  d.source === 'barcode' ? 'Food database' : 'Estimate · review before logging'
                }
              />
            )}
            {d.shared && (
              <AppButton
                title="Save shared recipe to My Foods"
                variant="surface"
                onPress={async () => {
                  try {
                    const items = ingredientItems(d.ingredients, d.recipeServings, randomUUID);
                    await n.store!.saveMeal(
                      {
                        name: d.fields.name,
                        servings: d.recipeServings,
                        items: items.map((i) => ({
                          foodItemId: i.foodItemId,
                          quantityMultiplier: i.quantityMultiplier,
                        })),
                      },
                      date,
                      items.flatMap((i) =>
                        i.food ? [{ ...i.food, quantityMultiplier: 1 }] : [],
                      ),
                    );
                    update({ shared: false });
                    setError(null);
                  } catch {
                    setError('Could not save this recipe.');
                  }
                }}
              />
            )}
            <NutritionFieldsForm
              value={d.fields}
              onChange={(fields) =>
                update({
                  fields,
                  ingredients: macroKeys.some((k) => fields[k] !== d.fields[k])
                    ? []
                    : d.ingredients,
                })
              }
            />
            {!!d.ingredients.length && (
              <Disclosure title="Ingredients" defaultOpen>
                {d.ingredients.map((ingredient, index) => (
                  <Stack key={index}>
                    <AppText variant="label">{ingredient.name}</AppText>
                    <NumericStepper
                      label={`${ingredient.name} grams`}
                      value={String(ingredient.weightG)}
                      min={0.1}
                      max={5000}
                      step={5}
                      onChange={(weight) => {
                        const ingredients = d.ingredients.map((item, i) =>
                          i === index ? { ...item, weightG: Number(weight) } : item,
                        );
                        const computed = sumIngredients(ingredients);
                        update({
                          ingredients,
                          fields: {
                            ...d.fields,
                            ...Object.fromEntries(
                              Object.entries(computed).map(([key, value]) => [
                                key,
                                String(value),
                              ]),
                            ),
                          },
                        });
                      }}
                    />
                  </Stack>
                ))}
              </Disclosure>
            )}
            {d.source !== 'manual' && (
              <Disclosure title="Refine estimate">
                <TextField
                  label="Correction"
                  value={d.text}
                  onChangeText={(text) => update({ text })}
                />
                <AppButton
                  title="Refine"
                  busy={busy}
                  onPress={() => void analyse({ text: `${d.fields.name}. ${d.text}` })}
                />
              </Disclosure>
            )}
          </>
        ) : (
          <>
            <AppText variant="heading">{d.fields.name}</AppText>
            <Picker
              label="Meal group"
              value={d.mealTypeId}
              options={n.view.mealTypes.map((mt) => ({ value: mt.id, label: mt.name }))}
              onChange={(mealTypeId) => update({ mealTypeId })}
            />
            <SegmentedControl
              label="Quantity unit"
              value={unit}
              options={[
                { value: 'serving', label: 'Servings' },
                { value: 'g', label: 'Grams' },
              ]}
              onChange={setUnit}
            />
            <NumericStepper
              label={unit === 'g' ? 'Grams' : 'Servings'}
              value={
                unit === 'g'
                  ? String(Number(d.quantity) * Number(d.fields.servingSizeG))
                  : d.quantity
              }
              min={0.01}
              max={unit === 'g' ? 5000 : 100}
              step={unit === 'g' ? 5 : 0.5}
              onChange={(raw) => {
                const q = qtyFromInput(raw, unit, Number(d.fields.servingSizeG));
                if (q != null) {
                  update({ quantity: String(q) });
                }
              }}
            />
            <Stack direction="row" wrap>
              {[0.5, 1, 1.5, 2].map((q) => (
                <AppButton
                  key={q}
                  title={String(q) + '×'}
                  variant={Number(d.quantity) === q ? 'primary' : 'surface'}
                  onPress={() => update({ quantity: String(q) })}
                />
              ))}
            </Stack>
            <AppText variant="caption" tone="muted">
              {date}
            </AppText>
            {date === n.today &&
              n.view.totals &&
              energy.data?.balance?.budgetKcal != null &&
              (() => {
                // #2863: the shared counted intake, with this food superseding its meal's estimate.
                const after = countedIntakeKcal({
                  loggedKcal:
                    n.view.totals.calories + Number(d.fields.calories) * Number(d.quantity),
                  estimates: readEstimateRows(energy.data.balance.estimatedMeals),
                  loggedMealTypeIds: [...n.view.logs.map((x) => x.mealTypeId), d.mealTypeId],
                });
                return (
                  <Card>
                    <AppText variant="caption">Today after logging</AppText>
                    <AppText>
                      {after} / {Math.round(energy.data.balance.budgetKcal)} kcal
                    </AppText>
                    <ProgressBar value={after / energy.data.balance.budgetKcal} />
                  </Card>
                );
              })()}
            <MacroLine
              value={{
                calories: Number(d.fields.calories) || 0,
                proteinG: Number(d.fields.proteinG) || 0,
                carbsG: Number(d.fields.carbsG) || 0,
                fatG: Number(d.fields.fatG) || 0,
              }}
              portion={Number(d.quantity) || 1}
            />
          </>
        )}
      </Sheet>
      <Sheet
        visible={scanner}
        fullHeight
        title="Scan barcode"
        onClose={() => setScanner(false)}
      >
        <NativeBarcodeScanner onCode={(code) => void lookup(code)} />
        <TextField
          label="Barcode"
          value={barcode}
          onChangeText={setBarcode}
          keyboardType="number-pad"
        />
        <AppButton title="Look up barcode" onPress={() => void lookup(barcode)} />
      </Sheet>
      <Sheet
        visible={!!candidates.length}
        title="Choose a recipe"
        onClose={() => setCandidates([])}
      >
        {candidates.map((scan, index) => (
          <ListRow
            key={index}
            title={scan.name}
            onPress={() => {
              review(scan);
              setCandidates([]);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
function NativeBarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const [Scanner, setScanner] = useState<React.ComponentType<{
    onCode: (code: string) => void;
  }> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import('../../../integrations/nutrition/BarcodeScanner')
      .then((scannerModule) => {
        if (active) setScanner(() => scannerModule.BarcodeScanner);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return Scanner ? (
    <Scanner onCode={onCode} />
  ) : (
    <AppText tone="muted">
      {failed
        ? 'Camera scanning needs the latest development build. You can enter the barcode below.'
        : 'Opening camera…'}
    </AppText>
  );
}
