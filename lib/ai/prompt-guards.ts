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
export const PROSE_GUARDS = `
Rules you must follow:
- Metric units only — kilograms, centimetres, kilometres, degrees Celsius, millilitres. Never convert a value to imperial and never state a target in imperial, whatever units you were trained to expect.
- Quote the numbers you were given, exactly. Never recompute one, never estimate one, and never state a number that is not above.
- Never apply a superlative to a value — not "perfect", "record", "your best", "all-time", "flawless". You are shown one snapshot and cannot see the history that would justify any of them. If a value came with a band label, use that label and nothing stronger.`.trim()
