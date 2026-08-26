/**
 * What an imported recipe does to the meal being built (BF-11c).
 *
 * A pure function rather than three `set…` calls inside the builder, because the one decision here
 * is numeric, silent when wrong, and was got wrong once already — see `servings` below.
 */

export interface ScannedRecipe {
  /** The recipe's own name, or the host as a stand-in. */
  name: string
  /** What the page stated it yields; `null` when it stated nothing. */
  recipeYield: number | null
}

export interface RecipeBuilderPatch {
  name: string
  servings: number
  /** Show the "this is the whole recipe" prompt beside the batch-size field. */
  unstatedYield: boolean
}

/**
 * **`servings` is always 1, and that is the part worth reading.**
 *
 * `/api/nutrition/scan` divides before it answers — `toMeal` runs `perServing(ingredients, yield)` —
 * so a page stating *makes 12* comes back as **one slice**, not the loaf. Adopting 12 as the meal's
 * batch size on top of that makes `oneServingItems()` divide a second time and logs a twelfth of a
 * slice: a plausible-looking number, twelve times too small.
 *
 * BF-11c's entry asks for `servings: 12` with the whole recipe's items, and it is not wrong about
 * the contract — `SavedMeal.totals` really is the whole batch and `oneServingItems()` really is the
 * only place that divides. It was written believing the route hands back the batch. It does not, so
 * honouring that shape would mean multiplying the route's division back out, which is a lossy round
 * trip for no gain. One serving at `servings: 1` is exact, and it is the same encoding
 * `savePlanMealToLibrary` already uses.
 *
 * **An unstated yield is the case that still needs asking.** `recipeYield: null` makes the route's
 * own divisor 1, so nothing was divided and what arrived IS the whole batch — a banana-bread page
 * measured 1,956 kcal for the loaf. Left alone that silently becomes one portion.
 */
export function recipeBuilderPatch(recipe: ScannedRecipe, currentName: string): RecipeBuilderPatch {
  return {
    // A link pasted into a meal you have already named must not rename it.
    name: currentName.trim() ? currentName : recipe.name,
    servings: 1,
    unstatedYield: recipe.recipeYield == null,
  }
}
