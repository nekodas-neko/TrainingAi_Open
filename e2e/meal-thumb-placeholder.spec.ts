import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * Every meal row carries a tile — its photo, or the placeholder (BF-32).
 *
 * The owner's instruction is what makes this stronger than "add a thumbnail": *"it should show the
 * default one in the mockup if no image is attached."* The placeholder is the **always-present**
 * state, so the assertion that matters is the one about a meal with **no** photo. A test that only
 * checked a photo renders would pass against a build that draws nothing when there isn't one, which
 * is the ragged list this exists to prevent.
 *
 * The feature was write-only before this: `saved_meals.image_data_uri` round-trips through both
 * write paths, the outbox replay and the local mirror, and **nothing rendered it** — every
 * `imageDataUri` hit in the tree was a route, an adapter or the picker.
 */

const WITH_PHOTO = 'bf32bf32-bf32-4bf3-8bf3-aaaaaaaaaaaa'
const NO_PHOTO = 'bf32bf32-bf32-4bf3-8bf3-bbbbbbbbbbbb'
const FOOD = 'bf32bf32-bf32-4bf3-8bf3-cccccccccccc'
const LOG = 'bf32bf32-bf32-4bf3-8bf3-dddddddddddd'
const NAME_WITH = 'BF32 Has Photo'
const NAME_WITHOUT = 'BF32 No Photo'

// A 1×1 WebP, the shape `MealPhotoTile` actually stores.
const PHOTO = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/vuUAAA='

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
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = ANY($1)', [[WITH_PHOTO, NO_PHOTO]])
    await db.query('DELETE FROM saved_meals WHERE id = ANY($1)', [[WITH_PHOTO, NO_PHOTO]])
    await db.query('DELETE FROM food_items WHERE id = $1', [FOOD])
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, 'BF32 Oats', 200, 8, 34, 4, 60, 'manual')`, [FOOD, userId])
    await db.query(
      `INSERT INTO saved_meals (id, user_id, name, servings, image_data_uri)
       VALUES ($1, $3, $4, 1, $5), ($2, $3, $6, 1, NULL)`,
      [WITH_PHOTO, NO_PHOTO, userId, NAME_WITH, PHOTO, NAME_WITHOUT])
    await db.query(
      `INSERT INTO saved_meal_items (id, saved_meal_id, food_item_id, quantity_multiplier)
       VALUES (gen_random_uuid(), $1, $3, 1), (gen_random_uuid(), $2, $3, 1)`,
      [WITH_PHOTO, NO_PHOTO, FOOD])
    // The day screen has no diary rows unless something is logged, and a spec that asserts on an
    // empty list passes for the wrong reason. Dated in the USER's zone, not the runner's.
    await db.query('DELETE FROM food_logs WHERE id = $1', [LOG])
    await db.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
       SELECT $1, $2, to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD'),
              (SELECT id FROM meal_types WHERE user_id = $2 AND deleted_at IS NULL LIMIT 1),
              $3, 1, now() - interval '3 hours'`,
      [LOG, userId, FOOD])
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM saved_meal_items WHERE saved_meal_id = ANY($1)', [[WITH_PHOTO, NO_PHOTO]])
    await db.query('DELETE FROM saved_meals WHERE id = ANY($1)', [[WITH_PHOTO, NO_PHOTO]])
    await db.query('DELETE FROM food_logs WHERE id = $1', [LOG])
    await db.query('DELETE FROM food_items WHERE id = $1', [FOOD])
  })
})

/** `.click()` never lands on this screen — see water-log-write-path.spec.ts (Q-354). */
async function openLibrary(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  const button = page.getByRole('button', { name: 'Saved Meals', exact: true })
  await expect(button).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    const box = (await button.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByText(NAME_WITHOUT)).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 90_000 })
}

/** The tile is a 40 px box carrying the gradient; the glyph or the photo sits inside it. */
async function tileOf(page: Page, mealName: string) {
  const row = page.getByRole('button', { name: new RegExp(`^${mealName}`) }).first()
  await expect(row).toBeVisible()
  return row.evaluate(el => {
    const tile = el.querySelector('span[style*="border-radius"]') as HTMLElement | null
    if (!tile) return { present: false, gradient: '', img: 0, svg: 0, size: '' }
    return {
      present: true,
      gradient: getComputedStyle(tile).backgroundImage.slice(0, 20),
      img: tile.querySelectorAll('img').length,
      svg: tile.querySelectorAll('svg').length,
      size: `${Math.round(tile.getBoundingClientRect().width)}x${Math.round(tile.getBoundingClientRect().height)}`,
    }
  })
}

test('a meal with no photo still gets the tile — the placeholder is the default state', async ({ page }) => {
  await openLibrary(page)

  const without = await tileOf(page, NAME_WITHOUT)
  expect(without.present, 'a meal with no photo rendered no tile at all').toBe(true)
  expect(without.size).toBe('40x40')
  expect(without.gradient).toContain('linear-gradient')
  expect(without.svg, 'the placeholder glyph is missing').toBeGreaterThan(0)
  expect(without.img, 'a meal with no photo must not render an <img>').toBe(0)
})

test('a meal with a photo shows it in the same box', async ({ page }) => {
  await openLibrary(page)

  const withPhoto = await tileOf(page, NAME_WITH)
  expect(withPhoto.present).toBe(true)
  // The same box, the same size — which is what makes the list read as one thing.
  expect(withPhoto.size).toBe('40x40')
  expect(withPhoto.img, 'the stored photo is not rendered').toBe(1)
  expect(withPhoto.svg, 'the placeholder glyph should give way to the photo').toBe(0)
})

test('the diary rows on the day screen carry the tile too', async ({ page }) => {
  // Artboard 1 draws it on every logged-food row. `food_items` has no image column, so these are
  // always the placeholder today — the box is what stops the list going ragged once one does.
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(page.getByText('BF32 Oats').first()).toBeVisible({ timeout: 30_000 })
  const tiles = await page.locator('span[style*="border-radius"]').count()
  expect(tiles, 'no meal tiles rendered on the day screen').toBeGreaterThan(0)
})
