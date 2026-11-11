import {
  correctedServingG,
  parsePortionCorrection,
  rescaleToServing,
} from '@trainingai/shared/nutrition/portion-correction';
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals';
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition';

type Fields = Record<string, string>;

const scaled = [
  'calories',
  'proteinG',
  'carbsG',
  'fatG',
  'fiberG',
  'sugarG',
  'sodiumMg',
  'satFatG',
] as const;

const number = (text: string | undefined) => {
  const value = Number(text ?? '');
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

/**
 * A correction that only changes the portion ("it was 300 g", "2 servings"), answered on the phone
 * the way the current app's Review step answers it (#3725): the form's figures rescaled to the new
 * serving size, with no request. Null for anything else, and for a form with no serving size to
 * scale from; those go to the model as before.
 *
 * The form's own figures are the base, so a number the person already corrected by hand is scaled
 * rather than replaced. A food made of ingredients has each weight scaled and its totals re-summed,
 * so what is logged per ingredient still adds up to what the form shows.
 */
export function portionRefine(
  correction: string,
  fields: Fields,
  ingredients: NutritionIngredient[],
): { fields: Fields; ingredients: NutritionIngredient[] } | null {
  const portion = parsePortionCorrection(correction);
  if (!portion) return null;
  const base = {
    servingSizeG: number(fields.servingSizeG),
    ...(Object.fromEntries(scaled.map((key) => [key, number(fields[key])])) as Record<
      (typeof scaled)[number],
      number
    >),
  };
  if (!(base.servingSizeG > 0)) return null;
  const grams = correctedServingG(portion, base.servingSizeG);
  const next = grams == null ? null : rescaleToServing(base, grams);
  if (!next) return null;
  const factor = next.servingSizeG / base.servingSizeG;
  const resized = ingredients.map((ingredient) => ({
    ...ingredient,
    weightG: Math.round(ingredient.weightG * factor * 10) / 10,
  }));
  const figures = resized.length ? { ...next, ...sumIngredients(resized) } : next;
  return {
    fields: {
      ...fields,
      ...Object.fromEntries(Object.entries(figures).map(([key, value]) => [key, String(value)])),
    },
    ingredients: resized,
  };
}

/**
 * Refine, in the order that matters: the phone's own answer first, the model only when there is
 * none. Kept out of the component so a test can hold the model's side and see it is never reached
 * for a portion.
 */
export function refineEstimate(
  input: { correction: string; fields: Fields; ingredients: NutritionIngredient[] },
  actions: {
    applyLocal: (result: { fields: Fields; ingredients: NutritionIngredient[] }) => void;
    askModel: () => void;
  },
): 'local' | 'model' {
  const local = portionRefine(input.correction, input.fields, input.ingredients);
  if (local) {
    actions.applyLocal(local);
    return 'local';
  }
  actions.askModel();
  return 'model';
}
