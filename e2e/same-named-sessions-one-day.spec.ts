import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * Two sessions with the same name on one day are two workouts, not one (Q-362a / Q-362b).
 *
 * `/api/day-log` used to key `workoutDurations` by session NAME, so the second `Push` of a day
 * overwrote the first and the surfaces reading it printed one window against both cards. Q-362a
 * added `workoutDurationsById`; this is the guard that the surfaces actually read it.
 *
 * **The assertion is on the durations, not on the card count.** Two cards appeared before this fix
 * as well — `day-sections` already grouped by id (Q-391) — and both showed the *later* session's
 * 82 minutes. Counting cards would have passed against the bug. What only passes when the lookup is
 * id-keyed is the two cards disagreeing.
 *
 * **Minutes, not clock times.** A duration is the difference between two instants and so is the
 * same number in every timezone, while "5:00pm" is not. Asserting on the rendered clock would tie
 * this spec to the seeded user's `Australia/Brisbane`.
 */

// Fixed ids so the fixture is idempotent, and a fixed past date so nothing here depends on a
// rolling window — both sides of every comparison are pinned (CLAUDE.md, Date Arithmetic).
//
// The day is deliberately a YEAR back, not last week. `scripts/local-db/seed.sql` dates its
// workouts RELATIVE to the day it runs, so any recent fixed date eventually collides with a seeded
// session — and CI reseeds every run, so the collision arrives without anything in the diff
// changing. It arrived as `getByText('Bench Press') resolved to 2 elements`, which reads like a
// duplicate-rendering bug rather than a fixture that drifted into the seed's window.
const MORNING_ID = '11111111-1111-4111-8111-111111111111'
const EVENING_ID = '22222222-2222-4222-8222-222222222222'
const DAY = '2025-05-14'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string; tz: string }>(
      `SELECT id, COALESCE(timezone, 'Australia/Brisbane') AS tz FROM users WHERE email = $1`,
      [SEED_EMAIL],
    )
    const userId = rows[0]?.id
    const tz = rows[0]?.tz
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

    await db.query('DELETE FROM exercise_logs WHERE workout_session_id = ANY($1)', [[MORNING_ID, EVENING_ID]])
    await db.query('DELETE FROM workout_sessions WHERE id = ANY($1)', [[MORNING_ID, EVENING_ID]])

    // 08:00→08:32 and 17:00→18:22 Brisbane on DAY. The two windows are deliberately far apart so a
    // collision shows up as one duration on both cards rather than as a near-miss.
    for (const [id, startedAt, completedAt, exercise, loggedAt] of [
      [MORNING_ID, '2025-05-13 22:00:00+00', '2025-05-13 22:40:00+00', 'Bench Press', '2025-05-13 22:30:00+00'],
      [EVENING_ID, '2025-05-14 07:00:00+00', '2025-05-14 08:30:00+00', 'Overhead Press', '2025-05-14 08:20:00+00'],
    ] as const) {
      await db.query(
        `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
         VALUES ($1, 'Push', $2, $3, $4)`,
        [id, startedAt, completedAt, userId],
      )
      await db.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, time_to_complete, logged_at, muscle_groups)
         VALUES ($1, $2, 120, $3, '{chest}')`,
        [id, exercise, loggedAt],
      )
    }

    // The two the fixture just wrote, and nothing else. Without this a seeded session sharing the
    // day fails the assertions below as a strict-mode violation naming an exercise, which says
    // nothing about the collision that caused it.
    const { rows: onDay } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workout_sessions
        WHERE user_id = $1
          AND (started_at AT TIME ZONE $3)::date = $2::date`,
      [userId, DAY, tz],
    )
    expect(Number(onDay[0].n), `${DAY} must hold only this fixture's two sessions`).toBe(2)
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM exercise_logs WHERE workout_session_id = ANY($1)', [[MORNING_ID, EVENING_ID]])
    await db.query('DELETE FROM workout_sessions WHERE id = ANY($1)', [[MORNING_ID, EVENING_ID]])
  })
})

test('the day detail gives each of two same-named sessions its own duration', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)

  // Both sessions are on screen, by their exercises rather than by a card count — the names are
  // identical, so an exercise is the only thing that tells the two cards apart.
  await expect(page.getByText('Bench Press')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Overhead Press')).toBeVisible()

  // 32 and 82 minutes. Both must be present: with a name-keyed lookup the later session's 82
  // appeared twice and 32 appeared nowhere.
  await expect(page.getByText(/\b32 min\b/)).toBeVisible()
  await expect(page.getByText(/\b82 min\b/)).toBeVisible()
})
