import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A chin-up on the Health day card reads as bodyweight, not `0kg` (LA-164).
 *
 * The unit test pins the copy; this pins that the copy survives the round trip — the library's
 * `exercise_type` has to reach `/api/day-log`'s `exerciseType` and then the cell. That is the half
 * that was broken: `isBodyweightType` and the column both already existed, and the card ignored
 * them. A weighted lift is asserted in the same run, because "reads as bodyweight" is only correct
 * if it is not what every row now says.
 */

const SESSION_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e'
const LIBRARY_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7f'
// A fixed past day: nothing here is compared against the clock on either side.
const DAY = '2026-08-14'
const BODYWEIGHT = 'Spec Chin-Up'
const WEIGHTED = 'Spec Barbell Row'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

async function cleanup(db: Client) {
  await db.query(
    `DELETE FROM set_logs WHERE exercise_log_id IN (SELECT id FROM exercise_logs WHERE workout_session_id = $1)`,
    [SESSION_ID],
  )
  await db.query('DELETE FROM exercise_logs WHERE workout_session_id = $1', [SESSION_ID])
  await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
  await db.query('DELETE FROM exercise_library WHERE id = $1', [LIBRARY_ID])
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)

    await db.query(
      `INSERT INTO exercise_library (id, name, exercise_type) VALUES ($1, $2, 'bodyweight')`,
      [LIBRARY_ID, BODYWEIGHT],
    )
    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'Spec Bodyweight Session', '2026-08-13 22:00:00+00', '2026-08-13 22:40:00+00', $2)`,
      [SESSION_ID, userId],
    )

    // The chin-up carries the library id — that FK is the only route from `exercise_type` to the
    // card. The row is logged at 0 kg added, which is the shape that rendered as `0kg`.
    const { rows: [bw] } = await db.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, logged_at, muscle_groups)
       VALUES ($1, $2, $3, '2026-08-13 22:10:00+00', '{back}') RETURNING id`,
      [SESSION_ID, BODYWEIGHT, LIBRARY_ID],
    )
    await db.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       SELECT $1, n, 0, 8 FROM generate_series(1, 3) n`,
      [bw.id],
    )

    // No `exercise_id` at all, which is the null-exerciseType path: it must stay on kg.
    const { rows: [wt] } = await db.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, muscle_groups)
       VALUES ($1, $2, '2026-08-13 22:25:00+00', '{back}') RETURNING id`,
      [SESSION_ID, WEIGHTED],
    )
    await db.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       SELECT $1, n, 60, 8 FROM generate_series(1, 3) n`,
      [wt.id],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

test('a bodyweight lift at 0 kg reads BW, and a weighted lift keeps its kg', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)

  // The row, not the whole card: `0` and `60` both appear elsewhere on this screen.
  const bwRow = page.locator('div').filter({ hasText: new RegExp(`^${BODYWEIGHT}`) }).last()
  await expect(bwRow).toBeVisible({ timeout: 30_000 })
  await expect(bwRow).toContainText('BW')
  // The regression itself. `0kg` on this row is the bug, and it is what passes if `exerciseType`
  // stops reaching the component.
  await expect(bwRow).not.toContainText(/0\s*kg/)

  const wtRow = page.locator('div').filter({ hasText: new RegExp(`^${WEIGHTED}`) }).last()
  await expect(wtRow).toContainText(/60\s*kg/)
  await expect(wtRow).not.toContainText('BW')
})
