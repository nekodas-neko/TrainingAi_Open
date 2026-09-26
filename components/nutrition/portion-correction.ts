/**
 * RV-203 ③ — a correction that only changes the portion, answered on the device.
 *
 * "Refine" posts the whole estimate back to `/api/nutrition/scan` and asks the model to redo it.
 * For *"it was 300g"* that is a network round trip and an AI call to perform a multiplication the
 * Review sheet's own serving-size field already performs, offline, from the same base snapshot —
 * and it is the most common correction there is, because the portion is the one thing a photo
 * cannot tell the model.
 *
 * **The parser is deliberately timid, and that asymmetry is the whole design.** A miss costs one
 * model call — exactly today's behaviour. A false positive silently rescales the user's macros from
 * a sentence that meant something else, and nothing on screen says the model was skipped. So
 * anything that is not unambiguously a bare quantity falls through: no unit-less numbers, no
 * millilitres (grams are what the row stores, and ml→g is a density the app does not know), nothing
 * with a second clause.
 */

export type PortionCorrection =
  | { kind: 'grams'; grams: number }
  | { kind: 'servings'; servings: number }

/**
 * Lead-ins people actually type in front of a portion. Stripped repeatedly, so "actually it was
 * about 300g" reduces the same as "300g". Anything not on this list makes the text a sentence
 * rather than a quantity, and a sentence goes to the model.
 */
const LEAD_IN = /^(?:it\s+was|it\s+is|it's|its|that\s+was|this\s+was|i\s+had|i\s+ate|make\s+it|change\s+(?:it\s+)?to|should\s+be|actually|really|about|around|roughly|approx(?:\.|imately)?|~)\s*/

/** Trailing politeness and punctuation, which carry no meaning for the quantity. */
const TRAILER = /(?:\s+please)?[.!]*$/

const GRAMS = /^(\d+(?:\.\d+)?)\s*(?:g|gs|gm|gms|gram|grams)$/
const KILOS = /^(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo|kilos|kilogram|kilograms)$/
const SERVINGS = /^(\d+(?:\.\d+)?)\s*(?:serving|servings|serve|serves|portion|portions)$/

/**
 * Upper bounds, not validation. Past these the text is far likelier to be a typo or a different
 * kind of statement than a portion, and the model is the better answer for both.
 */
const MAX_GRAMS = 20_000
const MAX_SERVINGS = 50

export function parsePortionCorrection(text: string): PortionCorrection | null {
  let s = text.trim().toLowerCase().replace(TRAILER, '')
  // Bounded: each pass must shorten the string, so a lead-in that matches the empty tail cannot
  // spin.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEAD_IN, '')
    if (next === s) break
    s = next.trim()
  }

  const grams = s.match(GRAMS)
  if (grams) {
    const n = Number(grams[1])
    return n > 0 && n <= MAX_GRAMS ? { kind: 'grams', grams: n } : null
  }

  const kilos = s.match(KILOS)
  if (kilos) {
    const n = Number(kilos[1]) * 1000
    return n > 0 && n <= MAX_GRAMS ? { kind: 'grams', grams: n } : null
  }

  const servings = s.match(SERVINGS)
  if (servings) {
    const n = Number(servings[1])
    return n > 0 && n <= MAX_SERVINGS ? { kind: 'servings', servings: n } : null
  }

  return null
}

/**
 * The new serving size in grams, or `null` when it cannot be resolved here.
 *
 * A serving count needs a base serving to multiply, and the Review sheet's base is null whenever
 * the estimate arrived with no serving size — so "2 servings" against no base is a model question,
 * not a rescale of nothing.
 */
export function correctedServingG(
  correction: PortionCorrection,
  baseServingSizeG: number | null,
): number | null {
  if (correction.kind === 'grams') return correction.grams
  if (baseServingSizeG == null || baseServingSizeG <= 0) return null
  const g = correction.servings * baseServingSizeG
  return g > 0 && g <= MAX_GRAMS ? g : null
}
