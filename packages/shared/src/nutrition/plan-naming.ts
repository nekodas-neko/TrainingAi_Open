// Naming a meal plan the model never saw (LA-38).
//
// `/api/nutrition/meal-plans/generate` used to call the model unconditionally, before it knew how
// many meals it needed. Pin three meals into a three-meal plan, or let the library fill all three,
// and it still sent the full generate prompt saying `Meals: exactly 0.` The tokens were the smaller
// half: the `catch` around that call cannot tell that the call was unnecessary, so a plan needing
// nothing from the model returned **502 "Could not generate a plan right now"** whenever the model
// was down. Measured 2026-08-30 with the model made to reject.
//
// The call was unconditional because the plan's NAME came out of it. When there is nothing to
// generate every meal is already in hand and already named, so the name is derivable — which is what
// makes skipping the call possible rather than merely cheaper.
//
// PURE: no I/O, no clock, no model.

/** `name` is capped at 200 chars by `POST /api/nutrition/meal-plans`; stay well inside it. */
const MAX_NAME_CHARS = 120

/**
 * A plan named after the meals in it.
 *
 * Up to three are listed; beyond that, or past the length cap, the tail becomes "and N more" — a
 * plan name is read in a list, and six dish names run together are not a name. Deliberately plain:
 * this stands in for a model-written name and should not pretend to be one.
 */
export function planNameFromMeals(names: readonly string[]): string {
  const clean = names.map(n => n.trim()).filter(Boolean)
  if (clean.length === 0) return 'Your meal plan'

  const listed = clean.length <= 3 ? clean : clean.slice(0, 2)
  const rest = clean.length - listed.length
  const full = joined(listed, rest)
  if (full.length <= MAX_NAME_CHARS) return full

  // Still too long with three short-ish names, or one very long one. Keep the first and count.
  const trimmed = joined(clean.slice(0, 1), clean.length - 1)
  return trimmed.length <= MAX_NAME_CHARS ? trimmed : `${clean[0].slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`
}

function joined(listed: readonly string[], rest: number): string {
  const tail = rest > 0 ? `${rest} more` : null
  const parts = tail ? [...listed, tail] : [...listed]
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * What changes on a rest day, stated from the shift the code actually applies.
 *
 * The AI path's version of this line is model prose and is NOT reconciled with it — that is a
 * separate question, and out of LA-38's scope. This one exists so a plan the model never named still
 * answers the same field rather than silently returning "".
 */
export function restDayCarbLine(carbShiftG: number): string {
  const g = Math.round(carbShiftG)
  if (g <= 0) return ''
  return `About ${g} g fewer carbohydrates on a rest day.`
}
