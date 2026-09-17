import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'
import {
  SEED_EMAIL, ensureEnergyBalanceProfile, settleRouteBoundary, suppressMorningCheckin, tapCentre,
} from './fixtures'

/**
 * BF-175. The nutrition card and the log-food sheet, one tap apart, printed two different budgets
 * for the same day — the owner's two screenshots, taken in the same minute: *"2 different calorie
 * goals here."* The card said **1506**; the sheet said **1660**.
 *
 * **1660 was not a stale copy of 1506.** It is `nutrition_targets.calories`, which the sheet
 * fetched for itself — the **rest-day floor**, not `restingBase + targetNet`, a distinction
 * `nutrition-content.tsx` and `home-nutrition-card.tsx` each state outright after three budgets
 * once landed on one screen (Q-417/Q-323). A second read of a different column is a second
 * quantity, not a cache problem, so no amount of invalidation would have closed the gap.
 *
 * The bar underneath is the half that actively misleads: it coloured green under its denominator
 * and orange over, so a day already past its real budget painted green and read as headroom.
 *
 * **This asserts the meaning, not the fix.** The source guard beside it
 * (`components/nutrition/__tests__/bf175-day-budget-single-source.test.ts`) pins the shape — no
 * targets read in the sheet, the denominator arriving as a prop. That guard would still pass if
 * the page threaded down the wrong number. This one reads the figure the sheet actually prints and
 * checks it against the route's own budget, with the stored goal forced apart from it so the two
 * answers cannot be confused.
 */

const ITEM_ID = 'b1750000-0000-4000-8000-b17500000001'
const LOG_ID = 'b1750000-0000-4000-8000-b17500000002'
const NAME = 'BF175 Budget Spec Bar'
/** Mirrors the owner's own gap (1660 − 1506) so the fixture reproduces the reported distance. */
const GOAL_OFFSET = 154

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

let userId: string
let storedGoalBefore: number | null = null

test.beforeAll(async () => {
  userId = await ensureEnergyBalanceProfile()
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE id = $1', [LOG_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
    const { rows } = await db.query<{ calories: number | null }>(
      'SELECT calories FROM nutrition_targets WHERE user_id = $1', [userId],
    )
    storedGoalBefore = rows[0]?.calories ?? null
    // A food with a known calorie count, so the "after logging" figure is checkable arithmetic
    // rather than whatever the seed happens to hold.
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, $3, 200, 10, 20, 8, 100, 'manual')`,
      [ITEM_ID, userId, NAME],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE id = $1', [LOG_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
    if (storedGoalBefore != null) {
      await db.query('UPDATE nutrition_targets SET calories = $1 WHERE user_id = $2', [storedGoalBefore, userId])
    }
  })
})

/** `.click()` never lands on these screens — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.scrollIntoViewIfNeeded()
  await tapCentre(page, target)
}

test('the log-food sheet counts against the day\'s budget, not the stored rest-day goal', async ({ page }) => {
  const res = await page.request.get('/api/nutrition/energy-balance')
  expect(res.ok()).toBeTruthy()
  const balance = (await res.json()).balance
  expect(balance, 'the seeded profile must produce a balance').toBeTruthy()
  const budget = budgetProvenance(balance).total

  // Force the two numbers apart. Without this the spec is decorative: the seeded goal could equal
  // the budget by coincidence, and then it passes against the unfixed sheet — which is exactly the
  // vacuous shape that has cost this repo four tests. `nutrition_targets.calories` does not feed
  // `targetNetKcal` (that comes from the goal delta), so moving it cannot move the budget.
  const storedGoal = budget + GOAL_OFFSET
  await withDb(db => db.query(
    `INSERT INTO nutrition_targets (user_id, calories) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET calories = EXCLUDED.calories`,
    [userId, storedGoal],
  ))
  expect(storedGoal).not.toBe(budget)

  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  await tap(page, page.getByRole('button', { name: 'Log Food' }))
  await tap(page, page.getByRole('tab', { name: 'Search' }))
  await tap(page, page.getByRole('button', { name: new RegExp(NAME) }).first())

  // Anchored on the sheet's own row, not on the first `/ N kcal` on the page — the day screen
  // behind this sheet prints a budget too, and that is the pair the report is about. Reading
  // whichever matched first could read the CARD's number and pass against the unfixed sheet.
  const row = page.getByText('Today after logging', { exact: true }).locator('..')
  await expect(row).toBeVisible({ timeout: 30_000 })
  const text = (await row.locator('span.tabular-nums').first().textContent())!
  const [, eatenRaw, budgetRaw] = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s*kcal/)!
  const num = (v: string) => Number(v.replace(/,/g, ''))

  expect(num(budgetRaw), 'the sheet must print the same budget the page resolved').toBe(budget)
  expect(num(budgetRaw), 'and not the stored rest-day floor it used to fetch for itself').not.toBe(storedGoal)

  // The other half of "Today after logging": the numerator is today's intake plus this food. A
  // denominator can be right while the bar is measuring the wrong day.
  expect(Math.abs(num(eatenRaw) - (Math.round(balance.intakeKcal) + 200)))
    .toBeLessThanOrEqual(2)
})
