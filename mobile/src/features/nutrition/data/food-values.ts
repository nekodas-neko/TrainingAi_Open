import { sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals';
import { FoodItemPushSchema, type Food } from './models.ts';
import { z } from 'zod';

export function foodValidationMessage(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  const labels: Record<string, string> = {
    name: 'a food name',
    servingSizeG: 'a serving size greater than zero',
    calories: 'a valid calorie amount (kcal)',
    proteinG: 'a valid protein amount (g)',
    carbsG: 'a valid carbohydrate amount (g)',
    fatG: 'a valid fat amount (g)',
    fiberG: 'a valid fibre amount (g)',
    sugarG: 'a valid sugar amount (g)',
    sodiumMg: 'a valid sodium amount (mg)',
    satFatG: 'a valid saturated fat amount (g)',
  };
  return typeof field === 'string' && labels[field]
    ? `Enter ${labels[field]}.`
    : 'Check the food details and amounts.';
}
export type FoodEntry = Pick<
  Food,
  | 'name'
  | 'brand'
  | 'servingSizeG'
  | 'calories'
  | 'proteinG'
  | 'carbsG'
  | 'fatG'
  | 'fiberG'
  | 'sugarG'
  | 'sodiumMg'
  | 'satFatG'
  | 'source'
  | 'barcode'
  | 'imageDataUri'
> & { id?: string; quantityMultiplier: number };
export function normaliseFood(input: FoodEntry, id: string) {
  const { quantityMultiplier, ...food } = input;
  if (!food.source || food.source === 'manual') {
    return FoodItemPushSchema.parse({
      ...food,
      id,
      brand: food.brand ?? undefined,
      barcode: food.barcode ?? undefined,
    });
  }
  return FoodItemPushSchema.parse({
    ...food,
    id,
    brand: food.brand ?? undefined,
    barcode: food.barcode ?? undefined,
    ...sanitiseNutrition({
      name: food.name,
      servingSizeG: food.servingSizeG,
      calories: food.calories,
      proteinG: food.proteinG,
      carbsG: food.carbsG,
      fatG: food.fatG,
      fiberG: food.fiberG ?? undefined,
      sugarG: food.sugarG ?? undefined,
      sodiumMg: food.sodiumMg ?? undefined,
      satFatG: food.satFatG ?? undefined,
    }),
  });
}
