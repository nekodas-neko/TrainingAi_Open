/**
 * #4113, the differential: with no workout finished during the model call, the store writes exactly what it
 * wrote before the change. 300 seeded cases on a real Postgres: the same plan is stored twice into the same
 * row, once as `main` stored it (no finish marker in `generatedFor`) and once with the marker read at the
 * start; the two rows must be byte-identical, bar the time they were generated. Then the cases that must
 * refuse (a finish of this type after the read) and the ones that must not (another type's, a deleted one,
 * one before the read). Runs only with DATABASE_URL. Made-up names; no model.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AiPrescription, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000041130'
const CASES = 300

// A small seeded generator, so a failure names its seed.
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }

describe.skipIf(!canRun)('the store with a finish marker is the store as it was when nothing finished meanwhile (#4113)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let push = '', legs = ''
  const row = async (session: string) => (await pool.query(
    `SELECT prescription, prescription_status, prescription_expires_at, phase, phase_started_at, sessions_in_phase FROM session_periodization WHERE user_id=$1 AND program_session_id=$2`, [USER, session])).rows[0]
  const reset = (session: string) => pool.query(
    `UPDATE session_periodization SET prescription=NULL, prescription_status='consumed', prescription_generated_at=NULL, prescription_expires_at=NULL WHERE user_id=$1 AND program_session_id=$2`, [USER, session])
  const finish = (session: string, opts: { deleted?: boolean; ago?: string } = {}) => pool.query(
    `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at, deleted_at) VALUES ($1,$2,'Differential 4113', now() - interval '2 hours', now() - ${opts.ago ?? "interval '1 hour'"}, ${opts.deleted ? 'now()' : 'NULL'}) RETURNING id`, [USER, session])
  const plan = (r: () => number): AiPrescription => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: `case ${r()}`, confidence: 0.9,
    estimatedSessionDurationMin: 30 + Math.floor(r() * 40), weeklyVolumeContribution: {},
    exercises: [{ sessionExerciseId: randomUUID(), name: 'Differential Lift', sets: 2 + Math.floor(r() * 4), reps: 3 + Math.floor(r() * 10), pct: 50 + Math.floor(r() * 40), restSec: 60 + Math.floor(r() * 150) }],
  } as AiPrescription)
  const forStore = async (session: string, withMarker: boolean) => {
    const state = (await repo.getSessionPeriodization(USER, session))!
    const stamp = await repo.getActiveProgramWithStructureStamp(USER, session)
    return { phase: state.phase, phaseStartedAt: state.phaseStartedAt, structure: stamp.structure, ...(withMarker && { finishMarker: stamp.finishMarker }) }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'diff-4113@example.com','x','UTC')`, [USER])
    const program = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'Diff 4113','ai_dynamic',true,'strength') RETURNING id`, [USER])).rows[0].id
    const mk = async (n: string, pos: number) => (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,60) RETURNING id`, [program, n, pos])).rows[0].id as string
    push = await mk('Push', 0); legs = await mk('Legs', 1)
    for (const sid of [push, legs]) await pool.query(`INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status) VALUES ($1,$2,'accumulation',2,true,'consumed')`, [USER, sid])
  })
  afterAll(async () => { await pool?.query(`DELETE FROM users WHERE id = $1`, [USER]) })

  it(`${CASES} seeded cases with no finish during the call: the stored row is byte-identical to the store without the marker`, async () => {
    let withEarlierFinishes = 0
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed)
      // Some finished workouts of this type exist before the generation reads (some deleted, some of the other type).
      const before = Math.floor(r() * 4)
      for (let i = 0; i < before; i++) await finish(r() < 0.8 ? push : legs, { deleted: r() < 0.25, ago: `interval '${1 + Math.floor(r() * 400)} hours'` })
      if (before > 0) withEarlierFinishes++
      const p = plan(r)
      const status: PrescriptionStatus = r() < 0.5 ? 'pending' : 'auto_applied'
      const expires = new Date(Date.UTC(2030, 0, 1 + Math.floor(r() * 300)))
      await reset(push)
      expect(await repo.storePrescription(USER, push, p, expires, status, await forStore(push, false)), `seed ${seed} (main)`).toBe(true)
      const main = await row(push)
      await reset(push)
      expect(await repo.storePrescription(USER, push, p, expires, status, await forStore(push, true)), `seed ${seed} (marker)`).toBe(true)
      const now = await row(push)
      expect(JSON.stringify(now), `seed ${seed}`).toBe(JSON.stringify(main))
    }
    expect(withEarlierFinishes).toBeGreaterThan(CASES / 2)
  }, 300_000)

  it(`${CASES} seeded cases with a finish of this type after the read: refused, nothing written; another type's, a deleted one: stored`, async () => {
    let refused = 0, storedOther = 0, storedDeleted = 0
    for (let seed = 1; seed <= CASES; seed++) {
      const r = rng(seed * 7919)
      const p = plan(r)
      await reset(push)
      const forThis = await forStore(push, true)
      const kind = seed % 3
      if (kind === 0) await finish(push, { ago: `interval '${Math.floor(r() * 3) * 24} hours'` }) // late upload: old completed_at, new row
      else if (kind === 1) await finish(legs)
      else await finish(push, { deleted: true })
      const stored = await repo.storePrescription(USER, push, p, new Date(Date.UTC(2030, 0, 2)), 'auto_applied', forThis)
      const after = await row(push)
      if (kind === 0) { refused++; expect(stored, `seed ${seed}`).toBe(false); expect(after.prescription, `seed ${seed}`).toBeNull() }
      else { expect(stored, `seed ${seed}`).toBe(true); expect(after.prescription_status).toBe('auto_applied'); if (kind === 1) storedOther++; else storedDeleted++ }
    }
    expect(refused + storedOther + storedDeleted).toBe(CASES)
  }, 300_000)
})
