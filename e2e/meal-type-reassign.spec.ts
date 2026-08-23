import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * Deleting a meal type that has entries offers to move them (Q-326).
 *
 * **The button used to be able only to fail.** `DELETE /api/nutrition/meal-types/[id]` refuses with a
 * 409 when food logs reference the type, and the manager turned that into a toast naming an action
 * — "move them to another meal type" — the app had never implemented, so the only escape a user
 * could find was deleting every log by hand (Q-412). The server half now takes `?reassignTo=`; this
 * asserts the client asks for it.
 *
 * **It uses its own meal type, not a seeded one.** The flow ends by deleting what it acts on, so
 * borrowing `Afternoon Snack` would leave every later spec running against a program the seed did
 * not describe.
 */
const TYPE_ID = '66666666-6666-4666-8666-666666666666'
const ITEM_ID = '66666666-6666-4666-8666-666666666667'
const LOG_COUNT = 3

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
  await db.query('DELETE FROM meal_types WHERE id = $1', [TYPE_ID])
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)
    // sort_order 99 keeps it last, so it cannot shift the seeded rows other specs count on.
    await db.query(
      `INSERT INTO meal_types (id, user_id, name, emoji, sort_order, time_start_hour, time_end_hour)
       VALUES ($1, $2, 'Spec Snack', '🧪', 99, 15, 17)`,
      [TYPE_ID, userId],
    )
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, 'Spec Oats', 380, 13, 60, 7, 'manual')`,
      [ITEM_ID, userId],
    )
    for (let i = 0; i < LOG_COUNT; i++) {
      await db.query(
        `INSERT INTO food_logs (user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
         VALUES ($1, to_char(current_date - $2::int, 'YYYY-MM-DD'), $3, $4, 1.0, now() - ($2 || ' days')::interval)`,
        [userId, i, TYPE_ID, ITEM_ID],
      )
    }
  })
})

test.afterAll(async () => { await withDb(cleanup) })

test('deleting a meal type with entries offers the move instead of only failing', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await page.getByRole('button', { name: 'Nutrition settings' }).click()

  // An exact attribute selector, not `getByRole(name:)`: the accessible-name match also resolves an
  // ancestor here, and the ancestor is not what carries the click.
  const del = page.locator('button[aria-label="Delete Spec Snack"]')
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()

  // The 409 becomes a question, not a toast. Asserting the COUNT is what distinguishes this from a
  // generic confirm — it can only come from the refusal's `logCount`.
  const dialog = page.getByRole('heading', { name: /Move .*entries/ }).locator('xpath=ancestor::*[@role="dialog"][1]')
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog).toContainText(`Spec Snack has ${LOG_COUNT} entries`)

  // Every other live meal type is offered, and nothing can be submitted until one is chosen.
  await expect(dialog.getByRole('radio')).toHaveCount(6)
  await expect(dialog.getByRole('button', { name: 'Move & delete' })).toBeDisabled()

  // The warning names the target once one is picked — the move rewrites history, which is the part
  // "move" does not imply on its own.
  await dialog.getByRole('radio', { name: /Lunch/ }).click()
  await expect(dialog).toContainText('Every past entry moves too')
  await expect(dialog).toContainText('will read as Lunch')

  await dialog.getByRole('button', { name: 'Move & delete' }).click()
  await expect(page.getByText(`Moved ${LOG_COUNT} entries to Lunch`)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('button[aria-label="Delete Spec Snack"]')).toHaveCount(0)

  // The entries are on the new type, not merely detached from the old one.
  const moved = await withDb(async db => {
    const { rows } = await db.query<{ name: string; n: string }>(
      `SELECT mt.name, count(*)::text AS n FROM food_logs fl
         JOIN meal_types mt ON mt.id = fl.meal_type_id
        WHERE fl.food_item_id = $1 AND fl.deleted_at IS NULL GROUP BY mt.name`,
      [ITEM_ID],
    )
    return rows
  })
  expect(moved).toEqual([{ name: 'Lunch', n: String(LOG_COUNT) }])
})
