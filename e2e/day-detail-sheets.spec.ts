import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * Tapping a logged exercise opens its history, and tapping an activity opens its detail (LB-3).
 *
 * These two affordances lived on `components/health/day-overlay-sheet.tsx`, which nothing could
 * open after Q-110 pointed the calendar's day-tap at `/health/day` — so both were gone for a
 * fortnight with no report, alongside the edit/delete controls LB-1 brought back. LB-3 ported them
 * onto the day screen and deleted the sheet. This is the guard that they are reachable, because
 * "unreachable and unnoticed" is exactly what happened last time.
 *
 * The tap target is the exercise NAME and the activity TITLE rather than a third icon: the row
 * already carries two 48dp controls. So these assertions also pin the decision that the name is a
 * control — an implementation that renders it as a plain `<span>` again fails here.
 */

const SESSION_ID = '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c'
const ACTIVITY_ID = '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d'
// A fixed past day: nothing here is compared against the clock on either side.
const DAY = '2026-08-12'
const EXERCISE = 'Spec Overhead Press'
const ACTIVITY = 'Spec Morning Ride'

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
       VALUES ($1, 'Spec Sheets Session', '2026-08-11 22:00:00+00', '2026-08-11 22:45:00+00', $2)`,
      [SESSION_ID, userId],
    )
    const { rows: [log] } = await db.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, muscle_groups)
       VALUES ($1, $2, '2026-08-11 22:20:00+00', '{shoulders}') RETURNING id`,
      [SESSION_ID, EXERCISE],
    )
    await db.query(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       SELECT $1, n, 40, 8 FROM generate_series(1, 3) n`,
      [log.id],
    )
    await db.query(
      `INSERT INTO activity_logs (id, user_id, date, activity_type, title, duration_min, distance_km)
       VALUES ($1, $2, $3, 'cycle', $4, 45, 18.2)`,
      [ACTIVITY_ID, userId, DAY, ACTIVITY],
    )
  })
})

test.afterAll(async () => { await withDb(cleanup) })

type Page = import('@playwright/test').Page

/**
 * A real CDP touch sequence, not `.click()` — `.click()` dispatches a mouse-only sequence that
 * never produces a `click` event on these screens (Q-354, written up on `water-log-write-path`).
 *
 * Retried because a tap fired before React has attached the handler does nothing, silently, and CI
 * starts the dev server cold. Only tapped while the sheet is CLOSED: once it is open the dialog
 * covers the row, and every retry would then fail on an element that is no longer visible.
 */
async function tapUntilSheet(page: Page, name: RegExp): Promise<void> {
  const target = page.getByRole('button', { name })
  await expect(target).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    const box = (await target.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
}

test('tapping a logged exercise opens its history', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)

  // By its accessible name, which is what makes it a control at all. A plain <span> — the shape
  // this shipped as before LB-3 — has no role and fails here rather than passing quietly.
  await tapUntilSheet(page, new RegExp(`^${EXERCISE} history$`))

  // The sheet identifies itself by the exercise it was opened for.
  await expect(page.getByRole('dialog').getByText(EXERCISE).first()).toBeVisible({ timeout: 20_000 })
})

test('tapping a logged activity opens its detail', async ({ page }) => {
  await page.goto(`/health/day?date=${DAY}`)
  await settleRouteBoundary(page)

  await tapUntilSheet(page, new RegExp(`^${ACTIVITY} detail$`))

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(ACTIVITY).first()).toBeVisible({ timeout: 20_000 })
  // A fact the row itself does NOT render, so this cannot pass on the row showing through.
  await expect(dialog.getByText(/18\.2/).first()).toBeVisible({ timeout: 20_000 })
})
