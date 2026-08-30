import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A logged meal is one diary row that opens to its ingredients (BF-39).
 *
 * Three owner reports, the last with a screenshot of one AI-logged breakfast as **eight** rows —
 * flour, protein powder, baking powder, salt, milk, eggs, butter, bacon — filling the whole meal
 * section: *"we need to be able to create an over arching food and have the ingredients and macro
 * break down inside of it."*
 *
 * The engine half (`food_logs.saved_meal_id` + `meal_group_id`, stamped by `logMealItems` on both
 * write paths) shipped separately. This is the read.
 *
 * **The second test is the one BF-39 names in its verification**: two servings of the same meal on
 * the same day must not merge, which is why the grouping is on `meal_group_id` and never on
 * `saved_meal_id`.
 */

const MEAL_ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1'
const MEAL_NAME = 'Spec Nested Breakfast'
const FOODS = [
  { id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e201', name: 'Spec Nested Oats' },
  { id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e202', name: 'Spec Nested Whey' },
  { id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e203', name: 'Spec Nested Butter' },
]
const GROUP_A = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e301'
const GROUP_B = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e302'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM food_logs WHERE food_item_id = ANY($1)', [FOODS.map(f => f.id)])
  await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
  await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
  await db.query('DELETE FROM food_items WHERE id = ANY($1)', [FOODS.map(f => f.id)])
}

/**
 * Seed the meal and one row per ingredient per group. **Today in the USER's timezone**, read back
 * from their own row — never `current_date`, which is the server's UTC day and is the previous one
 * for ten hours out of every twenty-four in Brisbane.
 */
async function seed(db: Client, groups: string[]) {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
  const userId = rows[0]?.id
  expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  await cleanup(db)
  for (const f of FOODS) {
    await db.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, $3, 100, 150, 8, 20, 4, 'manual')`,
      [f.id, userId, f.name],
    )
  }
  await db.query('INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 1)', [MEAL_ID, userId, MEAL_NAME])
  for (const f of FOODS) {
    await db.query(
      'INSERT INTO saved_meal_items (saved_meal_id, food_item_id, quantity_multiplier) VALUES ($1, $2, 1)',
      [MEAL_ID, f.id],
    )
  }
  for (const groupId of groups) {
    for (const f of FOODS) {
      await db.query(
        `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at, saved_meal_id, meal_group_id)
         SELECT $1, to_char(now() AT TIME ZONE u.timezone, 'YYYY-MM-DD'),
                (SELECT id FROM meal_types WHERE user_id = $1 ORDER BY sort_order LIMIT 1),
                $2, 1.0, now(), $3, $4
           FROM users u WHERE u.id = $1`,
        [userId, f.id, MEAL_ID, groupId],
      )
    }
  }
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })
test.afterAll(async () => { await withDb(cleanup) })

/** The dev overlay's `<nextjs-portal>` covers the bottom-left corner and eats coordinate taps. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const paint = () => {
      const style = document.createElement('style')
      style.textContent = 'nextjs-portal{display:none!important}'
      document.head.appendChild(style)
    }
    if (document.head) paint()
    else document.addEventListener('DOMContentLoaded', paint)
  })
})

const groupRow = (page: Page) => page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) })

async function openDiary(page: Page) {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
}

test('a logged meal is ONE row that opens to its ingredients', async ({ page }) => {
  await withDb(db => seed(db, [GROUP_A]))
  await openDiary(page)

  const row = groupRow(page).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText(`${FOODS.length} ingredients`)
  // 150 kcal × 3 — the group carries the meal's total, not one ingredient's.
  await expect(row).toContainText('450')

  // The flood is what was reported, so the ingredients start hidden.
  for (const f of FOODS) await expect(page.getByText(f.name, { exact: true })).toHaveCount(0)
  await expect(row).toHaveAttribute('aria-expanded', 'false')

  // Centre it first: a diary row's natural position here is under the bottom tab bar, so the
  // coordinate tap lands on a nav icon and switches tab — which reads as the row vanishing.
  await row.evaluate(el => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  const box = (await row.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)

  await expect(row).toHaveAttribute('aria-expanded', 'true')
  for (const f of FOODS) await expect(page.getByText(f.name, { exact: true })).toBeVisible()
  // "not eight siblings, and not a single opaque row that loses the breakdown" — both halves.
  // Scoped to the group, not the page: the meal card's own totals footer prints the same figures
  // whenever the meal is the only thing in that meal type, which it is here.
  const group = row.locator('xpath=..')
  await expect(group.getByText('P 24g', { exact: true })).toBeVisible()
  await expect(group.getByText('C 60g', { exact: true })).toBeVisible()
})

test('two servings of the same meal on one day stay two rows', async ({ page }) => {
  await withDb(db => seed(db, [GROUP_A, GROUP_B]))
  await openDiary(page)

  await expect(groupRow(page).first()).toBeVisible({ timeout: 30_000 })
  // Grouped on `meal_group_id`, never on `saved_meal_id`: the same meal twice is two helpings, and
  // merging them would report one where two were eaten.
  await expect(groupRow(page)).toHaveCount(2)
})

test('rows logged before the columns existed stay loose, which is correct rather than broken', async ({ page }) => {
  await withDb(async db => {
    await seed(db, [GROUP_A])
    // Nothing back-fills — there is no way to recover which pre-BF-39 rows belonged together.
    await db.query('UPDATE food_logs SET saved_meal_id = NULL, meal_group_id = NULL WHERE food_item_id = ANY($1)', [FOODS.map(f => f.id)])
  })
  await openDiary(page)

  await expect(page.getByText(FOODS[0].name, { exact: true })).toBeVisible({ timeout: 30_000 })
  for (const f of FOODS) await expect(page.getByText(f.name, { exact: true })).toBeVisible()
  await expect(groupRow(page)).toHaveCount(0)
})
