/**
 * Q-292: two failures found in one sampled batch of eight insights, then confirmed across all 117.
 *
 *   • **Fabricated superlatives** — *"leading to a perfect activity score"* on a day the stored
 *     score was **80**, and *"a perfect recovery index"* on a day the contributor scored **21 of
 *     100**. 12 absolute superlatives in 117 insights.
 *   • **Imperial units to a metric user** — *"keep your bedroom temperature at 65 degrees
 *     Fahrenheit"* to a user in Australia. 7 of these, all Fahrenheit, all in `sleep`.
 *
 * Roughly 16% of insights carried at least one. CLAUDE.md forbids an LLM self-reported number
 * *gating an automatic action*; these gate nothing and are rendered to the user as fact, so the
 * rule's spirit covers them and its letter does not.
 *
 * One string, imported by every prose-generating AI route, so a sixth route cannot be added
 * without it and the wording cannot drift into six versions.
 */
/** Metric units. Applies to anything a model writes for this user, prose or object field. */
export const METRIC_UNITS_RULE =
  '- Metric units only — kilograms, centimetres, kilometres, degrees Celsius, millilitres. Never convert a value to imperial and never state a target in imperial, whatever units you were trained to expect.'

/** No superlatives. Same reach as the units rule: an object route's `reasoning` can fabricate one too. */
export const NO_SUPERLATIVE_RULE =
  '- Never apply a superlative to a value — not "perfect", "record", "your best", "all-time", "flawless". You are shown one snapshot and cannot see the history that would justify any of them. If a value came with a band label, use that label and nothing stronger.'

/**
 * Q-292 / #2421: describe a deviation, never diagnose it. The 2026-07-19 insight that inferred
 * illness from a skin-temperature reading is the class: a model shown a number that sits off the
 * user's usual will reach for a cause, and the nearest one is medical. The app has no way to know
 * it, the user reads it as fact, and TN-46 already sets the same line for the dose overlay — never
 * imply infection. Same reach as the units and superlative rules, so it applies to prose and to
 * a text field inside an object alike.
 */
export const NO_DIAGNOSIS_RULE =
  '- Describe a change, never diagnose it. Say a reading is above or below the usual and by how much, but never name a medical condition, illness or infection, never say or suggest the user may be sick, and never offer a medical cause for a body signal such as temperature, resting heart rate or HRV.'

/**
 * Quote, never recompute. **This one does NOT generalise**, which is why PS-32 found the guard on
 * only half the prose routes and why a blanket import would have been a regression: four of the
 * remaining routes exist to PRODUCE numbers — `nutrition-goals/recommend` returns the calorie and
 * macro targets, `workout-review` returns sets/reps/%1RM. Telling those "never state a number that
 * is not above" contradicts the job. They take {@link PROSE_FIELD_GUARDS} instead.
 */
export const QUOTE_NUMBERS_RULE =
  '- Quote the numbers you were given, exactly. Never recompute one, never estimate one, and never state a number that is not above.'

/** For a route whose whole output is prose. */
export const PROSE_GUARDS = [
  'Rules you must follow:',
  METRIC_UNITS_RULE,
  QUOTE_NUMBERS_RULE,
  NO_SUPERLATIVE_RULE,
  NO_DIAGNOSIS_RULE,
].join('\n')

/**
 * For a route that returns structured data with a user-facing text field in it. Everything the
 * prose guards say except "quote, never recompute", which such a route cannot obey.
 */
export const PROSE_FIELD_GUARDS = [
  'Rules you must follow in any explanation you write:',
  METRIC_UNITS_RULE,
  NO_SUPERLATIVE_RULE,
  NO_DIAGNOSIS_RULE,
].join('\n')
