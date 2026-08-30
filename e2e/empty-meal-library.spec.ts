import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * The meal library's empty state (LB-20).
 *
 * **Why this is its own spec.** `food-row-shared.spec.ts:109` taps
 * `/^(New|Build your first meal)$/` and always lands on `New`, because the seeded user has meals —
 * so the empty branch of `food-list.tsx` had no cover at all, and that is where a live crash sat:
 * `onClick={onBuildFirst}` handed React's click event to the sheet's `openBuild(meal?)`, which does
 * `meal.items.map(...)`. An event has no `.items`. Its sibling in `meal-builder-footer.tsx` was the
 * same defect and reached production; this one was found by sweeping for the shape, and this spec is
 * what turned that into a reproduction: with the fix reverted it fails on a dead button.
 *
 * **The library is emptied by mocking the route, not by deleting rows.** Five other specs read the
 * seeded `saved_meals`, so a `beforeAll` that emptied the table would make the nutrition suite
 * flaky rather than this one spec. The mock is per-page and mutates nothing.
 */

// The saved-meals stub below is only reliable with the worker blocked: `sw-template.js` re-issues
// every `/api/` request, and Playwright does not intercept a service-worker fetch (PS-14).
test.use({ serviceWorkers: 'block' })

async function openEmptyMealsTab(page: import('@playwright/test').Page) {
  // Per-page, so nothing else in the suite sees an empty library. The GET is what fills the list;
  // the sheet reads local-first first, and `getLocalStore` is null outside the APK.
  await page.route('**/api/nutrition/saved-meals', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Meals', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still closed — this button opens Log Food, which then covers the
    // coordinate, so an unconditional re-tap lands on the sheet's own content (Q-395c).
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByRole('tab', { name: 'Meals', exact: true })).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })

  await page.getByRole('tab', { name: 'Meals', exact: true }).tap()
  await expect(page.getByText('No meals saved yet.')).toBeVisible({ timeout: 30_000 })
}

test('the empty library offers the builder, and the builder opens', async ({ page }) => {
  // Measured with the bug reintroduced: React swallows the TypeError, so the ONLY symptom is a
  // dead button — the sheet stays on an empty Meals tab and nothing opens. The `Save Meal`
  // assertion below is what fails; this listener caught nothing. Kept anyway, because it is free
  // and a different React version may surface the throw instead of eating it.
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(e.message))

  await openEmptyMealsTab(page)

  await page.getByRole('button', { name: 'Build your first meal' }).tap()

  // The builder opened for a NEW meal, not for whatever the click event looked like: an empty name
  // and "Save Meal" rather than "Update Meal", which is what `setEditingMeal(event)` would produce.
  await expect(page.getByRole('button', { name: 'Save Meal' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /^Update Meal$/ })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Meal name' })).toHaveValue('')

  expect(pageErrors, 'the click handler threw').toEqual([])
})

test('the single-foods empty state offers search, and still no builder', async ({ page }) => {
  await page.route('**/api/nutrition/food-items**', async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await openEmptyMealsTab(page)

  await page.getByRole('tab', { name: 'Single foods', exact: true }).tap()
  await expect(page.getByText('Search above to find a food, or log one')).toBeVisible({ timeout: 30_000 })

  // BF-48 changed what this state is FOR. The copy used to read *"Single foods land here once you
  // have logged them"* over no control at all — the search box was gated on the list being
  // non-empty, so the one screen that could now reach the food database hid its search in exactly
  // the state where nothing else was on offer. `Search above` is a promise, so assert the thing.
  await expect(page.getByRole('textbox', { name: /search your foods or the food database/i }))
    .toBeVisible({ timeout: 30_000 })

  // Unchanged, and still BF-37's distinction: a button here would reach the meal builder, which is
  // a different thing. Searching the database is not that — it stays on this tab.
  await expect(page.getByRole('button', { name: 'Build your first meal' })).toHaveCount(0)
})
