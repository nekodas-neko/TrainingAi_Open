import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * BF-146 — a first session is told to establish a baseline, and must not also be told that failed.
 *
 * The server deliberately refuses to prescribe while `phase === 'baseline' && !baselineComplete`:
 * a prescription is a percentage of a 1RM and there is no 1RM before the AMRAP. The client
 * funnelled that 400 into `prescriptionGenTimedOut` — a *timeout* flag — so the state was drawn in
 * amber with a retry that can never succeed, under a panel already explaining it correctly.
 *
 * **The state is built, not assumed.** The seeded program is `phase_mode = 'manual'` with no
 * `session_periodization` row at all, so a spec that reads the state and mutates it passes on a
 * developer's aged database and fails on a fresh CI seed — which is exactly what it did. Both
 * halves are created here and put back in `afterAll`, on the `deload-visible.spec.ts` pattern,
 * because every other spec runs against this same program.
 *
 * **`prescription_status = 'consumed'` is load-bearing, not incidental.** Every route to either
 * string runs through `isAiPrescriptionPending`, which is
 * `isAiDynamic && !isBaselinePhase && state.prescriptionStatus === 'consumed'` — so with any other
 * status the two assertions below hold no matter what the baseline terms do, and the spec would be
 * green against the defect it exists to catch. Proven by reinstating BF-148's `hasAnyPriorLog` term
 * in `app/api/workout-data`: with `'consumed'` this fails, with `'none'` it passes.
 */

test.setTimeout(180_000)

const FAILURE_BANNER = /Couldn't generate your AI prescription just now/
const PREPARING = /Preparing your AI workout/

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL
  expect(connectionString, 'DATABASE_URL must be set — see e2e/README.md').toBeTruthy()
  const db = new Client({ connectionString })
  await db.connect()
  try { return await fn(db) } finally { await db.end() }
}

interface Prior {
  phase: string
  baselineComplete: boolean
  prescription: unknown
  prescriptionStatus: string
}

let userId = ''
let programId = ''
let programSessionId = ''
let previousPhaseMode = 'manual'
let prior: Prior | null = null

test.beforeAll(async () => {
  await withDb(async db => {
    const { rows: users } = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [SEED_EMAIL])
    expect(users[0], `${SEED_EMAIL} is not seeded — run pnpm db:local`).toBeTruthy()
    userId = users[0].id

    // Picked by position, not by name — the no-hardcoded-sessions rule holds for fixtures too.
    const { rows: sessions } = await db.query<{ id: string; programId: string; phaseMode: string }>(
      `SELECT ps.id, p.id AS "programId", p.phase_mode AS "phaseMode"
         FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
        WHERE p.user_id = $1 AND p.is_active = true
        ORDER BY ps.position LIMIT 1`, [userId])
    expect(sessions[0], 'the seeded user has no active program with a session').toBeTruthy()
    programSessionId = sessions[0].id
    programId = sessions[0].programId
    previousPhaseMode = sessions[0].phaseMode

    // The refusal only exists on the AI-dynamic path; the seed ships `manual`.
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', ['ai_dynamic', programId])

    const { rows: existing } = await db.query<Prior>(
      `SELECT phase, baseline_complete AS "baselineComplete", prescription,
              prescription_status AS "prescriptionStatus"
         FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`,
      [userId, programSessionId])
    prior = existing[0] ?? null

    await db.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
          prescription, prescription_status)
       VALUES ($1, $2, 'baseline', 0, false, NULL, 'consumed')
       ON CONFLICT (user_id, program_session_id) DO UPDATE SET
         phase = EXCLUDED.phase, baseline_complete = EXCLUDED.baseline_complete,
         prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status`,
      [userId, programSessionId])
  })
})

test.afterAll(async () => {
  if (!programSessionId) return
  await withDb(async db => {
    if (prior) {
      await db.query(
        `UPDATE session_periodization
            SET phase = $3, baseline_complete = $4, prescription = $5, prescription_status = $6
          WHERE user_id = $1 AND program_session_id = $2`,
        [userId, programSessionId, prior.phase, prior.baselineComplete,
         prior.prescription === null ? null : JSON.stringify(prior.prescription), prior.prescriptionStatus])
    } else {
      await db.query('DELETE FROM session_periodization WHERE user_id = $1 AND program_session_id = $2',
        [userId, programSessionId])
    }
    await db.query('UPDATE programs SET phase_mode = $1 WHERE id = $2', [previousPhaseMode, programId])
  })
})

test('a session still establishing its baseline is not told the refusal was a failure', async ({ page }) => {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)

  // Anchor on something present before asserting absence: `toHaveCount(0)` is satisfied by a page
  // that failed to render at all, which is exactly the defect this would then miss.
  await expect(page.getByRole('button', { name: /Start Workout|Continue Workout/ }).first())
    .toBeVisible({ timeout: 60_000 })

  // The whole bounded poll would have elapsed by now on the old build — the banner trips after it.
  await page.waitForTimeout(12_000)

  await expect(page.getByText(FAILURE_BANNER), 'the refusal is expected, not a failure').toHaveCount(0)
  await expect(page.getByText(PREPARING), 'a generation that cannot succeed is not "preparing"').toHaveCount(0)
})
