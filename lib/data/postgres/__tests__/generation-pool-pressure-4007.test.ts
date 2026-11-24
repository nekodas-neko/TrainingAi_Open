/**
 * #4007, second review: the generation's store must not run the connection pool dry while it holds the lift lock.
 *
 * The store's transaction holds one pooled connection and the person's lift lock. When it used to restate a plan for
 * preferences that moved, it read the last bars, records and estimates on OTHER pooled connections. With as many stores
 * running at once as the pool has connections, every one of them waited for a connection that never freed: the reads
 * failed after the pool's 5 s `connectionTimeoutMillis`, the plan was stored as generated and the person's change was lost.
 * Those reads are now made before the lock is taken, and the restate inside it is a pure function.
 *
 * Real Postgres, real Coach writer, mocked model (0 real model requests). Made-up names only. Runs only against a real
 * Postgres (DATABASE_URL). The pool is `PG_POOL_MAX` wide (it can only lower the default of 10), so each size is run
 * with a fresh module registry and its own pool.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import pg from 'pg'
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const mocks = vi.hoisted(() => ({
  answers: [] as { userId: string; answer: unknown }[],
  started: 0,
  release: null as null | Promise<void>,
  onStart: null as null | (() => void),
}))
vi.mock('@/lib/ai/instrument', () => ({
  loggedGenerateObject: async (args: unknown) => {
    const who = (args as { userId?: string } | undefined)?.userId
    const mine = mocks.answers.find(a => a.userId === who)
    mocks.started++
    mocks.onStart?.()
    await mocks.release
    if (!mine) throw new Error('no model answer for this prompt (test)')
    return { object: structuredClone(mine.answer) }
  },
}))

/** Measurements: printed, and appended to the file named by MEASURE_OUT when it is set (vitest's console is quiet for a passing test). */
const report = (line: string) => { console.info(line); if (process.env.MEASURE_OUT) appendFileSync(process.env.MEASURE_OUT, line + '\n') }

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const LIFT = 'P4007 Cable Row'
const ANCHOR = 'P4007 Back Squat'
const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)

interface Person { id: string; session: string; slot: Record<string, string> }

/** The statements issued on each backend while `watch` is set, by pid. */
const seen = { watch: false, byPid: new Map<number, string[]>() }
const realQuery = pg.Client.prototype.query
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(pg.Client.prototype as any).query = function (this: pg.Client, ...args: unknown[]) {
  if (seen.watch) {
    const first = args[0] as string | { text?: string }
    const text = typeof first === 'string' ? first : first?.text ?? ''
    const pid = (this as unknown as { processID: number }).processID
    seen.byPid.set(pid, [...(seen.byPid.get(pid) ?? []), text.slice(0, 80)])
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (realQuery as any).apply(this, args)
}
afterAll(() => { pg.Client.prototype.query = realQuery })

describe.skipIf(!canRun).each([3, 10])('the store on a pool of %i connections (#4007)', size => {
  let pool: pg.Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let repo: import('@/lib/data/repository').WorkoutRepository
  let generate: typeof import('@trainingai/shared/ai-periodization/generate-prescription').generatePrescriptionForSession
  let apply: typeof import('@/lib/coach/apply')
  const users: string[] = []
  const libIds: string[] = []
  const lib: Record<string, string> = {}

  const model = (slot: Person['slot']) => ({
    phase: 'accumulation', phase_action: 'stay', deload: false, reasoning: 'test plan',
    exercises: [
      { session_exercise_id: slot[ANCHOR], name: ANCHOR, sets: 4, reps: 5, pct: 75, rest_sec: 180 },
      { session_exercise_id: slot[LIFT], name: LIFT, sets: 3, reps: 8, pct: 70, rest_sec: 120 },
    ],
  })

  const person = async (): Promise<Person> => {
    const id = randomUUID()
    users.push(id)
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [id, `p4007-${id}@example.com`, TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at)
       VALUES ($1,'Pool 4007','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [id])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position, time_budget_minutes) VALUES ($1,'Upper P4007',0,75) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,0,$2)`, [schedule, session])
    const slot: Record<string, string> = {}
    let pos = 0
    for (const [name, role, muscles] of [[ANCHOR, 'primary', ['quadriceps']], [LIFT, 'primary', ['back']]] as const) {
      slot[name] = (await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, lib[name], pos++, role, muscles])).rows[0].id
    }
    for (const [name, rm] of [[ANCHOR, 140], [LIFT, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [id, name, lib[name], rm])
    }
    // One finished session with logged sets, so the last-bar and last-1RM reads have rows to return.
    const ws = (await pool.query(
      `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Upper P4007',$3,$4) RETURNING id`,
      [id, session, local(0, 12), local(0, 13)])).rows[0].id
    for (const name of [ANCHOR, LIFT]) {
      const el = (await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
        [ws, name, lib[name], local(0, 12.5)])).rows[0].id
      for (let n = 1; n <= 3; n++) {
        await pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
           VALUES ($1,$2,60,5,5,60,75,150,150)`, [el, n])
      }
    }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, sessions_in_phase, baseline_complete, prescription, prescription_status)
       VALUES ($1,$2,'accumulation',2,true,NULL,'consumed')`, [id, session])
    mocks.answers.push({ userId: id, answer: model(slot) })
    return { id, session, slot }
  }

  const coachRange = (p: Person) =>
    apply.applyCoachPatch(db, p.id, { domain: 'lift_preference', targetId: p.slot[LIFT], changes: [{ id: 'c1', field: 'repRange', from: null, to: '12-15' }] } as never, ['c1'], '2026-11-22', TZ)
  const storedRow = async (p: Person) => {
    const plan = (await pool.query(`SELECT prescription FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [p.id, p.session])).rows[0]?.prescription
    return plan?.exercises?.find((e: { name: string }) => e.name === LIFT) as { reps: number; restSec: number } | undefined
  }

  /**
   * The restate's four reads, 100 ms slower than the database answers them (a loaded database or a long round trip). The
   * stores of one storm all start together, so on the old code each of them is already inside its transaction, holding a
   * connection and its lift lock, when the first of these reads asks for another connection.
   */
  const slowReads = () => new Proxy(repo, {
    get(target, key) {
      const v = Reflect.get(target, key, target)
      if (['getLastExerciseLogsBatch', 'listPersonalRecords', 'getLastRealOneRmBatch', 'getExerciseEstimates'].includes(String(key))) {
        return async (...args: unknown[]) => { await new Promise(r => setTimeout(r, 100)); return (v as (...x: unknown[]) => unknown).apply(target, args) }
      }
      return typeof v === 'function' ? v.bind(target) : v
    },
  })

  /** `count` people generate at once; each makes a rep-range change while the model answers; then every model call returns together. */
  const stormOf = async (count: number, change: (p: Person) => Promise<unknown> = coachRange) => {
    const people: Person[] = []
    for (let i = 0; i < count; i++) people.push(await person())
    mocks.started = 0
    let go!: () => void
    mocks.release = new Promise<void>(resolve => { go = resolve })
    const allStarted = new Promise<void>(resolve => { mocks.onStart = () => { if (mocks.started === count) resolve() } })
    const done: number[] = new Array(count).fill(0)
    let t0 = 0
    const runs = people.map((p, i) => generate(p.id, p.session, slowReads(), TZ).then(r => { done[i] = performance.now() - t0; return r }))
    runs.forEach(r => r.catch(() => undefined))
    await allStarted
    for (const p of people) expect(await change(p)).toMatchObject({ ok: true })
    t0 = performance.now()
    go()
    const results = await Promise.all(runs)
    mocks.release = null
    mocks.onStart = null
    return { people, results, durations: done }
  }
  const idleInTransaction = async () =>
    Number((await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'p4007-pool' AND state LIKE 'idle in transaction%'`)).rows[0].n)

  const setup = async () => {
    vi.resetModules()
    // Names this file's connections, so the idle-in-transaction count ignores other test files' transactions.
    process.env.PGAPPNAME = 'p4007-pool'
    // `PG_POOL_MAX` can only lower the pool below its default of 10.
    if (size < 10) process.env.PG_POOL_MAX = String(size); else delete process.env.PG_POOL_MAX
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    db = client.getDb()
    expect(pool.options.max).toBe(size)
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    generate = (await import('@trainingai/shared/ai-periodization/generate-prescription')).generatePrescriptionForSession
    apply = await import('@/lib/coach/apply')
    await pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [[ANCHOR, LIFT]])
    for (const [name, equipment, muscle] of [[ANCHOR, 'barbell', 'quads'], [LIFT, 'cable', 'back']]) {
      const id = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$2], $3::jsonb) RETURNING id`,
        [name, equipment, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id as string
      lib[name] = id
      libIds.push(id)
    }
  }
  const teardown = async () => {
    if (!pool) return
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [users])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[]) OR name = ANY($2)`, [libIds, [ANCHOR, LIFT]])
    await pool.end()
    const client = await import('@/lib/data/postgres/client')
    void client
  }

  it(`${size} people's changes made during the model call, ${size} stores at once on ${size} connections: every change kept, none slow, nothing left open`, async () => {
    await setup()
    try {
      const { people, results, durations } = await stormOf(size)
      expect(results.every(r => r.ok)).toBe(true)
      for (const p of people) {
        const row = await storedRow(p)
        expect(row?.reps, 'the rep range 12-15 is in the stored plan').toBeGreaterThanOrEqual(12)
      }
      report(`[4007] pool ${size}: ${size} stores at once, slowest request after the model returned: ${Math.max(...durations).toFixed(0)} ms`)
      expect(Math.max(...durations)).toBeLessThan(1000)
      expect(await idleInTransaction()).toBe(0)
    } finally { /* the pool is reused by the next tests of this size */ }
  }, 60_000)

  it(`${size + 1} stores at once on ${size} connections: all kept`, async () => {
    const { people, results, durations } = await stormOf(size + 1)
    expect(results.every(r => r.ok)).toBe(true)
    for (const p of people) expect((await storedRow(p))?.reps).toBeGreaterThanOrEqual(12)
    report(`[4007] pool ${size}: ${size + 1} stores at once, slowest: ${Math.max(...durations).toFixed(0)} ms`)
    expect(Math.max(...durations)).toBeLessThan(1000)
    expect(await idleInTransaction()).toBe(0)
  }, 60_000)

  it('while the store holds the lift lock, no statement runs on any connection but its own (moved and not moved)', async () => {
    for (const moved of [true, false]) {
      const proxied = new Proxy(repo, {
        get(target, key) {
          const v = Reflect.get(target, key, target)
          if (key === 'storePrescriptionForCurrentPreferences') {
            return async (...args: unknown[]) => {
              seen.byPid.clear()
              seen.watch = true
              try { return await (v as (...x: unknown[]) => unknown).apply(target, args) } finally { seen.watch = false }
            }
          }
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
      const p = await person()
      mocks.started = 0
      let go!: () => void
      mocks.release = new Promise<void>(resolve => { go = resolve })
      const started = new Promise<void>(resolve => { mocks.onStart = resolve })
      const run = generate(p.id, p.session, proxied, TZ)
      await started
      if (moved) expect(await coachRange(p)).toMatchObject({ ok: true })
      go()
      expect(await run).toMatchObject({ ok: true })
      mocks.release = null
      mocks.onStart = null
      const pids = [...seen.byPid.keys()]
      const statements = [...seen.byPid.values()].map(v => v.length)
      report(`[4007] pool ${size}, ${moved ? 'moved' : 'not moved'}: statements inside the store, by backend: ${JSON.stringify(Object.fromEntries(seen.byPid))}`)
      expect(pids, 'every statement of the locked section runs on one backend').toHaveLength(1)
      expect(statements[0]).toBeGreaterThan(0)
      if (moved) expect((await storedRow(p))?.reps).toBeGreaterThanOrEqual(12)
    }
  }, 60_000)

  afterAll(teardown)
})
