import { scaleIngredientsToTargets } from '@trainingai/shared/nutrition/meal-split';
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals';
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition';
export interface DraftMealTotals {
  servingSizeG: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}
export interface DraftMeal {
  position: number;
  name: string;
  savedMealId?: string | null;
  source?: 'kept' | 'library' | 'ai';
  matchReason?: string | null;
  notes: string | null;
  ingredients: NutritionIngredient[];
  actual: DraftMealTotals | null;
  suggestedTime: string;
  timingRole: 'pre_workout' | 'post_workout' | null;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
}
export interface DraftVariant {
  dayType: 'all' | 'training' | 'rest';
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  meals: DraftMeal[];
}
export interface Draft {
  planName: string;
  mealsPerDay: number;
  trainingTime: string | null;
  stores: string[];
  excludedFoods: string[];
  restrictionsSnapshot: {
    code: string;
    label: string;
    severity: 'avoid' | 'allergy';
  }[];
  restDayAdjustment?: string;
  macrosAdjusted?: boolean;
  targetCalories: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  variants: DraftVariant[];
  allergies: string[];
  droppedPins?: string[];
  libraryMatchCount?: number;
}
export interface RegeneratedMeal {
  name: string;
  notes: string | null;
  ingredients: NutritionIngredient[];
  fromLibrary?: {
    savedMealId: string;
    matchReason: string;
  };
}
export function replaceMealInDraft(
  draft: Draft,
  position: number,
  meal: RegeneratedMeal,
): Draft {
  return {
    ...draft,
    variants: draft.variants.map((v) => ({
      ...v,
      meals: v.meals.map((m) => {
        if (m.position !== position) return m;
        const ingredients = scaleIngredientsToTargets(meal.ingredients, {
          proteinG: m.targetProteinG,
          carbsG: m.targetCarbsG,
          fatG: m.targetFatG,
        }) as NutritionIngredient[];
        return {
          ...m,
          name: meal.name,
          savedMealId: meal.fromLibrary?.savedMealId ?? null,
          source: meal.fromLibrary ? 'library' : 'ai',
          matchReason: meal.fromLibrary?.matchReason ?? null,
          notes: meal.notes,
          ingredients,
          actual: ingredients.length > 0 ? sumIngredients(ingredients) : null,
        };
      }),
    })),
  };
}
export function reorderDraft(draft: Draft, from: number, to: number): Draft {
  const count = draft.variants[0]?.meals.length ?? 0;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return draft;
  return {
    ...draft,
    variants: draft.variants.map((v) => {
      const byPosition = [...v.meals].sort((a, b) => a.position - b.position);
      const moved = byPosition.splice(from, 1)[0];
      if (!moved) return v;
      byPosition.splice(to, 0, moved);
      return {
        ...v,
        meals: byPosition.map((meal, position) => {
          const slot = v.meals.find((m) => m.position === position)!;
          const ingredients = scaleIngredientsToTargets(meal.ingredients, {
            proteinG: slot.targetProteinG,
            carbsG: slot.targetCarbsG,
            fatG: slot.targetFatG,
          }) as NutritionIngredient[];
          return {
            ...meal,
            position,
            suggestedTime: slot.suggestedTime,
            timingRole: slot.timingRole,
            targetCalories: slot.targetCalories,
            targetProteinG: slot.targetProteinG,
            targetCarbsG: slot.targetCarbsG,
            targetFatG: slot.targetFatG,
            ingredients,
            actual: ingredients.length > 0 ? sumIngredients(ingredients) : null,
          };
        }),
      };
    }),
  };
}
