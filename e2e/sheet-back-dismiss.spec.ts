import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A sheet that MOUNTS already-open still opens, and the Android back gesture still closes it in one
 * press (LB-10).
 *
 * `useSheetBackDismiss` pushes a history entry on open and calls `history.back()` in its cleanup.
 * React StrictMode runs that cleanup→effect pair once on mount, and `history.back()` resolves its
 * delta when it is *called*, not when it runs — so the sequence is push → back() → push and the
 * resulting `popstate` lands after the second push carrying the pre-push state. The handler cannot
 * tell it from a real back gesture, so it fired `onClose()` on the frame the sheet opened, and took
 * the pushed entry with it.
 *
 * **Only `QuickEditLogSheet` was reachable**, because `nutrition-content.tsx` gives it a
 * `key={editingLog?.id}` — that remounts it with `open` already true. The other four call sites are
 * mounted permanently with `open` false, so their first (double-invoked) run bails before pushing
 * and the later flip to true runs once. Measured both ways before fixing.
 *
 * **This guard only means anything under `pnpm dev`**, which is what the harness runs and what
 * StrictMode is on for. Production never double-invokes, which is why this was invisible in the
 * product and fatal on the surface every change is tested against.
 */

const LOG_ID = '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c'
const FOOD_ID = '5d5d5d5d-5d5d-4d5d-8d5d-5d5d5d5d5d5d'
const MEAL = 'Breakfast'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM food_logs WHERE id = $1', [LOG_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [FOOD_ID])
}

/** The diary row shows *today*, so the fixture has to be dated in the user's zone, not UTC. */
async function todayForUser(db: Client): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `SELECT to_char(now() AT TIME ZONE coalesce(timezone, 'Australia/Brisbane'), 'YYYY-MM-DD') AS d
       FROM users WHERE email = $1`,
    [SEED_EMAIL],
  )
  return rows[0].d
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)

    const { rows: [meal] } = await db.query<{ id: string }>(
      'SELECT id FROM meal_types WHERE name = $1 LIMIT 1', [MEAL],
    )
    expect(meal?.id, `no "${MEAL}" meal type is seeded`).toBeTruthy()

    await db.query(
      `INSERT INTO food_items (id, user_id, name, serving_size_g, calories, protein_g, carbs_g, fat_g, source)
       VALUES ($1, $2, 'Spec Back Dismiss Food', 100, 200, 10, 20, 5, 'manual')`,
      [FOOD_ID, userId],
    )
    await db.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, $3, $4, $5, 2)`,
      [LOG_ID, userId, await todayForUser(db), meal.id, FOOD_ID],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

test('a sheet mounted already-open stays open, and one back press closes it', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const row = page.locator('button', { hasText: 'Spec Back Dismiss Food' }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  const lengthBefore = await page.evaluate(() => history.length)

  // A DOM click rather than a synthesised tap, deliberately: what is under test is the history
  // sequence the mount runs, not the input path, and a tap that misses would fail this spec for a
  // reason it is not about. Retried because a click fired before React has attached the handler
  // does nothing, silently, and CI starts the dev server cold.
  await expect(async () => {
    await row.evaluate(el => (el as HTMLElement).click())
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })

  // The defect: the sheet closed itself here, and its history entry was gone with it.
  await page.waitForTimeout(1_000)
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(lengthBefore + 1)

  // One press, and it lands back on the screen rather than off it.
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
  expect(new URL(page.url()).pathname).toBe('/nutrition')
})
