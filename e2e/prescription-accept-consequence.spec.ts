import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * The card says what Start Workout will do without Accept (BF-156).
 *
 * Owner: *"what happens if I dont select to apply the session? Its pretty easy to miss that
 * button."* There are two answers and they are opposite. `prescriptionDrivesLoad` splits the five
 * phase actions: a pending `stay` or `transition_recommended` already drives today's loads, so
 * ignoring the button costs only the phase decision; a pending `deload_recommended`,
 * `session_swap_recommended` or `rest_day_recommended` does not, so ignoring it trains the
 * program's base progression style instead of what is on screen.
 *
 * **The button shapes were never the signal, which is the part worth guarding.** The card's two
 * action blocks split on a different axis than the rule: `transition_recommended` and
 * `deload_recommended` share the "Move to …" block while having OPPOSITE load consequences, and
 * `stay` shares "Accept" with `session_swap_recommended`. So the two cases below are deliberately
 * both from the Accept block — same buttons, opposite sentence.
 *
 * The two are asserted against each other, not just for their own string: a line that appeared in
 * both states would be worse than none, because it would read as a fact about the card.
 */

const BASE = {
  phase: 'accumulation',
  exercises: [],
  estimatedSessionDurationMin: 48,
  weeklyVolumeContribution: {},
  deload: false,
  reasoning: 'Spec fixture.',
  confidence: 0.8,
}

let userId = ''
let programSessionId = ''
let previousPhaseMode = 'manual'

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

/** Replaces the pending prescription in place, so each case is the same card in a different state. */
async function seedPending(phaseAction: string) {
  await withDb(db => db.query(
    `INSERT INTO session_periodization
       (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
        prescription, prescription_generated_at, prescription_expires_at, prescription_status)
     VALUES ($1, $2, 'accumulation', 3, true, $3::jsonb, now(), now() + interval '1 day', 'pending')
     ON CONFLICT (user_id, program_session_id) DO UPDATE SET
       prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status,
       prescription_generated_at = EXCLUDED.prescription_generated_at,
       prescription_expires_at = EXCLUDED.prescription_expires_at`,
    [userId, programSessionId, JSON.stringify({ ...BASE, phaseAction })]))
}

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    userId = users[0]?.id
    expect(userId, `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()

    // By position, not by name: the app must work for any program structure, so a spec that keys
    // off "Push" is asserting something about this seed rather than about the app.
    const { rows } = await db.query<{ id: string; program_id: string; phase_mode: string }>(
      `SELECT ps.id, p.id AS program_id, p.phase_mode
         FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
        WHERE p.user_id = $1 ORDER BY ps.position LIMIT 1`, [userId])
    expect(rows[0], 'the seeded user has no program session').toBeTruthy()
    programSessionId = rows[0].id
    previousPhaseMode = rows[0].phase_mode

    // The card only renders on the AI-dynamic path. Restored in afterAll — every other spec runs
    // against this same program.
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', ['ai_dynamic', rows[0].program_id])
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

const ALREADY_LOADED = /numbers are already loaded/
const WILL_BE_IGNORED = /train the program.s normal loads/

test('a pending `stay` says the numbers are already loaded', async ({ page }) => {
  await seedPending('stay')
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  await expect(page.getByRole('button', { name: 'Accept' }), 'the prescription card never rendered')
    .toBeVisible({ timeout: 60_000 })

  await expect(page.getByText(ALREADY_LOADED)).toBeVisible({ timeout: 15_000 })
  // And NOT the other sentence. `stay` drives load, so warning about losing it would be false.
  await expect(page.getByText(WILL_BE_IGNORED)).toHaveCount(0)
})

test('a pending `session_swap_recommended` warns the numbers will be ignored', async ({ page }) => {
  await seedPending('session_swap_recommended')
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  // Same block, same two buttons as the case above — which is exactly why the sentence has to
  // carry the difference.
  await expect(page.getByRole('button', { name: 'Accept' }), 'the prescription card never rendered')
    .toBeVisible({ timeout: 60_000 })

  await expect(page.getByText(WILL_BE_IGNORED)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(ALREADY_LOADED)).toHaveCount(0)
})
