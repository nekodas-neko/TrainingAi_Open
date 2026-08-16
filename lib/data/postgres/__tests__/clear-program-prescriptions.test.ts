// Integration suite: clearProgramPrescriptions voids the cached AI prescription for
// every session in a program when the program is edited, without resetting phase/cycle
// progress. Runs only against a real local dev Postgres — skips cleanly in CI (no
// DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER_ID = '00000000-0000-4000-8000-00000000cf01'
const OTHER_USER_ID = '00000000-0000-4000-8000-00000000cf02'

describe.skipIf(!canRun)('clearProgramPrescriptions', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let clearProgramPrescriptions: typeof import('@/lib/data/postgres/slices/periodization').clearProgramPrescriptions
  let programId: string
  let otherProgramId: string
  let editedSessionIds: string[] = []
  let untouchedSessionId: string

  const seedPrescription = async (programSessionId: string, userId: string) => {
    await pool.query(
      `INSERT INTO session_periodization
         (user_id, program_session_id, phase, phase_started_at, sessions_in_phase,
          baseline_complete, baseline_1rm, prescription, prescription_status,
          prescription_generated_at, prescription_expires_at, updated_at)
       VALUES ($1, $2, 'accumulation', now(), 3, true, '{}'::jsonb,
          '{"exercises":[]}'::jsonb, 'auto_applied', now(), now() + interval '7 days', now())`,
      [userId, programSessionId],
    )
  }

  const makeProgram = async (userId: string, name: string): Promise<{ programId: string; sessionIds: string[] }> => {
    const p = await pool.query(
      `INSERT INTO programs (name, is_active, user_id, phase_mode, training_goal, auto_apply_prescriptions)
       VALUES ($1, false, $2, 'ai_dynamic', 'powerbuilding', true) RETURNING id`,
      [name, userId],
    )
    const pid = p.rows[0].id
    const sessionIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const s = await pool.query(
        `INSERT INTO program_sessions (program_id, name, position, time_budget_minutes)
         VALUES ($1, $2, $3, 60) RETURNING id`,
        [pid, `S${i}`, i],
      )
      sessionIds.push(s.rows[0].id)
    }
    return { programId: pid, sessionIds }
  }

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    ;({ clearProgramPrescriptions } = await import('@/lib/data/postgres/slices/periodization'))
    pool = getPool()
    db = getDb()
    for (const id of [USER_ID, OTHER_USER_ID]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`,
        [id, `clear-presc-${id}@example.com`],
      )
    }
    ;({ programId, sessionIds: editedSessionIds } = await makeProgram(USER_ID, 'Edited Program'))
    for (const sid of editedSessionIds) await seedPrescription(sid, USER_ID)

    // A different program owned by the same user — its prescription must NOT be cleared.
    const other = await makeProgram(USER_ID, 'Untouched Program')
    otherProgramId = other.programId
    untouchedSessionId = other.sessionIds[0]
    await seedPrescription(untouchedSessionId, USER_ID)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE id = ANY($1)`, [[programId, otherProgramId]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_ID, OTHER_USER_ID]])
  })

  it('voids the prescription and sets status=consumed for every session in the edited program', async () => {
    await clearProgramPrescriptions(db, USER_ID, programId)
    const rows = await pool.query(
      `SELECT prescription, prescription_status, prescription_generated_at, prescription_expires_at,
              phase, sessions_in_phase
       FROM session_periodization WHERE program_session_id = ANY($1)`,
      [editedSessionIds],
    )
    expect(rows.rows).toHaveLength(2)
    for (const r of rows.rows) {
      expect(r.prescription).toBeNull()
      expect(r.prescription_status).toBe('consumed')
      expect(r.prescription_generated_at).toBeNull()
      expect(r.prescription_expires_at).toBeNull()
      // Phase/cycle progress is preserved — only the prescription is voided.
      expect(r.phase).toBe('accumulation')
      expect(r.sessions_in_phase).toBe(3)
    }
  })

  it('does not touch a different program owned by the same user', async () => {
    const row = await pool.query(
      `SELECT prescription, prescription_status FROM session_periodization WHERE program_session_id = $1`,
      [untouchedSessionId],
    )
    expect(row.rows[0].prescription).not.toBeNull()
    expect(row.rows[0].prescription_status).toBe('auto_applied')
  })
})
