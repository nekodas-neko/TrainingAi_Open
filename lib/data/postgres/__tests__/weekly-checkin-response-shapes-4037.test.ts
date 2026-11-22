// #4037: what the weekly check-in's routes return, built by the real engine against a real Postgres.
//   - Three responses are recorded: a GET state (a card due), a save outcome with every kind of row and
//     offer (a lowered lift, a stepped-up offer, a pain offer, a swap offer, days off, a shorter session),
//     and a save outcome with a held lift. Ids, dates and times are normalised (they differ per run);
//     everything else is compared to the committed JSON, so a field renamed, added or dropped by the engine
//     fails here, not on the phone. The committed JSON was recorded on `main` BEFORE the response types
//     moved into packages/shared, so it is the proof that no response changed.
//   - The raw responses are then parsed by the shared schema, which must give back exactly what the engine
//     sent: a field the schema does not name, or names with another shape, fails.
// No model is called. Runs only with DATABASE_URL. Fake users and lifts; the library rows it adds are
// removed by exact name before and after.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { dateStrMidnightInTz, daysBetweenDateStrs, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const A = '00000000-0000-4000-8000-0000004037a1'
const B = '00000000-0000-4000-8000-0000004037b2'
const SQ = 'Shape Squat 4037'
const BP = 'Shape Press 4037'
const ALT = 'Shape Alt Press 4037'
const NAMES = [SQ, BP, ALT]

const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Ids by order of first appearance, days as an offset from the reviewed week, times as one word. */
function normalise(value: unknown, seen = new Map<string, string>()): unknown {
  if (typeof value === 'string') {
    if (UUID.test(value)) {
      if (!seen.has(value)) seen.set(value, `<id ${seen.size + 1}>`)
      return seen.get(value)
    }
    if (STAMP.test(value)) return '<time>'
    if (DAY.test(value)) return `<week${daysBetweenDateStrs(W0, value) >= 0 ? '+' : ''}${daysBetweenDateStrs(W0, value)}d>`
    return value
  }
  if (Array.isArray(value)) return value.map(v => normalise(v, seen))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v, seen)]))
  return value
}

/**
 * A swap offer lists library exercises for the same muscles, so its names and ids depend on the database.
 * Its list is pinned by what a row carries (the keys) and whether it is empty; the shared schema checks
 * the real values.
 */
function pinAlternatives<T>(value: T): T {
  const copy = structuredClone(value) as { state?: unknown; checkin?: { offers: { kind: string; alternatives?: unknown }[] } | null }
  for (const s of [copy, copy.state as typeof copy | undefined]) {
    for (const o of s?.checkin?.offers ?? []) {
      if (o.kind !== 'swap' || !Array.isArray(o.alternatives)) continue
      o.alternatives = { nonEmpty: o.alternatives.length > 0, keys: Object.keys(o.alternatives[0] ?? {}).sort() }
    }
  }
  return copy as T
}

/**
 * The wire form, with a saved check-in's lift rows in name order: the database returns them in no fixed
 * order, which is not what is pinned here.
 */
function sortedLifts(value: unknown) {
  const wire = JSON.parse(JSON.stringify(value)) as { state?: unknown; checkin?: { lifts: { exerciseName: string }[] } | null }
  for (const s of [wire, wire.state as typeof wire | undefined]) s?.checkin?.lifts.sort((x, y) => x.exerciseName.localeCompare(y.exerciseName))
  return wire
}

describe.skipIf(!canRun)('the weekly check-in response shapes (#4037)', () => {
  let pool: import('pg').Pool
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let ctxFor: (user: string) => import('@/lib/weekly-checkin/engine').EngineCtx
  const ids = {} as Record<string, string>
  const raw = {} as { due: unknown; full: unknown; held: unknown }

  const seedUser = async (user: string, withMiss: boolean) => {
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [user, `weekly-checkin-shape-${user}@example.com`, TZ])
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Shape test','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [user])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day 4037',0) RETURNING id`, [program])).rows[0].id
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const day of [0, 1, 2]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, session])
    const ex = async (name: string, pos: number, muscle: string) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,'primary',$5) RETURNING id`,
        [session, name, ids[`lib:${name}`], pos, [muscle]])).rows[0].id as string
    const sq = await ex(SQ, 0, 'quadriceps')
    const bp = await ex(BP, 1, 'chest')
    for (const [name, rm] of [[SQ, 140], [BP, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [user, name, ids[`lib:${name}`], rm])
    }
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day 4037',$3,$4) RETURNING id`,
        [user, session, local(d, 12), local(d, 13)])).rows[0].id
      for (const name of [SQ, BP]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, ids[`lib:${name}`], local(d, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          const miss = withMiss && name === SQ && d === 2 && n === 2
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
        }
      }
    }
    return { sq, bp }
  }

  const removeLibraryRows = () => pool.query(`DELETE FROM exercise_library WHERE name = ANY($1)`, [NAMES])
  const removeUsers = () => pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B]])

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    engine = await import('@/lib/weekly-checkin/engine')
    const repo = await (await import('@/lib/data')).getRepositoryAsync()
    ctxFor = user => ({ db: client.getDb(), repo, userId: user, tz: TZ, now: NOW })
    await removeUsers()
    await removeLibraryRows()
    // Muscle and equipment names the real library already uses (home-gym-exercise-gaps-migration counts them).
    for (const [name, muscle, equipment] of [[SQ, 'quads', 'barbell'], [BP, 'chest', 'barbell'], [ALT, 'chest', 'dumbbell']]) {
      ids[`lib:${name}`] = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$2], $3::jsonb) RETURNING id`,
        [name, equipment, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id
    }
    const a = await seedUser(A, true)
    const b = await seedUser(B, false)
    raw.due = await engine.readCheckinState(ctxFor(A))
    raw.full = await engine.saveCheckin(ctxFor(A), {
      weekStart: W0,
      lifts: [{ sessionExerciseId: a.sq, answer: 'heavy' }, { sessionExerciseId: a.bp, answer: 'light' }],
      pain: { sessionExerciseId: a.bp, where: 'front of the shoulder' },
      swap: { sessionExerciseId: a.bp },
      daysOff: [3, 6],
      shorterSessionMin: 40,
    })
    raw.held = await engine.saveCheckin(ctxFor(B), {
      weekStart: W0,
      lifts: [{ sessionExerciseId: b.sq, answer: 'heavy' }, { sessionExerciseId: b.bp, answer: 'about_right' }],
      pain: false, swap: null, daysOff: null, shorterSessionMin: null,
    })
  })

  afterAll(async () => {
    await removeUsers()
    await removeLibraryRows()
  })

  const recorded = () => ({
    due: normalise(pinAlternatives(sortedLifts(raw.due))),
    full: normalise(pinAlternatives(sortedLifts(raw.full))),
    held: normalise(pinAlternatives(sortedLifts(raw.held))),
  })

  it('each response is byte for byte what the engine sent before the types moved (normalised)', () => {
    if (process.env.SHAPES_DUMP) writeFileSync(process.env.SHAPES_DUMP, JSON.stringify({ ...recorded(), unfiltered: normalise(sortedLifts(raw.full)) }, null, 2))
    else expect(recorded()).toEqual(JSON.parse(readFileSync(new URL('./fixtures/weekly-checkin-responses-4037.json', import.meta.url), 'utf8')))
  })

  it('the shared schema describes every field of each response, and nothing it names is missing', async () => {
    const { checkinStateSchema, saveOutcomeSchema } = await import('@trainingai/shared/weekly-checkin/responses')
    const wire = (v: unknown) => JSON.parse(JSON.stringify(v))
    // `parse` drops a key the schema does not name, so equal output means no field is unnamed.
    expect(checkinStateSchema.parse(wire(raw.due))).toEqual(wire(raw.due))
    expect(saveOutcomeSchema.parse(wire(raw.full))).toEqual(wire(raw.full))
    expect(saveOutcomeSchema.parse(wire(raw.held))).toEqual(wire(raw.held))
  })

  it('the phone\'s lenient reading keeps what the screens use, and both flags of a lifted row come through', async () => {
    const { lenientSaveOutcomeSchema } = await import('@trainingai/shared/weekly-checkin/responses')
    const wire = (v: unknown) => JSON.parse(JSON.stringify(v))
    const full = lenientSaveOutcomeSchema.parse(wire(raw.full)).state.checkin!
    expect(full.lifts.map(l => [l.effect, l.holdLive, l.capped]).sort()).toEqual([['lowered_one_step', null, true], ['offered_step_up', null, null]])
    expect(full.offers.map(o => o.kind)).toEqual(['step_up', 'pain', 'swap'])
    const held = lenientSaveOutcomeSchema.parse(wire(raw.held)).state.checkin!
    expect(held.lifts.find(l => l.effect === 'held')).toMatchObject({ holdLive: true, capped: true })
  })
})
