import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin, tapCentre } from './fixtures'

/**
 * LB-159 — "Use my saved meals" defaults ON when there is a library, OFF when there is not.
 *
 * The owner's answer (2026-09-27) was the conditional default, not a flat one: a plan built from
 * meals he has already cooked carries his real macros, while defaulting on against an EMPTY library
 * ticks a box that changes nothing. Both halves are the decision, so both are pinned here.
 *
 * **This guards a default that a tidy-up would silently undo.** The toggle is reset on every open by
 * the sheet's `open` effect, so the obvious "fix" — setting the initial `useState` — looks right,
 * passes type-checking, and never reaches the screen. Only reaching step 4 and reading the control
 * can tell the two apart.
 *
 * The library is stubbed rather than seeded: what is under test is the DEFAULT's dependence on
 * emptiness, and arranging real saved meals would test the seed instead.
 */
test.use({ serviceWorkers: 'block' })

// Derived, never a literal: a pinned date in a stub is only safe when both sides of the comparison
// are fixed, and nothing here pins the app's clock (`check-e2e-stub-dates`).
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date())

async function openSetupAtYours(page: Page, savedMeals: unknown[]) {
  await page.route('**/api/nutrition/saved-meals**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedMeals) }))
  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // `tapCentre`, not `click()` — this app's screens read raw touch events and these controls sit
  // inside a swipe carousel, so a synthetic click is swallowed and the sheet silently never opens
  // (Q-354, which is what the fixture exists for). Measured here: `click()` left zero dialogs after
  // 90 s of retries while `dispatchEvent('click')` opened it first time, and nothing was covering
  // the button — the hit target at its centre was the button itself.
  await tapCentre(page, page.getByRole('button', { name: /Prefer the step-by-step setup/i }))

  // Stores → Avoid → Skip → Meals → Yours. The picker only mounts on the last of these, which is
  // why the assertion cannot be made any earlier.
  //
  // Each tap waits for the step counter to advance rather than for a fixed delay. A touch
  // dispatched mid-layout is simply lost, so a blind four taps stops a step short — and a retry
  // loop that only watches the destination overshoots instead, landing on step 6 where `Next` no
  // longer exists. The counter is the one signal that says exactly where we are.
  const next = page.getByRole('button', { name: 'Next', exact: true })
  const toggleLabel = page.getByText('Use my saved meals')
  for (let step = 1; step <= 4; step++) {
    await tapCentre(page, next)
    await expect(
      page.getByText(`Step ${step + 1} of 7`),
      `the tap on step ${step} was swallowed`,
    ).toBeVisible({ timeout: 15_000 })
  }

  await expect(toggleLabel, 'never reached the "Yours" step').toBeVisible({ timeout: 30_000 })
}

// The real `SavedMeal` shape — `totals` is a nested object, and the picker reads `totals.calories`
// straight out. A flat `calories` field type-checks nowhere and crashes the step with
// "Cannot read properties of undefined", which reads as the control being missing rather than as a
// bad fixture. Matching the type is the whole of the fix.
const MEAL = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Chicken and rice',
  servings: 1,
  imageDataUri: null,
  createdAt: `${TODAY}T00:00:00.000Z`,
  lastUsedAt: null,
  mealTypeIds: [],
  items: [],
  totals: { calories: 600, proteinG: 45, carbsG: 60, fatG: 15 },
}

test('with saved meals, the plan is allowed to use them by default', async ({ page }) => {
  test.setTimeout(240_000)
  await openSetupAtYours(page, [MEAL])
  await expect(
    page.getByRole('switch', { name: 'Let the plan use my saved meals' }),
    'a library exists, so the default must be on — the owner took this over the flat default',
  ).toBeChecked()
})

test('with an empty library, it stays off — the box would change nothing', async ({ page }) => {
  test.setTimeout(240_000)
  await openSetupAtYours(page, [])
  await expect(
    page.getByRole('switch', { name: 'Let the plan use my saved meals' }),
    'nothing is saved, so defaulting on would tick a box that cannot affect the plan',
  ).not.toBeChecked()
})
