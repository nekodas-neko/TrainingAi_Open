// Q-54: `storePrescription` writes the prescription and its status in one statement.
//
// It used to be two: store (which reset the status to 'pending') and then a separate
// `updatePrescriptionStatus('auto_applied')`. Two generations for the same session can run
// concurrently — the duration-preset picker and the auto-fire trigger build different dedup keys,
// so neither collapses the other — and interleaving between those two statements leaves the row
// holding one run's prescription with the other run's status.
//
// These tests reproduce that interleaving directly against the real table, then pin that the
// single-statement version cannot express it. Runs only against a local dev Postgres; skips
// cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

const canRun = !!process.env.DATABASE_URL
const USER_ID = '00000000-0000-4000-8000-00000000d541'

describe.skipIf(!canRun)('storePrescription writes content and status atomically (Q-54)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let period: typeof import('@/lib/data/postgres/slices/periodization')
  let programSessionId: string

  const prescriptionFor = (tag: string) =>
    ({ exercises: [], notes: tag } as unknown as AiPrescription)

  const readRow = async () => {
    const { rows } = await pool.query(
      `SELECT prescription->>'notes' AS tag, prescription_status AS status
         FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`,
      [USER_ID, programSessionId],
    )
    return rows[0] as { tag: string; status: string }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    db = client.getDb()
    pool = client.getPool()
    period = await import('@/lib/data/postgres/slices/periodization')

    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, 'Q54 test')
         ON CONFLICT (id) DO NOTHING`,
      [USER_ID, `q54-${USER_ID}@local.test`],
    )
    const p = await pool.query(
      `INSERT INTO programs (name, is_active, user_id, phase_mode, training_goal, auto_apply_prescriptions)
       VALUES ('Q54', false, $1, 'ai_dynamic', 'powerbuilding', true) RETURNING id`,
      [USER_ID],
    )
    const ps = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position, time_budget_minutes)
       VALUES ($1, 'S', 0, 60) RETURNING id`,
      [p.rows[0].id],
    )
    programSessionId = ps.rows[0].id
    await pool.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, phase_started_at, sessions_in_phase,
          baseline_complete, baseline_1rm, updated_at)
       VALUES ($1, $2, 'accumulation', now(), 3, true, '{}'::jsonb, now())`,
      [USER_ID, programSessionId],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID])
  })

  it('reproduces the old two-statement interleaving: status describes the wrong prescription', async () => {
    // Exactly the old sequence, hand-rolled: A stores, B stores, A's status lands last.
    const expires = new Date(Date.now() + 7 * 86_400_000)
    await period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('runA'), expires)
    await period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('runB'), expires)
    await period.updatePrescriptionStatus(db, USER_ID, programSessionId, 'auto_applied')

    const row = await readRow()
    // The row now holds run B's prescription with run A's status. This is the defect, and it is
    // still reachable by anyone who calls updatePrescriptionStatus separately — which is why the
    // generation path no longer does.
    expect(row.tag).toBe('runB')
    expect(row.status).toBe('auto_applied')
  })

  it('carries the status through in one statement, so content and status cannot disagree', async () => {
    const expires = new Date(Date.now() + 7 * 86_400_000)
    await period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('autoApplied'), expires, 'auto_applied')
    expect(await readRow()).toEqual({ tag: 'autoApplied', status: 'auto_applied' })
  })

  it('still defaults to pending when no status is given', async () => {
    const expires = new Date(Date.now() + 7 * 86_400_000)
    await period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('plain'), expires)
    expect(await readRow()).toEqual({ tag: 'plain', status: 'pending' })
  })

  it('leaves the last writer whole under an interleave — the race remains, the mismatch does not', async () => {
    // Two "concurrent" generations, each now a single statement. Whichever lands last owns BOTH
    // fields. Last-writer-wins was never the defect; a row describing neither run was.
    const expires = new Date(Date.now() + 7 * 86_400_000)
    await Promise.all([
      period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('A'), expires, 'auto_applied'),
      period.storePrescription(db, USER_ID, programSessionId, prescriptionFor('B'), expires, 'pending'),
    ])
    const row = await readRow()
    expect(row).toEqual(
      row.tag === 'A'
        ? { tag: 'A', status: 'auto_applied' }
        : { tag: 'B', status: 'pending' },
    )
  })
})
