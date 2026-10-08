import { test, expect } from '@playwright/test'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import { settleRouteBoundary } from './fixtures'

/**
 * What the nutrition surface knew and did not say (LA-102).
 *
 * **LA-102** — the owner, on the resting-rate-anchored budget: *"1350 doesnt count some basic
 * metabolic needs".* He is right. BF-152 deliberately did not model the thermic effect of food or
 * non-step movement — a multiplier ASSERTS the overhead happened where the step credit OBSERVES it,
 * and treating intake-linked digestion as an earned credit makes the budget grow as you eat. The
 * decision stands; what was missing is saying so.
 *
 * (TN-28's check on the Calorie Nudge card was retired with the card, issue 2622.)
 *
 * The payload is stubbed rather than seeded. A calibrated maintenance that drifts from the stored
 * target is what makes the nudge card render at all, and building that from real logs means a
 * fortnight of intake against a weight trend — the estimator is not what is under test here, the
 * two sentences are.
 */
test.use({ serviceWorkers: 'block' })
test.setTimeout(120_000)

/**
 * The seeded user's day, not the runner's and not a literal.
 *
 * `nutrition-content.tsx` renders both cards under `energyBalance?.date === selectedDate`, and
 * `selectedDate` is `todayInTz('Australia/Brisbane')`. A hardcoded date therefore matches for the
 * rest of the day it was written on and never again: this file pinned `2026-09-14` and went red at
 * 14:00 UTC that day, on every branch, permanently — the page took the stub, compared its date to
 * Brisbane's 2026-09-15, and rendered the no-balance state, so both locators were genuinely absent.
 *
 * It is the `scale-ble-day-keying.test.ts` shape rather than the `periodization-soft-delete` one:
 * that class fires for two hours a day and recovers, this one detonates once and stays red. Both
 * come from the same rule — a fixture may hold an absolute date only when BOTH sides of the
 * comparison are fixed, and here the other side is the clock.
 *
 * `Intl` rather than a DB round-trip because nothing in this file needs the database: the payload
 * is stubbed precisely so the estimator is not under test. `plan-day-fill.spec.ts:58` is the same
 * shape. 'en-CA' is what yields YYYY-MM-DD.
 */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

// Issue 2071: a payload without `deficitKcal` is read as one cached before the owner's budget and
// gets the retired BF-152 branch, which has no chain and so no explanatory paragraph. The stub carries
// the deficit and step credit a live payload does, and the total is asked of the shared function.
const STUB_BALANCE = {
  intakeKcal: 1200, expenditureKcal: 2100, restingBaseKcal: 1815, activeKcal: 285,
  netKcal: -900, targetNetKcal: -500,
  restingRateKcal: 1815, deficitKcal: 232, stepCreditKcal: 100,
}
const STUB_BUDGET = budgetProvenance(STUB_BALANCE)

const PAYLOAD = {
  date: TODAY,
  balance: {
    ...STUB_BALANCE,
    budgetKcal: STUB_BUDGET.total,
    deviationKcal: 1200 - STUB_BUDGET.total, remainingKcal: STUB_BUDGET.total - 1200,
    projectedWeeklyKg: -0.9,
    zone: 'under', zoneLabel: 'Well under', zoneColor: '#60a5fa',
  },
  // Calibrated and low-confidence: the exact shape TN-28 is about.
  maintenance: {
    kcal: 2045, source: 'calibrated', confidence: 'low',
    daysLogged: 10, daysInWindow: 14, weightRateKgPerWeek: -0.4, gapMessage: null,
  },
  // `driftsFromRecommendation` is what gates the card.
  target: { recommendedKcal: 2045, currentKcal: 1800, driftsFromRecommendation: true },
  macroTargets: null,
  activeBreakdown: { workoutKcal: 200, activityKcal: 50, stepsKcal: 35, workoutKcalBySession: [] },
  goal: 'lose_fat',
  missingProfileFields: [],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/nutrition/energy-balance**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(PAYLOAD),
  }))
})

test('the ⓘ panel puts digestion and everyday living INTO the budget (LA-102, reworked by issue 2071)', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // By its accessible name. The first draft clicked every `aria-expanded="false"` button on the
  // page instead, which opened meal accordions and never touched this one.
  // LB-189 renamed it: Health's bar carried the identical name and the tab shell keeps both trees
  // mounted, so this used to match two elements and only one of them was on screen.
  const info = page.getByRole('button', { name: "How today's calorie budget is calculated" })
  await expect(info, 'the ⓘ toggle is gone or renamed').toHaveCount(1, { timeout: 60_000 })
  await expect(info).toBeVisible()
  // `locator.click()` does not reach controls on this tab — a standing gotcha, and the second
  // thing that made this test fail while the panel worked.
  await info.evaluate((el: HTMLElement) => el.click())
  await expect(info).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 })

  // LA-102 asked the panel to own up that basic metabolic needs (digestion, everyday living) were
  // not in the budget. Issue 2071 answered by putting them in — a fifth of the resting rate, less the
  // first 3,000 steps the movement term already counts — so the panel now has to NAME that term, its
  // size, and the chain's total. Asserting on the substance rather than the sentence, so a rewording
  // that keeps the meaning does not fail and one that drops a term does.
  // The PARAGRAPH, not the emphasised span inside it — `getByText` resolves to the innermost match.
  const panel = page.locator('p').filter({ hasText: "Today's budget" }).filter({ hasText: 'daily living' })
  await expect(panel, 'the ⓘ panel never named the daily-living term').toBeVisible({ timeout: 20_000 })
  const chain = STUB_BUDGET.chain!
  await expect(panel).toContainText(/digesting food/)
  await expect(panel).toContainText(`plus ${chain.dailyLiving.toLocaleString('en-US')} kcal for daily living`)
  await expect(panel).toContainText(`less the ${chain.stepCredit.toLocaleString('en-US')} kcal your first 3,000 steps are worth`)
  await expect(panel).toContainText(`less ${chain.deficit.toLocaleString('en-US')} kcal for your goal`)
  await expect(panel).toContainText(`${STUB_BUDGET.total.toLocaleString('en-US')} kcal so far`)
  await expect(panel).toContainText(/never drops below your resting rate or 1,200 kcal/)
})
