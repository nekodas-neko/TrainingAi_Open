/**
 * The curated grocery lists the meal-plan flow offers, in one place so the Coach can serve them
 * instead of typing them out (Q-407).
 *
 * They lived as five `const` arrays inside `meal-plan-setup-sheet.tsx`, which was right while the
 * sheet was the only reader. It is not any more: `/api/coach/options` serves the same rows to the
 * Coach's picker, and a model that writes a nine-option list out longhand costs **~554 output
 * tokens** — measured, and output tokens are essentially all of Coach's latency. Paying a language
 * model to transcribe a list the app already holds is the thing `CHOICE_SOURCES` exists to stop.
 *
 * **The id is the name, deliberately**, unlike every other choice source. `ChoiceListSchema`'s
 * comment says an option id must be a real DB id and never a name, and the reason is that a session
 * can be renamed while its identity is its row. These have no row: the string *is* the value, it is
 * what goes into the plan's prompt, and a slug would only add a mapping that could drift.
 */

/** AU chains. A curated list, not geolocation: the store names only bias what the model suggests,
 *  and a location permission buys nothing without per-store stock data. */
export const GROCERY_STORES = ['Coles', 'Woolworths', 'Aldi', 'IGA', 'Costco', 'Local grocer'] as const

export const PROTEIN_STAPLES = ['Chicken', 'Beef', 'Pork', 'Lamb', 'Salmon', 'White fish', 'Prawns', 'Eggs', 'Tofu', 'Greek yoghurt'] as const
export const CARB_STAPLES = ['Rice', 'Pasta', 'Potato', 'Sweet potato', 'Oats', 'Bread', 'Quinoa', 'Couscous'] as const
export const FAT_STAPLES = ['Olive oil', 'Avocado', 'Nuts', 'Cheese', 'Butter', 'Seeds'] as const
export const VEG_STAPLES = ['Broccoli', 'Spinach', 'Capsicum', 'Mushroom', 'Carrot', 'Green beans', 'Tomato', 'Zucchini'] as const

/** Every staple list, by the `CHOICE_SOURCES` name that serves it. */
export const GROCERY_CATALOGUE = {
  grocery_stores: GROCERY_STORES,
  proteins: PROTEIN_STAPLES,
  carbs: CARB_STAPLES,
  fats: FAT_STAPLES,
  vegetables: VEG_STAPLES,
} as const satisfies Record<string, readonly string[]>

export type GroceryCatalogueKey = keyof typeof GROCERY_CATALOGUE
