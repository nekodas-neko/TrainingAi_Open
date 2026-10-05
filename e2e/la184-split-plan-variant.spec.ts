import { test, expect, type Page } from '@playwright/test'
import { STORAGE_STATE, settleRouteBoundary, tapInView } from './fixtures'

/**
 * LA-184 in a browser — and the bug was on screen the whole time.
 *
 * `MealPlanSection` has taken `isTrainingDay?: boolean` since it was written and **no caller ever
 * passed it**, so `pickVariant` saw `undefined` every day and fell to the REST variant. The card
 * renders `variant.dayType` as a visible badge, so a split plan said **"Rest day"** on a training
 * day — which is what makes this assertable rather than a claim about a prop.
 *
 * **Both payloads are stubbed, and that is the only way to reach this at all.** The local database
 * holds **zero `meal_plans` and zero `meal_plan_variants`** (`count(*)`), and so does production —
 * the owner's only plan was soft-deleted on 2026-08-11. A split plan has never existed on any
 * database this harness can see.
 */
test.use({
  storageState: STORAGE_STATE,
  serviceWorkers: 'block',
  viewport: { width: 412, height: 915 },
  colorScheme: 'dark',
  contextOptions: { reducedMotion: 'reduce' },
})
test.setTimeout(180_000)

const PLAN_ID = 'aaaa1111-0000-4000-8000-00000000c0de'

/**
 * Derived from the clock, never written down. `isPlanStale` in `nutrition-content.tsx` compares
 * `lastReviewedAt` against `Date.now()` over a **28-day** window, so a literal here is one side of
 * a rolling comparison and the other side is the real clock: the fixture would pass until it
 * silently started rendering the plan-review banner instead. That is the class
 * `scale-ble-day-keying.test.ts` went red on across every branch, and `check-e2e-stub-dates`
 * refuses it outright.
 *
 * 24 hours back, and **no timezone is involved on purpose**: `isPlanStale` subtracts two instants
 * and compares elapsed milliseconds, so there is no calendar day to key to and a zone-derived date
 * here would be a second thing to get wrong. 27 days of slack against the window.
 */
const REVIEWED_AT = new Date(Date.now() - 86_400_000).toISOString()

function variant(dayType: 'training' | 'rest', kcal: number) {
  return {
    id: `${PLAN_ID}-${dayType}`,
    mealPlanId: PLAN_ID,
    dayType,
    targetCalories: kcal,
    targetProteinG: 150,
    targetCarbsG: dayType === 'training' ? 250 : 150,
    targetFatG: 60,
    meals: [{
      id: `${PLAN_ID}-${dayType}-1`,
      variantId: `${PLAN_ID}-${dayType}`,
      mealTypeId: null,
      savedMealId: null,
      position: 1,
      name: `${dayType === 'training' ? 'Training' : 'Rest'} day breakfast`,
      notes: null,
      targetCalories: kcal,
      targetProteinG: 150,
      targetCarbsG: dayType === 'training' ? 250 : 150,
      targetFatG: 60,
      ingredients: [],
    }],
  }
}

/** A plan split into the two variants, which is what `meal-plans/generate` produces. */
const SPLIT_PLAN = {
  id: PLAN_ID,
  userId: 'stub',
  name: 'LA-184 Split Plan',
  isActive: true,
  splitTrainingRest: true,
  variants: [variant('training', 2600), variant('rest', 2100)],
  generatedAt: REVIEWED_AT,
  lastReviewedAt: REVIEWED_AT,
}

async function openNutrition(page: Page, recommendation: unknown) {
  await page.route('**/api/nutrition/meal-plans', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ plans: [SPLIT_PLAN], activePlanId: PLAN_ID }),
  }))
  await page.route('**/api/next-session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(recommendation),
  }))
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(page.getByText('LA-184 Split Plan')).toBeVisible({ timeout: 120_000 })
}

/** The meal list is collapsed by default — `Show N meals` on the card. */
async function showMeals(page: Page) {
  const toggle = page.getByRole('button', { name: /^Show \d+ meals?$/ })
  await tapInView(page, toggle)
  const list = page.getByText(/day breakfast$/)
  await expect(list).toBeVisible({ timeout: 15_000 })
  return list
}

test('a scheduled session today shows the TRAINING variant', async ({ page }) => {
  await openNutrition(page, {
    isRestDay: false,
    session: { id: 'sess-1', name: 'Session A', exercises: [] },
    reason: 'Scheduled day',
  })

  // The badge the card already renders from `variant.dayType`. Before this change it read
  // "Rest day" here, which is the whole defect and is visible without opening anything.
  await expect(page.getByText('Training day', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Rest day', { exact: true })).toHaveCount(0)
  // And the variant's OWN meals, so the badge cannot pass while the list comes from the other
  // variant. They are behind the card's own "Show N meals" toggle.
  await expect(await showMeals(page)).toContainText('Training day breakfast')
})

test('a rest day shows the REST variant', async ({ page }) => {
  await openNutrition(page, { isRestDay: true, reason: 'Rest day — not a scheduled training day' })

  await expect(page.getByText('Rest day', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Training day', { exact: true })).toHaveCount(0)
  await expect(await showMeals(page)).toContainText('Rest day breakfast')
})

test('⛔ no active program shows the rest variant rather than claiming a training day', async ({ page }) => {
  // `getNextSession` returns `{ isRestDay: false, reason: 'No active program configured' }` with no
  // session. A bare `!isRestDay` would read that as a training day — a claim about nothing.
  await openNutrition(page, { isRestDay: false, reason: 'No active program configured' })

  await expect(page.getByText('Rest day', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Training day', { exact: true })).toHaveCount(0)
})
