import {
  DayCheckinExtrasSchema,
  DayCheckinScalesSchema,
} from '@trainingai/shared/validation/day-checkin';
import { FoodItemPushSchema } from '@trainingai/shared/validation/food-item';
import { goalBoundSchema } from '@trainingai/shared/validation/goal-bounds';
import { SupplementCreateSchema } from '@trainingai/shared/validation/supplement';
import { NutritionIngredientsSchema } from '@trainingai/shared/validators/nutrition-ingredient';
import { SavedMealSchema } from '@trainingai/shared/validators/saved-meal';
import { z } from 'zod';
const n = z.number().finite();
const optionalNumber = n.nullish();
const optionalText = z.string().nullish();
export const mealTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string(),
    sortOrder: n,
    timeStartHour: n,
    timeEndHour: n,
    remindersEnabled: z.boolean(),
    required: z.boolean(),
  })
  .passthrough();
export const mealTypeBody = mealTypeSchema.omit({ id: true }).strict();
export const foodSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    brand: optionalText,
    servingSizeG: n,
    calories: n,
    proteinG: n,
    carbsG: n,
    fatG: n,
    fiberG: optionalNumber,
    sugarG: optionalNumber,
    sodiumMg: optionalNumber,
    satFatG: optionalNumber,
    source: z.string(),
    barcode: optionalText,
    imageDataUri: optionalText,
  })
  .passthrough();
export type Food = z.infer<typeof foodSchema>;
export const logSchema = z
  .object({
    id: z.string(),
    date: z.string(),
    mealTypeId: z.string(),
    foodItemId: z.string(),
    quantityMultiplier: n,
    loggedAt: z.string(),
    savedMealId: optionalText,
    mealGroupId: optionalText,
    mealGroupName: optionalText,
    foodItem: foodSchema,
    calories: n,
    proteinG: n,
    carbsG: n,
    fatG: n,
    fiberG: optionalNumber,
    sugarG: optionalNumber,
    sodiumMg: optionalNumber,
    satFatG: optionalNumber,
  })
  .passthrough();
export type FoodLog = z.infer<typeof logSchema>;
export const mealLoggingChoiceSchema = z.object({
  mealTypeId: z.uuid(),
  skipped: z.boolean(),
  decisionId: z.uuid(),
});
export const mealSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    servings: n,
    imageDataUri: optionalText,
    mealTypeIds: z.array(z.string()).default([]),
    items: z.array(
      z
        .object({
          id: z.string().optional(),
          foodItemId: z.string(),
          quantityMultiplier: n,
          foodItem: foodSchema,
        })
        .passthrough(),
    ),
    totals: z.object({ calories: n, proteinG: n, carbsG: n, fatG: n }),
    lastUsedAt: optionalText,
  })
  .passthrough();
export type SavedMeal = z.infer<typeof mealSchema>;
export const supplementSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    dose: optionalText,
    defaultAmount: optionalNumber,
    unit: optionalText,
    startedOn: optionalText,
    stoppedOn: optionalText,
    dosePrompt: z.boolean().default(false),
    reminderEnabled: z.boolean(),
    reminderTime: optionalText,
    sortOrder: n,
    active: z.boolean(),
    loggedToday: z.boolean().default(false),
    loggedDose: z
      .object({
        amount: optionalNumber,
        unit: optionalText,
        doseText: optionalText,
        takenAt: optionalText,
        vialStrengthMg: optionalNumber,
        vialWaterMl: optionalNumber,
        vialUnitsPerMl: optionalNumber,
      })
      .nullish(),
    loggedAmount: z
      .object({
        amount: optionalNumber,
        unit: optionalText,
        contributions: n,
        mixedUnits: z.boolean().optional(),
      })
      .nullish(),
  })
  .passthrough();
export type Supplement = z.infer<typeof supplementSchema>;
export const targetsSchema = z
  .object({
    calories: optionalNumber,
    proteinG: optionalNumber,
    carbsG: optionalNumber,
    fatG: optionalNumber,
    fiberG: optionalNumber,
  })
  .passthrough();
export const targetsBody = z
  .object({
    calories: goalBoundSchema('calories').nullish(),
    proteinG: goalBoundSchema('proteinG').nullish(),
    carbsG: goalBoundSchema('carbsG').nullish(),
    fatG: goalBoundSchema('fatG').nullish(),
    fiberG: goalBoundSchema('fiberG').nullish(),
  })
  .strict();
export const eveningSchema = DayCheckinScalesSchema.merge(DayCheckinExtrasSchema)
  .extend({ phase: z.literal('evening') })
  .strict();
export const answerSchema = z
  .object({
    planMealId: z.string(),
    logDate: z.string(),
    answer: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();
export const coreSpecs = {
  mealTypes: { path: '/api/nutrition/meal-types', schema: z.array(mealTypeSchema) },
  foods: { path: '/api/nutrition/food-items', schema: z.array(foodSchema) },
  meals: { path: '/api/nutrition/saved-meals', schema: z.array(mealSchema) },
  supplements: { path: '/api/supplements', schema: z.array(supplementSchema) },
  targets: { path: '/api/nutrition/targets', schema: targetsSchema },
};
export const foodLogsSpec = (date: string) => ({
  path: '/api/nutrition/food-logs',
  query: { date },
  schema: z.array(logSchema),
  ttl: 300000,
});
export const weeklySpec = {
  path: '/api/nutrition/weekly-summary',
  ttl: 300000,
  schema: z.array(
    z.object({
      date: z.string(),
      calories: n,
      proteinG: n,
      carbsG: n,
      fatG: n,
      logged: z.boolean().optional(),
      isToday: z.boolean().optional(),
    }),
  ),
};
export const adherenceSpec = {
  path: '/api/nutrition/adherence',
  ttl: 300000,
  schema: z
    .object({ requiredMealTypeCount: n, adherence7d: n.nullable(), adherence28d: n.nullable() })
    .passthrough(),
};
export const restrictionSpec = {
  path: '/api/nutrition/dietary-restrictions',
  ttl: 3600000,
  schema: z.object({
    catalogue: z.array(
      z
        .object({
          id: z.string(),
          code: z.string(),
          label: z.string(),
          category: z.string(),
          synonyms: z.array(z.string()).default([]),
        })
        .passthrough(),
    ),
    mine: z.array(
      z
        .object({ restrictionId: z.string(), severity: z.enum(['avoid', 'allergy']) })
        .passthrough(),
    ),
  }),
};
export const planMealSchema = z
  .object({
    id: z.string().optional(),
    position: n,
    name: z.string(),
    mealTypeId: optionalText,
    savedMealId: optionalText,
    notes: optionalText,
    suggestedTime: optionalText,
    targetCalories: n,
    targetProteinG: n,
    targetCarbsG: n,
    targetFatG: n,
    ingredients: NutritionIngredientsSchema.default([]),
    actual: z
      .object({ calories: n, proteinG: n, carbsG: n, fatG: n, servingSizeG: n })
      .nullish(),
    source: z.string().optional(),
    matchReason: optionalText,
  })
  .passthrough();
export const variantSchema = z
  .object({
    id: z.string().optional(),
    dayType: z.enum(['all', 'training', 'rest']),
    targetCalories: n,
    targetProteinG: n,
    targetCarbsG: n,
    targetFatG: n,
    meals: z.array(planMealSchema),
  })
  .passthrough();
export const planSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    mealsPerDay: n,
    targetCalories: n,
    targetProteinG: n,
    targetCarbsG: n,
    targetFatG: n,
    trainingTime: optionalText,
    stores: z.array(z.string()).default([]),
    excludedFoods: z.array(z.string()).default([]),
    restrictionsSnapshot: z
      .array(
        z.object({
          code: z.string(),
          label: z.string(),
          severity: z.enum(['avoid', 'allergy']),
        }),
      )
      .default([]),
    avoidNote: optionalText,
    generatedAt: z.string(),
    lastReviewedAt: optionalText,
    variants: z.array(variantSchema),
  })
  .passthrough();
export type MealPlan = z.infer<typeof planSchema>;
export const planSpec = {
  path: '/api/nutrition/meal-plans',
  ttl: 300000,
  schema: z.object({ plans: z.array(planSchema), activePlanId: z.string().nullable() }),
};
export const draftPlanSchema = planSchema
  .omit({
    id: true,
    name: true,
    isActive: true,
    generatedAt: true,
    lastReviewedAt: true,
    avoidNote: true,
  })
  .extend({ planName: z.string(), allergies: z.array(z.string()).default([]) })
  .passthrough();
export type PlanDraft = z.infer<typeof draftPlanSchema>;
export const scanSchema = z
  .object({
    name: z.string(),
    brand: optionalText,
    servingSizeG: n,
    calories: n,
    proteinG: n,
    carbsG: n,
    fatG: n,
    fiberG: optionalNumber,
    sugarG: optionalNumber,
    sodiumMg: optionalNumber,
    satFatG: optionalNumber,
    origin: z.enum(['barcode', 'search', 'photo', 'text', 'url']).optional(),
    barcode: optionalText,
    imageDataUri: optionalText,
    notes: optionalText,
    confidence: z.string().optional(),
    ingredients: NutritionIngredientsSchema.optional(),
    candidates: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type Scan = z.infer<typeof scanSchema>;
export const nutritionPaths = [
  '/api/day-timeline',
  '/api/nutrition',
  '/api/body-metadata',
  '/api/progress-summary',
  '/api/health-trends',
  '/api/health/trends',
  '/api/day-log',
  '/api/day-checkin',
  '/api/body-battery',
  '/api/readiness-score',
  '/api/weekly-digest',
  '/api/health/dose-vitals',
  '/api/supplements',
  '/api/next-session',
];
export function totals(
  rows: readonly Pick<Food, 'calories' | 'proteinG' | 'carbsG' | 'fatG'>[],
) {
  return rows.reduce(
    (sum, row) => ({
      calories: sum.calories + row.calories,
      proteinG: sum.proteinG + row.proteinG,
      carbsG: sum.carbsG + row.carbsG,
      fatG: sum.fatG + row.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}
export function scaledLog(
  food: Food,
  row: Pick<
    FoodLog,
    | 'id'
    | 'date'
    | 'mealTypeId'
    | 'foodItemId'
    | 'quantityMultiplier'
    | 'loggedAt'
    | 'savedMealId'
    | 'mealGroupId'
    | 'mealGroupName'
  >,
): FoodLog {
  return {
    ...row,
    foodItem: food,
    ...scaleFood(food, row.quantityMultiplier),
  };
}
export function scaleFood(food: Food, q: number) {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    calories: Math.round(food.calories * q),
    proteinG: round(food.proteinG * q),
    carbsG: round(food.carbsG * q),
    fatG: round(food.fatG * q),
    ...Object.fromEntries(
      ['fiberG', 'sugarG', 'sodiumMg', 'satFatG'].flatMap((key) =>
        typeof food[key] === 'number' ? [[key, round((food[key] as number) * q)]] : [],
      ),
    ),
  };
}
export { FoodItemPushSchema, SavedMealSchema, SupplementCreateSchema };
