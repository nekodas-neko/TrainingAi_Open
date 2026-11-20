// #3895 — a Coach change to a session's exercise voids that session's stored AI plan, as the
// program editor's save does (`clearProgramPrescriptions`). Before, a swap applied but the stored
// plan kept driving the bar for that slot until it expired. Under the AI plan the Coach also no
// longer applies a progression-style change, which reaches nothing there, nor claims it takes effect.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000003895'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))
// The workout-data read must not start a real generation; only whether the old plan is served counts.
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: vi.fn(),
}))

describe.skipIf(!canRun)('a Coach change voids the stored AI plan (#3895)', () => {
  let pool: import('pg').Pool
  let db: typeof import('@/lib/data/postgres/client').getDb extends () => infer T ? T : never
  let apply: typeof import('@/lib/coach/apply').applyCoachPatch
  let undo: typeof import('@/lib/coach/apply').undoCoachChange
  let handler: typeof import('@/lib/coach/domains/session-exercise').sessionExerciseHandler
  let workoutData: typeof import('@/app/api/workout-data/route').GET
  let programId: string, sessionId: string, squatId: string, styleId: string

  const plan = () => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.', source: 'model',
    estimatedSessionDurationMin: 55, weeklyVolumeContribution: {}, confidence: 0.7,
    confidenceReasons: [], droppedExerciseIds: [],
    exercises: [{ sessionExerciseId: squatId, name: 'C3895 Squat', sets: 7, reps: 3, pct: 80, restSec: 180 }],
  })
  const stored = async () => (await pool.query(
    'SELECT prescription, prescription_status FROM session_periodization WHERE user_id=$1 AND program_session_id=$2',
    [USER, sessionId])).rows[0]
  const served = async () => {
    const res = await workoutData(Object.assign(new Request('http://localhost/api/workout-data?tab=all'), {
      nextUrl: { pathname: '/api/workout-data' },
    }) as never)
    expect(res.status).toBe(200)
    const body = await res.json() as { perSession: Record<string, { prescriptionSource?: string }> }
    return body.perSession[sessionId]
  }
  const swap = (from: string, to: string) => ({
    domain: 'session_exercise' as const, targetId: squatId,
    changes: [{ id: 'c1', field: 'exerciseName' as const, from, to }],
  })

  beforeAll(async () => {
    const { getPool, getDb } = await import('@/lib/data/postgres/client')
    pool = getPool(); db = getDb()
    ;({ applyCoachPatch: apply, undoCoachChange: undo } = await import('@/lib/coach/apply'))
    handler = (await import('@/lib/coach/domains/session-exercise')).sessionExerciseHandler
    workoutData = (await import('@/app/api/workout-data/route')).GET
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3) ON CONFLICT (id) DO NOTHING`,
      [USER, `c3895-${USER}@example.com`, TZ])
    await pool.query(
      `INSERT INTO exercise_library (name, muscles, equipment) VALUES ('C3895 Front Squat', $1::jsonb, ARRAY['barbell'])
       ON CONFLICT (name) DO NOTHING`, [JSON.stringify([{ muscle: 'quads', role: 'main' }])])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM coach_changes WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM session_periodization WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM programs WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM phase_sets WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM progression_styles WHERE user_id=$1', [USER])
    await pool.query(`DELETE FROM exercise_library WHERE name = 'C3895 Jefferson Curl'`)
    programId = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active) VALUES ($1,'C3895 Program','ai_dynamic',true) RETURNING id`,
      [USER])).rows[0].id
    sessionId = (await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'C3895 Lower',0) RETURNING id`,
      [programId])).rows[0].id
    squatId = (await pool.query(
      `INSERT INTO session_exercises (session_id, exercise_name, position, muscle_groups, exercise_role)
       VALUES ($1,'C3895 Squat',0,ARRAY['quads'],'primary') RETURNING id`, [sessionId])).rows[0].id
    styleId = (await pool.query(
      `INSERT INTO progression_styles (user_id, name) VALUES ($1,'C3895 Style') RETURNING id`, [USER])).rows[0].id
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete,
         prescription, prescription_status, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,'accumulation',1,true,$3::jsonb,'accepted',now(),now() + interval '3 days')`,
      [USER, sessionId, JSON.stringify(plan())])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM coach_changes WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM session_periodization WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM programs WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM phase_sets WHERE user_id=$1', [USER])
    await pool.query('DELETE FROM progression_styles WHERE user_id=$1', [USER])
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE 'C3895 %'`)
    await pool.query('DELETE FROM users WHERE id=$1', [USER])
  })

  it('a swap on a slot with a stored plan: the next workout-data response does not use the old plan', async () => {
    // The stored plan drives the session before the swap.
    expect((await served()).prescriptionSource).toBe('model')

    const res = await apply(db, USER, swap('C3895 Squat', 'C3895 Front Squat') as never, ['c1'])
    expect(res.ok).toBe(true)

    const row = await stored()
    expect(row.prescription).toBeNull()
    expect(row.prescription_status).toBe('consumed')
    expect((await served()).prescriptionSource).toBeUndefined()
  })

  it('undo still restores the exercise, and voids a plan made for the swapped session', async () => {
    const res = await apply(db, USER, swap('C3895 Squat', 'C3895 Front Squat') as never, ['c1'])
    if (!res.ok) throw new Error('apply refused')
    // A plan regenerated between the apply and the undo was made for the Front Squat session.
    await pool.query(
      `UPDATE session_periodization SET prescription=$3::jsonb, prescription_status='accepted' WHERE user_id=$1 AND program_session_id=$2`,
      [USER, sessionId, JSON.stringify(plan())])

    expect((await undo(db, USER, res.changeId)).ok).toBe(true)
    const { rows } = await pool.query('SELECT exercise_name FROM session_exercises WHERE id=$1', [squatId])
    expect(rows[0].exercise_name).toBe('C3895 Squat')
    expect((await stored()).prescription).toBeNull()
  })

  it('refuses a progression-style change under the AI plan, and the card claims no effect', async () => {
    const patch = {
      domain: 'session_exercise' as const, targetId: squatId,
      changes: [{ id: 'c1', field: 'styleId' as const, from: null, to: styleId }],
    }
    const preview = await handler.preview(db, USER, patch as never)
    expect(preview.consequences.some(c => /Takes effect/.test(c.text))).toBe(false)
    expect(preview.consequences.some(c => /not used while the AI plan is on/.test(c.text))).toBe(true)

    const res = await apply(db, USER, patch as never, ['c1'])
    expect(res).toMatchObject({ ok: false, reason: 'invalid' })
    // Refused means nothing written, the stored plan included.
    expect((await pool.query('SELECT style_id FROM session_exercises WHERE id=$1', [squatId])).rows[0].style_id).toBeNull()
    expect((await stored()).prescription).not.toBeNull()
  })

  it('still applies a style change on a manual program, and says it takes effect', async () => {
    await pool.query(`UPDATE programs SET phase_mode='manual' WHERE id=$1`, [programId])
    const patch = {
      domain: 'session_exercise' as const, targetId: squatId,
      changes: [{ id: 'c1', field: 'styleId' as const, from: null, to: styleId }],
    }
    const preview = await handler.preview(db, USER, patch as never)
    expect(preview.consequences.some(c => /Takes effect/.test(c.text))).toBe(true)
    expect((await apply(db, USER, patch as never, ['c1'])).ok).toBe(true)
  })

  it('says a style change does nothing for a primary lift while phases run automatically', async () => {
    await pool.query(`UPDATE programs SET phase_mode='automatic' WHERE id=$1`, [programId])
    const preview = await handler.preview(db, USER, {
      domain: 'session_exercise', targetId: squatId,
      changes: [{ id: 'c1', field: 'styleId', from: null, to: styleId }],
    } as never)
    expect(preview.consequences.some(c => /Takes effect/.test(c.text))).toBe(false)
    expect(preview.consequences.some(c => /phase's progression style is used/.test(c.text))).toBe(true)
  })

  // #3895 review: the void used to race a generation already running. Apply voids the plan; the
  // lifter opens Home and a generation starts, reading the swapped session; they tap Undo while it
  // runs. Its plan, made for the swapped lift, must not be stored after the undo's void.
  describe('a generation that read the session before a change stores nothing', () => {
    const generatedFor = async () => {
      const [r] = (await pool.query(
        'SELECT phase, phase_started_at FROM session_periodization WHERE user_id=$1 AND program_session_id=$2',
        [USER, sessionId])).rows
      const { getSessionStructureStamp } = await import('@/lib/data/postgres/slices/periodization')
      return { phase: r.phase, phaseStartedAt: r.phase_started_at as Date, structure: await getSessionStructureStamp(db, USER, sessionId) }
    }
    const store = async (made: Awaited<ReturnType<typeof generatedFor>>) => {
      const { storePrescription } = await import('@/lib/data/postgres/slices/periodization')
      return storePrescription(db, USER, sessionId, plan() as never, new Date(Date.now() + 7 * 86_400_000), 'pending', made)
    }

    it('Coach: a generation started between the apply and its undo leaves the slot voided', async () => {
      const res = await apply(db, USER, swap('C3895 Squat', 'C3895 Front Squat') as never, ['c1'])
      if (!res.ok) throw new Error('apply refused')
      const made = await generatedFor() // the generation starts on the swapped session
      expect((await undo(db, USER, res.changeId)).ok).toBe(true)

      expect(await store(made)).toBe(false)
      const row = await stored()
      expect(row.prescription).toBeNull()
      expect(row.prescription_status).toBe('consumed')
    })

    it('Coach: a generation started before the apply is not stored after it', async () => {
      const made = await generatedFor()
      expect((await apply(db, USER, swap('C3895 Squat', 'C3895 Front Squat') as never, ['c1'])).ok).toBe(true)
      expect(await store(made)).toBe(false)
      expect((await stored()).prescription).toBeNull()
    })

    it('editor: a generation started before the program save is not stored after its void', async () => {
      const { getRepository } = await import('@/lib/data')
      const repo = await getRepository()
      const made = await generatedFor()
      const program = await repo.getActiveProgram(USER)
      if (!program) throw new Error('no active program')
      const session = program.sessions.find(x => x.id === sessionId)!
      session.exercises = session.exercises.map(e => (e.id === squatId ? { ...e, exerciseName: 'C3895 Front Squat' } : e))
      await repo.saveProgram(USER, program)
      await repo.clearProgramPrescriptions(USER, programId)

      expect(await store(made)).toBe(false)
      const row = await stored()
      expect(row.prescription).toBeNull()
      expect(row.prescription_status).toBe('consumed')
    })

    it('stores the plan when nothing changed while it was made', async () => {
      const made = await generatedFor()
      // A write that changes nothing the plan reads (only `updated_at`) does not void it.
      await pool.query('UPDATE session_exercises SET updated_at = now() WHERE id=$1', [squatId])
      expect(await store(made)).toBe(true)
      expect((await stored()).prescription_status).toBe('pending')
    })

    it('reads no stamp for another user\'s session', async () => {
      const { getSessionStructureStamp } = await import('@/lib/data/postgres/slices/periodization')
      expect(await getSessionStructureStamp(db, '00000000-0000-4000-8000-0000000038ff', sessionId)).toBeNull()
    })
  })

  it('a refused style change leaves no new exercise behind, though it came with a swap to one', async () => {
    const patch = {
      domain: 'session_exercise' as const, targetId: squatId,
      changes: [
        { id: 'c1', field: 'exerciseName' as const, from: 'C3895 Squat', to: 'C3895 Jefferson Curl' },
        { id: 'c2', field: 'newExerciseMuscles' as const, from: null, to: 'Hamstrings' },
        { id: 'c3', field: 'styleId' as const, from: null, to: styleId },
      ],
    }
    // Only an admin can add to the shared library, so only an admin's refused change could leave one.
    await pool.query('UPDATE users SET is_admin = true WHERE id=$1', [USER])
    try {
      expect(await apply(db, USER, patch as never, ['c1', 'c2', 'c3'])).toMatchObject({ ok: false, reason: 'invalid' })
    } finally {
      await pool.query('UPDATE users SET is_admin = false WHERE id=$1', [USER])
    }
    expect((await pool.query(`SELECT 1 FROM exercise_library WHERE name = 'C3895 Jefferson Curl'`)).rowCount).toBe(0)
  })

  it('an accessory whose Accessory phase has its own style: no "Takes effect" while phases run automatically', async () => {
    const setId = (await pool.query(
      `INSERT INTO phase_sets (user_id, name) VALUES ($1,'C3895 Phases') RETURNING id`, [USER])).rows[0].id
    await pool.query(
      `INSERT INTO program_phases (phase_set_id, position, name, duration_cycles, phase_type, primary_style_id)
       VALUES ($1,0,'Accessory',1,'accessory',$2)`, [setId, styleId])
    await pool.query(`UPDATE programs SET phase_mode='automatic', phase_set_id=$2 WHERE id=$1`, [programId, setId])
    await pool.query(`UPDATE session_exercises SET exercise_role='accessory' WHERE id=$1`, [squatId])
    const preview = () => handler.preview(db, USER, {
      domain: 'session_exercise', targetId: squatId,
      changes: [{ id: 'c1', field: 'styleId', from: null, to: styleId }],
    } as never)
    const styled = await preview()
    expect(styled.consequences.some(c => /Takes effect/.test(c.text))).toBe(false)
    expect(styled.consequences.some(c => /Accessory phase's progression style is used/.test(c.text))).toBe(true)

    // With no style on the Accessory phase, the accessory keeps its own, so the change does reach it.
    await pool.query('UPDATE program_phases SET primary_style_id = NULL WHERE phase_set_id=$1', [setId])
    expect((await preview()).consequences.some(c => /Takes effect/.test(c.text))).toBe(true)
  })

  it('says on the card that the plan is rebuilt, and that undo does not bring the old plan back', async () => {
    const preview = await handler.preview(db, USER, swap('C3895 Squat', 'C3895 Front Squat') as never)
    expect(preview.consequences.some(c => /Your plan for this session will be rebuilt/.test(c.text))).toBe(true)
  })
})
