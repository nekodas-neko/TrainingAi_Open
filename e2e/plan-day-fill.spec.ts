import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * Q-187 step 4 — the plan's automatic half, as an explicit "log the meals so far" action.
 *
 * The design's whole point is that the day's totals never count food nobody ate. Phases 1–3 held
 * that by keeping unconfirmed prefills out of `food_logs` entirely; this button is the one place
 * that could hand it back, by logging a dinner at breakfast time. So the two things asserted are:
 *
 *   1. the offer is **bounded by the clock** — at 09:00 it offers the morning meal and not the
 *      evening one, and the count in the label says which;
 *   2. pressing it writes **exactly those** meals into the day, through the same path the per-meal
 *      button uses, and the button then goes away rather than offering them again.
 *
 * The plan is stubbed rather than seeded because the shape under test is the *selection*, and a
 * seeded plan would pin the assertion to whatever hours the seed happens to use. The food write is
 * real: `getLocalStore` is null on web, so this takes the `/api/nutrition/food-logs` fallback and
 * the rows land in the dev database.
 *
 * **Mutation-checked**: removing the clock bound in `fillableMeals` fails assertion 1; dropping the
 * already-logged filter fails the re-offer half of assertion 2.
 */

// This spec stubs /api/nutrition/meal-plans, and the service worker re-issues every /api request
// out of Playwright's reach.
test.use({ serviceWorkers: 'block' })

test.setTimeout(180_000)

// Unique per run, and that is load-bearing rather than tidiness. Which planned meals are already
// logged is derived by matching ingredient NAMES against the day's food (see
// `use-plan-meal-logging.ts`), and this spec writes real rows — so a second run on the same day
// would find run one's food and correctly offer nothing, failing the first assertion for a reason
// that has nothing to do with the code. CI gets a fresh database and would never show it.
const RUN = Date.now().toString(36)
const MORNING = `E2E Morning Oats ${RUN}`
const EVENING = `E2E Evening Rice ${RUN}`

function ingredient(name: string) {
  return { name, weightG: 100, caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 15, fatPer100g: 2 }
}

function planResponse(nowHour: number) {
  // One meal an hour behind the clock and one an hour ahead, so "so far" has exactly one answer
  // whatever time the suite runs at. Clamped so the pair stays inside 00–23.
  const past = Math.max(0, Math.min(22, nowHour)) 
  const future = Math.min(23, past + 1)
  return {
    plans: [{
      id: 'plan-e2e', userId: 'u', name: 'E2E plan', mealsPerDay: 2, isActive: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      variants: [{
        id: 'var-e2e', mealPlanId: 'plan-e2e', dayType: 'all',
        targetCalories: 2000, targetProteinG: 150, targetCarbsG: 200, targetFatG: 60,
        meals: [
          {
            id: 'meal-past', variantId: 'var-e2e', mealTypeId: null, savedMealId: null, position: 1,
            name: MORNING, notes: null, targetCalories: 100, targetProteinG: 5, targetCarbsG: 15,
            targetFatG: 2, ingredients: [ingredient(MORNING)],
            suggestedTime: `${String(past).padStart(2, '0')}:00`,
          },
          {
            id: 'meal-future', variantId: 'var-e2e', mealTypeId: null, savedMealId: null, position: 2,
            name: EVENING, notes: null, targetCalories: 100, targetProteinG: 5, targetCarbsG: 15,
            targetFatG: 2, ingredients: [ingredient(EVENING)],
            suggestedTime: `${String(future).padStart(2, '0')}:00`,
          },
        ],
      }],
    }],
  }
}

test('the plan offers only the meals whose time has come, and logging them clears the offer', async ({ page }) => {
  // The app reads "now" in the user's timezone; read it the same way rather than from the runner's
  // clock, which is UTC and would put the pair on the wrong side of the boundary.
  const nowHour = await page.evaluate(() =>
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Brisbane', hour: '2-digit', hour12: false }).format(new Date())))

  await page.route('**/api/nutrition/meal-plans', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(planResponse(nowHour)) }))

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // 1 — one meal is offered, not two. The count is in the label, so a wrong bound is visible.
  const fill = page.getByRole('button', { name: /Log the 1 meal so far/ })
  await expect(fill, 'the offer must stop at the current hour').toBeVisible()

  // `tap()`, not `click()`. The date-swipe `useDrag` on this screen's scroll container swallows
  // MOUSE clicks — measured and open as Q-354 — and mouse is what `click()` sends. Touch is both
  // the working path and the only one the canonical runtime has, so this is the faithful input
  // rather than a workaround. Do not "fix" it back to click().
  await fill.tap()

  // 2 — the morning meal reaches the day; the evening one does not.
  await expect(page.getByText(MORNING).first()).toBeVisible()
  await expect(page.getByText(EVENING)).toHaveCount(0)

  // …and the offer is gone, rather than proposing the same meal again.
  await expect(page.getByRole('button', { name: /Log the .* so far/ })).toHaveCount(0)
})
