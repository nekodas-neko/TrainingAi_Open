import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
/**
 * Comments are stripped before matching. Every file below explains the retired behaviour in prose
 * directly above the fix, so a raw-source match would pass on the explanation — the vacuous-guard
 * failure this repo has on its record twice (BF-154's header names the second).
 */
const read = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const ASSIGN_STEP = read('components/nutrition/assign-step.tsx')
const FOOD_LOGGER = read('components/nutrition/food-logger-sheet.tsx')
const PAGE = read('app/nutrition/nutrition-content.tsx')
const DAY_SUMMARY = read('components/nutrition/end-of-day/day-summary-card.tsx')

/**
 * BF-175. Two surfaces one tap apart printed two different budgets for the same day, from the
 * owner's two screenshots taken in the same minute: *"2 different calorie goals here"* — the
 * nutrition page's card said **1506**, the log-food sheet said **1660**.
 *
 * 1660 is `nutrition_targets.calories`, which the sheet fetched for itself. That column is the
 * **rest-day floor**, not `restingBase + targetNet` — the rule `nutrition-content.tsx:432` and
 * `home-nutrition-card.tsx` both state outright, after three budgets once appeared on one screen
 * (Q-417/Q-323). So the sheet was not showing a stale copy of the page's number; it was showing a
 * different quantity that happens to be measured in kcal.
 *
 * The progress bar under it is the half that misleads rather than merely disagreeing: it coloured
 * green under target and orange over, against the 1660 denominator, so a day already past its real
 * 1506 budget painted green and read as headroom.
 *
 * **The fix is a shape, not a value:** exactly one place on this page resolves the day's budget
 * (`effectiveCalorieGoal`, from `budgetProvenance` with a deliberate no-addend fallback), and every
 * surface that prints a single day's denominator is handed it. A second read is a second number the
 * moment its inputs differ — which is what `energy-card.tsx`'s own header records happening.
 */
describe('the log-food sheet does not resolve a budget of its own', () => {
  it('reads no nutrition targets at all', () => {
    // Both halves: the cache seed and the fetch. `NutritionTargets` as a type is gone with them —
    // nothing in this sheet has any business naming that row.
    expect(ASSIGN_STEP).not.toMatch(/nutrition-targets/)
    expect(ASSIGN_STEP).not.toMatch(/NutritionTargets/)
  })

  it('does not recompute the budget either', () => {
    // The other way to get a second number: call the same helper on possibly-different inputs.
    // NOTE: this is the one assertion in the file that ALSO passes on unfixed `main` — the sheet
    // never called it. It is a forward guard against the obvious wrong fix, not evidence of this
    // one. The other nine were run against `main` and all nine went red.
    expect(ASSIGN_STEP).not.toMatch(/budgetProvenance/)
  })

  it('takes the denominator as a prop', () => {
    expect(ASSIGN_STEP).toMatch(/dayBudgetKcal\??:\s*number\s*\|\s*null/)
  })

  it('draws nothing rather than inventing a denominator when none is known', () => {
    // A bar with no budget behind it is the fault wearing a different number.
    expect(ASSIGN_STEP).toMatch(/dayBudgetKcal\s*!==\s*null\s*&&/)
  })

  it('colours and scales the bar against that same prop, not a local target', () => {
    // The visible half of the report. Any surviving `calorieTarget` local is the old denominator.
    expect(ASSIGN_STEP).not.toMatch(/calorieTarget/)
    const bar = ASSIGN_STEP.slice(ASSIGN_STEP.indexOf('Today after logging'))
    expect(bar).toMatch(/>\s*dayBudgetKcal/)          // over-budget colouring
    expect(bar).toMatch(/\/\s*dayBudgetKcal\s*\)/)    // scaleX fraction
  })
})

describe('the page hands its one resolved budget to every day-scoped surface', () => {
  it('threads it through the logger sheet to the assign step', () => {
    expect(FOOD_LOGGER).toMatch(/dayBudgetKcal\??:\s*number\s*\|\s*null/)
    expect(FOOD_LOGGER).toMatch(/dayBudgetKcal=\{dayBudgetKcal\}/)
  })

  it('passes effectiveCalorieGoal into the logger, not the stored row', () => {
    expect(PAGE).toMatch(/dayBudgetKcal=\{effectiveCalorieGoal\}/)
  })

  it('passes the earned-scaled targets into the end-of-day review, not the stored row', () => {
    // Its summary card prints `eaten / target kcal` for ONE day, so it is the same class as the
    // sheet; `energy-card` above it already receives this value.
    expect(PAGE).toMatch(/targets=\{effectiveTargets\}/)
    expect(PAGE).not.toMatch(/targets=\{targets\}/)
  })
})

describe('the end-of-day summary prints no budget it was not given', () => {
  it('has no fallback denominator', () => {
    // It read `targets?.calories ?? 2000` — a number nobody chose, rendered exactly like one.
    expect(DAY_SUMMARY).not.toMatch(/\?\?\s*2000/)
    expect(DAY_SUMMARY).toMatch(/targets\?\.calories\s*\?\?\s*null/)
  })

  it('hides the ratio and the bar when no target is known', () => {
    expect(DAY_SUMMARY).toMatch(/calTarget\s*!=\s*null\s*&&/)
  })
})
