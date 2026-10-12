import {
  CARB_STAPLES,
  FAT_STAPLES,
  GROCERY_STORES,
  PROTEIN_STAPLES,
  VEG_STAPLES,
} from '@trainingai/shared/nutrition/grocery-catalogue';
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients';
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals';
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  ConfirmationCard,
  Disclosure,
  ListRow,
  MultiChoice,
  NumericStepper,
  Picker,
  SegmentedControl,
  Sheet,
  Stack,
  StatusIndicator,
  SwitchRow,
  TextField,
} from '../../../shared/ui';
import { MacroComparison, MacroLine } from '../../nutrition/components/NutritionElements';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { confirmedCreate, UnconfirmedCreate } from '../../nutrition/data/confirmed-create';
import { libraryMealForSlot, usedSavedMealIds } from '../../nutrition/data/library-swap';
import {
  applyReduction,
  reductionNeeded,
  type Pin,
} from '../../nutrition/data/meal-count-reduction';
import {
  draftPlanSchema,
  planSpec,
  restrictionSpec,
  scanSchema,
  type MealPlan,
} from '../../nutrition/data/models';
import { reorderDraft, replaceMealInDraft, type Draft } from '../../nutrition/data/plan-draft';
import { asSharedMeal } from '../../nutrition/data/recipes';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
import { useWorkoutDraft } from '../../workouts/data/useWorkoutDraft';
import { logPlanMeal, savePlanMeal } from './PlanMeals';
import { PlanStructure } from './PlanStructure';
const configSchema = z.object({
  typedMeals: z
    .array(
      z.object({
        text: z.string(),
        keep: z.boolean(),
        ingredients: NutritionIngredientsSchema,
      }),
    )
    .default([]),
  savePositions: z.array(z.number()).default([]),
  savedPlanId: z.string().nullable().default(null),
  step: z.number(),
  stores: z.array(z.string()),
  restrictionsLoaded: z.boolean().default(false),
  restrictions: z.array(
    z.object({ restrictionId: z.string(), severity: z.enum(['avoid', 'allergy']) }),
  ),
  excludedFoods: z.array(z.string()),
  mealCount: z.string(),
  useLibrary: z.boolean(),
  keepSavedMealIds: z.array(z.string()),
  usualMeals: z.string(),
  trainingTime: z.string(),
  splitDays: z.boolean(),
  draft: draftPlanSchema.nullable(),
});
const initial: z.infer<typeof configSchema> = {
  typedMeals: [],
  savePositions: [],
  savedPlanId: null,
  step: 0,
  stores: [],
  restrictionsLoaded: false,
  restrictions: [],
  excludedFoods: [],
  mealCount: '3',
  useLibrary: true,
  keepSavedMealIds: [],
  usualMeals: '',
  trainingTime: '',
  splitDays: false,
  draft: null,
};
const steps = ['Stores', 'Avoid', 'Skip', 'Meals', 'Yours', 'Training', 'Review'];
export function MealPlansSheet({
  onClose,
  initialPlan,
  startSetup = false,
}: {
  onClose: () => void;
  initialPlan?: MealPlan | null;
  startSetup?: boolean;
}) {
  const resources = useWorkoutResources();
  const n = useNutrition();
  const state = useWorkoutResource(planSpec);
  const dietary = useWorkoutResource(restrictionSpec);
  const [structure, setStructure] = useState(false);
  const [remove, setRemove] = useState(false);
  const [swap, setSwap] = useState<number | null>(null);
  const [reduction, setReduction] = useState<{ count: number; keys: string[] } | null>(null);
  const [newText, setNewText] = useState('');
  const [setup, setSetup] = useState(startSetup);
  const [selected, setSelected] = useState<MealPlan | null>(initialPlan ?? null);
  const [day, setDay] = useState<'all' | 'training' | 'rest'>('all');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{
    plan: MealPlan;
    meal: MealPlan['variants'][number]['meals'][number];
  } | null>(null);
  const [instruction, setInstruction] = useState('');
  const draftKey = 'meal-plan-setup:' + (initialPlan?.id ?? 'new');
  const form = useWorkoutDraft(
    draftKey,
    configSchema,
    initialPlan
      ? {
          ...initial,
          stores: initialPlan.stores,
          excludedFoods: initialPlan.excludedFoods,
          mealCount: String(initialPlan.mealsPerDay),
          trainingTime: initialPlan.trainingTime ?? '',
          splitDays: initialPlan.variants.some((v) => v.dayType !== 'all'),
        }
      : initial,
  );
  const [draftDay, setDraftDay] = useState<'all' | 'training' | 'rest'>('all');
  const [draftInstruction, setDraftInstruction] = useState('');
  const f = form.value;
  const set = (patch: Partial<typeof f>) => form.setValue({ ...f, ...patch });
  useEffect(() => {
    if (form.ready && !f.restrictionsLoaded && dietary.data) {
      set({
        restrictionsLoaded: true,
        restrictions: dietary.data.mine.map((x) => ({
          restrictionId: x.restrictionId,
          severity: x.severity,
        })),
      });
    }
  }, [form.ready, dietary.data]);
  const pins: Pin[] = [
    ...f.keepSavedMealIds.map((key) => ({
      key,
      name: n.view.meals.find((m) => m.id === key)?.name ?? 'Meal',
      kind: 'saved' as const,
    })),
    ...f.typedMeals
      .filter((m) => m.keep)
      .map((m) => ({ key: m.text, name: m.text, kind: 'typed' as const })),
  ];
  function changeCount(raw: string) {
    const count = Number(raw);
    const decision = reductionNeeded(pins, count);
    if (decision) {
      setReduction({ count, keys: decision.preselected });
    } else {
      set({ mealCount: raw });
    }
  }
  async function addTyped() {
    await action(async () => {
      const scan = scanSchema.parse(
        await resources!.connection.post('/api/nutrition/scan', {
          text: newText,
          region: n.region,
        }),
      );
      if (!scan.ingredients?.length) {
        throw new Error('No ingredients found.');
      }
      set({
        typedMeals: [
          ...f.typedMeals,
          { text: newText.trim(), keep: false, ingredients: scan.ingredients },
        ],
      });
      setNewText('');
    });
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      state.refresh();
    } catch (cause) {
      setError(
        cause instanceof UnconfirmedCreate
          ? cause.message
          : 'Could not complete this action. Your edits are still here; retry when connected.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    await action(async () => {
      if (!resources || !n.store || !f.restrictionsLoaded) {
        throw new Error('Connect your account.');
      }
      await n.store.queueHttp('restrictions', n.today, { entries: f.restrictions });
      await n.store.sync();
      if (n.store.getSnapshot().http.some((op) => op.kind === 'restrictions')) {
        throw new Error('Restrictions not confirmed.');
      }
      const draft = draftPlanSchema.parse(
        await resources.connection.post('/api/nutrition/meal-plans/generate', {
          mealCount: Number(f.mealCount),
          stores: f.stores,
          excludedFoods: f.excludedFoods,
          trainingTime: f.trainingTime || null,
          splitTrainingRest: f.splitDays,
          useLibrary: f.useLibrary,
          keepSavedMealIds: f.keepSavedMealIds,
          keepMeals: f.typedMeals
            .filter((m) => m.keep)
            .map((m) => ({ name: m.text, ingredients: m.ingredients })),
          usualMeals: [
            ...f.typedMeals.map((m) => m.text),
            ...f.usualMeals
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean),
          ],
        }),
      );
      set({
        draft,
        step: 6,
        savedPlanId: null,
        savePositions: draft.variants[0].meals
          .filter((m) => !m.savedMealId)
          .map((m) => m.position),
      });
    });
  }
  async function save() {
    if (!f.draft || !resources) {
      return;
    }
    await action(async () => {
      const d = f.draft!;
      const created = f.savedPlanId
        ? planSpec.schema
            .parse(await resources.connection.get(planSpec.path))
            .plans.find((p) => p.id === f.savedPlanId)!
        : await confirmedCreate(
            resources,
            planSpec.path,
            {
              name: d.planName,
              mealsPerDay: d.mealsPerDay,
              targetCalories: d.targetCalories,
              targetProteinG: d.targetProteinG,
              targetCarbsG: d.targetCarbsG,
              targetFatG: d.targetFatG,
              trainingTime: d.trainingTime,
              stores: d.stores,
              excludedFoods: d.excludedFoods,
              restrictionsSnapshot: d.restrictionsSnapshot,
              activate: true,
              variants: d.variants.map((v) => ({
                dayType: v.dayType,
                targetCalories: v.targetCalories,
                targetProteinG: v.targetProteinG,
                targetCarbsG: v.targetCarbsG,
                targetFatG: v.targetFatG,
                meals: v.meals.map((m) => ({
                  position: m.position,
                  name: m.name,
                  notes: m.notes ?? null,
                  mealTypeId: m.mealTypeId ?? null,
                  savedMealId: m.savedMealId ?? null,
                  suggestedTime: m.suggestedTime ?? null,
                  targetCalories: m.targetCalories,
                  targetProteinG: m.targetProteinG,
                  targetCarbsG: m.targetCarbsG,
                  targetFatG: m.targetFatG,
                  ingredients: m.ingredients,
                })),
              })),
            },
            async () =>
              planSpec.schema.parse(await resources.connection.get(planSpec.path)).plans,
            (row, p) =>
              row.name === p.name &&
              row.mealsPerDay === p.mealsPerDay &&
              row.targetCalories === p.targetCalories &&
              row.variants[0]?.meals.map((m) => m.name).join('|') ===
                (p.variants as MealPlan['variants'])[0]?.meals.map((m) => m.name).join('|'),
          );
      if (!created) {
        throw new Error('Saved plan unavailable.');
      }
      form.setValue({ ...f, savedPlanId: created.id });
      await resources.saveDraft(draftKey, { ...f, savedPlanId: created.id });
      for (const v of created.variants) {
        for (const m of v.meals) {
          if (f.savePositions.includes(m.position)) {
            await savePlanMeal(n, m);
          }
        }
      }
      setSetup(false);
      form.setValue(initial);
      setSelected(null);
      onClose();
    });
  }
  async function replaceDraft(position: number, instruction?: string) {
    if (!f.draft || !resources) {
      return;
    }
    await action(async () => {
      const d = f.draft!;
      const meal = d.variants[0].meals.find((m) => m.position === position)!;
      const replacement = z
        .object({
          name: z.string(),
          notes: z.string().nullable(),
          ingredients: NutritionIngredientsSchema,
        })
        .parse(
          await resources.connection.post('/api/nutrition/meal-plans/generate/meal', {
            targetCalories: meal.targetCalories,
            targetProteinG: meal.targetProteinG,
            targetCarbsG: meal.targetCarbsG,
            targetFatG: meal.targetFatG,
            stores: d.stores,
            excludedFoods: d.excludedFoods,
            avoidNames: d.variants[0].meals.map((m) => m.name),
            timingRole: meal.timingRole,
            suggestedTime: meal.suggestedTime,
            ...(instruction
              ? { instruction, currentMeal: { name: meal.name, ingredients: meal.ingredients } }
              : {}),
          }),
        );
      const updated = replaceMealInDraft(d as unknown as Draft, position, replacement);
      set({ draft: draftPlanSchema.parse(updated) });
    });
  }
  const current = selected
    ? (state.data?.plans.find((p) => p.id === selected.id) ?? selected)
    : null;
  const variant = current?.variants.find((v) => v.dayType === day) ?? current?.variants[0];
  return (
    <>
      <Sheet
        visible
        fullHeight
        title={setup ? `Meal plan · ${steps[f.step]}` : current ? current.name : 'Meal plans'}
        onClose={onClose}
        actions={
          <StatusIndicator
            label="Meal plans"
            busy={busy || state.loading || (setup && !form.ready)}
            error={error ?? state.error ?? dietary.error ?? form.error}
            onRetry={() => {
              state.refresh();
              dietary.refresh();
            }}
          />
        }
        footer={
          setup ? (
            <Stack direction="row">
              <AppButton
                title="Previous"
                variant="secondary"
                onPress={() => set({ step: Math.max(0, f.step - 1) })}
              />
              <AppButton
                title={f.step === 6 ? (f.draft ? 'Save plan' : 'Generate plan') : 'Next'}
                busy={busy}
                disabled={
                  !form.ready ||
                  (f.step === 6 && !f.restrictionsLoaded) ||
                  (f.step >= 4 && pins.length > Math.max(0, Number(f.mealCount) - 1))
                }
                onPress={() => {
                  if (f.step === 6) {
                    void (f.draft ? save() : generate());
                  } else {
                    set({ step: f.step + 1 });
                  }
                }}
              />
            </Stack>
          ) : undefined
        }
      >
        {setup ? (
          <>
            {f.step === 0 ? (
              <MultiChoice
                label="Where do you shop?"
                value={f.stores}
                options={GROCERY_STORES.map((value) => ({ value, label: value }))}
                onChange={(stores) => set({ stores })}
              />
            ) : f.step === 1 ? (
              <>
                <AppText tone="muted">Allergies and foods to avoid</AppText>
                {dietary.data?.catalogue.map((item) => (
                  <Stack key={item.id} direction="row" align="center">
                    <AppText style={{ flex: 1 }}>{item.label}</AppText>
                    <Picker
                      label={item.label + ' restriction'}
                      value={
                        f.restrictions.find((x) => x.restrictionId === item.id)?.severity ??
                        'none'
                      }
                      options={[
                        { value: 'none', label: 'No restriction' },
                        { value: 'avoid', label: 'Avoid' },
                        { value: 'allergy', label: 'Allergy' },
                      ]}
                      onChange={(severity) =>
                        set({
                          restrictions: [
                            ...f.restrictions.filter((x) => x.restrictionId !== item.id),
                            ...(severity === 'none'
                              ? []
                              : [
                                  {
                                    restrictionId: item.id,
                                    severity: severity as 'avoid' | 'allergy',
                                  },
                                ]),
                          ],
                        })
                      }
                    />
                  </Stack>
                ))}
              </>
            ) : f.step === 2 ? (
              <MultiChoice
                label="Foods you prefer to skip"
                value={f.excludedFoods}
                options={[
                  ...PROTEIN_STAPLES,
                  ...CARB_STAPLES,
                  ...FAT_STAPLES,
                  ...VEG_STAPLES,
                ].map((value) => ({ value, label: value }))}
                onChange={(excludedFoods) => set({ excludedFoods })}
              />
            ) : f.step === 3 ? (
              <>
                <NumericStepper
                  label="Meals per day"
                  value={f.mealCount}
                  min={1}
                  max={6}
                  onChange={changeCount}
                />
                {f.keepSavedMealIds.length > Math.max(0, Number(f.mealCount) - 1) && (
                  <AppText tone="danger">
                    Choose which saved meals to keep in the next step before reducing the count.
                  </AppText>
                )}
              </>
            ) : f.step === 4 ? (
              <>
                <SwitchRow
                  label="Use my saved meals where they fit"
                  value={f.useLibrary}
                  onValueChange={(useLibrary) => set({ useLibrary })}
                />
                <MultiChoice
                  label="Meals to keep"
                  value={f.keepSavedMealIds}
                  options={n.view.meals.map((m) => ({ value: m.id, label: m.name }))}
                  onChange={(keepSavedMealIds) => {
                    if (
                      keepSavedMealIds.length + f.typedMeals.filter((m) => m.keep).length <=
                      Math.max(0, Number(f.mealCount) - 1)
                    ) {
                      set({ keepSavedMealIds });
                    } else {
                      setError(
                        'Leave one slot for a suggestion. Remove a kept meal before choosing another.',
                      );
                    }
                  }}
                />
                <AppText variant="caption" tone="muted">
                  Keep at most {Math.max(0, Number(f.mealCount) - 1)} meals, leaving a slot for
                  a suggestion.
                </AppText>
                <TextField
                  label="A meal you usually eat"
                  value={newText}
                  onChangeText={setNewText}
                />
                <AppButton
                  title="Look up meal"
                  busy={busy}
                  disabled={!newText.trim() || f.typedMeals.length >= 10}
                  onPress={() => void addTyped()}
                />
                {f.typedMeals.map((m, index) => (
                  <Card key={index}>
                    <AppText variant="label">{m.text}</AppText>
                    <MacroLine value={sumIngredients(m.ingredients)} />
                    <SwitchRow
                      label="Keep this meal as written"
                      value={m.keep}
                      onValueChange={(keep) => {
                        if (!keep || pins.length < Math.max(0, Number(f.mealCount) - 1)) {
                          set({
                            typedMeals: f.typedMeals.map((item, i) =>
                              i === index ? { ...item, keep } : item,
                            ),
                          });
                        } else {
                          setError('Leave one slot for a suggestion.');
                        }
                      }}
                    />
                    <AppButton
                      title="Remove meal"
                      variant="ghost"
                      onPress={() =>
                        set({ typedMeals: f.typedMeals.filter((_, i) => i !== index) })
                      }
                    />
                  </Card>
                ))}
                <TextField
                  label="Other usual meals (one per line)"
                  multiline
                  value={f.usualMeals}
                  onChangeText={(usualMeals) => set({ usualMeals })}
                />
              </>
            ) : f.step === 5 ? (
              <>
                <TextField
                  label="Usual training time (HH:MM, optional)"
                  value={f.trainingTime}
                  onChangeText={(trainingTime) => set({ trainingTime })}
                />
                <SwitchRow
                  label="Separate training and rest days"
                  value={f.splitDays}
                  onValueChange={(splitDays) => set({ splitDays })}
                />
              </>
            ) : f.draft ? (
              <>
                <TextField
                  label="Plan name"
                  value={f.draft.planName}
                  onChangeText={(planName) => set({ draft: { ...f.draft!, planName } })}
                />
                {f.draft.allergies.length > 0 && (
                  <Card tone="heart">
                    <AppText variant="eyebrow">Must not contain</AppText>
                    <AppText>{f.draft.allergies.join(', ')}</AppText>
                    <AppText variant="caption" tone="muted">
                      Written by AI. Review the ingredients before accepting the plan.
                    </AppText>
                  </Card>
                )}
                {Array.isArray(f.draft.droppedPins) && f.draft.droppedPins.length > 0 && (
                  <AppText tone="muted">
                    There was no room for {f.draft.droppedPins.join(', ')}. Go back to increase
                    the meal count if you want to keep them.
                  </AppText>
                )}
                {f.draft.macrosAdjusted === true && (
                  <AppText variant="caption" tone="muted">
                    This plan keeps protein and fat and fits carbs to{' '}
                    {Math.round(f.draft.targetCarbsG)} g so its macros match the calorie target.
                    Your saved targets are unchanged.
                  </AppText>
                )}
                {f.draft.variants.length > 1 && (
                  <SegmentedControl
                    label="Review plan variant"
                    value={
                      (
                        f.draft.variants.find((v) => v.dayType === draftDay) ??
                        f.draft.variants[0]
                      ).dayType
                    }
                    options={f.draft.variants.map((v) => ({
                      value: v.dayType,
                      label: v.dayType + ' day',
                    }))}
                    onChange={setDraftDay}
                  />
                )}
                {f.draft.variants
                  .filter(
                    (v) =>
                      v ===
                      (f.draft!.variants.find((v) => v.dayType === draftDay) ??
                        f.draft!.variants[0]),
                  )
                  .map((v) => (
                    <Disclosure key={v.dayType} title={v.dayType + ' days'} defaultOpen>
                      <MacroLine
                        value={{
                          calories: v.targetCalories,
                          proteinG: v.targetProteinG,
                          carbsG: v.targetCarbsG,
                          fatG: v.targetFatG,
                        }}
                      />
                      <MacroComparison
                        label="Planned day versus targets"
                        target={v}
                        actual={
                          v.meals.some((m) => m.actual != null)
                            ? v.meals.reduce(
                                (sum, m) => ({
                                  calories: sum.calories + (m.actual?.calories ?? 0),
                                  proteinG: sum.proteinG + (m.actual?.proteinG ?? 0),
                                  carbsG: sum.carbsG + (m.actual?.carbsG ?? 0),
                                  fatG: sum.fatG + (m.actual?.fatG ?? 0),
                                }),
                                { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
                              )
                            : null
                        }
                      />
                      {v.meals.map((m) => (
                        <Card key={m.position}>
                          <AppText variant="heading">{m.name}</AppText>
                          <Badge label={m.source ?? 'Generated'} />
                          <AppText variant="caption" tone="muted">
                            {m.suggestedTime} · target {Math.round(m.targetCalories)} kcal
                          </AppText>
                          <MacroComparison
                            label={m.name + ' versus targets'}
                            actual={m.actual ?? null}
                            target={m}
                          />
                          {m.notes && (
                            <AppText variant="caption" tone="muted">
                              {m.notes}
                            </AppText>
                          )}
                          {m.ingredients.map((i, index) => (
                            <AppText key={index} variant="caption" tone="muted">
                              {i.name} · {Math.round(i.weightG)} g
                            </AppText>
                          ))}
                          <Disclosure title="Edit ingredients">
                            {m.ingredients.map((ing, index) => (
                              <NumericStepper
                                key={index}
                                label={ing.name + ' (g)'}
                                value={String(ing.weightG)}
                                min={0.1}
                                max={5000}
                                step={5}
                                onChange={(weight) => {
                                  const draft = {
                                    ...f.draft!,
                                    variants: f.draft!.variants.map((variant) => ({
                                      ...variant,
                                      meals: variant.meals.map((meal) => {
                                        if (meal.position !== m.position) {
                                          return meal;
                                        }
                                        const ingredients = meal.ingredients.map((item, i) =>
                                          i === index
                                            ? { ...item, weightG: Number(weight) }
                                            : item,
                                        );
                                        return {
                                          ...meal,
                                          ingredients,
                                          actual: sumIngredients(ingredients),
                                        };
                                      }),
                                    })),
                                  };
                                  set({ draft });
                                }}
                              />
                            ))}
                          </Disclosure>
                          <SwitchRow
                            label="Save to My Foods when confirmed"
                            value={f.savePositions.includes(m.position)}
                            disabled={!!m.savedMealId}
                            onValueChange={(enabled) =>
                              set({
                                savePositions: enabled
                                  ? [...new Set([...f.savePositions, m.position])]
                                  : f.savePositions.filter((p) => p !== m.position),
                              })
                            }
                          />
                          <Stack direction="row">
                            <AppButton
                              title="Replace meal"
                              variant="secondary"
                              busy={busy}
                              onPress={() => {
                                setSwap(m.position);
                                setDraftInstruction('');
                              }}
                            />
                            <AppButton
                              title="Move up"
                              variant="ghost"
                              disabled={m.position === 0}
                              onPress={() =>
                                set({
                                  draft: draftPlanSchema.parse(
                                    reorderDraft(
                                      f.draft as unknown as Draft,
                                      m.position,
                                      m.position - 1,
                                    ),
                                  ),
                                })
                              }
                            />
                          </Stack>
                        </Card>
                      ))}
                    </Disclosure>
                  ))}
                <AppButton
                  title="Generate again"
                  variant="secondary"
                  busy={busy}
                  onPress={() => void generate()}
                />
              </>
            ) : (
              <>
                {f.savedPlanId && (
                  <AppText tone="muted">
                    This plan is already saved. Continue to finish copying recipes; use Manage
                    plan to edit it.
                  </AppText>
                )}
                <AppText>Review your choices and generate a draft.</AppText>
                <AppText variant="caption" tone="muted">
                  {f.mealCount} meals · {f.stores.join(', ') || 'Any store'} ·{' '}
                  {f.splitDays ? 'Training/rest split' : 'Same plan each day'}
                </AppText>
              </>
            )}
          </>
        ) : current && variant ? (
          <>
            <SegmentedControl
              label="Plan day"
              value={variant.dayType}
              options={current.variants.map((v) => ({ value: v.dayType, label: v.dayType }))}
              onChange={setDay}
            />
            <MacroLine
              value={{
                calories: variant.targetCalories,
                proteinG: variant.targetProteinG,
                carbsG: variant.targetCarbsG,
                fatG: variant.targetFatG,
              }}
            />
            <AppButton
              title={current.isActive ? 'Deactivate plan' : 'Activate plan'}
              onPress={() =>
                void action(() =>
                  resources!.write(
                    'PATCH',
                    `/api/nutrition/meal-plans/${current.id}`,
                    { isActive: !current.isActive },
                    ['/api/nutrition/meal-plans'],
                  ),
                )
              }
            />
            {variant.meals.map((m) => (
              <Card key={m.id}>
                <ListRow
                  title={m.name}
                  subtitle={`${m.suggestedTime ?? ''} · ${m.targetCalories} kcal`}
                  onPress={() => {
                    setEdit({ plan: current, meal: m });
                    setInstruction('');
                  }}
                />
                <MacroLine
                  value={
                    m.ingredients.length
                      ? sumIngredients(m.ingredients)
                      : {
                          calories: m.targetCalories,
                          proteinG: m.targetProteinG,
                          carbsG: m.targetCarbsG,
                          fatG: m.targetFatG,
                        }
                  }
                />
                <AppButton
                  title="Log this meal"
                  variant="secondary"
                  onPress={() => void action(() => logPlanMeal(n, m, dateFor(n), current))}
                />
                <AppButton
                  title="Save to My Foods"
                  variant="ghost"
                  onPress={() => void action(() => savePlanMeal(n, m))}
                />
              </Card>
            ))}
            <AppButton
              title="Plan structure"
              variant="surface"
              onPress={() => setStructure(true)}
            />
            <AppButton
              title="Review plan"
              variant="secondary"
              onPress={() =>
                void action(() =>
                  resources!.write(
                    'POST',
                    `/api/nutrition/meal-plans/${current.id}/review`,
                    {},
                    ['/api/nutrition/meal-plans'],
                  ),
                )
              }
            />
            <AppButton title="Delete plan" variant="danger" onPress={() => setRemove(true)} />
            <AppButton title="All plans" variant="ghost" onPress={() => setSelected(null)} />
          </>
        ) : (
          <>
            <AppButton
              title="Create a meal plan"
              onPress={() => {
                setSetup(true);
                set({ step: f.draft ? 6 : 0 });
              }}
            />
            {state.data?.plans.map((plan) => (
              <ListRow
                key={plan.id}
                title={plan.name}
                subtitle={`${plan.isActive ? 'Active · ' : ''}${plan.mealsPerDay} meals · ${plan.targetCalories} kcal`}
                onPress={() => {
                  setSelected(plan);
                  setDay(plan.variants[0]?.dayType ?? 'all');
                }}
              />
            ))}
          </>
        )}
      </Sheet>
      {structure && current && (
        <PlanStructure
          plan={current}
          onClose={() => setStructure(false)}
          onSaved={() => {
            setStructure(false);
            state.refresh();
          }}
        />
      )}
      <Sheet visible={remove && !!current} title="Delete plan" onClose={() => setRemove(false)}>
        {current && (
          <ConfirmationCard
            title={'Delete ' + current.name + '?'}
            message="Saved recipes and logged history are kept."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            onCancel={() => setRemove(false)}
            onConfirm={() =>
              void action(async () => {
                await resources!.write('DELETE', `${planSpec.path}/${current.id}`, {}, [
                  planSpec.path,
                ]);
                setSelected(null);
                setRemove(false);
              })
            }
          />
        )}
      </Sheet>
      <Sheet
        visible={swap !== null}
        fullHeight
        title="Replace meal"
        onClose={() => setSwap(null)}
      >
        <AppButton
          title="Generate another suggestion"
          busy={busy}
          onPress={() => {
            if (swap != null) {
              void replaceDraft(swap);
              setSwap(null);
            }
          }}
        />
        <TextField
          label="What to change about this meal"
          value={draftInstruction}
          onChangeText={setDraftInstruction}
        />
        <AppButton
          title="Apply instruction"
          disabled={!draftInstruction.trim()}
          busy={busy}
          onPress={() => {
            if (swap != null) {
              void replaceDraft(swap, draftInstruction.trim());
              setSwap(null);
            }
          }}
        />
        <AppButton
          title="One of mine · best fit"
          variant="secondary"
          onPress={() => {
            if (f.draft && swap != null) {
              const variant =
                f.draft.variants.find((v) => v.dayType === draftDay) ?? f.draft.variants[0];
              const slot = variant.meals.find((m) => m.position === swap);
              const fit = slot
                ? libraryMealForSlot(
                    slot as unknown as Draft['variants'][number]['meals'][number],
                    n.view.meals.map(asSharedMeal),
                    n.view.mealTypes,
                    usedSavedMealIds(
                      variant.meals as unknown as Draft['variants'][number]['meals'],
                    ),
                  )
                : null;
              if (!fit) {
                setError('Nothing in My Foods fits this slot.');
                return;
              }
              set({
                draft: draftPlanSchema.parse(
                  replaceMealInDraft(f.draft as unknown as Draft, swap, {
                    name: fit.meal.name,
                    notes: null,
                    ingredients: savedMealToIngredients(fit.meal),
                    fromLibrary: { savedMealId: fit.meal.id, matchReason: fit.matchReason },
                  }),
                ),
              });
              setSwap(null);
            }
          }}
        />
        <AppText variant="heading">From My Foods</AppText>
        {n.view.meals.map((m) => (
          <ListRow
            key={m.id}
            title={m.name}
            subtitle={m.mealTypeIds
              .map((id) => n.view.mealTypes.find((t) => t.id === id)?.name)
              .filter(Boolean)
              .join(' · ')}
            onPress={() => {
              if (f.draft && swap != null) {
                const draft = replaceMealInDraft(f.draft as unknown as Draft, swap, {
                  name: m.name,
                  notes: null,
                  ingredients: savedMealToIngredients(asSharedMeal(m)),
                  fromLibrary: { savedMealId: m.id, matchReason: 'Chosen from My Foods' },
                });
                set({ draft: draftPlanSchema.parse(draft) });
                setSwap(null);
              }
            }}
          />
        ))}
      </Sheet>
      <Sheet
        visible={reduction !== null}
        title="Choose meals to keep"
        onClose={() => setReduction(null)}
      >
        {reduction && (
          <>
            <AppText>
              Keep at most {Math.max(0, reduction.count - 1)} meals, leaving room for a
              suggestion.
            </AppText>
            <MultiChoice
              label="Meals to keep"
              value={reduction.keys}
              options={pins.map((p) => ({ value: p.key, label: p.name }))}
              onChange={(keys) => setReduction({ ...reduction, keys })}
            />
            <AppButton
              title="Apply meal count"
              disabled={reduction.keys.length > Math.max(0, reduction.count - 1)}
              onPress={() => {
                const kept = applyReduction(reduction.keys, f.keepSavedMealIds, f.typedMeals);
                set({
                  mealCount: String(reduction.count),
                  keepSavedMealIds: kept.selectedIds,
                  typedMeals: kept.typedMeals,
                });
                setReduction(null);
              }}
            />
          </>
        )}
      </Sheet>
      {error?.startsWith('The previous save') && (
        <Sheet visible title="Check previous plan save" onClose={() => setError(null)}>
          <ConfirmationCard
            title="Start another save?"
            message="Check All plans first. Use Save plan again to check whether the previous save arrived. Starting another save may create a duplicate."
            confirmLabel="Start another save"
            cancelLabel="Keep checking"
            onCancel={() => setError(null)}
            onConfirm={async () => {
              await resources?.clearDraft('nutrition-create:' + planSpec.path);
              setError(null);
            }}
          />
        </Sheet>
      )}
      <Sheet
        visible={edit !== null}
        fullHeight
        title={edit?.meal.name ?? 'Meal'}
        onClose={() => setEdit(null)}
      >
        {edit && (
          <>
            <TextField
              label="Meal name"
              value={edit.meal.name}
              onChangeText={(name) => setEdit({ ...edit, meal: { ...edit.meal, name } })}
            />
            <TextField
              label="Notes"
              multiline
              value={edit.meal.notes ?? ''}
              onChangeText={(notes) => setEdit({ ...edit, meal: { ...edit.meal, notes } })}
            />
            <Picker
              label="Meal group"
              value={edit.meal.mealTypeId ?? ''}
              options={[
                { value: '', label: 'Use suggested time' },
                ...n.view.mealTypes.map((t) => ({ value: t.id, label: t.name })),
              ]}
              onChange={(mealTypeId) =>
                setEdit({ ...edit, meal: { ...edit.meal, mealTypeId: mealTypeId || null } })
              }
            />
            <TextField
              label="Suggested time (HH:MM)"
              value={edit.meal.suggestedTime ?? ''}
              onChangeText={(suggestedTime) =>
                setEdit({
                  ...edit,
                  meal: { ...edit.meal, suggestedTime: suggestedTime || null },
                })
              }
            />
            {edit.meal.ingredients.map((ing, index) => (
              <NumericStepper
                key={index}
                label={ing.name + ' (g)'}
                value={String(ing.weightG)}
                min={0.1}
                max={5000}
                step={5}
                onChange={(weight) =>
                  setEdit({
                    ...edit,
                    meal: {
                      ...edit.meal,
                      ingredients: edit.meal.ingredients.map((x, i) =>
                        i === index ? { ...x, weightG: Number(weight) } : x,
                      ),
                    },
                  })
                }
              />
            ))}
            <AppButton
              title="Save changes"
              busy={busy}
              onPress={() =>
                void action(async () => {
                  await n.store?.sync();
                  if (
                    n.store
                      ?.getSnapshot()
                      .http.some(
                        (op) =>
                          op.kind === 'plan-link' && op.payload.planMealId === edit.meal.id,
                      )
                  ) {
                    throw new Error(
                      'Finish uploading this meal’s library copy before editing it.',
                    );
                  }
                  const original = edit.plan.variants
                    .flatMap((v) => v.meals)
                    .find((m) => m.id === edit.meal.id);
                  const changed =
                    original?.name !== edit.meal.name ||
                    JSON.stringify(original?.ingredients) !==
                      JSON.stringify(edit.meal.ingredients);
                  await resources!.write(
                    'PATCH',
                    `/api/nutrition/meal-plans/meals/${edit.meal.id}`,
                    {
                      name: edit.meal.name,
                      notes: edit.meal.notes,
                      mealTypeId: edit.meal.mealTypeId,
                      suggestedTime: edit.meal.suggestedTime,
                      ingredients: edit.meal.ingredients,
                      ...(changed ? { savedMealId: null } : {}),
                    },
                    ['/api/nutrition/meal-plans'],
                  );
                  if (changed && edit.meal.id) {
                    await n.store?.forgetPlanLink(edit.meal.id);
                  }
                  setEdit(null);
                })
              }
            />
            <TextField
              label="Change this meal"
              value={instruction}
              onChangeText={setInstruction}
            />
            <AppButton
              title="Suggest a replacement"
              busy={busy}
              onPress={() =>
                void action(async () => {
                  const m = edit.meal;
                  const replacement = z
                    .object({
                      name: z.string(),
                      ingredients: NutritionIngredientsSchema,
                      notes: z.string().nullable(),
                    })
                    .parse(
                      await resources!.connection.post(
                        '/api/nutrition/meal-plans/generate/meal',
                        {
                          targetCalories: m.targetCalories,
                          targetProteinG: m.targetProteinG,
                          targetCarbsG: m.targetCarbsG,
                          targetFatG: m.targetFatG,
                          stores: edit.plan.stores,
                          excludedFoods: edit.plan.excludedFoods,
                          ...(instruction.trim()
                            ? {
                                instruction: instruction.trim(),
                                currentMeal: { name: m.name, ingredients: m.ingredients },
                              }
                            : { avoidNames: edit.plan.variants[0].meals.map((x) => x.name) }),
                        },
                      ),
                    );
                  setEdit({ ...edit, meal: { ...m, ...replacement } });
                })
              }
            />
          </>
        )}
      </Sheet>
    </>
  );
}
function dateFor(n: ReturnType<typeof useNutrition>) {
  return n.date;
}
export { ActiveMealPlan } from './PlanMeals';
