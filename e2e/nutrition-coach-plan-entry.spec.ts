import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary, tapCentre } from './fixtures'

/**
 * Q-407 — the Nutrition tab's plan entry opens the coach, and the stepper stays reachable.
 *
 * **The scope is the point, not the navigation.** `app/api/coach/route.ts` takes an optional `scope`
 * and resolves it through `coachScope`, which decides the tool subset — *"a tool it never receives is
 * a boundary it cannot cross"*, as against a prompt asking the model not to read workout data.
 * Nothing sent one before this. So a test that only checked the URL would pass against a coach
 * running in the general scope, which is the failure worth catching.
 *
 * **And the fallback is asserted, not assumed.** The entry is explicit that a conversational flow
 * stalling mid-plan with no fallback is worse than seven screens that finish. Rebuild does not exist
 * until a plan does, so the no-plan state is exactly where a stranded user would be.
 */

/**
 * The service worker re-issues every `/api/` request and Playwright cannot intercept a
 * service-worker fetch, so a route stub applies or not depending on whether the worker has claimed
 * the page yet — passing locally and failing on CI with the real route answering. The scope
 * assertion below is a stub, so this is load-bearing, not boilerplate.
 */
test.use({ serviceWorkers: 'block' })

async function openNutrition(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
}

/** The empty-state entry. The seeded account has no meal plan — `seed.sql` creates none. */
function buildButton(page: Page) {
  return page.getByRole('button', { name: /Build a meal plan/ })
}

test('the plan entry opens Coach in the nutrition scope', async ({ page }) => {
  // The request the coach makes, captured rather than inferred. `scope: 'nutrition'` in the POST body
  // is the whole feature; the URL is only how it gets there.
  const scopes: (string | undefined)[] = []
  await page.route('**/api/coach', async route => {
    const body = route.request().postDataJSON() as { scope?: string }
    scopes.push(body?.scope)
    // Answered rather than fulfilled with a real turn: this asserts what the client SENDS, and a
    // live Gemini call would make the test depend on a model and a key.
    await route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  })

  await openNutrition(page)
  const build = buildButton(page)
  await expect(build).toBeVisible({ timeout: 60_000 })
  await tapCentre(page, build)

  await expect(page).toHaveURL(/\/coach\?scope=nutrition/, { timeout: 30_000 })

  // Drive one turn so the transport actually posts. Without this the page is on /coach and has sent
  // nothing, and the scope — the thing under test — is never exercised.
  const composer = page.getByRole('textbox').first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.fill('build me a plan')
  await composer.press('Enter')

  await expect.poll(() => scopes, { timeout: 30_000 }).toContain('nutrition')
})

test('the step-by-step sheet is still reachable from the no-plan state', async ({ page }) => {
  await openNutrition(page)
  await expect(buildButton(page)).toBeVisible({ timeout: 60_000 })

  const stepper = page.getByRole('button', { name: /step-by-step setup/i })
  await expect(stepper, 'a stalled conversation needs a way back to seven screens that finish')
    .toBeVisible()
  await tapCentre(page, stepper)

  // The wizard's own first step, not merely a dialog — an empty sheet would satisfy a role check.
  // `STEPS` holds internal names ('Stores'); what is RENDERED is `STEP_TITLES` and the step's own
  // heading, so those are what a user would see and what this asserts.
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Step 1 of 7/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Where do you shop?')).toBeVisible()
  // And it must not have navigated away: the fallback is the sheet, not the coach.
  await expect(page).toHaveURL(/\/nutrition/)
})
