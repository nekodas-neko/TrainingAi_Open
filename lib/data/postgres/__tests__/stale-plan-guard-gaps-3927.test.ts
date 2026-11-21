// #3927 — the four gaps left in #3921's guard against storing a plan made for a session that has
// since changed (`coach-change-voids-stored-plan-3895.test.ts` has the guard itself):
//  1. the dedup cooldown answered a call made just after a change with the plan from before it;
//  2. the stamp and the program the plan was built from were read apart, so a change and its undo
//     landing between them stored a plan built from the changed session;
//  3. the stamp left out the program's goal and phase mode, which the plan is also written for;
//  4. the duration re-fit and the Workout Review apply stored with no guard at all.
//
// Generation runs for real against the local database. The model is mocked to fail, so each plan is
// the rules plan built from the session's own sets (0 Gemini calls), which names the exercises it was
// built from. Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type { WorkoutRepository } from '@/lib/data/repository'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003927'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
vi.mock('@/lib/ai/instrument', async orig => ({
  ...(await orig<typeof import('@/lib/ai/instrument')>()),
  aiModel: () => ({}),
  loggedGenerateObject: vi.fn(async () => { throw new Error('no model call in this test') }),
}))

// A change made at a chosen point of a read-then-write: after the generation has read the program
// (`ensureSessionPeriodization` follows that read) or just before the store.
const hooks: { afterEnsure?: () => Promise<unknown>; beforeStore?: () => Promise<unknown> } = {}
function hooked(real: WorkoutRepository): WorkoutRepository {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (prop === 'ensureSessionPeriodization') {
        return async (...args: unknown[]) => {
          const out = await value.apply(target, args)
          const hook = hooks.afterEnsure; hooks.afterEnsure = undefined
          if (hook) await hook()
          return out
        }
      }
      if (prop === 'storePrescription') {
        return async (...args: unknown[]) => {
          const hook = hooks.beforeStore; hooks.beforeStore = undefined
          if (hook) await hook()
          return value.apply(target, args)
        }
      }
      return value.bind(target)
    },
  })
}
vi.mock('@/lib/data', async orig => {
  const actual = await orig<typeof import('@/lib/data')>()
  const getRepository = async () => hooked(await actual.getRepository())
  return { ...actual, getRepository }
})

describe.skipIf(!canRun)('the stale-plan guard covers its four remaining gaps (#3927)', () => {
  let pool: import('pg').Pool
  let db: typeof import('@/lib/data/postgres/client').getDb extends () => infer T ? T : never
  let repo: WorkoutRepository
  let apply: typeof import('@/lib/coach/apply').applyCoachPatch
  let undo: typeof import('@/lib/coach/apply').undoCoachChange
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let programId: string, sessionId: string, squatId: string, styleId: string

  const stored = async () => (await pool.query(
    'SELECT prescription, prescription_status FROM session_periodization WHERE user_id=$1 AND program_session_id=$2',
    [USER, sessionId])).rows[0]
  const names = (p: { exercises: Array<{ name: string }> } | null | undefined) => (p?.exercises ?? []).map(e => e.name)
  const swap = (from: string, to: string) => ({
    domain: 'session_exercise' as const, targetId: squatId,
    changes: [{ id: 'c1', field: 'exerciseName' as const, from, to }],
  })
  const swapToFront = () => apply(db, USER, swap('C3927 Squat', 'C3927 Front Squat') as never, ['c1'])
  // A stored plan the lifter is looking at, as generation would leave it, with the re-fit's baseline.
  const storeLookedAtPlan = () => pool.query(
    `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='pending',
       prescription_generated_at=now() - interval '1 hour', prescription_expires_at=now() + interval '3 days'
     WHERE user_id=$1 AND program_session_id=$2`,
    [USER, sessionId, JSON.stringify({
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.', source: 'model',
      estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, confidence: 0.7,
      confidenceReasons: [], durationPreset: 'standard', sessionTimeBudgetMinutes: 60,
      exercises: [{ sessionExerciseId: squatId, name: 'C3927 Squat', sets: 3, reps: 5, pct: 75, restSec: 120 }],
      refitBaseline: { sets: { [squatId]: 3 }, reasoning: 'Keep going.' },
    })])

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    pool = getPool(); db = getDb()
    // Through the mocked `@/lib/data`, so the hooks above apply to it.
    repo = await (await import('@/lib/data')).getRepository()
    ;({ applyCoachPatch: apply, undoCoachChange: undo } = await import('@/lib/coach/apply'))
    generate = (await import('@trainingai/shared/ai-periodization/generate-prescription')).generatePrescriptionForSession
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
      [USER, `c3927-${USER}@example.com`, TZ])
    await pool.query(
      `INSERT INTO exercise_library (name, muscles, equipment) VALUES ('C3927 Front Squat', $1::jsonb, ARRAY['barbell'])
       ON CONFLICT (name) DO NOTHING`, [JSON.stringify([{ muscle: 'quads', role: 'main' }])])
  })

  beforeEach(async () => {
    hooks.afterEnsure = undefined; hooks.beforeStore = undefined
    await pool.query('DELETE FROM coach_changes WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM session_periodization WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM programs WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM progression_styles WHERE user_id=$1', [USER])
    programId = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active) VALUES ($1,'C3927 Program','ai_dynamic',true) RETURNING id`,
      [USER])).rows[0].id
    sessionId = (await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'C3927 Lower',0) RETURNING id`,
      [programId])).rows[0].id
    styleId = (await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1,'C3927 Style') RETURNING id`, [USER])).rows[0].id
    await pool.query(
      `INSERT INTO style_sets (style_id, set_number, pct, reps, rest_sec) VALUES ($1,1,75,5,120),($1,2,75,5,120),($1,3,75,5,120)`,
      [styleId])
    squatId = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, muscle_groups, exercise_role, style_id)
       VALUES ($1,'C3927 Squat',0,ARRAY['quads'],'primary',$2) RETURNING id`, [sessionId, styleId])).rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription_status)
       VALUES ($1,$2,'accumulation',1,true,'consumed')`, [USER, sessionId])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM coach_changes WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM session_periodization WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM programs WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM progression_styles WHERE user_id=$1', [USER])
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE 'C3927 %'`)
    await pool.query('DELETE FROM users WHERE id=$1', [USER])
  })

  it('1. a generation just after a Coach change is made for the changed session, not answered from the cooldown', async () => {
    const first = await generate(USER, sessionId, repo, TZ)
    if (!first.ok) throw new Error(`first generation failed: ${first.error}`)
    expect(names(first.prescription)).toEqual(['C3927 Squat'])

    expect((await swapToFront()).ok).toBe(true)
    const second = await generate(USER, sessionId, repo, TZ)
    if (!second.ok) throw new Error(`second generation failed: ${second.error}`)
    expect(names(second.prescription)).toEqual(['C3927 Front Squat'])
    expect(names((await stored()).prescription)).toEqual(['C3927 Front Squat'])
  })

  it('2. a change and its undo inside a generation do not store a plan built from the changed session', async () => {
    let changeId = ''
    // The apply lands after the generation has read the program; the undo just before its store.
    hooks.afterEnsure = async () => {
      const res = await swapToFront()
      if (!res.ok) throw new Error('apply refused')
      changeId = res.changeId
    }
    hooks.beforeStore = async () => expect((await undo(db, USER, changeId)).ok).toBe(true)

    await generate(USER, sessionId, repo, TZ)
    expect(changeId).not.toBe('')
    // The session is the squat again. A plan, if one is stored, is the squat's.
    expect(names((await stored()).prescription)).not.toContain('C3927 Front Squat')
  })

  describe('3. a program-level change the plan depends on stops a running generation from storing', () => {
    const generatedFor = async () => {
      const { getSessionStructureStamp } = await import('@/lib/data/postgres/slices/periodization')
      const [r] = (await pool.query(
        'SELECT phase, phase_started_at FROM session_periodization WHERE user_id=$1 AND program_session_id=$2',
        [USER, sessionId])).rows
      return { phase: r.phase, phaseStartedAt: r.phase_started_at as Date, structure: await getSessionStructureStamp(db, USER, sessionId) }
    }
    const plan = () => ({
      phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.', source: 'model',
      estimatedSessionDurationMin: 40, weeklyVolumeContribution: {}, confidence: 0.7, confidenceReasons: [],
      exercises: [{ sessionExerciseId: squatId, name: 'C3927 Squat', sets: 3, reps: 5, pct: 75, restSec: 120 }],
    })
    const store = async (made: Awaited<ReturnType<typeof generatedFor>>) => {
      const { storePrescription } = await import('@/lib/data/postgres/slices/periodization')
      return storePrescription(db, USER, sessionId, plan() as never, new Date(Date.now() + 7 * 86_400_000), 'pending', made)
    }

    it('the training goal', async () => {
      const made = await generatedFor()
      await pool.query(`UPDATE programs SET training_goal='hypertrophy' WHERE id=$1`, [programId])
      expect(await store(made)).toBe(false)
      expect((await stored()).prescription).toBeNull()
    })

    it('the phase mode', async () => {
      const made = await generatedFor()
      await pool.query(`UPDATE programs SET phase_mode='automatic' WHERE id=$1`, [programId])
      expect(await store(made)).toBe(false)
      expect((await stored()).prescription).toBeNull()
    })

    it('and still stores when the program is as it was', async () => {
      const made = await generatedFor()
      await pool.query(`UPDATE programs SET updated_at = now() WHERE id=$1`, [programId])
      expect(await store(made)).toBe(true)
    })
  })

  describe('4. the two other writers carry the same guard', () => {
    it('the duration re-fit does not write over a Coach change that voided the plan it re-fits', async () => {
      await storeLookedAtPlan()
      const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
      hooks.beforeStore = async () => expect((await swapToFront()).ok).toBe(true)

      const res = await refitPrescriptionToBudget(USER, sessionId, repo, TZ, 'short')
      expect(res.ok).toBe(false)
      const row = await stored()
      expect(row.prescription).toBeNull()
      expect(row.prescription_status).toBe('consumed')
    })

    it('the duration re-fit still stores when nothing changed', async () => {
      await storeLookedAtPlan()
      const { refitPrescriptionToBudget } = await import('@trainingai/shared/ai-periodization/refit-prescription')
      expect((await refitPrescriptionToBudget(USER, sessionId, repo, TZ, 'short')).ok).toBe(true)
      expect((await stored()).prescription_status).toBe('pending')
    })

    const review = async () => {
      const { POST } = await import('@/app/api/workout-review/session/[sessionId]/apply/route')
      return POST(new Request(`http://localhost/api/workout-review/session/${sessionId}/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adjustments: [{ sessionExerciseId: squatId, sets: 4, reps: 5, pct: 75, restSec: 120 }],
          estimatedSessionDurationMin: 45,
        }),
      }) as never, { params: Promise.resolve({ sessionId }) })
    }

    it('the Workout Review apply does not write over a Coach change that voided the slot', async () => {
      await storeLookedAtPlan()
      hooks.beforeStore = async () => expect((await swapToFront()).ok).toBe(true)

      const res = await review()
      expect(res.status).toBe(409)
      const row = await stored()
      expect(row.prescription).toBeNull()
      expect(row.prescription_status).toBe('consumed')
    })

    it('the Workout Review apply still stores and accepts when nothing changed', async () => {
      await storeLookedAtPlan()
      expect((await review()).status).toBe(200)
      const row = await stored()
      expect(row.prescription_status).toBe('accepted')
      expect(row.prescription.exercises[0].sets).toBe(4)
    })
  })
})
