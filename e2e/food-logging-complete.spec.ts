import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * "I've finished logging" marks the day, and the counter says what that bought (Q-387).
 *
 * The maintenance calibration averages the intake of every logged day, and **a day abandoned after
 * lunch was byte-for-byte identical to a completed light one**. The Lane A half taught
 * `estimateMaintenance` to filter on a completeness flag; until this control shipped, nothing could
 * set it, so **every** day was excluded and the estimate could never leave `source: 'formula'`.
 *
 * **The counter is asserted, not just the button.** The entry's own reason for shipping them
 * together is that the button feeds something otherwise invisible — a day is either in the window or
 * it is not, and nothing on screen said so. A test that only pressed the button would pass against
 * a control that wrote the flag and told the user nothing.
 */

/**
 * A real CDP touch sequence, not `.click()`.
 *
 * `.click()` on the Nutrition tab dispatches a mouse-only sequence that never produces a `click`
 * event — measured and written up on `water-log-write-path.spec.ts` (Q-354). Taps are also how the
 * product is used. This control sits inside `[data-swipe-carousel]`, where it bites.
 */
async function tap(page: Page, target: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(target).toBeVisible({ timeout: 30_000 })
  // `toBeVisible` does not mean "in the viewport", and this control is the LAST element of a long
  // scroll — without the scroll its box is off-screen and the tap lands on whatever is there.
  await target.scrollIntoViewIfNeeded()
  const box = (await target.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function userId(db: Client) {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
  expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
  return rows[0].id
}

/** The flag as the DATABASE holds it — the UI's own state would agree with itself either way. */
async function flagInDb(): Promise<boolean> {
  return withDb(async db => {
    const id = await userId(db)
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM day_checkins
        WHERE user_id = $1 AND phase = 'evening' AND deleted_at IS NULL
          AND food_logging_completed_at IS NOT NULL
          AND log_date::date = (now() AT TIME ZONE 'Australia/Brisbane')::date`,
      [id],
    )
    return Number(rows[0].n) > 0
  })
}

test.beforeAll(async () => {
  await withDb(async db => {
    const id = await userId(db)
    await db.query(
      `UPDATE day_checkins SET food_logging_completed_at = NULL WHERE user_id = $1`, [id],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    const id = await userId(db)
    await db.query(`UPDATE day_checkins SET food_logging_completed_at = NULL WHERE user_id = $1`, [id])
  })
})

test('marking the day complete writes the flag, and undo clears it', async ({ page }) => {
  expect(await flagInDb(), 'fixture starts with the day unmarked').toBe(false)

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  const mark = page.getByRole('button', { name: /finished logging/i })
  await expect(mark).toBeVisible({ timeout: 30_000 })
  // 48dp floor — this is a primary action at the end of a long scroll on a 6.9" screen.
  const box = (await mark.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(48)

  await tap(page, mark)
  await expect.poll(flagInDb, { timeout: 20_000 }).toBe(true)
  // The receipt replaces the button rather than sitting beside it, so there is no "did that work?"
  await expect(page.getByText(/Logging finished/i)).toBeVisible()

  await tap(page, page.getByRole('button', { name: 'Undo' }))
  await expect.poll(flagInDb, { timeout: 20_000 }).toBe(false)
  await expect(mark).toBeVisible()
})

test('the counter says how many days the calibration has, and how many it still needs', async ({ page }) => {
  const res = await page.request.get('/api/nutrition/energy-balance')
  const body = await res.json()
  const m = body.maintenance
  expect(m, 'the seeded profile must produce a maintenance estimate').toBeTruthy()

  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  if (m.source === 'calibrated') {
    await expect(page.getByText(new RegExp(`${m.daysLogged} days marked`))).toBeVisible({ timeout: 30_000 })
  } else {
    // "N of 10 days marked" — the number the button moves, which is the whole reason it ships here.
    await expect(page.getByText(new RegExp(`${m.daysLogged} of \\d+`))).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/more to calibrate/i)).toBeVisible()
  }
})
