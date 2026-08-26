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
  // Q-395c merged the two lists and landed on one name. What matters here is the row's shape once
  // the list is open, not how it is reached.
  await tap(page, page.getByRole('button', { name: 'My Foods' }).first())

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
