/**
 * LB-111 — the windowed per-muscle set read.
 *
 * The case this file exists for is the PROGRAMME CHANGE: `getWeeklySetsByMuscleGroup`, the method
 * the entry assumed could be widened, scopes to one `programId`, so a span crossing a programme
 * boundary silently loses half its sets. Every other case here is a guard around that one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL

const ME = '00000000-0000-4000-8000-0000000000f1'
const TZ = 'Australia/Brisbane'

let sessionUser: { id: string; timezone?: string } | null = { id: ME, timezone: TZ }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))

describe.skipIf(!canRun)('muscle-sets window — sets per muscle over an arbitrary span', () => {
  let pool: import('pg').Pool
  let GET: typeof import('@/app/api/muscle-sets/route').GET

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ GET } = await import('@/app/api/muscle-sets/route'))

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`, [ME, `msw-${ME}@example.com`, TZ])

    // Roles matter: 'secondary' is what the 0.5 weight hangs off. The second entry has no
    // secondary at all, so a test can isolate whole-weight counting.
    await pool.query(
      `INSERT INTO exercise_library (name, muscles) VALUES ('LB111 Bench', $1::jsonb), ('LB111 Row', $2::jsonb)
       ON CONFLICT (name) DO NOTHING`,
      [JSON.stringify([{ muscle: 'chest', role: 'main' }, { muscle: 'triceps', role: 'secondary' }]),
       JSON.stringify([{ muscle: 'lats', role: 'main' }])])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [ME])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [ME])
    await pool.query(`DELETE FROM users WHERE id = $1`, [ME])
    await pool.query(`DELETE FROM exercise_library WHERE name IN ('LB111 Bench', 'LB111 Row')`)
  })

  beforeEach(async () => {
    sessionUser = { id: ME, timezone: TZ }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [ME])
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [ME])
  })

  /** One session on `day`, one exercise, `sets` sets. `programId` is optional so a fixture can
   *  model training logged before any programme existed as well as under a named one. */
  const logged = async (day: string, exerciseName: string, sets: number, opts: {
    programId?: string; muscleGroups?: string[]
  } = {}) => {
    const at = new Date(`${day}T12:00:00+10:00`)
    const { rows: [ws] } = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, session_id)
       VALUES ($1, 'LB111', $2, $3) RETURNING id`,
      [ME, at, opts.programId ?? null])
    const { rows: [el] } = await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, muscle_groups, logged_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ws.id, exerciseName, opts.muscleGroups ?? [], at])
    for (let i = 1; i <= sets; i++) {
      await pool.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps) VALUES ($1, $2, 60, 10)`,
        [el.id, i])
    }
  }

  /** A programme with one session. Both ids are returned: workout_sessions points at the SESSION,
   *  while `getWeeklySetsByMuscleGroup` scopes by the PROGRAMME — which is the whole difference. */
  const programSession = async (name: string) => {
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name) VALUES ($1, $2) RETURNING id`, [ME, name])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'Upper', 0) RETURNING id`,
      [p.id])
    return { programId: p.id as string, sessionId: ps.id as string }
  }

  const call = async (qs = '') =>
    GET(new Request(`http://localhost/api/muscle-sets${qs}`))
  const body = async (qs = '') => (await (await call(qs)).json()) as {
    from: string; to: string; muscles: { muscle: string; sets: number }[]
  }
  const setsFor = async (muscle: string, qs = '') =>
    (await body(qs)).muscles.find(m => m.muscle === muscle)?.sets

  const today = () => todayInTz(TZ)

  it('refuses without a session', async () => {
    sessionUser = null
    expect((await call()).status).toBe(401)
  })

  /**
   * THE case. Two programmes, one window, and the sets logged under the older programme must not
   * vanish — which is exactly what `getWeeklySetsByMuscleGroup`'s `programId` scope would do. The
   * two sessions sit 40 days apart so no week-shaped query could return both either.
   */
  it('counts sets logged under a previous programme', async () => {
    const oldProgram = await programSession('LB111 Old')
    const newProgram = await programSession('LB111 New')
    await logged(shiftDateStr(today(), -40), 'LB111 Row', 4, { programId: oldProgram.sessionId })
    await logged(shiftDateStr(today(), -2), 'LB111 Row', 3, { programId: newProgram.sessionId })

    expect(await setsFor('lats', `?from=${shiftDateStr(today(), -60)}&to=${today()}`)).toBe(7)
  })

  /**
   * The negative half of the case above, and the reason this is a new method rather than a `from`
   * and `to` on the existing one. LB-111 proposed widening `getWeeklySetsByMuscleGroup`, which
   * already accepts arbitrary dates — so nothing in the entry says why that would not work. This is
   * why: on the SAME fixture and the SAME span it returns only the current programme's 3 sets,
   * because its `programId` scope drops everything logged under the previous one.
   *
   * That behaviour is correct for its two callers, which grade a week against that programme's
   * targets, so this asserts it rather than treating it as a defect. It is pinned here because the
   * next session to read LB-111 will have the same idea.
   */
  it('is not what getWeeklySetsByMuscleGroup would have returned', async () => {
    const oldProgram = await programSession('LB111 Old')
    const newProgram = await programSession('LB111 New')
    await logged(shiftDateStr(today(), -40), 'LB111 Row', 4, { programId: oldProgram.sessionId })
    await logged(shiftDateStr(today(), -2), 'LB111 Row', 3, { programId: newProgram.sessionId })

    const repo = await (await import('@/lib/data')).getRepositoryAsync()
    const from = shiftDateStr(today(), -60)
    const scoped = await repo.getWeeklySetsByMuscleGroup(ME, newProgram.programId, from, today(), TZ)
    const unscoped = await repo.getSetsByMuscleInWindow(ME, from, today(), TZ)

    expect(scoped.lats).toBe(3)
    expect(unscoped.lats).toBe(7)
  })

  it('weights a secondary muscle at half a set', async () => {
    await logged(today(), 'LB111 Bench', 4)

    expect(await setsFor('chest')).toBe(4)
    expect(await setsFor('triceps')).toBe(2)
  })

  /**
   * `to` is inclusive and `from` is a floor — asserted from BOTH sides, because a window that is
   * wrong by one day at one edge still passes a test that only checks the other.
   */
  it('includes both named days and excludes what falls outside them', async () => {
    await logged(shiftDateStr(today(), -10), 'LB111 Row', 1)   // before `from`
    await logged(shiftDateStr(today(), -5), 'LB111 Row', 2)    // the `from` day itself
    await logged(shiftDateStr(today(), -3), 'LB111 Row', 4)    // inside
    await logged(today(), 'LB111 Row', 8)                      // the `to` day itself

    const qs = `?from=${shiftDateStr(today(), -5)}&to=${today()}`
    expect(await setsFor('lats', qs)).toBe(14)
  })

  it('folds synonyms to one canonical muscle', async () => {
    // An exercise with no library row falls through to `muscle_groups`, which is where the raw
    // spellings live — 'core' and 'abs' are the pair that used to paint one muscle as two rows.
    await logged(today(), 'LB111 Unlisted', 2, { muscleGroups: ['core'] })
    await logged(today(), 'LB111 Unlisted Too', 3, { muscleGroups: ['abs'] })

    const rows = (await body()).muscles.filter(m => m.muscle === 'abs')
    expect(rows).toHaveLength(1)
    expect(rows[0].sets).toBe(5)
  })

  /**
   * The deliberately equivalent control: the default window and the same window named explicitly
   * must return the same answer. Without it, a change that broke the defaulting would still pass
   * every case above, since they all pass dates.
   */
  it('defaults to the same 90-day window an explicit request would name', async () => {
    await logged(shiftDateStr(today(), -30), 'LB111 Row', 5)

    const explicit = await body(`?from=${shiftDateStr(today(), -89)}&to=${today()}`)
    const defaulted = await body()

    expect(defaulted.from).toBe(explicit.from)
    expect(defaulted.to).toBe(explicit.to)
    expect(defaulted.muscles).toEqual(explicit.muscles)
  })

  // The client's `localDateString()` emits slashes, so a dash-only schema would reject every real
  // request before the handler ran — invisible until a caller fills the param from that helper.
  it('accepts the slash form the client actually sends', async () => {
    await logged(today(), 'LB111 Row', 2)

    const res = await call(`?from=${today().replace(/-/g, '/')}&to=${today().replace(/-/g, '/')}`)
    expect(res.status).toBe(200)
    expect((await res.json()).muscles[0]).toEqual({ muscle: 'lats', sets: 2 })
  })

  // Date-SHAPED but not a real day. Left to the driver this is [pg 22008] — a client error
  // recorded as a server fault.
  it('answers 400 rather than 500 for a date that is not a real day', async () => {
    expect((await call('?from=2026-02-31&to=2026-03-01')).status).toBe(400)
  })

  it('rejects a reversed window', async () => {
    expect((await call(`?from=${today()}&to=${shiftDateStr(today(), -5)}`)).status).toBe(400)
  })

  it('rejects a window longer than the cap', async () => {
    expect((await call(`?from=${shiftDateStr(today(), -500)}&to=${today()}`)).status).toBe(400)
  })

  it('answers no-store', async () => {
    expect((await call()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
