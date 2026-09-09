import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-133's clinical half on Profile details: a scan, a metabolic test and a timed test, beside the
 * daily readings (`/more/details` → "Tests and scans").
 *
 * **The assertions are on the numbers as CONVERTED and on the labels that keep them apart**, which
 * is where this section can be wrong in a way that still looks right. The DEXA report prints masses
 * in grams and the app renders kilograms; body fat, resting rate and resting heart rate each have a
 * same-named neighbour on the very same page that is a *different* measurement — the scale's, the
 * scale's estimate, and the ring's daily figure. A row that dropped its qualifier would render a
 * plausible screen that silently merges two numbers which disagree by construction.
 *
 * **Mutation-checked**: dropping the gram-to-kilogram scale renders `63,400 kg` and fails; removing
 * a note fails the label half; rendering empty groups fails the "no blood section" assertion.
 *
 * Not exercised here: the device path. `fitness_tests` is read local-first and the browser has no
 * native SQLite, so this runs the `cachedFetch` fallback — the `getFitnessTests` branch is owed an
 * on-device check.
 */

const DEXA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01'
const RMR = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb01'
const WALK = 'cccccccc-3333-4333-8333-cccccccccc01'
const HRR = 'cccccccc-3333-4333-8333-cccccccccc02'

test.setTimeout(180_000)

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client): Promise<void> {
  await db.query('DELETE FROM dexa_scans WHERE id = $1', [DEXA])
  await db.query('DELETE FROM measured_rmr WHERE id = $1', [RMR])
  await db.query('DELETE FROM fitness_tests WHERE id = ANY($1::uuid[])', [[WALK, HRR]])
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    expect(rows[0]?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    const uid = rows[0].id
    await cleanup(db)

    // Masses in grams, as a DEXA report prints them — the conversion is the thing under test.
    await db.query(
      `INSERT INTO dexa_scans (id, user_id, scanned_on, pct_fat, lean_plus_bmc_g, fat_g,
                               total_bmd, t_score, vat_mass_g, android_gynoid_ratio)
       VALUES ($1, $2, '2026-06-02', 24.3, 63400, 21900, 1.234, 0.4, 480, 1.08)`,
      [DEXA, uid],
    )
    await db.query(
      `INSERT INTO measured_rmr (id, user_id, measured_on, rmr_kcal, ffm_kg_at_test)
       VALUES ($1, $2, '2026-05-11', 1725, 62.8)`,
      [RMR, uid],
    )
    // Two tests on one day producing disjoint fields — the production shape, and the reason the
    // section reads per metric rather than per test.
    await db.query(
      `INSERT INTO fitness_tests (id, user_id, test_type, date, distance_m, vo2max_est)
       VALUES ($1, $2, '6mwt', '2026-07-19', 520, 18.8)`,
      [WALK, uid],
    )
    await db.query(
      `INSERT INTO fitness_tests (id, user_id, test_type, date, resting_hr, hrr1_bpm, max_hr)
       VALUES ($1, $2, 'resting_hrr', '2026-07-19', 94, 21, 138)`,
      [HRR, uid],
    )
  })
})

test.afterAll(async () => {
  await withDb(cleanup)
})

test('the tests-and-scans section shows each measurement, converted, dated and told apart', async ({ page }) => {
  await page.goto('/more/details')
  await settleRouteBoundary(page)

  const section = page.locator('section').filter({ hasText: 'Tests and scans' }).first()
  await expect(section).toBeVisible({ timeout: 60_000 })

  // 1 — every metric is read off whichever test produced it, across two tests of different types.
  await expect(section.getByText('18.8 ml/kg/min')).toBeVisible({ timeout: 30_000 })
  await expect(section.getByText('520 m')).toBeVisible()
  await expect(section.getByText('21 bpm')).toBeVisible()
  await expect(section.getByText('138 bpm')).toBeVisible()

  // 2 — the report's grams reach the screen as kilograms. `63,400 kg` is what a dropped conversion
  // renders, and it is a number a reader would have to know the units to catch.
  await expect(section.getByText('63.4 kg')).toBeVisible()
  await expect(section.getByText('21.9 kg')).toBeVisible()
  await expect(section.getByText('0.48 kg')).toBeVisible()
  await expect(section.getByText('1.234 g/cm²')).toBeVisible()
  await expect(section, 'grams must not reach the screen as kilograms').not.toContainText('63,400 kg')

  // 3 — the dates, which is what stops a scan from one visit reading as current beside today's
  // step count on the same page.
  await expect(section.getByText('2026-06-02').first()).toBeVisible()
  await expect(section.getByText('2026-05-11').first()).toBeVisible()
  await expect(section.getByText('2026-07-19').first()).toBeVisible()

  // 4 — each number that has a same-named neighbour elsewhere on this page says which one it is.
  await expect(section.getByText(/estimated from a submaximal test/)).toBeVisible()
  await expect(section.getByText(/the daily figure is under Vitals/)).toBeVisible()
  await expect(section.getByText(/the scale reads its own figure/)).toBeVisible()
  await expect(section.getByText(/the scale estimates its own/)).toBeVisible()

  // 5 — and the section does not invent headings for stores nothing has ever written to.
  await expect(section).not.toContainText('Blood')

  // The full report stays where it is entered; this is the dense view that links to it.
  await expect(section.getByRole('link', { name: /DEXA & RMR results/ })).toBeVisible()
})
