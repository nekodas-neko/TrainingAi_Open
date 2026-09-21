import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin } from './fixtures'

/**
 * TN-35 (the overlay half) — the day's stress read against what the owner was doing.
 *
 * *"I'd like to get stress metric to be a usable value to determine what events stress me."*
 * TN-3b's chart answers **when** a stressed window happened; this answers **what was happening
 * then**, by placing the day timeline's typed, timestamped events on the same axis and printing the
 * measured level beside each.
 *
 * **Driven on a PAST day deliberately** — that is the entry's own pass test (*"the owner opens a
 * past day…"*), and it is the case a today-only surface cannot cover. The day screen is also where
 * the comparison happens, since it swipes between days.
 *
 * **The assertion that matters most is the negative one.** Coverage averages 13.3 of 24 hours, so
 * events routinely fall in a hole, and the entry is explicit: *"Render that as absent, never as
 * calm."* A `0.00` where there is no bucket would be the one invented number the owner would act
 * on. So this seeds an event inside a measured window AND one inside a gap, and checks the second
 * reads `no reading`.
 *
 * **Not checked here:** the tick marks on the chart itself. They are SVG lines with no text, so the
 * DOM cannot distinguish them; `components/body-battery/__tests__/stress-at-events.test.ts` pins
 * the placement and the lookup (14 cases, six mutations).
 */

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/**
 * Stress buckets at 07:00–08:00 local, leaving the rest of the day a gap. The walk is seeded at
 * 07:30 (inside the measured run) and a second at 15:00 (well past the 75-minute gap threshold),
 * so one event must carry a level and the other must say it has none.
 *
 * Anchored to the USER's local day, never `CURRENT_DATE`: the route derives its window from
 * `todayInTz`, and after 14:00 UTC that is a different date (Q-356).
 */
const MEASURED_HOURS = [7, 7.5, 8]
let day: string | null = null
let userId: string | null = null

test.describe('TN-35 — the day screen reads stress against the day\'s events', () => {
  test.setTimeout(240_000)

  test.beforeAll(async () => {
    await withDb(async db => {
      const { rows: users } = await db.query<{ id: string; timezone: string | null }>(
        'SELECT id, timezone FROM users WHERE email = $1', [SEED_EMAIL])
      userId = users[0]?.id ?? null
      expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
      const tz = users[0].timezone ?? 'Australia/Brisbane'

      // Two days back, so it is unambiguously a PAST day whichever side of midnight CI runs on.
      const { rows } = await db.query<{ d: string }>(
        `SELECT to_char(((now() AT TIME ZONE $1)::date - 2), 'YYYY-MM-DD') AS d`, [tz])
      day = rows[0].d

      for (const [i, h] of MEASURED_HOURS.entries()) {
        await db.query(
          `INSERT INTO oura_daytime_stress_buckets (user_id, day, bucket_start, level)
           VALUES ($1, $2, (($2 || ' ' || $3)::timestamp AT TIME ZONE $4), $5)
           ON CONFLICT (user_id, bucket_start) DO UPDATE SET level = EXCLUDED.level, day = EXCLUDED.day`,
          [userId, day,
           `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}:00`,
           tz, [-0.8, -0.6, -0.4][i]],
        )
      }

      // `start_time` is a bare `time`, and `title` is NOT NULL — written against the real columns
      // rather than guessed. The first draft guessed a `started_at timestamptz` and wrapped the
      // insert in a catch-and-retry, which would have hidden the schema mismatch behind a second
      // wrong query. A fixture that cannot insert must fail loudly, not fall back.
      for (const [hhmm, title] of [['07:30', 'Measured walk'], ['15:00', 'Unmeasured walk']]) {
        await db.query(
          `INSERT INTO activity_logs
             (user_id, date, activity_type, title, start_time, end_time, duration_min, calories_burned)
           VALUES ($1, $2::date, 'walk', $3, $4::time, $5::time, 20, 90)`,
          [userId, day, title, `${hhmm}:00`, `${hhmm.slice(0, 2)}:50:00`],
        )
      }
    })
  })

  test.afterAll(async () => {
    await withDb(async db => {
      if (!userId || !day) return
      await db.query('DELETE FROM oura_daytime_stress_buckets WHERE user_id = $1 AND day = $2', [userId, day])
      await db.query(`DELETE FROM activity_logs WHERE user_id = $1 AND date = $2::date AND activity_type = 'walk'`, [userId, day])
    })
  })

  test('a past day lists its events with the stress reading, and says when there is none', async ({ page }) => {
    await suppressMorningCheckin(page)
    await page.goto(`/health/day?date=${day}`)
    await settleRouteBoundary(page)

    const heading = page.getByText('What was happening', { exact: false }).first()
    await expect(heading, 'the day screen did not join the timeline to the stress series')
      .toBeVisible({ timeout: 60_000 })

    // The coverage denominator, which stops a sparse day reading as an uneventful one.
    await expect(heading).toContainText(/\d+ of \d+ with a reading/)

    // The negative assertion — the entry's "absent, never calm". An event outside every measured
    // run must say so rather than print a level.
    await expect(page.getByText('no reading').first(),
      'an event in a measurement gap did not say it had no reading')
      .toBeVisible({ timeout: 30_000 })
  })
})
