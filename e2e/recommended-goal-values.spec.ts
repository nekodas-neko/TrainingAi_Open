import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'

/**
 * BF-101 — the per-field "Recommended" affordance on the Profile goals form.
 *
 * The owner asked for a recommended value under each goal field and assumed it would need a model:
 * *"id assume we use AI here to choose but maybe we could have some logic to decide so not using
 * the ai if not needed?"* It does not — `calculateBaseline` already produces one for every field on
 * that screen except sleep, and the AI route only *adjusts* it.
 *
 * Three claims here are runtime claims that no source scan can make, which is why this is a spec
 * and not another vitest file: the control **hides** on an incomplete profile, tapping it **fills
 * the field**, and the whole path issues **no request to an AI route**.
 *
 * The steps goal is the field this drives because it is the one that needs nothing from the seed:
 * `STEP_GOAL_BY_ACTIVITY.moderate` is 10,000 whatever the user weighs. It is also the exact drift
 * the entry was filed on — the owner's activity level said Moderate while his steps goal held
 * 7,000, the *sedentary* number, and nothing on screen said so.
 */

// Crosses `/more`, the goals collapsible, `/api/user/profile` and `/api/user/goals`, each of which
// compiles on first use against `pnpm dev`.
test.setTimeout(180_000)

const GOALS_ROW = 'Activity level, targets & AI recommendations'

test('the recommended steps goal is computed, offered and applied without a model call', async ({ page }) => {
  const modelCalls: string[] = []
  page.on('request', req => {
    const url = new URL(req.url()).pathname
    if (url.includes('/api/ai') || url.includes('nutrition-goals/recommend')) modelCalls.push(url)
  })

  await page.goto('/more')
  await settleRouteBoundary(page)
  await page.getByText(GOALS_ROW).click()

  const moderate = page.getByRole('radio', { name: /Moderate/ })
  await expect(moderate).toBeVisible({ timeout: 60_000 })

  // Clear the activity level first, whatever a previous run left. This is the "hide, not guess"
  // half: `calculateBaseline` would still return numbers without it — computed from a level the
  // user never chose — so `goalBaseline` withholds the whole result instead.
  if ((await moderate.getAttribute('aria-checked')) === 'true') {
    await moderate.click()
    await expect(moderate).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 })
  }
  const anyLevel = page.getByRole('radio', { name: /Sedentary|Light|Moderate|Active/ })
  for (const level of await anyLevel.all()) {
    if ((await level.getAttribute('aria-checked')) === 'true') {
      await level.click()
      await expect(level).toHaveAttribute('aria-checked', 'false', { timeout: 30_000 })
    }
  }
  await expect(page.getByText(/recommended/i)).toHaveCount(0)

  await moderate.click()
  await expect(moderate).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 })

  // Put the field on the *sedentary* number while the level says Moderate — the owner's exact live
  // state, and what makes the offer render rather than the matching state. Driving it explicitly is
  // also what makes this spec re-runnable: its own successful run leaves the goal at 10,000, so a
  // version that assumed the seeded value passed once and then failed on every run after.
  const stepsInput = page.getByLabel('Steps Goal')
  await stepsInput.fill('7000')
  await expect(page.getByText(/Matches the recommended/)).toHaveCount(0)

  const offer = page.getByRole('button', { name: 'Use recommended: 10,000' })
  await expect(offer).toBeVisible({ timeout: 30_000 })

  await offer.click()
  await expect(stepsInput).toHaveValue('10000')

  // The same control, now stating that the field follows the recommendation rather than offering
  // it — the half that makes a screenshot say which fields are calibrated and which are not.
  await expect(page.getByText(/Matches the recommended 10,000/)).toBeVisible()
  await expect(offer).toHaveCount(0)

  expect(modelCalls).toEqual([])
})
