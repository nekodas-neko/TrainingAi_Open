import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * TN-53 (the render half) — a day with no reading must not be drawn as a reading.
 *
 * TN-53's engine gate made `analyseHrRecovery` return `null` when the two readings behind `hrr1`
 * are not 45–75 s apart, replacing a fabricated number with an honest absence. The sparkline then
 * put the invention straight back: it passed `spanGaps: true`, so Chart.js joined the value before
 * a run of nulls to the value after it and drew the missing days as a smooth line. The gate bought
 * nothing on the one surface that shows the trend.
 *
 * **This drives `rhrBpm`, not `hrr1Bpm`, deliberately.** Both fields render through the same
 * `TrendSparkline`, and the gap handling under test is the component's. Seeding `hrr1Bpm` would
 * mean a completed workout session plus an HR window plus set timestamps — three fixtures to reach
 * a code path identical to the one a `body_metrics` row reaches in one.
 *
 * **What this cannot check:** the line itself. Chart.js draws to a canvas, so whether the segment
 * breaks and whether the stranded point gets its dot are not readable from the DOM. Those are
 * pinned in `components/health/__tests__/trend-sparkline-gaps.test.ts`, whose five mutations
 * include reverting `spanGaps` and dropping the stranded-point rule. What the browser adds, and
 * the node tests cannot, is that the wiring reaches a real screen and the note fits beside the
 * delta chip at a phone width.
 */

const CARD = 'Resting Heart Rate'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/**
 * Offsets from the user's local today, in days. The adjacent pair holds itself up with a segment;
 * −3 is stranded between two absences, which is the case that renders as nothing at all once
 * spanning stops; and 0 anchors the right-hand end. Trimmed at the first reading the chart draws
 * 7 days and has 4, so the note must say three are missing.
 *
 * **Anchored to the USER's day, never `CURRENT_DATE`.** The route builds its 14-day window from
 * `todayInTz`, and Postgres's `CURRENT_DATE` is the session's — UTC on CI. Between 14:00 and 24:00
 * UTC those are different dates, so an offset of 0 seeds the chart's *yesterday*, the window's last
 * day is empty, and the note reads one higher. Written the wrong way first, and it failed at 21:30
 * UTC with `4 days missing` — the shape the repo's own rule describes: a fixture and a query that
 * each derive from a clock, but not the same one.
 */
const SEEDED = [6, 5, 3, 0]
const EXPECTED_NOTE = '3 days missing'

/** `now()` in the seeded user's own timezone, which is the day the chart's window ends on. */
const LOCAL_TODAY = `(now() AT TIME ZONE COALESCE(
  (SELECT timezone FROM users WHERE id = $1), 'Australia/Brisbane'))::date`

/** Dates that already carried a row before this spec ran — they are emptied, not deleted. */
let preExisting: string[] = []

test.describe('TN-53 — the trend sparkline states its gaps instead of drawing over them', () => {
  test.setTimeout(180_000)

  test.beforeAll(async () => {
    await withDb(async db => {
      const { rows: users } = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
      const userId = users[0]?.id
      expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

      const { rows: had } = await db.query<{ d: string }>(
        `SELECT to_char(date, 'YYYY-MM-DD') AS d FROM body_metrics
         WHERE user_id = $1 AND date >= ${LOCAL_TODAY} - 14`, [userId])
      preExisting = had.map(r => r.d)

      // Distinct values so the line has a shape rather than a flat run.
      for (const [i, offset] of SEEDED.entries()) {
        await db.query(
          `INSERT INTO body_metrics (user_id, date, resting_heart_rate)
           VALUES ($1, ${LOCAL_TODAY} - $2::int, $3)
           ON CONFLICT (user_id, date) DO UPDATE SET resting_heart_rate = EXCLUDED.resting_heart_rate`,
          [userId, offset, 54 + i * 3])
      }
    })
  })

  test.afterAll(async () => {
    await withDb(async db => {
      const { rows: users } = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
      const userId = users[0]?.id
      if (!userId) return
      // Restore rather than wipe: two of these dates carry seed weight/steps other specs read.
      await db.query(
        `UPDATE body_metrics SET resting_heart_rate = NULL
         WHERE user_id = $1 AND to_char(date, 'YYYY-MM-DD') = ANY($2::text[])`,
        [userId, preExisting])
      await db.query(
        `DELETE FROM body_metrics
         WHERE user_id = $1 AND date >= ${LOCAL_TODAY} - 14
           AND NOT (to_char(date, 'YYYY-MM-DD') = ANY($2::text[]))`,
        [userId, preExisting])
    })
  })

  test('the card says how many days are missing, and the row still fits a phone', async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto('/health/heart-rate')
    await settleRouteBoundary(page)

    const heading = page.getByText(new RegExp(`${CARD} — 14 days`, 'i')).first()
    await expect(heading, 'the resting-HR sparkline did not render')
      .toBeVisible({ timeout: 60_000 })

    // The assertion the fix exists for. Before it, the chart drew a continuous line over the
    // three absent days and said nothing, so this text did not exist anywhere on the page.
    await expect(heading, 'the sparkline drew the gap without disclosing it')
      .toContainText(EXPECTED_NOTE)

    // Measured, not eyeballed: the note is new text in a row that already carries a delta chip,
    // and a header that overflows its card is a new defect traded for the old one.
    const row = heading.locator('xpath=..')
    const fit = await row.evaluate(el => ({
      row: el.getBoundingClientRect().width,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      widest: Math.max(...Array.from(el.children,
        c => (c as HTMLElement).getBoundingClientRect().width)),
    }))
    expect(fit.widest, 'a child of the header is wider than the header')
      .toBeLessThanOrEqual(fit.row + 1)
    expect(fit.scrollW, 'the page scrolls sideways')
      .toBeLessThanOrEqual(fit.clientW + 1)
  })
})
