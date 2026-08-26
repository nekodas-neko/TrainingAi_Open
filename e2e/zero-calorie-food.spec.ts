import { test, expect, type Page } from '@playwright/test'
import { settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * A calorie-free food can be logged, and a disabled button says what it wants (LA-30).
 *
 * `review-step.tsx` gated Next on `value.calories > 0`, so **every genuinely calorie-free item was
 * refused** — supplements, water, black coffee, plain tea, diet soft drink, sugar-free gum,
 * sweetener, most spices. The owner hit it on a ZMA scan the AI had read correctly as *"It is
 * calorie-free"*, and the only feedback was a greyed-out button. The server never agreed with the
 * gate: `FoodItemFieldsSchema` is `calories: z.number().min(0)`.
 *
 * **The scan route is stubbed** — what is under test is the client's handling of a zero-calorie
 * result, not the model's ability to produce one. The route's own behaviour is tested where it
 * lives.
 */

// `public/sw-template.js` re-issues every `/api/` request from the worker, where `page.route`
// cannot see it. Any spec that stubs an `/api/` route in this app needs this line.
test.use({ serviceWorkers: 'block' })

const ZERO_CAL = {
  name: 'Spec ZMA Capsules',
  servingSizeG: 3,
  calories: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  confidence: 'high',
  notes: 'It is calorie-free.',
}

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, name: RegExp | string) {
  const target = page.getByRole('button', { name }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function openDescribe(page: Page): Promise<void> {
  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, /^Log Food$/)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  // The capture tiles sit in a grid; a coordinate tap that misses opens a neighbour (History opens
  // the Food Library, which has its own textbox and looks plausibly like the describe field). Wait
  // for the describe pane's own copy before touching anything in it.
  await expect(async () => {
    await tap(page, /^Describe it$/)
    await expect(page.getByText('Describe the food and portion size')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 45_000 })
}

/** The describe pane's textarea, distinguished from every other field on the screen. */
function describeField(page: Page) {
  return page.getByPlaceholder('e.g. 200g chicken breast with white rice and broccoli')
}

test('a zero-calorie scan reaches the review step and can be taken forward', async ({ page }) => {
  await page.route('**/api/nutrition/scan', route => route.fulfill({ json: ZERO_CAL }))

  await openDescribe(page)
  await describeField(page).fill('zma capsules')
  await tap(page, /^Analyse$/)

  // The review step, with the AI's own reading of it intact.
  await expect(page.getByRole('textbox').filter({ hasNot: page.locator('textarea') }).first())
    .toHaveValue(ZERO_CAL.name, { timeout: 30_000 })

  // The assertion the old gate fails: Next is enabled at zero calories.
  const next = page.getByRole('button', { name: 'Next', exact: true })
  await expect(next, 'a calorie-free food cannot be taken past review').toBeEnabled()

  // And nothing is nagging about calories, because zero is a value rather than a missing one.
  await expect(page.getByText('Give this food a name to continue.')).toHaveCount(0)
})

test('an unnamed food is still blocked — and now says so', async ({ page }) => {
  await page.route('**/api/nutrition/scan', route => route.fulfill({ json: { ...ZERO_CAL, name: '' } }))

  await openDescribe(page)
  await describeField(page).fill('something unnameable')
  await tap(page, /^Analyse$/)

  // The silent disable was half the bug: the report was "it wouldn't let me log it", not "it told
  // me why". Dropping the calorie gate must not drop the feedback with it.
  await expect(page.getByText('Give this food a name to continue.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})
