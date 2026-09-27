/**
 * RV-203 ① — what, if anything, of a typed description can be looked up in the user's own foods.
 *
 * "Describe or enter" posts straight to `/api/nutrition/scan`, so typing *"chicken breast"* asks
 * the model to estimate a food the user has logged a dozen times and already has a saved row for,
 * with its own macros. The saved row is better than an estimate — it is what they actually eat —
 * and it is available offline, which the model never is.
 *
 * **The stored search is `name LIKE %q%`**, so the raw text cannot be the query: *"200g chicken
 * breast with white rice and broccoli"* matches nothing as one substring. This reduces a
 * description to the food name it is about, and returns `null` when it is about more than one
 * food — a composite meal is not a row in `food_items`, and offering a partial match for it would
 * be worse than offering none.
 *
 * Nothing here decides anything: a phrase only produces *suggestions*. Analyse stays exactly where
 * it was and does exactly what it did, so a wrong phrase costs a list nobody taps.
 */

/**
 * A leading quantity, with or without a unit — "200g", "2 cups of", "1 slice", "3 x".
 *
 * The unit alternatives are ordered LONGEST FIRST and the pattern is not end-anchored, so a
 * shorter alternative would otherwise win and leave its own plural behind: `cup` before `cups`
 * reduced "2 cups of oats" to "s of oats".
 */
const LEADING_QUANTITY =
  /^\d+(?:\.\d+)?\s*(?:tablespoons|tablespoon|teaspoons|kilograms|teaspoon|kilogram|servings|portions|serving|portion|ounces|litres|liters|pieces|slices|scoops|serves|ounce|litre|liter|piece|slice|scoop|grams|kilos|serve|cups|tbsp|gram|kilo|kgs|mls|gms|lbs|tsp|cup|kg|ml|gm|lb|oz|gs|g|l|x)?\s*(?:of\s+)?/

/** Filler that adds nothing to a name lookup. */
const LEAD_IN = /^(?:some|a|an|the|my|one|two|half\s+a|half\s+an)\s+/

/**
 * A description of more than one food. `,` and "and" and "+" are the separators people use; " with
 * " is deliberately NOT one, because "chicken with rice" is a plausible saved-meal name.
 */
const MULTI_ITEM = /,|\band\b|\+|\bplus\b/

/** Longer than this and it is prose about a meal, not the name of a food. */
const MAX_WORDS = 5
const MIN_LENGTH = 3

export function describeSearchPhrase(text: string): string | null {
  let s = text.trim().toLowerCase()
  if (!s) return null
  if (MULTI_ITEM.test(s)) return null

  s = s.replace(LEADING_QUANTITY, '').trim()
  for (let i = 0; i < 3; i++) {
    const next = s.replace(LEAD_IN, '').trim()
    if (next === s) break
    s = next
  }
  // Trailing punctuation only. Interior characters are left alone: a name can legitimately hold
  // an apostrophe or a hyphen, and stripping those would stop it matching the stored row.
  s = s.replace(/[.,!?;:]+$/, '').trim()

  if (s.length < MIN_LENGTH) return null
  if (s.split(/\s+/).length > MAX_WORDS) return null
  return s
}

/**
 * Whether a stored name answers the phrase, for the candidates already in memory (the cached food
 * list and the saved meals). The stored search does this in SQL; this is the same test in JS so
 * the two populations rank together rather than one of them being filtered by a different rule.
 */
export function nameMatchesPhrase(name: string, phrase: string): boolean {
  return name.toLowerCase().includes(phrase)
}
