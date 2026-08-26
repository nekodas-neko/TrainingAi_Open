import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, openSavedMeal, settleRouteBoundary } from './fixtures'

/**
 * The meal library drawn as artboard 3 draws it (BF-29).
 *
 * The list was a stack of tall cards, each carrying a macro bar and a four-button action row, and
 * the calorie figure sat in a pill inside the name block. The drawing is a scannable list: one
 * grouped card of rows, `name · what is in it · calories in a right-hand column`, with the actions
 * reached by swiping a row.
 *
 * **The footnote is the specification these assertions are really about.** "Calories are per
 * portion" is a claim about the number in the calorie column — a batch meal that makes two shows
 * one portion, not the tub — and "swipe a row for label, edit and delete" is a claim that a gesture
 * exists which nothing else on the screen announces. Both are asserted below, the first with a
 * fixture whose batch and portion figures differ by a factor the arithmetic cannot fake.
 */

const MEAL_ID = 'bf29bf29-bf29-4bf2-8bf2-bf29bf29bf29'
const FOOD_A = 'bf29bf29-bf29-4bf2-8bf2-aaaaaaaaaaaa'
const FOOD_B = 'bf29bf29-bf29-4bf2-8bf2-bbbbbbbbbbbb'
const MEAL_NAME = 'BF29 Batch Ice Cream'

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
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
    await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [[FOOD_A, FOOD_B]])
    // 200 + 120 = 320 kcal for the whole batch; the recipe makes two, so a row must read 160.
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $3, 'BF29 Oats', 200, 8, 34, 4, 60, 'manual'),
              ($2, $3, 'BF29 Whey', 120, 24, 3, 2, 30, 'manual')`,
      [FOOD_A, FOOD_B, userId],
    )
    await db.query(
      `INSERT INTO saved_meals (id, user_id, name, servings) VALUES ($1, $2, $3, 2)`,
      [MEAL_ID, userId, MEAL_NAME],
    )
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES (gen_random_uuid(), $1, $2, 1), (gen_random_uuid(), $1, $3, 1)`,
      [MEAL_ID, FOOD_A, FOOD_B],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = $1', [MEAL_ID])
    await db.query('DELETE FROM saved_meals WHERE id = $1', [MEAL_ID])
    await db.query('DELETE FROM food_items WHERE id = ANY($1)', [[FOOD_A, FOOD_B]])
  })
})

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openLibrary(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'My Meals', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    // Tap only while the sheet is still CLOSED. Since Q-395c this button opens Log Food, which then
    // covers the coordinate, so an unconditional re-tap lands on the sheet's own content and the
    // retry makes things worse rather than better (it cost `meal-label` two runs).
    if (await page.getByRole('dialog').count() === 0) {
      const box = (await button.boundingBox())!
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }
    await expect(page.getByText(MEAL_NAME)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
}

/**
 * Drag a row to the left with a real touch sequence.
 *
 * Playwright's `touchscreen` can tap and nothing else, and a mouse drag proves nothing about a
 * handler bound with `pointer: { touch: true }` — so the moves go through CDP directly. They are
 * spaced in time on purpose: `@use-gesture` derives velocity from the interval, and a burst
 * dispatched in one tick reads as an instant flick rather than a drag.
 */
async function swipeRowLeft(page: Page, row: ReturnType<Page['getByRole']>, distance: number): Promise<void> {
  const box = (await row.boundingBox())!
  const y = box.y + box.height / 2
  const startX = box.x + box.width - 16
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] })
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX - (distance * step) / 10, y }],
      })
      await page.waitForTimeout(16)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

test('the meal library is artboard 3: a count line, one grouped list, and per-portion calories', async ({ page }) => {
  await openLibrary(page)

  // The search field no longer waits for a fifth meal to appear. It says which list it searches
  // since BF-37 split them back apart.
  await expect(page.getByPlaceholder('Search your meals')).toBeVisible()

  // The count line, which replaced the `· N` that used to ride on the sheet's title. Still "items"
  // rather than "meals": the word survived the split because the row count is what it describes,
  // and a tab that shows only meals already says so in its own label.
  await expect(page.getByText(/^\d+ items?$/)).toBeVisible()

  const row = page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) }).first()
  await expect(row).toBeVisible()

  // Artboard 3's grey line: what is in it, and that it is a batch.
  await expect(row).toContainText('2 items · makes 2 portions')

  // Per portion — 160 of the batch's 320. A row printing 320 would be describing the tub while the
  // button beside it logs half of one.
  await expect(row).toContainText('160')
  await expect(row).not.toContainText('320')

  await expect(page.getByText('Meal calories are per portion. Swipe a meal for label, edit and delete.')).toBeVisible()
})

test('swiping a row left reveals its actions, and delete still asks first', async ({ page }) => {
  await openLibrary(page)
  const row = page.getByRole('button', { name: new RegExp(`^${MEAL_NAME}`) }).first()
  await expect(row).toBeVisible()

  // Closed, the tray is out of the accessibility tree — a reader must not be walked through three
  // actions that are not on screen.
  const trayDelete = page.getByRole('button', { name: `Delete ${MEAL_NAME}` })
  await expect(trayDelete).toHaveCount(0)

  await swipeRowLeft(page, row, 200)
  await expect(trayDelete).toBeVisible({ timeout: 10_000 })

  // Delete never fires outright — it opens the meal with its confirmation up (BF-30). A swipe that
  // deletes on release is the failure mode this list cannot afford: the tray is one thumb-flick
  // from a scroll.
  await trayDelete.tap()
  await expect(page.getByText(`Delete “${MEAL_NAME}”?`)).toBeVisible()

  const stillThere = await withDb(async db =>
    (await db.query('SELECT 1 FROM saved_meals WHERE id = $1', [MEAL_ID])).rowCount)
  expect(stillThere, 'the swipe deleted the meal without a confirmation').toBe(1)
})

test('the actions the swipe offers are also reachable by opening the row', async ({ page }) => {
  await openLibrary(page)
  // Swipe is an accelerator. Every action it holds has to be reachable without the gesture, or a
  // reader — and anyone who never discovers the drag — loses delete entirely. Since BF-30 they all
  // live one tap away inside the meal.
  await openSavedMeal(page, MEAL_NAME)
  await expect(page.getByRole('button', { name: `Print a label for ${MEAL_NAME}` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Edit ${MEAL_NAME}` })).toBeVisible()
  await expect(page.getByRole('button', { name: `Delete ${MEAL_NAME}` })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log this meal' })).toBeVisible()
})
