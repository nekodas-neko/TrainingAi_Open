import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary, suppressMorningCheckin, SKELETON_TIMEOUT_MS } from './fixtures'

/**
 * Home's Today's Timeline: the workout card opens the day-detail screen (Q-93-followup).
 *
 * **The assertion is the destination URL, not that anything moved.** A row wired to nothing renders
 * identically to a wired one — same card, same `role="button"`, same press feedback — which is the
 * same reason `day-entry-edit-delete.spec.ts` asserts on the database rather than on a row
 * disappearing. Two of this timeline's seven card types were wired in Q-93 and Q-93-followup's first
 * pass with no guard at all, and the third sat inert for nineteen days after the screen it needed
 * shipped.
 *
 * The row is located by `getByRole('button')`, not by its text, so the spec also fails if the tap
 * target stops being a control — the WebView nested-control rule means this is a
 * `<div role="button">` rather than a `<button>`, and nothing else would notice it losing the role.
 *
 * Home is `/`. `/session-select` redirects to `/workout` despite hosting the component's file.
 */

// A distinct name, because `scripts/local-db/seed.sql` dates its workouts RELATIVE to the day it
// runs — a generic name would eventually collide with a seeded session on the same day and fail as
// a strict-mode violation, which reads like a duplicate-rendering bug rather than a fixture clash.
const SESSION_ID = '33333333-3333-4333-8333-333333333333'
const SESSION_NAME = 'Timeline Tap Probe'

// Unlike the fixed-date specs this one MUST land on today: `/api/day-timeline` covers today and
// yesterday only. So both sides come from one clock — the day is read from Postgres in the user's
// timezone and the session is anchored at MIDDAY on it, never midnight, because a boundary is
// exactly where an off-by-one stops being visible (CLAUDE.md, Date Arithmetic).
async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

let today = ''

test.beforeAll(async () => {
  today = await withDb(async db => {
    const { rows } = await db.query<{ id: string; tz: string; d: string }>(
      `SELECT id,
              COALESCE(timezone, 'Australia/Brisbane') AS tz,
              to_char(now() AT TIME ZONE COALESCE(timezone, 'Australia/Brisbane'), 'YYYY-MM-DD') AS d
         FROM users WHERE email = $1`,
      [SEED_EMAIL],
    )
    const user = rows[0]
    expect(user?.id, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

    await db.query('DELETE FROM exercise_logs WHERE workout_session_id = $1', [SESSION_ID])
    await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])

    await db.query(
      `INSERT INTO workout_sessions (id, session_name, started_at, completed_at, user_id)
       VALUES ($1, $2, ($3::date + time '12:00') AT TIME ZONE $4,
                       ($3::date + time '12:45') AT TIME ZONE $4, $5)`,
      [SESSION_ID, SESSION_NAME, user.d, user.tz, user.id],
    )
    // The route skips a session with no logged exercises as a phantom, so the card needs one.
    await db.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, time_to_complete, logged_at, muscle_groups)
       VALUES ($1, 'Bench Press', 120, ($2::date + time '12:30') AT TIME ZONE $3, '{chest}')`,
      [SESSION_ID, user.d, user.tz],
    )
    return user.d
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM exercise_logs WHERE workout_session_id = $1', [SESSION_ID])
    await db.query('DELETE FROM workout_sessions WHERE id = $1', [SESSION_ID])
  })
})

test('the timeline workout card opens the day-detail screen for its own date', async ({ page }) => {
  // Radix `aria-hidden`s <main> while the Morning Check-in modal is open, so every getByRole on
  // Home returns 0 and the failure reads as "the affordance does not exist".
  await suppressMorningCheckin(page)
  await page.goto('/')
  await settleRouteBoundary(page)

  // Scoped to the timeline region, not the page: a workout card's title is its session name, which
  // Home also renders as a session chip near the top — an unscoped locator matches both.
  const timeline = page.getByRole('region', { name: "Today's Timeline" })
  const row = timeline.getByRole('button').filter({ hasText: SESSION_NAME })
  await expect(row).toBeVisible({ timeout: SKELETON_TIMEOUT_MS })
  await row.click()

  await expect(page).toHaveURL(new RegExp(`/health/day\\?date=${today}$`))
  // The screen it lands on actually renders that session, rather than falling back to today by
  // coincidence — `/health/day` swallows an unparseable date param and shows today instead.
  await settleRouteBoundary(page)
  await expect(page.getByText(SESSION_NAME).first()).toBeVisible({ timeout: SKELETON_TIMEOUT_MS })
})
