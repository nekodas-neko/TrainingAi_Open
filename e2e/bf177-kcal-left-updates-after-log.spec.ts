import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { ensureEnergyBalanceProfile, settleRouteBoundary, suppressMorningCheckin, tapCentre } from './fixtures'

/**
 * BF-177. The owner: *"The kcal left in the top right; doesnt load on the same page: it requires
 * page switching to show."*
 *
 * **The cache bust he proposed already existed** — `logFoodEntries` calls
 * `invalidateNutritionWrite()`, which clears `energy-balance:`. This is the Q-402 shape CLAUDE.md
 * names: evicting a key and re-rendering the component that reads it are two different things. The
 * optimistic branch of `handleFoodLogged` appended to `logs` and returned, so the ring moved while
 * `energyBalance` still held the object fetched before the meal.
 *
 * So the assertion has to be **"the number moves without navigating"**. Anything that leaves the
 * screen re-runs `fetchData` and passes against the unfixed component.
 */

const ITEM_ID = 'bf177000-0000-4000-8000-bf1770000001'
const NAME = 'BF177 Kcal Left Probe'
const KCAL = 250

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

let userId: string

test.beforeAll(async () => {
  userId = await ensureEnergyBalanceProfile()
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
    await db.query(
      `INSERT INTO food_items (id, user_id, name, calories, protein_g, carbs_g, fat_g, serving_size_g, source)
       VALUES ($1, $2, $3, $4, 10, 20, 8, 100, 'manual')`,
      [ITEM_ID, userId, NAME, KCAL],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM food_logs WHERE food_item_id = $1', [ITEM_ID])
    await db.query('DELETE FROM food_items WHERE id = $1', [ITEM_ID])
  })
})

/** `.click()` never lands on these screens — see water-log-write-path.spec.ts (Q-354). */
async function tap(page: Page, target: ReturnType<Page['getByRole']>) {
  await expect(target).toBeVisible({ timeout: 30_000 })
  await target.scrollIntoViewIfNeeded()
  await tapCentre(page, target)
}

/** The card prints `{Math.abs(remaining)}` and `kcal left` as adjacent spans. */
async function kcalLeft(page: Page): Promise<number> {
  const block = page.getByText(/^kcal (left|over)$/).first().locator('..')
  await expect(block).toBeVisible({ timeout: 30_000 })
  const text = (await block.textContent())!
  const m = text.match(/([\d,]+)/)
  expect(m, `could not read a number out of "${text}"`).not.toBeNull()
  return Number(m![1].replace(/,/g, ''))
}

test('kcal left moves when food is logged, without leaving the screen', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const before = await kcalLeft(page)

  await tap(page, page.getByRole('button', { name: 'Log Food' }).first())
  await tap(page, page.getByRole('tab', { name: 'Search' }))
  await tap(page, page.getByRole('button', { name: new RegExp(NAME) }).first())
  // The assign step's own confirm carries the same label as the opener, so take the last match.
  await tap(page, page.getByRole('button', { name: 'Log Food' }).last())

  // No navigation between the log and this read — that is the whole point. `toPass` because the
  // balance is a round trip behind the optimistic append, which is the accepted trade in BF-177.
  await expect(async () => {
    const after = await kcalLeft(page)
    expect(
      before - after,
      `kcal left went ${before} → ${after}; logging ${KCAL} kcal should move it by about that, ` +
      'and a 0 move means the card is still rendering the pre-log payload',
    ).toBeGreaterThanOrEqual(KCAL - 5)
  }).toPass({ timeout: 30_000 })
})
