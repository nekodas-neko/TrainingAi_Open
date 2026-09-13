import { test, expect, type Locator, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, tapCentre } from './fixtures'

/**
 * The plan card's per-meal answer: *"I ate this"* and *"did not eat this"* (LB-51 residue).
 *
 * `plan-rescale.spec.ts` covered the re-scaling, `plan-day-fill.spec.ts` the bulk offer and
 * `plan-meal-to-saved-meal.spec.ts` the copy into My Foods. The pair left uncovered was the one the
 * whole Q-187 design turns on: **an answer of "yes" writes food and an answer of "no" writes none**,
 * because the property being protected is that the day's totals never count a meal nobody ate.
 *
 * **The assertions are on the `food_logs` rows, not on the button's label.** Both buttons report
 * themselves instantly — the log button flips on the optimistic write, and the decline flips before
 * its request resolves — so a control wired to nothing paints exactly the same screen. What only
 * passes when the write really happened is a row in the database, and for the decline, its absence.
 *
 * **And the decline is re-read after a reload**, which is the only evidence it did anything at all:
 * declining changes no food and no total, so a version that kept the answer in React state and
 * dropped the write would pass every on-screen assertion in this file.
 *
 * The fixture is built in Postgres rather than stubbed, because `plan_meal_answers.plan_meal_id` is
 * a foreign key onto `meal_plan_meals` — a stubbed plan's invented ids cannot be declined at all.
 *
 * Not exercised here: the device path. The browser has no native SQLite, so `getLocalStore` returns
 * null and both writes take their web fallback; the local-store mirror and the outbox mutation are
 * owed an on-device check.
 */

// Fixed ids so a crashed run cleans up on the next one rather than accumulating plans.
const PLAN = '11111111-1111-4111-8111-1111111111b3'
const VARIANT = '22222222-2222-4222-8222-2222222222b3'
const ALPHA = '33333333-3333-4333-8333-3333333333b1'
const BRAVO = '33333333-3333-4333-8333-3333333333b2'

/**
 * Distinct per meal, because "already logged" is derived by matching the day's food against a
 * meal's ingredient NAMES — two meals sharing an ingredient name would both read as logged off one
 * tap, and the second half of every assertion below would pass for the wrong reason.
 */
const ALPHA_FOOD = 'E2E LogDecline Alpha'
const BRAVO_FOOD = 'E2E LogDecline Bravo'
const FOOD_PREFIX = 'E2E LogDecline %'

/**
 * Both meals sit at 00:00, so both are behind the clock at every hour of the day.
 *
 * The offer is bounded by `hour <= nowHour`, and a fixture placed relative to "now" is how
 * `plan-day-fill.spec.ts` came to fail for one hour a day. Midnight has no such edge: there is no
 * hour it is not already past.
 */
const AT = '00:00'

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

/** Today in the USER's timezone, which is what `food_logs.date` is keyed on — never the runner's. */
async function todayInUserTz(db: Client): Promise<string> {
  const { rows } = await db.query<{ d: string }>(
    `SELECT to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD') AS d`,
  )
  return rows[0].d
}

/**
 * The food and answers this spec's own taps produce, cleared between tests.
 *
 * Their ids are the app's rather than this spec's, so they are matched by the ingredient names
 * above. Clearing them between tests is what keeps each test's opening state the same two
 * unanswered meals regardless of what ran before it — and clearing them at the END is what keeps
 * this file out of `plan-rescale.spec.ts`, which runs later in the same serial worker and sums the
 * day's food (LA-67).
 */
async function clearAnswers(db: Client): Promise<void> {
  await db.query(
    `DELETE FROM food_logs WHERE food_item_id IN (SELECT id FROM food_items WHERE name LIKE $1)`,
    [FOOD_PREFIX],
  )
  await db.query('DELETE FROM food_items WHERE name LIKE $1', [FOOD_PREFIX])
  await db.query('DELETE FROM plan_meal_answers WHERE plan_meal_id = ANY($1::uuid[])', [[ALPHA, BRAVO]])
}

async function cleanup(db: Client): Promise<void> {
  await clearAnswers(db)
  await db.query('DELETE FROM meal_plan_meals WHERE variant_id = $1', [VARIANT])
  await db.query('DELETE FROM meal_plan_variants WHERE id = $1', [VARIANT])
  await db.query('DELETE FROM meal_plans WHERE id = $1', [PLAN])
}

/**
 * `meal_plans_one_active_per_user` allows one, and `cleanup` only removes THIS spec's plan by id —
 * so a plan another spec left active makes the insert below fail on the constraint, and every test
 * here dies in `beforeAll` talking about a duplicate key rather than about the plan card.
 * Deactivating rather than deleting: another spec's row is not this one's to remove.
 */
async function standDownOtherActivePlans(db: Client, uid: string): Promise<void> {
  await db.query('UPDATE meal_plans SET is_active = false WHERE user_id = $1 AND id <> $2', [uid, PLAN])
}

function ingredient(name: string) {
  return { name, weightG: 100, caloriesPer100g: 300, proteinPer100g: 20, carbsPer100g: 30, fatPer100g: 10 }
}

/** How many food logs the day holds for one of the fixture's ingredients. */
async function loggedCount(food: string): Promise<number> {
  return withDb(async db => {
    const uid = await userId(db)
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM food_logs fl JOIN food_items fi ON fi.id = fl.food_item_id
        WHERE fl.user_id = $1 AND fl.date = $2 AND fl.deleted_at IS NULL AND fi.name = $3`,
      [uid, await todayInUserTz(db), food],
    )
    return Number(rows[0].n)
  })
}

/** Live (not undone) decline rows for one fixture meal, on the day the page is showing. */
async function answerCount(planMealId: string): Promise<number> {
  return withDb(async db => {
    const uid = await userId(db)
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM plan_meal_answers
        WHERE user_id = $1 AND plan_meal_id = $2 AND log_date = $3 AND deleted_at IS NULL`,
      [uid, planMealId, await todayInUserTz(db)],
    )
    return Number(rows[0].n)
  })
}

test.beforeAll(async () => {
  await withDb(async db => {
    const uid = await userId(db)
    await cleanup(db)
    await standDownOtherActivePlans(db, uid)

    await db.query(
      `INSERT INTO meal_plans (id, user_id, name, is_active, meals_per_day,
                               target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'LB-51 answer fixture', true, 2, 2000, 150, 200, 67)`,
      [PLAN, uid],
    )
    await db.query(
      `INSERT INTO meal_plan_variants (id, meal_plan_id, day_type, target_calories, target_protein_g, target_carbs_g, target_fat_g)
       VALUES ($1, $2, 'all', 2000, 150, 200, 67)`,
      [VARIANT, PLAN],
    )
    const rows: [string, number, string, string][] = [
      [ALPHA, 1, 'Fixture Alpha', ALPHA_FOOD],
      [BRAVO, 2, 'Fixture Bravo', BRAVO_FOOD],
    ]
    for (const [id, position, name, food] of rows) {
      await db.query(
        `INSERT INTO meal_plan_meals (id, variant_id, position, name, target_calories,
                                      target_protein_g, target_carbs_g, target_fat_g, ingredients, suggested_time)
         VALUES ($1, $2, $3, $4, 300, 20, 30, 10, $5, $6)`,
        [id, VARIANT, position, name, JSON.stringify([ingredient(food)]), AT],
      )
    }
  })
})

test.beforeEach(async () => {
  await withDb(clearAnswers)
})

test.afterAll(async () => {
  await withDb(cleanup)
})

/** Opens Nutrition and expands the plan's meal list. */
async function openPlanMeals(page: Page): Promise<void> {
  await page.goto('/nutrition')
  await settleRouteBoundary(page)
  await expect(page.getByText('LB-51 answer fixture')).toBeVisible({ timeout: 60_000 })
  // A real touch, never `.click()`: the Nutrition screen's date-swipe `useDrag` binds mouse and
  // pointer and swallows the click, so a forced click leaves `aria-expanded` at `false` (Q-354).
  // Not `scrollIntoViewIfNeeded()` — see `tapRowButton` below for the carousel half, and
  // `plan-meal-to-saved-meal.spec.ts` for the bottom-nav half. The same two hazards apply to this
  // toggle; it is only luck that this file's fixture leaves it higher up the page.
  const toggle = page.getByRole('button', { name: /Show 2 meals/ })
  await toggle.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await tapCentre(page, toggle)
  await expect(page.getByRole('button', { name: /Hide meals/ })).toBeVisible({ timeout: 30_000 })
}

/** The row for one fixture meal, found by the ingredient line only that meal carries. */
function mealRow(page: Page, food: string) {
  return page.locator('li').filter({ hasText: food }).first()
}

/**
 * Scroll a row's control into view — **vertically only** — and tap it.
 *
 * Two hazards, both of which this spec hit before the helper existed.
 *
 * `tapCentre` dispatches at a coordinate with no actionability check of its own, so a control below
 * the fold is tapped at whatever happens to be at those coordinates and the state never changes.
 * It needs a scroll first.
 *
 * But **`scrollIntoViewIfNeeded()` is the wrong scroll here**: it scrolls every ancestor scroll
 * container, and on the tab shell one of those is the *horizontal* carousel that holds all five tab
 * trees — so scrolling a control into view slid the shell off Nutrition and the tap landed on the
 * Workout tab. `inline: 'nearest'` is the whole fix: it leaves the horizontal axis alone when the
 * element is already within it, which it always is.
 */
async function tapRowButton(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await tapCentre(page, target)
}

test('"I ate this" writes the meal into the day, and the bulk offer drops with it', async ({ page }) => {
  await openPlanMeals(page)

  // The offer's count is the control: it can only fall to 1 if this meal stopped being fillable.
  await expect(page.getByRole('button', { name: /Log the 2 meals so far/ })).toBeVisible({ timeout: 30_000 })
  expect(await loggedCount(ALPHA_FOOD), 'the day starts with none of this meal').toBe(0)

  const row = mealRow(page, ALPHA_FOOD)
  await tapRowButton(page, row.getByRole('button', { name: /I ate this/ }))

  await expect(row.getByText('Logged')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Log the 1 meal so far/ })).toBeVisible({ timeout: 30_000 })

  // The row that only exists if the tap wrote food, rather than only repainted.
  expect(await loggedCount(ALPHA_FOOD)).toBe(1)
  expect(await loggedCount(BRAVO_FOOD), 'the meal that was not answered must stay unlogged').toBe(0)
})

test('declining writes no food, survives a reload, and undoes', async ({ page }) => {
  await openPlanMeals(page)
  await expect(page.getByRole('button', { name: /Log the 2 meals so far/ })).toBeVisible({ timeout: 30_000 })

  const row = mealRow(page, BRAVO_FOOD)
  // The decline flips the row BEFORE its write resolves — the tap is the feedback — so the write
  // has to be waited for rather than assumed. Reading the table straight after the flip found it
  // empty while the request was still in the air.
  const posted = page.waitForResponse(r =>
    r.url().includes('/api/nutrition/plan-meal-answers') && r.request().method() === 'POST')
  await tapRowButton(page, row.getByRole('button', { name: 'Did not eat Fixture Bravo' }))

  await expect(row.getByRole('button', { name: /Didn't eat this — undo/ })).toBeVisible({ timeout: 30_000 })
  expect((await posted).status(), 'the decline must be accepted, not 404ed as an unknown meal').toBe(200)
  // The design's whole point: an answer of "no" cannot move the day's totals, because it writes
  // nothing to move them.
  expect(await loggedCount(BRAVO_FOOD), 'declining must never write food').toBe(0)
  expect(await answerCount(BRAVO), 'the decline must reach plan_meal_answers').toBe(1)
  await expect(page.getByRole('button', { name: /Log the 1 meal so far/ })).toBeVisible({ timeout: 30_000 })

  // The decline changes no food and no total, so this reload is the only thing that can tell a
  // persisted answer from one that lived in React state until the next navigation.
  await openPlanMeals(page)
  await expect(mealRow(page, BRAVO_FOOD).getByRole('button', { name: /Didn't eat this — undo/ }))
    .toBeVisible({ timeout: 30_000 })

  const after = mealRow(page, BRAVO_FOOD)
  const removed = page.waitForResponse(r =>
    r.url().includes('/api/nutrition/plan-meal-answers') && r.request().method() === 'DELETE')
  await tapRowButton(page, after.getByRole('button', { name: /Didn't eat this — undo/ }))
  await expect(after.getByRole('button', { name: /I ate this/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /Log the 2 meals so far/ })).toBeVisible({ timeout: 30_000 })
  expect((await removed).status()).toBe(200)
  // Undo is a soft delete, so this is "no live answer" rather than "no row" — a hard delete would
  // never reach a device that has not synced.
  expect(await answerCount(BRAVO), 'undo must clear the stored answer, not only the button').toBe(0)
})
