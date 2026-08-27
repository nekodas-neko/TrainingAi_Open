import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * The food library and the food-database search draw the SAME row (Q-406).
 *
 * A food read four different ways across the app — the diary, the library sheet and the two search
 * lists — because each was written separately, and calories sat somewhere different in three of
 * them, so a list of foods never lined up. This is the shared row, asserted where it now renders.
 *
 * **The assertion is that calories sit in their own right-hand column**, which is the change: the
 * search row used to print them *inside* the grey secondary line, and the library row stacked them
 * over a serving sub-line. A test that only checked the numbers appear would pass against both old
 * shapes.
 */

const ITEM_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const NAME = 'Food Row Spec Oats'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
    await db.query(
      `INSERT INTO food_items (id, user_id, name, brand, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, $3, 'Spec Brand', 389, 17, 66, 7, 100, 'manual')`,
      [ITEM_ID, userId, NAME],
    )
  })
})

test.afterAll(async () => {
  await withDb(db => db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID]))
})

/** `.click()` never lands on these screens — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.scrollIntoViewIfNeeded()
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

test('the library sheet lists foods in the shared row, calories in their own column', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await tap(page, page.getByRole('button', { name: 'Log Food' }))
  // LB-16 made the lists TABS rather than tiles, and BF-37 split them back into two, so a single
  // food lives under `Single foods`. `role: tab`, not `role: button` — `SegmentedTabs` sets the ARIA
  // role and a `button` query silently finds nothing. What matters here is the row's shape once the
  // list is open, not how it is reached.
  await tap(page, page.getByRole('tab', { name: 'Single foods' }))

  const row = page.getByRole('button', { name: new RegExp(NAME) }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })

  // The calories live in a fixed-width sibling of the name, not inside the grey line under it.
  // `w-16` + `tabular-nums` is what makes a column of numbers scannable, and is the whole point.
  const calorieCell = row.locator('span.tabular-nums')
  await expect(calorieCell).toHaveCount(1)
  await expect(calorieCell).toContainText('389')
  const cellBox = (await calorieCell.boundingBox())!
  const rowBox = (await row.boundingBox())!
  // Right-aligned: the cell ends within a chevron's width of the row's right edge.
  expect(rowBox.x + rowBox.width - (cellBox.x + cellBox.width)).toBeLessThan(40)
})

/**
 * The LAST call site: the external food-database result (Q-406).
 *
 * It stayed a bespoke `<button>` after the other three converted, because the decided warning design
 * sent its sentence to the food's detail and **this surface has none** — the tap adds the food
 * outright. The owner's answer (2026-08-26) was to keep the sentence in the row, which is what makes
 * the conversion buildable at all.
 *
 * The search is stubbed rather than driven: it reaches Open Food Facts, so a live run would be
 * non-deterministic and offline-fragile — which is why this row had no e2e cover at all.
 */
test('the external food-database row is the shared row, and keeps its mismatch warning', async ({ page }) => {
  // Deliberately inconsistent: 96 kcal against macros that come to ~122. That is the real shape the
  // warning exists for — a database filled in field by field by different contributors.
  await page.route('**/api/nutrition/food-search**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [{
      externalId: 'spec-off-1', name: 'Spec Mismatch Yoghurt', brand: 'Spec Dairy',
      calories: 96, proteinG: 9, carbsG: 12, fatG: 4, servingSizeG: 100,
    }] }),
  }))

  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await tap(page, page.getByRole('button', { name: 'Log Food' }))
  // The builder is reached from the meal library, so this one goes to `Meals` rather than to the
  // single-food tab above.
  await tap(page, page.getByRole('tab', { name: 'Meals' }))

  // Into the builder, where the ingredient picker's search lives.
  await tap(page, page.getByRole('button', { name: /^(New|Build your first meal)$/ }).first())
  const search = page.getByPlaceholder(/search/i).first()
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill('spec mismatch')
  // PS-14 PROBE (temporary): does the typed query survive? If the hypothesis is right this is what
  // fails; if it holds and the row still never appears, the remount theory is wrong.
  await expect(search, 'PS-14 PROBE: query was discarded').toHaveValue('spec mismatch', { timeout: 3_000 })

  const row = page.getByRole('button', { name: /Spec Dairy — Spec Mismatch Yoghurt/ }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })

  // Shared shape: calories in their own right-hand column, not inline in the grey line.
  const calorieCell = row.locator('span.tabular-nums')
  await expect(calorieCell).toHaveCount(1)
  await expect(calorieCell).toContainText('96')

  // And the warning the owner chose to keep here — the sentence, not just an icon. An icon alone
  // has no hover on a phone, so it would have carried no explanation at all.
  await expect(row).toContainText('Its macros and calories disagree')

  // The macros stay readable beside it: the rows carrying a mismatch are exactly the rows where you
  // want to judge the numbers yourself, which is what ruled out replacing this line.
  await expect(row).toContainText('9P')
})

