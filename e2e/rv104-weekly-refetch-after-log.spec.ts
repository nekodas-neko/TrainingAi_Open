import { test, expect, type Page } from '@playwright/test'
import { Client } from 'pg'
import { ensureEnergyBalanceProfile, settleRouteBoundary, suppressMorningCheckin, tapCentre } from './fixtures'

/**
 * RV-104. `nutrition-weekly-summary` and `nutrition-adherence` were fetched **only** from
 * `fetchMountData`, whose effect deps are stable, on a screen the tab shell never unmounts — so the
 * 7-day calorie chart and the adherence percentages below it held their launch-time values until
 * the app was restarted. A tab switch did not help: `useRefreshOnTabShow` re-runs `fetchData`
 * (logs + balance), never `fetchMountData`.
 *
 * The asymmetry that made it visible: the delete path had learned to refetch the weekly summary by
 * hand and the add path had not — same screen, same quantity, one updated and one did not.
 *
 * **The assertion is the request, not the pixels.** Whether a single ~300 kcal add visibly moves a
 * 7-day bar is genuinely unclear; whether the screen asked the server for a new one is not, and it
 * is the whole of what was broken. Asserting a bar height here would be a weaker test of a
 * different thing.
 */

const ITEM_ID = 'c0104000-0000-4000-8000-c01040000001'
const NAME = 'RV104 Weekly Refetch Probe'

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
       VALUES ($1, $2, $3, 310, 24, 30, 10, 100, 'manual')`,
      [ITEM_ID, userId, NAME],
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

test('logging a food refetches the weekly chart and adherence, without leaving the screen', async ({ page }) => {
  test.setTimeout(180_000)
  await suppressMorningCheckin(page)
  await page.goto('/nutrition')
  await settleRouteBoundary(page)

  // Counted from here, so the mount-time fetches this replaces are not what passes the test.
  const seen = new Set<string>()
  page.on('request', r => {
    const u = new URL(r.url(), 'http://localhost')
    if (u.pathname === '/api/nutrition/weekly-summary') seen.add('weekly')
    if (u.pathname === '/api/nutrition/adherence') seen.add('adherence')
  })
  seen.clear()

  await tap(page, page.getByRole('button', { name: 'Log Food' }).first())
  await tap(page, page.getByRole('tab', { name: 'Search' }))
  await tap(page, page.getByRole('button', { name: new RegExp(NAME) }).first())
  // The assign step's own confirm carries the same label as the opener, so take the last match.
  await tap(page, page.getByRole('button', { name: 'Log Food' }).last())

  await expect(async () => {
    expect(
      [...seen].sort(),
      'the write invalidated both keys and nothing asked for a new value — the Q-402 shape',
    ).toEqual(['adherence', 'weekly'])
  }).toPass({ timeout: 30_000 })
})
