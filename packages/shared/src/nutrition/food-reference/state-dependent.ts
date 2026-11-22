// #3749 review. The one list of foods whose numbers depend on how they were prepared.
//
// Rice is 130 kcal per 100 g cooked and 365 dry; chicken breast 120 raw and 165 roasted; oats 379
// dry and 71 as porridge. A name that does not say which is not a number, so two things refuse it:
//  - the bundled table gives none of these a bare name (`scripts/build-food-reference.mjs`, checked
//    over the whole generated table by `__tests__/food-reference-states.test.ts`);
//  - the resolver never takes a saved barcode food of one of these names (`resolve.ts`). A bag of dry
//    rice saved as "Rice" is about 360 kcal per 100 g, and a plate of "Rice 200 g" is cooked.
//
// Folded names (`text()` in food-item-identity.ts), matched whole. "Rice Krispies" and "white rice,
// cooked" are not on it. The test fails when the table holds a food in states that differ and its
// bare name is missing here, so the list cannot fall behind the table.
//
// PURE: no I/O.

import { text } from '../food-item-identity'

export const STATE_DEPENDENT_FOOD_KEYS: readonly string[] = [
  // Rice, grains and starches
  'rice', 'white rice', 'brown rice', 'basmati rice', 'jasmine rice', 'long grain rice', 'wild rice',
  'arborio rice', 'risotto rice', 'quinoa', 'couscous', 'bulgur', 'bulgur wheat', 'barley',
  'pearl barley', 'buckwheat', 'polenta', 'farro', 'freekeh',
  // Pasta and noodles
  'pasta', 'spaghetti', 'penne', 'macaroni', 'fusilli', 'linguine', 'noodles', 'egg noodles', 'rice noodles',
  // Oats
  'oats', 'rolled oats', 'quick oats', 'porridge oats', 'instant oats', 'steel cut oats', 'oatmeal', 'porridge',
  // Legumes
  'lentils', 'red lentils', 'green lentils', 'brown lentils', 'beans', 'black beans', 'kidney beans',
  'red kidney beans', 'cannellini beans', 'butter beans', 'pinto beans', 'chickpeas', 'split peas',
  // Meat and fish
  'chicken', 'chicken breast', 'chicken thigh', 'chicken thighs', 'mince', 'beef mince', 'lean beef mince',
  'ground beef', 'lean ground beef', 'lamb mince', 'pork mince', 'turkey mince', 'ground turkey',
  'steak', 'beef steak', 'lean beef steak', 'sirloin steak', 'pork tenderloin', 'bacon',
  'salmon', 'salmon fillet', 'cod', 'cod fillet', 'tilapia', 'white fish', 'prawns', 'shrimp',
  // Potatoes
  'potato', 'potatoes', 'sweet potato', 'sweet potatoes',
]

const KEYS = new Set(STATE_DEPENDENT_FOOD_KEYS)

/** True when this name, folded, is one of the foods above. */
export function isStateDependentFoodName(name: string): boolean {
  const key = text(name)
  return key.length > 0 && KEYS.has(key)
}
