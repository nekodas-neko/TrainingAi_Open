import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-163 — the owner, on the prescription card: *"Is hypertrogpy the correct tag?"*
 *
 * **It was, and that is what made it worth fixing.** `intensityZoneForPct` maps %1RM to a band with
 * no reference to reps, so his squat at **72.5%** is Hypertrophy by the band's own definition. The
 * contradiction was inside the chip: its tooltip claimed `typically 8–12 reps` one line above a
 * prescription of **2×6**, a rep count the same table calls **Strength**.
 *
 * **This reads the rendered `title`, which is the point of doing it here at all.** The unit test
 * beside it matches source, and a source match is exactly the shape that passes when the edit never
 * reached the render. The fixture is the owner's own row — 72.5% × 6 — not a situation built to make
 * a test go green.
 */

const OWNER_PCT = 72.5
const OWNER_REPS = 6

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

let userId = ''
let programSessionId = ''
let sessionExerciseId = ''
let exerciseName = ''
let previousPhaseMode = 'manual'

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    userId = users[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

    // By position, never by name — the app must work for any program structure.
    const { rows } = await db.query<{ id: string; program_id: string; phase_mode: string }>(
      `SELECT ps.id, p.id AS program_id, p.phase_mode
         FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
        WHERE p.user_id = $1 ORDER BY ps.position LIMIT 1`, [userId])
    expect(rows[0], 'the seeded user has no program session').toBeTruthy()
    programSessionId = rows[0].id
    previousPhaseMode = rows[0].phase_mode

    // The prescription names a REAL session_exercise: the card filters its rows against the
    // session, so an invented id renders nothing and the spec would fail looking like the bug.
    // The column is `session_id`, and the display name lives on the row as `exercise_name` —
    // `exercise_id` is nullable, so joining exercise_library would drop custom exercises.
    const { rows: exRows } = await db.query<{ id: string; name: string }>(
      `SELECT id, exercise_name AS name FROM session_exercises
        WHERE session_id = $1 AND deleted_at IS NULL ORDER BY position LIMIT 1`, [programSessionId])
    expect(exRows[0], 'the seeded session has no exercises').toBeTruthy()
    sessionExerciseId = exRows[0].id
    exerciseName = exRows[0].name

    // The card only renders on the AI-dynamic path. Restored in afterAll — every other spec runs
    // against this same program.
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', ['ai_dynamic', rows[0].program_id])

    await db.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
          prescription, prescription_generated_at, prescription_expires_at, prescription_status)
       VALUES ($1, $2, 'accumulation', 3, true, $3::jsonb, now(), now() + interval '1 day', 'pending')
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET
         prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status,
         prescription_generated_at = EXCLUDED.prescription_generated_at,
         prescription_expires_at = EXCLUDED.prescription_expires_at`,
      [userId, programSessionId, JSON.stringify({
        phase: 'accumulation',
        exercises: [{
          sessionExerciseId, name: exerciseName,
          sets: 2, reps: OWNER_REPS, pct: OWNER_PCT, restSec: 180,
        }],
        estimatedSessionDurationMin: 48,
        weeklyVolumeContribution: {},
        deload: false,
        reasoning: 'Spec fixture.',
        confidence: 0.8,
        phaseAction: 'stay',
      })])
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM session_periodization WHERE program_session_id = $1', [programSessionId])
    await db.query(
      'UPDATE programs SET phase_mode = $1 WHERE id = (SELECT program_id FROM program_sessions WHERE id = $2)',
      [previousPhaseMode, programSessionId])
  })
})

test('the intensity chip names its input and does not assert a rep range', async ({ page }) => {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  await expect(page.getByRole('button', { name: 'Accept' }), 'the prescription card never rendered')
    .toBeVisible({ timeout: 60_000 })

  const chip = page.getByText('Hypertrophy · 65–75%').first()
  await expect(chip, `72.5% must still band as Hypertrophy — the label was never the bug`)
    .toBeVisible({ timeout: 15_000 })

  const title = await chip.getAttribute('title')
  expect(title, 'the tooltip must say what the band is read from').toContain('named from load alone')

  // The regression, stated as the thing that must NOT come back: a rep claim the chip cannot see.
  // Asserted against the rendered attribute, so re-adding it anywhere upstream is caught.
  expect(title).not.toContain('typically')
  expect(title).not.toContain('8–12')

  // And the line it used to contradict is still on screen, unchanged — this is only a label fix.
  await expect(page.getByText(new RegExp(`2×${OWNER_REPS}\\b`)).first()).toBeVisible({ timeout: 15_000 })
})
