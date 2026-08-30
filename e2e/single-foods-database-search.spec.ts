import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { settleRouteBoundary } from './fixtures'

/**
 * Log Food → Single foods reaches the food database (BF-48).
 *
 * The owner's report, device pass N7: *"When I try add a food via the 'single food' section; it
 * only searches saved/history food - its not checking the food data base. So its not useful."* It
 * was exactly right — the tab filtered an in-memory list of foods you had already logged, and the
 * database search existed only inside the meal builder, so getting one new food into the diary
 * meant building a meal around it.
 *
 * **The stub is the point, not a shortcut.** The search reaches Open Food Facts, which rate-limits
 * and measurably goes down (1 of 3 probes returned 503), so a live run would assert on a third
 * party's uptime. What is under test is that this screen *asks* and renders what comes back.
 *
 * **This guard fails if `dbVisible` is removed** — before the fix, the searched-for name appears
 * nowhere on this screen, because the tab never called the route at all.
 */

const PRODUCT = 'Spec Database Only Oats'
const BRAND = 'Spec Pantry'

// PS-14: `page.route` never sees a request the service worker re-issued, and `sw-template.js`
// re-issues EVERY `/api/` request. Whether the worker has claimed the page is a race, so an
// unblocked worker makes the stub apply on some runs and not others.
test.use({ serviceWorkers: 'block' })

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

// Tapping a database row MINTS the food, so the row outlives the test unless it is cleared. Matched
// on the spec's own name so a real food of the owner's is never touched.
test.afterAll(async () => {
  await withDb(db => db.query('DELETE FROM food_items WHERE name = $1', [PRODUCT]))
})

/** `.click()` never lands on these screens — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.scrollIntoViewIfNeeded()
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function openSingleFoods(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await tap(page, page.getByRole('button', { name: 'Log Food' }))
  // `role: tab`, not `role: button` — `SegmentedTabs` sets the ARIA role and a `button` query
  // silently finds nothing.
  await tap(page, page.getByRole('tab', { name: 'Single foods' }))
  const search = page.getByRole('textbox', { name: /search your foods or the food database/i })
  await expect(search).toBeVisible({ timeout: 30_000 })
  return search
}

test('a food never logged before is findable from Single foods, and carries its mismatch warning', async ({ page }) => {
  // Deliberately inconsistent: 96 kcal against macros that come to ~122. That is the real shape the
  // warning exists for — a database filled in field by field by different contributors.
  await page.route('**/api/nutrition/food-search**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [{
      externalId: 'spec-off-single-1', name: PRODUCT, brand: BRAND,
      calories: 96, proteinG: 9, carbsG: 12, fatG: 4, servingSizeG: 100,
    }] }),
  }))

  const search = await openSingleFoods(page)
  await search.fill('spec database only')

  // The section is headed, so the row is not mistaken for something already in your library.
  await expect(page.getByText('Food database', { exact: true })).toBeVisible({ timeout: 30_000 })

  const row = page.getByRole('button', { name: new RegExp(`${BRAND} — ${PRODUCT}`) }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  // The warning the owner chose to keep in the row (Q-406). An icon alone has no hover on a phone,
  // so it would carry no explanation at all.
  await expect(row).toContainText('Its macros and calories disagree')

  // And it goes somewhere: tapping mints the food and opens the portion step.
  await tap(page, row)
  await expect(page.getByText('Quantity', { exact: true })).toBeVisible({ timeout: 30_000 })
})

test('the database is only asked once the query is worth asking about', async ({ page }) => {
  // Under two characters OFF returns the world index. Asserting the route is never called is what
  // separates "the screen searches the database" from "the screen hammers it on every keystroke".
  let calls = 0
  await page.route('**/api/nutrition/food-search**', route => {
    calls += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) })
  })

  const search = await openSingleFoods(page)
  await search.fill('s')
  // Comfortably past the 700 ms debounce, so a fired request would have landed.
  await page.waitForTimeout(2_000)
  expect(calls, 'a one-character query must not reach the food database').toBe(0)

  await search.fill('spec database only')
  await expect.poll(() => calls, {
    message: 'a real query must reach the food database',
    timeout: 20_000,
  }).toBeGreaterThan(0)
})
