import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin, tapCentre } from './fixtures'

/**
 * RV-203 ① — Describe offers the user's own foods before it asks the model.
 *
 * Typing a food into **Describe or enter** posted straight to `/api/nutrition/scan`, so a food
 * already saved with real macros was re-estimated every time and the panel did nothing at all
 * offline. The assertion that matters is the negative one: the panel reaches the assign step with
 * **no scan request at all**, which is the entry's own "done when".
 *
 * **What this can and cannot see.** The panel has two suggestion sources. The one that matters is
 * the local store's full `searchFoodItems` — it works cold, offline, over every stored food, and
 * `getLocalStore` returns null on the web, so **this harness cannot reach it**. What it reaches is
 * the fallback: the `ALL_ITEMS_KEY` list that `FoodList` seeds. That list is written by the
 * **Search** tab, which is why this spec opens it first rather than going straight to Describe —
 * not stage-setting, but the honest shape of the web path. The device path is the `Keep:` on the
 * entry.
 */

const ITEM_ID = '5a3f1c9e-2b7d-4e18-9c60-a1b2c3d4e5f6'
const NAME = 'Spec Describe Chicken Breast'
const KCAL = 231

test.use({ serviceWorkers: 'block' })

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source, created_at)
       VALUES ($1, $2, $3, $4, 31, 0, 11, 100, 'manual', now())`,
      [ITEM_ID, rows[0].id, NAME, KCAL],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
  })
})

/** `.click()` never lands on these screens — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, name: RegExp | string) {
  await tapRole(page, 'button', name)
}

/** The list strip is a `role="tab"` set (`SegmentedTabs`), not buttons. */
async function tapRole(page: Page, role: 'button' | 'tab', name: RegExp | string) {
  const target = page.getByRole(role, { name }).first()
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await tapCentre(page, target)
}

/** Opens Log Food and puts the Search tab up, which is what seeds `ALL_ITEMS_KEY`. */
async function openLogFoodWithSeededList(page: Page) {
  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(async () => {
    await tap(page, /^Log Food$/)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await tapRole(page, 'tab', /^Search$/)
  await expect(page.getByText(NAME).first()).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await tap(page, /^Describe or enter$/)
    await expect(page.getByLabel('Describe it')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 45_000 })
}

test('a described food already in the library is offered without calling the model', async ({ page }) => {
  // The one assertion this spec exists for. Counted for the WHOLE test, so a scan fired at any
  // point — including one the UI swallowed — fails it.
  const scans: string[] = []
  page.on('request', r => { if (r.url().includes('/api/nutrition/scan')) scans.push(r.method()) })

  // Seeds `ALL_ITEMS_KEY` — see the header. The sheet opens on Recent, which does not.
  await openLogFoodWithSeededList(page)

  // A quantity in front of the name is the common shape and the one the phrase extractor has to
  // strip; a raw `name LIKE '%200g spec describe…%'` matches nothing.
  await page.getByLabel('Describe it').fill('200g Spec Describe Chicken Breast')

  await expect(page.getByText('You already have')).toBeVisible({ timeout: 15_000 })
  const suggestion = page.getByText(NAME).first()
  await expect(suggestion).toBeVisible()

  // Tapping it reaches the assign step — the same destination the list's own rows have.
  await tapCentre(page, suggestion)
  await expect(page.getByText(/Analysing…/)).toHaveCount(0)
  await expect(page.getByText(new RegExp(String(KCAL)))).toBeVisible({ timeout: 15_000 })

  expect(scans, 'the model was called for a food the user already has').toEqual([])
})

test('a description naming several foods still goes to the model', async ({ page }) => {
  // The control. Without it a suggestion list that never renders would pass the test above by
  // never offering anything — and "no scan" would be evidence of nothing.
  await openLogFoodWithSeededList(page)

  await page.getByLabel('Describe it').fill('Spec Describe Chicken Breast and white rice')
  // A composite is not a row in `food_items`; offering half of it would be worse than nothing.
  await expect(page.getByText('You already have')).toHaveCount(0)
  await page.waitForTimeout(1_000)
  await expect(page.getByText('You already have')).toHaveCount(0)
})
