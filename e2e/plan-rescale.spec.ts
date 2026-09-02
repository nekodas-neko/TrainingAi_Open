import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, tapCentre } from './fixtures'

/**
 * Q-187 on the real screen: the plan card's remaining meals re-scale against what was eaten.
 *
 * **This spec exists because the seed builds no meal plan and logs no food** (LB-51), so the whole
 * plan card — the log-all action, the per-meal log and decline, save-to-My-Foods, and this — had
 * nothing exercising it. Q-187 shipped verified by hand against a local database, which proves it
 * worked once and leaves no regression net.
 *
 * It builds its own fixture in Postgres rather than stubbing `/api/nutrition/meal-plans`, because
 * the `eaten` half of the arithmetic comes from real `food_logs` the page reads through its own
 * pipeline. A stubbed plan against real food would test half the sum.
 *
 * **The assertion is the invariant, not a number:** the adjusted figures on the remaining rows sum
 * to the day's target minus what was eaten, both read off the card itself. That survives someone
 * changing the fixture's calories.
 */

// Fixed ids so a crashed run cleans up on the next one rather than accumulating plans. Deleted in
// `beforeAll` as well as `afterAll` for exactly that reason.
const PLAN = '11111111-1111-4111-8111-1111111111a7'
const VARIANT = '22222222-2222-4222-8222-2222222222a7'
const MEALS = ['33333333-3333-4333-8333-3333333333a1', '33333333-3333-4333-8333-3333333333a2', '33333333-3333-4333-8333-3333333333a3']
const ITEM = '44444444-4444-4444-8444-4444444444a7'
const LOG = '55555555-5555-4555-8555-5555555555a7'

const TARGET_KCAL = 2000
/** 900 eaten leaves 1,100 over a 2,000 kcal plan — a factor of 0.55, well clear of the floor. */
const EATEN_KCAL = 900
/** 1,900 eaten leaves 100, which cannot make a meal — the floor case. */
const OVER_KCAL = 1900

test.setTimeout(180_000)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function userId(db: Client): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
  expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  return rows[0].id
}

async function cleanup(db: Client): Promise<void> {
  await db.query('DELETE FROM food_logs WHERE id = $1', [LOG])
  await db.query('DELETE FROM food_items WHERE id = $1', [ITEM])
  await db.query('DELETE FROM meal_plan_meals WHERE variant_id = $1', [VARIANT])
  await db.query('DELETE FROM meal_plan_variants WHERE id = $1', [VARIANT])
  await db.query('DELETE FROM meal_plans WHERE id = $1', [PLAN])
}

/** Today in the USER's timezone, which is what `food_logs.date` is keyed on — never the runner's. */
async function todayInUserTz(db: Client): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD') AS d`,
  )
  return rows[0].d
}

async function setEaten(kcal: number): Promise<void> {
  await withDb(db => db.query('UPDATE food_items SET calories = $1 WHERE id = $2', [kcal, ITEM]).then(() => undefined))
}

test.beforeAll(async () => {
  await withDb(async db => {
    const uid = await userId(db)
    await cleanup(db)
    const date = await todayInUserTz(db)

    await db.query(
      `INSERT INTO meal_plans (id, user_id, name, is_active, meals_per_day,
                               target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'Q-187 rescale fixture', true, 3, $3, 150, 200, 67)`,
      [PLAN, uid, TARGET_KCAL],
    )
    await db.query(
      `INSERT INTO meal_plan_variants (id, meal_plan_id, day_type, target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'all', $3, 150, 200, 67)`,
      [VARIANT, PLAN, TARGET_KCAL],
    )
    // 600 + 700 + 700 = 2,000, matching the variant target so the arithmetic has no slack in it.
    const rows: [string, number, number, string, string][] = [
      [MEALS[0], 1, 600, 'Fixture breakfast', '07:00'],
      [MEALS[1], 2, 700, 'Fixture lunch', '12:30'],
      [MEALS[2], 3, 700, 'Fixture dinner', '19:00'],
    ]
    for (const [id, position, kcal, name, at] of rows) {
      await db.query(
        `INSERT INTO meal_plan_meals (id, variant_id, position, name, target_calories,
                                      target_protein_g, target_carbs_g, target_fat_g, ingredients, suggested_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, VARIANT, position, name, kcal, (kcal * 0.3) / 4, (kcal * 0.4) / 4, (kcal * 0.3) / 9,
         JSON.stringify([{ name: 'Fixture food', weightG: 100, calories: kcal, proteinG: 0, carbsG: 0, fatG: 0 }]), at],
      )
    }

    // The eaten half has to be real food the page reads through its own pipeline: `eaten` is derived
    // from the day's logs, so a stubbed plan against no food would test half the sum.
    const { rows: mealTypes } = await db.query<{ id: string }>(`SELECT id FROM meal_types ORDER BY time_start_hour LIMIT 1`)
    await db.query(
      `INSERT INTO food_items (id, user_id, name, source, calories, protein_g, carbs_g, fat_g)
       VALUES ($1, $2, 'Q-187 fixture meal', 'manual', $3, 60, 90, 30)`,
      [ITEM, uid, EATEN_KCAL],
    )
    await db.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [LOG, uid, date, mealTypes[0].id, ITEM],
    )
  })
})

test.afterAll(async () => {
  await withDb(cleanup)
})

/** Opens Nutrition and expands the plan's meal list. */
async function openPlanMeals(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(page.getByText('Q-187 rescale fixture')).toBeVisible({ timeout: 60_000 })
  // A real touch, never `.click()`: the Nutrition screen's date-swipe `useDrag` binds mouse and
  // pointer and swallows the click, so a forced click leaves `aria-expanded` at `false` (Q-354).
  // Measured while building Q-187, and it is the single thing most likely to cost the next author
  // an hour on this screen.
  const toggle = page.getByRole('button', { name: /Show 3 meals/ })
  await toggle.scrollIntoViewIfNeeded()
  await tapCentre(page, toggle)
  await expect(page.getByRole('button', { name: /Hide meals/ })).toBeVisible({ timeout: 30_000 })
}

/** Every `N kcal` figure the expanded rows are currently offering, adjusted or planned. */
async function rowCalories(page: Page): Promise<number[]> {
  const list = page.locator('ul').filter({ hasText: 'Fixture dinner' }).first()
  const text = await list.innerText()
  return [...text.matchAll(/(\d[\d,]*) kcal/g)].map(m => Number(m[1].replace(/,/g, '')))
}

test('the remaining meals are re-scaled to what is left of the day', async ({ page }) => {
  await setEaten(EATEN_KCAL)
  await openPlanMeals(page)

  // Read the eaten figure off the card rather than trusting the fixture — if the page and the
  // database disagree, that is itself the failure, and asserting against a constant would hide it.
  const header = await page.locator('text=/\\d[\\d,]* \\/ [\\d,]+/').first().innerText()
  const [eaten, target] = header.split('/').map(s => Number(s.replace(/[^\d]/g, '')))
  expect(target).toBe(TARGET_KCAL)

  // Each row carries its planned figure too, so the adjusted ones are the odd indices out — match
  // the pairing explicitly instead.
  const list = page.locator('ul').filter({ hasText: 'Fixture dinner' }).first()
  const text = await list.innerText()
  const adjusted = [...text.matchAll(/(\d[\d,]*) kcal\(planned ([\d,]+)\)/g)]
    .map(m => ({ now: Number(m[1].replace(/,/g, '')), planned: Number(m[2].replace(/,/g, '')) }))

  expect(adjusted, 'every remaining meal must carry an adjusted figure and its planned one').toHaveLength(3)
  expect(adjusted.reduce((s, m) => s + m.now, 0)).toBe(target - eaten)
  // Not merely different: scaled DOWN, because the day is over its share.
  for (const m of adjusted) expect(m.now).toBeLessThan(m.planned)
})

test('the floor leaves the meals as planned and says why', async ({ page }) => {
  await setEaten(OVER_KCAL)
  await openPlanMeals(page)

  await expect(page.getByText(/under a meal — the remaining meals are left as planned/)).toBeVisible({ timeout: 30_000 })

  const list = page.locator('ul').filter({ hasText: 'Fixture dinner' }).first()
  expect(await list.innerText(), 'no row may carry an adjusted figure once the floor binds').not.toContain('(planned')
  expect(await rowCalories(page)).toEqual([600, 700, 700])
})
