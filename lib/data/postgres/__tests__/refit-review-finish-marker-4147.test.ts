/**
 * #4147: the re-fit (`refitPrescriptionToBudget`) and the Workout Review apply read the session type's finish marker
 * with the plan they start from and pass it to the store, as generation does since #4113. Per path, on a real Postgres:
 *   - a workout finished between the read and the store: nothing is stored (the slot's plan is left as it was);
 *   - no finish: the stored row is byte-identical to the store without a marker (what `main` wrote).
 * The model is never involved (the re-fit and the apply make no model call): 0 real requests. `aggregateSignals` is
 * mocked (it is ~30 reads with its own coverage); everything downstream of it, the real budget stage, runs.
 * Runs only with DATABASE_URL. Made-up names and numbers.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000041470'
const SQUAT = randomUUID(), ROW = randomUUID()

const seam = vi.hoisted(() => ({ repo: null as null | Record<string, unknown> }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: '00000000-0000-4000-8000-000000041470', timezone: 'UTC' } }) }))
vi.mock('@/lib/data', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/data')>()),
  getRepository: async () => seam.repo,
}))
vi.mock('@trainingai/shared/ai-periodization/signals', async importOriginal => ({
  ...(await importOriginal<typeof import('@trainingai/shared/ai-periodization/signals')>()),
  aggregateSignals: async () => ({
    trainingGoal: 'hypertrophy', effectiveTimeBudgetMin: 50,
    exercises: [
      { sessionExerciseId: SQUAT, name: 'Squat', role: 'primary', muscleAssignments: [{ muscle: 'quads', role: 'main' }], transitionSec: 240, timeProfile: null },
      { sessionExerciseId: ROW, name: 'Row', role: 'secondary', muscleAssignments: [{ muscle: 'back', role: 'main' }], transitionSec: 240, timeProfile: null },
    ],
    weeklyTargets: { quads: 16, back: 16 }, weeklyLogged: { quads: 4, back: 4 },
  }),
}))

describe.skipIf(!canRun)('a re-fit and a review apply carry the finish marker to the store (#4147)', () => {
  let pool: import('pg').Pool
  let real: import('@/lib/data/repository').WorkoutRepository
  let push = '', legs = ''
  const plan = (): AiPrescription => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Steady week.', confidence: 0.8,
    estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, durationPreset: 'standard',
    refitBaseline: { sets: { [SQUAT]: 5, [ROW]: 5 }, reasoning: 'Steady week.' },
    exercises: [
      { sessionExerciseId: SQUAT, name: 'Squat', sets: 4, reps: 8, pct: 70, restSec: 120 },
      { sessionExerciseId: ROW, name: 'Row', sets: 4, reps: 10, pct: 65, restSec: 90 },
    ],
  } as AiPrescription)
  const put = (session: string) => pool.query(
    `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='accepted', prescription_generated_at=now(), prescription_expires_at=now() + interval '5 days'
      WHERE user_id=$1 AND program_session_id=$2`, [USER, session, JSON.stringify(plan())])
  const row = async (session: string) => (await pool.query(
    `SELECT prescription, prescription_status, prescription_expires_at, phase FROM session_periodization WHERE user_id=$1 AND program_session_id=$2`, [USER, session])).rows[0]
  const finish = (session: string) => pool.query(
    `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Finish 4147', now() - interval '2 hours', now() - interval '1 hour')`, [USER, session])
  /** The repository as `main` read it: no marker in the snapshot, so nothing is passed to the store. */
  const withoutMarker = () => ({
    ...real,
    getActiveProgramWithStructureStamp: async (u: string, s: string) => { const { finishMarker: _m, ...rest } = await real.getActiveProgramWithStructureStamp(u, s); return rest },
    getSessionPeriodization: (u: string, s: string) => real.getSessionPeriodization(u, s),
    storePrescription: (...a: Parameters<typeof real.storePrescription>) => real.storePrescription(...a),
    updatePrescriptionStatus: (...a: Parameters<typeof real.updatePrescriptionStatus>) => real.updatePrescriptionStatus(...a),
  }) as unknown as import('@/lib/data/repository').WorkoutRepository
  /** The real repository, with a workout finished right after `after` returns: the window between the read and the store. */
  const finishingAfter = (after: 'plan' | 'second-stamp', session: string) => {
    let stamps = 0
    return {
      ...real,
      getActiveProgramWithStructureStamp: async (u: string, s: string) => {
        const out = await real.getActiveProgramWithStructureStamp(u, s)
        stamps++
        if (after === 'second-stamp' && stamps === 2) await finish(session)
        return out
      },
      getSessionPeriodization: async (u: string, s: string) => {
        const out = await real.getSessionPeriodization(u, s)
        if (after === 'plan') await finish(session)
        return out
      },
      storePrescription: (...a: Parameters<typeof real.storePrescription>) => real.storePrescription(...a),
      updatePrescriptionStatus: (...a: Parameters<typeof real.updatePrescriptionStatus>) => real.updatePrescriptionStatus(...a),
      removeSessionExercise: (...a: Parameters<typeof real.removeSessionExercise>) => real.removeSessionExercise(...a),
      getActiveProgram: (u: string) => real.getActiveProgram(u),
    } as unknown as import('@/lib/data/repository').WorkoutRepository
  }
  const applyBody = { adjustments: [{ sessionExerciseId: SQUAT, sets: 3, reps: 8, pct: 70, restSec: 120 }], dropThisCycle: [], dropPermanent: [], estimatedSessionDurationMin: 33, reasoning: 'Review.' }
  const callApply = async (session: string) => {
    const { POST } = await import('@/app/api/workout-review/session/[sessionId]/apply/route')
    const req = new Request('http://localhost/api/workout-review/session/x/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(applyBody) })
    return POST(req as never, { params: Promise.resolve({ sessionId: session }) })
  }
  const strip = (r: Record<string, unknown>) => JSON.stringify({ ...r, prescription_expires_at: undefined })

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    real = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'finish-4147@example.com','x','UTC')`, [USER])
    const program = (await pool.query(`INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal) VALUES ($1,'Finish 4147','ai_dynamic',true,'hypertrophy') RETURNING id`, [USER])).rows[0].id
    const mk = async (n: string, pos: number) => (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,$2,$3,60) RETURNING id`, [program, n, pos])).rows[0].id as string
    push = await mk('Push', 0); legs = await mk('Legs', 1)
    for (const sid of [push, legs]) await pool.query(`INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status) VALUES ($1,$2,'accumulation',2,true,'consumed')`, [USER, sid])
    for (const [sid, id] of [[push, SQUAT], [push, ROW]] as const) {
      await pool.query(`INSERT INTO session_exercises (id, session_id, exercise_name, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary','{quads}')`, [id, sid, id === SQUAT ? 'Squat' : 'Row', id === SQUAT ? 0 : 1])
    }
  })
  afterAll(async () => { await pool?.query(`DELETE FROM users WHERE id = $1`, [USER]) })

  describe('the re-fit', () => {
    it('a finish between the plan read and the store: nothing is stored', async () => {
      const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
      await put(push)
      const before = await row(push)
      const res = await refitPrescriptionToBudget(USER, push, finishingAfter('plan', push), 'UTC', 'short')
      expect(res).toEqual({ ok: false, reason: 'session_changed' })
      expect(strip(await row(push))).toBe(strip(before))
    })
    it('a finish of the other session type, or before the read: stored', async () => {
      const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
      await put(push)
      await finish(legs)
      const res = await refitPrescriptionToBudget(USER, push, real, 'UTC', 'short')
      expect(res.ok).toBe(true)
    })
    it('no finish meanwhile: the stored row is byte-identical to the store without the marker', async () => {
      const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
      for (const preset of ['short', 'long', 'standard'] as const) {
        await put(push)
        const a = await refitPrescriptionToBudget(USER, push, withoutMarker(), 'UTC', preset)
        const main = await row(push)
        await put(push)
        const b = await refitPrescriptionToBudget(USER, push, real, 'UTC', preset)
        const now = await row(push)
        expect(a.ok && b.ok, preset).toBe(true)
        expect(JSON.stringify(b), preset).toBe(JSON.stringify(a))
        expect(strip(now), preset).toBe(strip(main))
      }
    })
  })

  describe('the review apply', () => {
    it('a finish between the read and the store: 409, nothing is stored', async () => {
      await put(push)
      const before = await row(push)
      seam.repo = finishingAfter('second-stamp', push) as unknown as Record<string, unknown>
      const res = await callApply(push)
      expect(res.status).toBe(409)
      expect(strip(await row(push))).toBe(strip(before))
    })
    it('no finish meanwhile: the stored row is byte-identical to the store without the marker', async () => {
      // The finish rows of the case above are before this read, so the marker covers them.
      await put(push)
      seam.repo = withoutMarker() as unknown as Record<string, unknown>
      const a = await callApply(push)
      const main = await row(push)
      await put(push)
      seam.repo = real as unknown as Record<string, unknown>
      const b = await callApply(push)
      const now = await row(push)
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(await b.json()).toEqual(await a.json())
      expect(strip(now)).toBe(strip(main))
    })
  })
})
