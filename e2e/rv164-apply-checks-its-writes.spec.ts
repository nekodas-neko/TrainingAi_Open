import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * RV-164 — "Apply Selected" marked the recommendation `applied` and toasted *"Goals updated"*
 * without reading a single write's response.
 *
 * Found in production, not from the code: the 2026-09-14 recommendation is `status='applied'`
 * while `nutrition_targets` still holds the 2026-08-31 values. Only a thrown network error reached
 * the failure toast, so a 4xx or 5xx passed as success and the recommendation recorded a state the
 * database contradicts — permanently, because the route takes only `applied` or `dismissed`.
 *
 * This is a spec rather than another source scan because the three claims that matter are runtime
 * ones: the toast says which field failed, the sheet STAYS OPEN so the apply can be retried, and
 * no PATCH marks the recommendation applied. A source assertion can see the branch; it cannot see
 * that the branch is reached.
 *
 * Everything is stubbed, so nothing here writes to the shared seeded database.
 */

// `serviceWorkers: 'block'` is mandatory for any spec stubbing `**/api/` — the worker re-issues
// every /api/ request and Playwright cannot intercept a service-worker fetch, so whether a stub
// applies becomes a race against `clients.claim()`.
test.use({ serviceWorkers: 'block' })

// Crosses `/more`, the goals collapsible and the recommendation sheet, each compiling on first use.
test.setTimeout(180_000)

const GOALS_ROW = 'Activity level, targets & AI recommendations'
const REC_ID = '11111111-2222-4333-8444-555555555555'

// No date field anywhere in this payload, so there is no literal for the clock to walk away from.
// `activityLevel` is null on both sides so the Activity Level row stays hidden and the profile
// route is never reached.
const RECOMMENDATION = {
  id: REC_ID,
  current: {
    stepsGoal: 8000, stepsGoalType: 'daily',
    calorieGoal: 2000, calorieGoalType: 'daily',
    waterGoalMl: 2500, waterGoalType: 'daily',
    proteinG: 140, carbsG: 200, fatG: 60,
    activityLevel: null,
  },
  recommended: {
    stepsGoal: 10000, calories: 2200, proteinG: 150, carbsG: 210, fatG: 65,
    waterMl: 3000, activityLevel: null,
  },
  reasoning: 'Synthetic recommendation for RV-164.',
  insights: '',
  dataQualityNote: '',
}

test('a refused targets write names the field, keeps the sheet open, and does not mark it applied', async ({ page }) => {
  const statusPatches: string[] = []

  await page.route('**/api/nutrition-goals/**', async route => {
    const url = new URL(route.request().url()).pathname
    if (url.endsWith('/recommend')) {
      await route.fulfill({ json: RECOMMENDATION })
      return
    }
    // The apply/dismiss PATCH. Recording it is the assertion: it must not fire.
    statusPatches.push(route.request().postData() ?? '')
    await route.fulfill({ json: { success: true } })
  })

  // The daily-goals half succeeds; only the macro targets are refused. That split is the point —
  // a partial apply is exactly the case the old code recorded as a clean success.
  await page.route('**/api/user/goals', route =>
    route.request().method() === 'PATCH' ? route.fulfill({ json: { success: true } }) : route.continue())
  await page.route('**/api/nutrition/targets', route =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, json: { error: 'refused' } })
      : route.continue())

  await page.goto('/more')
  await settleRouteBoundary(page)
  await page.getByText(GOALS_ROW).click()

  const getRec = page.getByRole('button', { name: /Get AI Recommendation/ })
  await expect(getRec).toBeEnabled({ timeout: 60_000 })
  await getRec.click()

  const apply = page.getByRole('button', { name: 'Apply Selected' })
  await expect(apply).toBeVisible({ timeout: 30_000 })
  await apply.click()

  // Names the metrics whose write was refused, and says the recommendation was left alone.
  await expect(page.getByText(/Couldn.t save .*Protein.*Carbs.*Fat/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/nothing was marked applied/)).toBeVisible()

  // Still open, toggles untouched, so retrying is one tap.
  await expect(apply).toBeVisible()

  expect(statusPatches, 'the recommendation must stay pending when a ticked write did not land').toEqual([])
})
