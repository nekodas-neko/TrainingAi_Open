// BF-199 Phase 1 — the shadow row round-trips through the repository into prescription_shadow.
// Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000199a01'

describe.skipIf(!canRun)('recordPrescriptionShadow (BF-199)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'bf199@example.com', 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })

  it('stores the phases and the paired rows', async () => {
    const session = crypto.randomUUID() // no FK row needed: the column is nullable and SET NULL on delete
    await pool.query(`INSERT INTO programs (id, user_id, name, is_active) VALUES ($1, $2, 'BF199', false)`, [session, USER])
    await pool.query(`INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $1, 'S', 0)`, [session])
    await repo.recordPrescriptionShadow(USER, session, {
      modelPhase: 'intensification', modelPhaseAction: 'transition_recommended', finalPhase: 'accumulation', finalPhaseAction: 'stay',
      rows: [{ sessionExerciseId: 'x', name: 'Squat', given: { sets: 2, reps: 8, pct: 75, restSec: 143 }, rules: { sets: 2, reps: 8, pct: 75, restSec: 120 } }],
    })
    const { rows } = await pool.query(`SELECT model_phase, final_phase, rows FROM prescription_shadow WHERE user_id = $1`, [USER])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ model_phase: 'intensification', final_phase: 'accumulation' })
    expect(rows[0].rows[0].rules.restSec).toBe(120)
  })
})
