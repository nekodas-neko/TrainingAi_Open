import { test, expect } from '@playwright/test'
import { settleRouteBoundary } from './fixtures'
import { execFileSync } from 'node:child_process'

/**
 * LA-36 — a food item's stored picture reaches the diary row.
 *
 * `food_items.image_data_uri` was written to the device and read back by nothing: every diary row
 * passed `thumbSrc={null}`, so the tile the artboards draw was permanently the placeholder.
 *
 * The day's logs are injected. Whether the seeded user has a logged food carrying a picture is a
 * fact about fixtures — the device measured **1 of 339** local foods with one on 2026-09-23 — so
 * this would otherwise assert against a diary with nothing to show.
 */
test.setTimeout(180_000)

// A 1x1 PNG data URI. Real ones are 128 px thumbnails capped at 16 KB; only the scheme matters
// here, and `MealThumb`'s contract is explicitly `data:` URIs and never a remote URL.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'
const ITEM_ID = '11111111-2222-3333-4444-la36a0000001'.replace(/[^0-9a-f-]/g, '0')
const LOG_ID  = '11111111-2222-3333-4444-la36b0000002'.replace(/[^0-9a-f-]/g, '0')

function sql(statement: string): string {
  return execFileSync('psql', [DB, '-tAc', statement], { encoding: 'utf8' }).trim()
}

// Seeded rather than stubbed: the diary reads the day's logs and the seeded user has NONE, so a
// route overlay had nothing to patch and both assertions passed against an empty list. The device
// measured 1 of 339 local foods carrying a picture, so this is the rare row made deterministic.
test.beforeAll(() => {
  const userId = sql("select id from users where email = 'test@local.dev'")
  const mealTypeId = sql(`select id from meal_types where user_id = '${userId}' order by sort_order limit 1`)
  const today = sql(`select to_char(now() at time zone 'Australia/Brisbane', 'YYYY-MM-DD')`)
  sql(`insert into food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source, region, image_data_uri)
       values ('${ITEM_ID}', '${userId}', 'LA36 Pictured Food', 210, 20, 12, 9, 100, 'manual', 'AU', '${PIXEL}')
       on conflict (id) do update set image_data_uri = excluded.image_data_uri`)
  sql(`insert into food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
       values ('${LOG_ID}', '${userId}', '${today}', '${mealTypeId}', '${ITEM_ID}', 1, now())
       on conflict (id) do nothing`)
})

test.afterAll(() => {
  sql(`delete from food_logs where id = '${LOG_ID}'`)
  sql(`delete from food_items where id = '${ITEM_ID}'`)
})

test('a logged food with a stored picture shows it instead of the placeholder', async ({ page }) => {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await expect(page.getByText('LA36 Pictured Food')).toBeVisible()
  await expect(page.locator(`img[src="${PIXEL}"]`).first()).toBeVisible()
})

test('the tile is still drawn for a food without a picture', async ({ page }) => {
  // The box stays on every row — it is what stops the list reading as ragged (BF-32), so its
  // absence would be the regression, not its presence. Asserted by clearing the picture on the
  // very row proved above to render one.
  sql(`update food_items set image_data_uri = null where id = '${ITEM_ID}'`)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await expect(page.getByText('LA36 Pictured Food')).toBeVisible()
  await expect(page.locator(`img[src="${PIXEL}"]`)).toHaveCount(0)
})
