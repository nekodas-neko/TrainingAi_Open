import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A logged workout, exercise and activity can be edited and deleted from the app (LB-1).
 *
 * Q-110 replaced the calendar's day-tap with a push to `/health/day`, and the edit/delete controls
 * stayed behind on the bottom sheet that tap used to open. Nothing else opened it, so for two weeks
 * the three DELETE routes and the workout-entry PATCH had no reachable caller at all — a mistyped
 * weight or a stray session could be logged but never corrected. This is the guard that the
 * controls are on the screen the tap now lands on, and that pressing them actually writes.
 *
 * **The assertions are on the database, not on the disappearance.** Every one of these handlers
 * closes its dialog and toasts *before* the request resolves (the feedback-first rule), so a row
 * vanishing from the screen is exactly what a control wired to nothing would also produce.
 */

const SESSION_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a'
const ACTIVITY_ID = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b'
// A fixed past day, so neither side of any comparison here moves with the clock.
const DAY = '2026-08-14'
const KEPT = 'Spec Bench Press'
const REMOVED = 'Spec Leg Press'
const ACTIVITY = 'Spec Evening Walk'

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
  await db.query('DELETE FROM activity_logs WHERE id = $1', [ACTIVITY_ID])
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = rows[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    await cleanup(db)

    // 08:00→08:45 Brisbane on DAY.
    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, 'Spec Session', '2026-08-13 22:00:00+00', '2026-08-13 22:45:00+00', $2)`,
      [SESSION_ID, userId],
    )
    for (const name of [KEPT, REMOVED]) {
      const { rows: [log] } = await db.query<{ id: string }>(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, muscle_groups)
         VALUES ($1, $2, '2026-08-13 22:20:00+00', '{chest}') RETURNING id`,
        [SESSION_ID, name],
      )
      await db.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
         SELECT $1, n, 50, 8 FROM generate_series(1, 3) n`,
        [log.id],
      )
    }
    await db.query(
      `INSERT INTO activity_logs (id, user_id, date, activity_type, title, duration_min)
       VALUES ($1, $2, $3, 'walk', $4, 30)`,
      [ACTIVITY_ID, userId, DAY, ACTIVITY],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

type Page = import('@playwright/test').Page

/**
 * A real CDP touch sequence, not `.click()`.
 *
 * `.click()` on these screens dispatches a mouse-only sequence that never produces a `click` event —
 * measured and written up on `water-log-write-path.spec.ts` (Q-354). The gesture layer is not
 * implicated; the mouse path simply does not land here. Taps are also how the product is used.
 *
 * Retried because a tap fired before React has attached the handler does nothing, silently, and CI
 * starts the dev server cold. Safe for every control here: each one opens a dialog, so a repeated
 * tap re-opens rather than toggling something shut.
 */
async function tap(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector)
  await expect(target).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    const box = (await target.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
}

/** The dialogs render a `Cancel`/`Delete` pair; scope to the open one so the label is unambiguous.
 *  Inside the dialog a plain click works — it is not on the screen the mouse path fails on. */
const confirmDelete = (page: Page) =>
  page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

test('an exercise can be edited from the day screen and the new weight persists', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)
  await expect(page.getByText(KEPT)).toBeVisible({ timeout: 30_000 })

  await tap(page, `button[aria-label="Edit ${KEPT}"]`)
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="number"]').first().fill('62.5')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect.poll(async () => withDb(async db => {
    const { rows } = await db.query<{ weight_kg: number }>(
      `SELECT sl.weight_kg FROM set_logs sl
         JOIN exercise_logs el ON el.id = sl.exercise_log_id
        WHERE el.workout_session_id = $1 AND el.exercise_name = $2 AND sl.set_number = 1`,
      [SESSION_ID, KEPT],
    )
    return rows[0]?.weight_kg ?? null
  }), { timeout: 15_000 }).toBe(62.5)
})

test('deleting one exercise leaves the rest of the session standing', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)
  await expect(page.getByText(REMOVED)).toBeVisible({ timeout: 30_000 })

  await tap(page, `button[aria-label="Delete ${REMOVED}"]`)
  await confirmDelete(page)

  await expect.poll(async () => withDb(async db => {
    const { rows } = await db.query<{ exercise_name: string }>(
      'SELECT exercise_name FROM exercise_logs WHERE workout_session_id = $1 AND deleted_at IS NULL',
      [SESSION_ID],
    )
    return rows.map(r => r.exercise_name).sort()
  }), { timeout: 15_000 }).toEqual([KEPT])

  // The session itself is only tombstoned when its LAST exercise goes — checked because the
  // handler mirrors `sessionDeleted` into the local store and would otherwise hide a server change.
  const alive = await withDb(async db => {
    const { rows } = await db.query('SELECT 1 FROM workout_sessions WHERE id = $1 AND deleted_at IS NULL', [SESSION_ID])
    return rows.length
  })
  expect(alive).toBe(1)
})

test('a whole session can be deleted from the day screen', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)
  await expect(page.getByText(KEPT)).toBeVisible({ timeout: 30_000 })

  await tap(page, 'button[aria-label="Delete Spec Session session"]')
  await confirmDelete(page)

  await expect.poll(async () => withDb(async db => {
    const { rows } = await db.query('SELECT 1 FROM workout_sessions WHERE id = $1 AND deleted_at IS NULL', [SESSION_ID])
    return rows.length
  }), { timeout: 15_000 }).toBe(0)
})

test('an activity can be deleted from the day screen', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)
  await expect(page.getByText(ACTIVITY)).toBeVisible({ timeout: 30_000 })

  await tap(page, `button[aria-label="Delete ${ACTIVITY}"]`)
  await confirmDelete(page)

  await expect.poll(async () => withDb(async db => {
    const { rows } = await db.query('SELECT 1 FROM activity_logs WHERE id = $1 AND deleted_at IS NULL', [ACTIVITY_ID])
    return rows.length
  }), { timeout: 15_000 }).toBe(0)
})
