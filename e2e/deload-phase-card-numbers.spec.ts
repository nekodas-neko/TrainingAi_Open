import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * The card in a deload PHASE shows the deload numbers, not the program as written (#2402).
 *
 * `workout-data` re-evaluates a stored prescription on the first read of the day, and that pass
 * treated every deloaded row with a `preDeload` as "soreness cleared, put it back". A deload phase
 * flags nothing per exercise by design, so a stored 2×6 @ 50% came back as 3×8 @ 75% and was written
 * back, while the bar kept deloading. This drives the real route: the numbers the card shows are the
 * ones AFTER that pass.
 */
const SESSION_NAME = 'Push'
let programSessionId = ''
let previousPhaseMode = 'manual'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    const userId = users[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    const { rows: sessions } = await db.query<{ id: string; program_id: string; phase_mode: string }>(
      `SELECT ps.id, p.id AS program_id, p.phase_mode
         FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
        WHERE p.user_id = $1 AND ps.name = $2 LIMIT 1`,
      [userId, SESSION_NAME],
    )
    expect(sessions[0], `the seeded program has no ${SESSION_NAME} session`).toBeTruthy()
    programSessionId = sessions[0].id
    previousPhaseMode = sessions[0].phase_mode
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', ['ai_dynamic', sessions[0].program_id])

    const { rows: exs } = await db.query<{ id: string; exercise_name: string }>(
      'SELECT id, exercise_name FROM session_exercises WHERE session_id = $1 AND deleted_at IS NULL ORDER BY position',
      [programSessionId],
    )
    expect(exs.length, 'the seeded Push session has no exercises').toBeGreaterThan(0)
    const prescription = {
      phase: 'deload', phaseAction: 'stay', deload: true, confidence: 0.3, source: 'rules',
      estimatedSessionDurationMin: 20, weeklyVolumeContribution: {},
      reasoning: 'Spec fixture: a deload phase.',
      exercises: exs.map(e => ({
        sessionExerciseId: e.id, name: e.exercise_name, sets: 2, reps: 6, pct: 50, restSec: 120,
        deloaded: true, preDeload: { sets: 3, reps: 8, pct: 75, restSec: 90 },
      })),
    }
    await db.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
          prescription, prescription_generated_at, prescription_expires_at, prescription_status)
       VALUES ($1, $2, 'deload', 1, true, $3::jsonb, now(), now() + interval '1 day', 'auto_applied')
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET
         phase = EXCLUDED.phase, baseline_complete = EXCLUDED.baseline_complete,
         prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status,
         prescription_generated_at = EXCLUDED.prescription_generated_at,
         prescription_expires_at = EXCLUDED.prescription_expires_at`,
      [userId, programSessionId, JSON.stringify(prescription)],
    )
  })
})

test.afterAll(async () => {
  await withDb(async db => {
    await db.query('DELETE FROM session_periodization WHERE program_session_id = $1', [programSessionId])
    await db.query(
      'UPDATE programs SET phase_mode = $1 WHERE id = (SELECT program_id FROM program_sessions WHERE id = $2)',
      [previousPhaseMode, programSessionId],
    )
  })
})

test('the card of a deload phase lists the deload numbers, and the stored row stays deloaded', async ({ page }) => {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  const card = page.getByRole('button', { name: /AI Prescription/ })
  await expect(card).toBeVisible({ timeout: 30_000 })
  if (await card.getAttribute('aria-expanded') !== 'true') await card.click()

  await expect(page.getByText(/2×6 @ .*50%/).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/3×8 @ /), 'the card shows the program as written, not the deload that runs').toHaveCount(0)

  // And the re-evaluation did not write the full numbers back over the stored plan.
  const stored = await withDb(async db => {
    const { rows } = await db.query<{ prescription: { exercises: { sets: number; deloaded?: boolean }[] } }>(
      'SELECT prescription FROM session_periodization WHERE program_session_id = $1', [programSessionId],
    )
    return rows[0].prescription.exercises
  })
  expect(stored.every(e => e.deloaded === true && e.sets === 2), JSON.stringify(stored)).toBe(true)
})
