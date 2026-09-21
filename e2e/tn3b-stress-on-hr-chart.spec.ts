import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * TN-3b — stress drawn against heart rate on one clock.
 *
 * The owner, on the stress metric: *"Can we have this displayed on a widget or chart so we can see
 * when the stress occurs. I will be able to match it up based on time to what I was doing around
 * then."* The standalone strip answers *when*; putting the series on the HR chart answers *what my
 * heart was doing while it happened*, which is the comparison he described and which needs the two
 * on the same axis.
 *
 * **What the browser can check and the node tests cannot:** that the overlay reaches a real screen
 * at all — the series is fetched by a hook, placed by `stressOverlay`, and handed to a Chart.js
 * dataset on a second scale, and any one of those three joints can be wired wrong while every pure
 * test stays green. The legend entry is the DOM-visible end of that chain.
 *
 * **What it cannot check:** the drawn line. Chart.js paints to a canvas, so neither the amber
 * stroke nor the break across the gap is readable from the DOM. Those are pinned in
 * `components/health/__tests__/hr-stress-overlay.test.ts` (10 cases), whose gap case uses the real
 * measured 06:45 → 13:15 hole.
 */

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/**
 * Local hours to seed buckets at. 6:00–7:00 then 13:00–14:00, which straddles the 75-minute gap
 * threshold — so the fixture exercises the break rather than one unbroken run.
 *
 * **Anchored to the USER's day, never `CURRENT_DATE`.** The route derives the day from `todayInTz`
 * and Postgres's `CURRENT_DATE` is the session's, UTC on CI; after 14:00 UTC those are different
 * dates and the seeded buckets would land on yesterday. Same trap as Q-356.
 */
const HOURS = [6, 6.5, 7, 13, 13.5, 14]
let seededDay: string | null = null

test.describe('TN-3b — the HR chart carries the day\'s stress', () => {
  test.setTimeout(180_000)

  test.beforeAll(async () => {
    await withDb(async db => {
      const { rows: users } = await db.query<{ id: string; timezone: string | null }>(
        'SELECT id, timezone FROM users WHERE email = $1', [SEED_EMAIL])
      const userId = users[0]?.id
      expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
      const tz = users[0].timezone ?? 'Australia/Brisbane'

      const { rows: dayRows } = await db.query<{ day: string }>(
        `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day`, [tz])
      seededDay = dayRows[0].day

      // The chart renders nothing without HR readings, and `seed.sql` records nothing for today
      // (the standing local-seed gap). Seed a sparse day of them first, or the assertion below
      // tests the absence of a chart rather than the presence of an overlay.
      for (let minute = 0; minute < 24 * 60; minute += 20) {
        await db.query(
          `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source)
           VALUES ($1, (($2 || ' 00:00:00')::timestamp AT TIME ZONE $3) + ($4 || ' minutes')::interval, $5, 'rest')
           ON CONFLICT (user_id, timestamp) DO UPDATE SET bpm = EXCLUDED.bpm`,
          [userId, seededDay, tz, String(minute), 55 + (minute % 300) / 10],
        )
      }

      for (const [i, h] of HOURS.entries()) {
        await db.query(
          `INSERT INTO oura_daytime_stress_buckets (user_id, day, bucket_start, level)
           VALUES ($1, $2, (($2 || ' ' || $3)::timestamp AT TIME ZONE $4), $5)
           ON CONFLICT (user_id, bucket_start) DO UPDATE SET level = EXCLUDED.level, day = EXCLUDED.day`,
          [userId, seededDay,
           `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}:00`,
           tz,
           // A shape rather than a flat run, and inside [-1,+1]. Negative is stressed.
           [-0.6, -0.4, -0.2, 0.3, 0.1, -0.1][i]],
        )
      }
    })
  })

  test.afterAll(async () => {
    await withDb(async db => {
      const { rows: users } = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
      if (!users[0]?.id || !seededDay) return
      await db.query('DELETE FROM oura_daytime_stress_buckets WHERE user_id = $1 AND day = $2',
        [users[0].id, seededDay])
      await db.query(
        `DELETE FROM oura_heartrate WHERE user_id = $1 AND source = 'rest'
           AND timestamp >= ($2 || ' 00:00:00')::timestamp AT TIME ZONE
               COALESCE((SELECT timezone FROM users WHERE id = $1), 'Australia/Brisbane')
           AND timestamp <  (($2 || ' 00:00:00')::timestamp AT TIME ZONE
               COALESCE((SELECT timezone FROM users WHERE id = $1), 'Australia/Brisbane')) + interval '1 day'`,
        [users[0].id, seededDay])
    })
  })

  test('the stress series is drawn on the heart-rate chart, and named in its legend', async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto('/health/heart-rate')
    await settleRouteBoundary(page)

    // The chart only renders with HR readings, and the seed may not carry any for today. Skip
    // loudly rather than passing vacuously — a spec that cannot see the feature must not be green.
    const chart = page.locator('canvas').first()
    await expect(chart, 'the heart-rate page rendered no chart at all').toBeVisible({ timeout: 60_000 })

    // The legend entry is the DOM end of the fetch → place → dataset chain. It renders only when
    // `stressOverlay` returned measured points, so it cannot appear on a wiring that fetched
    // nothing.
    await expect(page.getByText('Stress', { exact: true }).first(),
      'the HR chart did not pick up the day\'s stress series')
      .toBeVisible({ timeout: 30_000 })
  })
})
