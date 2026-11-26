import { test, expect } from '@playwright/test'
import { Client } from 'pg'
import { SEED_EMAIL, settleRouteBoundary } from './fixtures'

/**
 * What the person sees on the prescription card of an AI-dynamic program (BF-156, rewritten for
 * #3900 / #4088 / #4104).
 *
 * BF-156 was the owner's question — *"what happens if I dont select to apply the session? Its
 * pretty easy to miss that button."* — and the card answered it with one sentence per kind of
 * plan. **#3900 removed the question for most plans:** since #4088 every plan generated on the AI
 * program is stored applied (`auto_applied`), and a plan left `pending` from before is promoted
 * the first time it is served (`adoptPendingAiPlan`). A stay or a session swap therefore shows
 * "Auto-applied" and has no Accept to miss; #4104 made the native screen the same (one Start).
 * The cases below assert that.
 *
 * The consequence sentences still exist for the two pending plans the rule leaves alone, and the
 * spec keeps both covered through them: a phase move on a program waiting for its switch-over
 * (`transition_recommended` with `typeOnlyMove`: today's numbers are already loaded) and a
 * deload that is not a one-day deload (not applied by itself: the program's normal loads train).
 * They are asserted against each other, because a line that appeared in both states would read
 * as a fact about the card.
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
async function seedPending(phaseAction: string, extra: Record<string, unknown> = {}) {
  await withDb(db => db.query(
    `INSERT INTO session_periodization
       (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
        prescription, prescription_generated_at, prescription_expires_at, prescription_status)
     VALUES ($1, $2, 'accumulation', 3, true, $3::jsonb, now(), now() + interval '1 day', 'pending')
     ON CONFLICT (user_id, program_session_id) DO UPDATE SET
       prescription = EXCLUDED.prescription, prescription_status = EXCLUDED.prescription_status,
       prescription_generated_at = EXCLUDED.prescription_generated_at,
       prescription_expires_at = EXCLUDED.prescription_expires_at`,
    [userId, programSessionId, JSON.stringify({ ...BASE, ...extra, phaseAction })]))
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

/** The card's header line reads "AI Prescription · <phase> · Auto-applied" once the plan is applied. */
const APPLIED_HEADER = /AI Prescription · .* · Auto-applied/

async function open(page: import('@playwright/test').Page) {
  await page.goto(`/workout?session=${programSessionId}`)
  await settleRouteBoundary(page)
}

for (const [phaseAction, what] of [
  ['stay', 'a stay left pending'],
  ['session_swap_recommended', 'a session swap left pending'],
] as const) {
  test(`${what} is applied when the workout opens, with no Accept to miss`, async ({ page }) => {
    await seedPending(phaseAction)
    await open(page)

    await expect(page.getByText(APPLIED_HEADER), 'the prescription card never rendered as applied')
      .toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0)
    // Nothing is waiting on the person, so neither consequence sentence has a reason to show.
    await expect(page.getByText(ALREADY_LOADED)).toHaveCount(0)
    await expect(page.getByText(WILL_BE_IGNORED)).toHaveCount(0)

    // And the store agrees with the screen: the plan was promoted, not just painted.
    const status = await withDb(db => db.query<{ prescription_status: string }>(
      'SELECT prescription_status FROM session_periodization WHERE user_id = $1 AND program_session_id = $2',
      [userId, programSessionId]))
    expect(status.rows[0]?.prescription_status).toBe('auto_applied')
  })
}

test('a pending phase move on a waiting program says the numbers are already loaded', async ({ page }) => {
  // `typeOnlyMove` is the program waiting for its switch-over: adoption leaves it pending (#3877).
  await seedPending('transition_recommended', { phase: 'intensification', typeOnlyMove: true })
  await open(page)

  await expect(page.getByRole('button', { name: /^Move to /i }), 'the pending move never rendered')
    .toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(ALREADY_LOADED)).toBeVisible({ timeout: 15_000 })
  // And NOT the other sentence. A move drives load, so warning about losing it would be false.
  await expect(page.getByText(WILL_BE_IGNORED)).toHaveCount(0)
})

test('a pending deload that is not a one-day deload warns the numbers will be ignored', async ({ page }) => {
  // `deload: false` is not a one-day deload (`isOneDayDeload`), so it is not applied by itself.
  await seedPending('deload_recommended', { deload: false })
  await open(page)

  await expect(page.getByRole('button', { name: /^Move to /i }), 'the pending deload never rendered')
    .toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(WILL_BE_IGNORED)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(ALREADY_LOADED)).toHaveCount(0)
})
