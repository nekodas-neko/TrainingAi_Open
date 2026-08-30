import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { ensureEnergyBalanceProfile, enableHomeCards, settleRouteBoundary } from './fixtures'

/**
 * The calorie bar is a progress bar you walk to the end of, and Home's ring says how much is left
 * (Q-323).
 *
 * The owner's words: *"more like Red/Orange/green; all the way like a progress bar with the green
 * towards the end … So it still looks like a progress bar where you want to go to the end."* The old
 * bar drew fixed deviation bands with a marker, which reads as a dial. Home's ring was a full 360°
 * split by macro — it encoded composition, which the three macro rows beside it already give in
 * grams, and said nothing about progress.
 *
 * **Asserted against the route's arithmetic, through the rendered geometry.** A screenshot would
 * pin the pixels and rot on the next style change; asserting that the fill reaches
 * `intake / (budget + OUTER)` and the notch sits at `budget / (budget + OUTER)` pins the *meaning*,
 * which is the thing that was wrong.
 */

const SESSION_ID = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a'
const ITEM_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e'
const LOG_ID = '8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f'
/** Mirrors OUTER_KCAL — the tail past the goal is exactly the far-over threshold. */
const OUTER_KCAL = 400

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query('DELETE FROM food_logs WHERE id = $1', [LOG_ID])
  await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
  await db.query('DELETE FROM workout_hr_stats WHERE workout_session_id = $1', [SESSION_ID])
  await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
}

async function balanceFromRoute(page: Page) {
  const res = await page.request.get('/api/nutrition/energy-balance')
  expect(res.ok()).toBeTruthy()
  const b = (await res.json()).balance
  expect(b, 'the seeded profile must produce a balance').toBeTruthy()
  const budget = Math.round(b.restingBaseKcal + b.targetNetKcal) + Math.round(b.activeKcal)
  return { budget, intake: Math.round(b.intakeKcal) }
}

test.beforeAll(async () => {
  const userId = await ensureEnergyBalanceProfile()
  await withDb(async db => {
    await cleanup(db)
    // A heart-rate session, not a walk: the sandbox serves the MET table as synthetic fixtures, so
    // an activity estimates to 0 and the notch would sit where a no-movement day puts it.
    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'Bar spec session', now() - interval '2 hours', now() - interval '1 hour', $2)`,
      [SESSION_ID, userId],
    )
    await db.query(
      `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, readings_count, source)
       VALUES ($1, $2, 130, 120, 'oura_ble')`,
      [SESSION_ID, userId],
    )
    // Partway through the day, so the fill is neither empty nor clamped — both of those would pass
    // against a bar that ignored intake entirely.
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, 'Bar spec meal', 1450, 120, 150, 48, 500, 'manual')`,
      [ITEM_ID, userId],
    )
    await db.query(
      `INSERT INTO food_logs (id, user_id, date, meal_type_id, food_item_id, quantity_multiplier, logged_at)
       SELECT $1, $2, to_char((now() AT TIME ZONE 'Australia/Brisbane')::date, 'YYYY-MM-DD'),
              (SELECT id FROM meal_types WHERE user_id = $2 AND deleted_at IS NULL LIMIT 1),
              $3, 1, now() - interval '3 hours'`,
      [LOG_ID, userId, ITEM_ID],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

test('the bar fills toward the goal notch, not around a centred marker', async ({ page }) => {
  const { budget, intake } = await balanceFromRoute(page)
  expect(intake).toBeGreaterThan(0)
  expect(intake).toBeLessThan(budget)

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // Anchored on the bar, not on an "Energy Balance" eyebrow. That label belonged to
  // `CalorieBalanceBar`, which the day screen stopped rendering when BF-24 ② merged it and the
  // macro ring into one artboard-1 card — the drawing has no eyebrow there, and Home still shows
  // one because Home is a different card. Nothing this test actually asserts moved: the fill and
  // notch percentages below are unchanged, which is what says the bar itself is intact rather than
  // the anchor being loosened until it passed.
  const scale = budget + OUTER_KCAL
  const bar = page.locator('[data-calorie-bar]').first()
  await expect(bar).toBeVisible({ timeout: 30_000 })

  await expect.poll(async () => Number(await bar.getAttribute('data-fill-pct')), { timeout: 15_000 })
    .toBeCloseTo((intake / scale) * 100, 1)
  expect(Number(await bar.getAttribute('data-notch-pct'))).toBeCloseTo((budget / scale) * 100, 1)

  // The goal is not at the centre — that was the old gauge, and it is what a half-converted bar
  // would still look like.
  expect(Number(await bar.getAttribute('data-notch-pct'))).toBeGreaterThan(60)
})

test('Home\'s nutrition ring says how much is left, not what the macros were', async ({ page }) => {
  await enableHomeCards(page, ['nutritionDonut'])
  const { budget, intake } = await balanceFromRoute(page)

  await page.goto('/')
  await settleRouteBoundary(page)

  const left = budget - intake
  expect(left, 'fixture must leave the day under budget so the word is "left"').toBeGreaterThan(0)
  await expect(page.getByText(left.toLocaleString(), { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('left', { exact: true })).toBeVisible()
})
