import { z } from 'zod'
import { ModelIngredientSchema } from './ingredient-schema'

// What the model is asked to return, for the food scan and both meal-plan generators. They live
// here, not in their route files, because a Next route file may export only handlers and the Gemini
// schema check (`lib/ai/__tests__/gemini-model-schemas-4056.test.ts`) has to import them (#4060).

// One dish. Previously these fields WERE the schema, so a week of meal-prep containers or a "5
// lunches" roundup page was flattened into one merged estimate (BF-11b).
//
// #3749: no `confidence`. The badge it fed was the model's opinion of itself; it is now decided in
// code from how many ingredients took their numbers from a saved food or the bundled table.
export const CandidateSchema = z.object({
  name: z.string(),
  brand: z.string().nullable(),
  notes: z.string().nullable(),
  fiberG: z.number(),
  sugarG: z.number(),
  sodiumMg: z.number(),
  satFatG: z.number(),
  ingredients: z.array(ModelIngredientSchema),
})

// The model returns candidates only; the route builds the response's top level from
// `candidates[0]`. Asking for both would mean the first dish is described twice and could disagree
// with itself — the top level and the array are produced by one function below for the same reason.
export const ScanSchema = z.object({
  identified: z.boolean(),
  candidates: z.array(CandidateSchema),
})

/**
 * What the model returns. Ingredients are the one shape every AI food route uses
 * (`ModelIngredientSchema`, #3749): a weight plus per-100g densities, which code replaces with a
 * saved food's or the bundled table's wherever it knows the food. Every total below is summed in
 * code by `sumIngredients`, with its Atwater cross-check, exactly as a scanned photo is. The model
 * still never states a meal total.
 */
export const DraftSchema = z.object({
  planName: z.string().describe('Short, plain name for this plan'),
  meals: z.array(z.object({
    name: z.string().describe('Meal name, e.g. "Greek yoghurt with berries and oats"'),
    ingredients: z.array(ModelIngredientSchema),
    notes: z.string().describe('One short line: prep time, swaps, or where to buy it'),
  })),
  restDayAdjustment: z.string().describe('One line on what changes on a rest day, or "" if not applicable'),
})

export const MealSchema = z.object({
  name: z.string().describe('Meal name, e.g. "Greek yoghurt with berries and oats"'),
  ingredients: z.array(ModelIngredientSchema),
  notes: z.string().describe('One short line: prep time, swaps, or where to buy it'),
})
