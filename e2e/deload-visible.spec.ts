import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * A deload the prescription applied says so on screen (BF-8).
 *
 * The Intensity control read **"Full · As prescribed"** while the card directly below it read
 * **"Deload session · Auto-applied"**, because the toggle was seeded from the `?aiDeload=1` URL
 * param and nothing else. The owner trained one of those believing it was a full session and
 * confirmed it: *"I was under the assumption I was doing my full session but it looks like it has
 * been deload... its too hidden."*
 *
 * **The bug is a predicate, not a label.** Both surfaces asked `isDeloadActive` — "is the current
 * PHASE a deload week" — rather than whether TODAY's session is one, which is what
 * `prescription.deload` holds. The header half is pinned by `session-context-label.test.ts`; this is
 * the toggle half, which needs the real prescription in the database to mean anything.
 *
 * The fixture is an auto-applied deload in a NON-deload phase — exactly the state the entry says
 * would confirm it, and the one no existing guard covered.
 */

const SESSION_NAME = 'Push'
const PRESCRIPTION = {
  phase: 'accumulation',
  phaseAction: 'stay',
  exercises: [],
  estimatedSessionDurationMin: 48,
  weeklyVolumeContribution: {},
  deload: true,
  reasoning: 'Spec fixture: readiness-driven deload inside an ordinary phase.',
  confidence: 0.8,
}

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

    // The Intensity control only exists on the AI-dynamic path, which is the only path that honours
    // it. Restored in afterAll — every other spec runs against this same program.
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', ['ai_dynamic', sessions[0].program_id])

    await db.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
          prescription, prescription_generated_at, prescription_expires_at, prescription_status)
       VALUES ($1, $2, 'accumulation', 3, true, $3::jsonb, now(), now() + interval '1 day', 'auto_applied')
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET
         phase = EXCLUDED.phase, baseline_complete = EXCLUDED.baseline_complete,
         prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status,
         prescription_generated_at = EXCLUDED.prescription_generated_at,
         prescription_expires_at = EXCLUDED.prescription_expires_at`,
      [userId, programSessionId, JSON.stringify(PRESCRIPTION)],
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

test('an auto-applied deload is stated by the intensity control, not contradicted by it', async ({ page }) => {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  const group = page.getByRole('radiogroup', { name: 'Intensity for today' })
  await expect(group).toBeVisible({ timeout: 30_000 })

  // The control states what will run. Asserted on `aria-checked` rather than on styling, because the
  // selected half is distinguished by background colour, and colour alone is not a state.
  await expect(group.getByRole('radio', { name: /Deload/ })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
  await expect(group.getByRole('radio', { name: /Full/ })).toHaveAttribute('aria-checked', 'false')

  // And "As prescribed" lands on the half that IS prescribed. It sat permanently under Full, which
  // is the sentence that contradicted the card below it.
  await expect(group.getByRole('radio', { name: /Deload/ })).toContainText('As prescribed')
  await expect(group.getByRole('radio', { name: /Full/ })).toContainText('Override')
})

test('choosing Full still overrides it, and the choice survives the prescription reloading', async ({ page }) => {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  const group = page.getByRole('radiogroup', { name: 'Intensity for today' })
  await expect(group.getByRole('radio', { name: /Deload/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 })

  // Reflecting the prescription must not become ignoring the user: the toggle is live, and what it
  // says is what will run.
  await group.getByRole('radio', { name: /Full/ }).click()
  await expect(group.getByRole('radio', { name: /Full/ })).toHaveAttribute('aria-checked', 'true')

  // Held for long enough that a late prescription fetch would have re-adopted and undone it.
  await expect(group.getByRole('radio', { name: /Full/ })).toHaveAttribute('aria-checked', 'true', { timeout: 5_000 })
  await expect(group.getByRole('radio', { name: /Deload/ })).toHaveAttribute('aria-checked', 'false')
})
