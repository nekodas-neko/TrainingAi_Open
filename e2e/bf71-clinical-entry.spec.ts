import { test, expect } from '@playwright/test'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'
import { Client } from 'pg'

const DB = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/trainingai_dev'

async function db<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: DB })
  await c.connect()
  try { return (await c.query<T>(sql, params)).rows } finally { await c.end() }
}

/**
 * BF-71: both routes shipped with no client caller, so both tables were empty in production while
 * every resting rate the app quoted was predicted.
 *
 * The unit guard beside this one proves the routes are *reachable*; only this proves they *work* —
 * that what the owner types is what the column ends up holding. The values are the real ones from
 * `docs/clinical-baseline-2026-08-27.md`, because a fixture of round numbers would not have caught
 * the grams/kilograms hazard the schema's own comment names.
 */
test('BF-71: the owner can type in the 2026-08-27 DEXA and RMR, and both land', async ({ page }) => {
  const [{ id: userId }] = await db<{ id: string }>('SELECT id FROM users WHERE email=$1', [SEED_EMAIL])
  // Cleared at the start rather than only at the end, so a previous aborted run cannot make this
  // one fail for a reason that has nothing to do with the change.
  await db('DELETE FROM measured_rmr WHERE user_id=$1', [userId])
  await db('DELETE FROM dexa_scans WHERE user_id=$1', [userId])

  // Reachability is the defect: get there by tapping, not by typing the URL.
  await page.goto('/more')
  // The row navigates through the client router, so a tap dispatched before hydration wires the
  // handler is swallowed and the page simply stays on More — which is what this spec saw once.
  await settleRouteBoundary(page)
  const row = page.getByText('DEXA & RMR results')
  await expect(row).toBeVisible()
  await row.click()
  await page.waitForURL('**/more/clinical')
  await expect(page.getByRole('heading', { name: 'DEXA & RMR' })).toBeVisible()

  // Both empty states must say so — this is what "your target uses a predicted rate" looks like.
  await expect(page.getByText(/calorie target is using a predicted rate/)).toBeVisible()

  // ── RMR: the real numbers from docs/clinical-baseline-2026-08-27.md ──
  await page.getByLabel('Test date').fill('2026-08-27')
  await page.getByLabel('Measured RMR (kcal/day)').fill('1325')
  await page.getByLabel('Fat-free mass at test (kg)').fill('51.46')
  await page.getByRole('button', { name: 'Save RMR test' }).click()
  await expect(page.getByText('RMR test saved')).toBeVisible({ timeout: 15_000 })

  // ── DEXA ──
  // Both "add" sections default open while their table is empty, so this must NOT toggle — an
  // unconditional click here closes the section instead of opening it.
  await expect(page.getByLabel('Scan date')).toBeVisible()
  await page.getByLabel('Scan date').fill('2026-08-27')
  await page.getByLabel('Total body fat (%)').fill('28.5')
  await page.getByLabel('Weight at scan (kg)').fill('72.1')
  await page.getByRole('button', { name: 'Body composition' }).click()
  await page.getByLabel('Fat (g)').fill('20547.5')
  // The unit echo is the guard against the grams/kg mix-up the route cannot catch.
  await expect(page.getByText('= 20.55 kg')).toBeVisible()
  await page.getByLabel('Lean + BMC (fat-free mass) (g)').fill('51460.1')
  await page.getByRole('button', { name: 'Save DEXA scan' }).click()
  await expect(page.getByText('DEXA scan saved')).toBeVisible({ timeout: 15_000 })

  // ── The rows exist, with the values that were typed ──
  const rmr = await db<{ rmr_kcal: number; ffm_kg_at_test: string; measured_on: string }>(
    'SELECT rmr_kcal, ffm_kg_at_test, measured_on FROM measured_rmr WHERE user_id=$1', [userId])
  expect(rmr).toHaveLength(1)
  expect(rmr[0].rmr_kcal).toBe(1325)
  expect(Number(rmr[0].ffm_kg_at_test)).toBeCloseTo(51.46, 2)

  const dexa = await db<{ pct_fat: string; fat_g: string; source: string; scanned_on: string }>(
    'SELECT pct_fat, fat_g, source, scanned_on FROM dexa_scans WHERE user_id=$1', [userId])
  expect(dexa).toHaveLength(1)
  expect(Number(dexa[0].pct_fat)).toBeCloseTo(28.5, 1)
  expect(Number(dexa[0].fat_g)).toBeCloseTo(20547.5, 1)
  expect(dexa[0].source).toBe('manual')

  // ── The stored values now show, which is how the owner knows it landed ──
  await page.reload()
  await expect(page.getByText('1,325')).toBeVisible()
  await expect(page.getByText('28.5%')).toBeVisible()

  // A DEXA row left behind would feed the body-fat calibration for every spec after this one.
  await db('DELETE FROM measured_rmr WHERE user_id=$1', [userId])
  await db('DELETE FROM dexa_scans WHERE user_id=$1', [userId])
})
