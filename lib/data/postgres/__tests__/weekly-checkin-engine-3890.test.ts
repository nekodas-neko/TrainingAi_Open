// #3890 step 2: the weekly check-in engine against a real Postgres.
//   - The state: due after the planned sessions, the summary from the logs, the main lifts and their misses.
//   - Save: Heavy holds, Heavy + a miss lowers one step through the Coach's writer (source 'checkin', a
//     coach_changes row); Light, pain and swap write NOTHING until their offer is accepted; days off and a
//     shorter session are applied as typed.
//   - Redo: the same row; never two lowerings; a lowering no longer called for is undone; one that has
//     shaped a workout is kept, not doubled; an accepted injury blocks a changed answer until undone.
//   - Accept / decline / undo of each offer and effect, each restoring what it changed.
//   - Dismiss, then save later. Ownership: user B with user A's ids is a 404 with nothing written.
//
// The clock is the engine's `now`, set to a local midday in LAST week (so every fixture is in the past
// and the "trained since" check sees none of them). Runs only with DATABASE_URL. Fake users and lifts.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { dateStrMidnightInTz, shiftDateStr, todayInTz, weekStartForDay } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const A = '00000000-0000-4000-8000-00000389e0a1'
const B = '00000000-0000-4000-8000-00000389e0b2'
const C = '00000000-0000-4000-8000-00000389e0c3' // no rows at all: the identity case
const SQ = 'Checkin Squat 3890'
const BP = 'Checkin Press 3890'
const ALT = 'Checkin Alt Press 3890'
const ACC = 'Checkin Curl 3890'

// Last week's Monday, and a local wall-clock instant on one of its days.
const W0 = shiftDateStr(weekStartForDay(todayInTz(TZ)), -7)
const local = (dayOffset: number, hour: number) => new Date(dateStrMidnightInTz(shiftDateStr(W0, dayOffset), TZ).getTime() + hour * 3_600_000)
const NOW = local(2, 18) // Wednesday 18:00, after the third workout
const APPLIES = shiftDateStr(W0, 7)

describe.skipIf(!canRun)('weekly check-in engine (#3890 step 2)', () => {
  let pool: import('pg').Pool
  let engine: typeof import('@/lib/weekly-checkin/engine')
  let slice: typeof import('@/lib/data/postgres/slices/weekly-checkin')
  let ctxFor: (user: string, now?: Date) => import('@/lib/weekly-checkin/engine').EngineCtx
  const ids = {} as Record<string, string>

  const seedUser = async (user: string, withMiss: boolean) => {
    const program = (await pool.query(
      `INSERT INTO programs (user_id, name, phase_mode, is_active, training_goal, created_at) VALUES ($1,'Checkin test','ai_dynamic',true,'strength', now() - interval '90 days') RETURNING id`, [user])).rows[0].id
    const session = (await pool.query(`INSERT INTO program_sessions (program_id, name, position) VALUES ($1,'Day 3890',0) RETURNING id`, [program])).rows[0].id
    // A weekly schedule, Monday to Wednesday: three planned sessions.
    const schedule = (await pool.query(`INSERT INTO schedules (program_id, type) VALUES ($1,'weekly') RETURNING id`, [program])).rows[0].id
    for (const day of [0, 1, 2]) await pool.query(`INSERT INTO schedule_days (schedule_id, day_of_week, session_id) VALUES ($1,$2,$3)`, [schedule, day, session])
    const ex = async (name: string, pos: number, role: string, muscles: string[]) =>
      (await pool.query(`INSERT INTO session_exercises (session_id, exercise_name, exercise_id, position, exercise_role, muscle_groups) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [session, name, ids[`lib:${name}`] ?? null, pos, role, muscles])).rows[0].id as string
    const sq = await ex(SQ, 0, 'primary', ['quadriceps'])
    const bp = await ex(BP, 1, 'primary', ['chest'])
    const acc = await ex(ACC, 2, 'accessory', ['biceps'])
    for (const [name, rm] of [[SQ, 140], [BP, 100]] as const) {
      await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm) VALUES ($1,$2,$3,$4)`, [user, name, ids[`lib:${name}`], rm])
    }
    for (let d = 0; d < 3; d++) {
      const ws = (await pool.query(
        `INSERT INTO workout_sessions (user_id, session_id, session_name, started_at, completed_at) VALUES ($1,$2,'Day 3890',$3,$4) RETURNING id`,
        [user, session, local(d, 12), local(d, 13)])).rows[0].id
      for (const name of [SQ, BP]) {
        const el = (await pool.query(
          `INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_id, estimated_1rm, logged_at) VALUES ($1,$2,$3,100,$4) RETURNING id`,
          [ws, name, ids[`lib:${name}`], local(d, 12.5)])).rows[0].id
        for (let n = 1; n <= 3; n++) {
          // The miss is in the lift's LAST session of the week: decision 9 reads that one.
          const miss = withMiss && name === SQ && d === 2 && n === 2
          await pool.query(
            `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, planned_reps, planned_weight_kg, planned_pct, rest_time_sec, planned_rest_sec)
             VALUES ($1,$2,80,$3,5,80,75,150,150)`, [el, n, miss ? 3 : 5])
        }
      }
    }
    return { program, session, sq, bp, acc }
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    await client.ensureSchema()
    pool = client.getPool()
    engine = await import('@/lib/weekly-checkin/engine')
    slice = await import('@/lib/data/postgres/slices/weekly-checkin')
    const repo = await (await import('@/lib/data')).getRepositoryAsync()
    ctxFor = (user, now = NOW) => ({ db: client.getDb(), repo, userId: user, tz: TZ, now })
    for (const [name, muscle, equipment] of [[SQ, 'quadriceps', 'Barbell'], [BP, 'chest', 'Barbell'], [ALT, 'chest', 'Dumbbell'], [ACC, 'biceps', 'Dumbbell']]) {
      ids[`lib:${name}`] = (await pool.query(
        `INSERT INTO exercise_library (name, equipment, muscles) VALUES ($1, ARRAY[$2], $3::jsonb)
         ON CONFLICT (name) DO UPDATE SET equipment = EXCLUDED.equipment, muscles = EXCLUDED.muscles RETURNING id`,
        [name, equipment, JSON.stringify([{ muscle, role: 'main' }])])).rows[0].id
    }
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[A, B, C]])
    for (const id of [A, B, C]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x',$3)`, [id, `weekly-checkin-${id}@example.com`, TZ])
    }
    Object.assign(ids, Object.fromEntries(Object.entries(await seedUser(A, true)).map(([k, v]) => [`a:${k}`, v])))
    Object.assign(ids, Object.fromEntries(Object.entries(await seedUser(B, false)).map(([k, v]) => [`b:${k}`, v])))
  })

  const count = async (q: string, params: unknown[]) => Number((await pool.query(q, params)).rows[0].n)
  const coachChanges = (user = A) => pool.query(`SELECT id, domain, undone_at, target_id FROM coach_changes WHERE user_id = $1 ORDER BY applied_at`, [user]).then(r => r.rows)
  const pref = (name: string, user = A) => pool.query(
    `SELECT next_load_step, source, deleted_at FROM exercise_preferences WHERE user_id = $1 AND exercise_name = $2`, [user, name]).then(r => r.rows[0])
  const restDays = (user = A) => pool.query(`SELECT date::text AS d FROM rest_days WHERE user_id = $1 AND deleted_at IS NULL ORDER BY date`, [user]).then(r => r.rows.map(x => x.d))
  const liftOf = (state: Awaited<ReturnType<typeof engine.readCheckinState>>, name: string) => state.checkin!.lifts.find(l => l.exerciseName === name)!
  const fullSave = (over: Partial<import('@/lib/weekly-checkin/engine').SaveInput> = {}) => engine.saveCheckin(ctxFor(A), {
    weekStart: W0,
    lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'heavy' }, { sessionExerciseId: ids['a:bp'], answer: 'light' }],
    pain: { sessionExerciseId: ids['a:bp'], where: 'front of the shoulder' },
    swap: { sessionExerciseId: ids['a:bp'] },
    daysOff: [3, 6],
    shorterSessionMin: 40,
    ...over,
  })

  it('the state: due once the planned sessions are done, the summary and the main lifts from the logs', async () => {
    const before = await engine.readCheckinState(ctxFor(A, local(1, 18)))
    expect(before.due).toBe(false) // two of three done
    const state = await engine.readCheckinState(ctxFor(A))
    expect(state).toMatchObject({ due: true, why: 'planned_count_reached', weekStart: W0 })
    expect(state.lifts.map(l => [l.exerciseName, l.missedRep, l.lastSession])).toEqual([[SQ, true, 'short'], [BP, false, 'met']])
    expect(state.summary!.lines).toEqual([
      '3 of 3 planned sessions done.',
      `Last session: ${SQ} fell short of the plan, ${BP} met the plan.`,
      'Short rest cost no reps.',
    ])
    expect(state.checkin).toMatchObject({ status: 'offered', weekStart: W0, appliesWeekStart: APPLIES })
    // Reading again does not create a second row.
    await engine.readCheckinState(ctxFor(A))
    expect(await count(`SELECT count(*) n FROM weekly_checkins WHERE user_id = $1`, [A])).toBe(1)
  })

  it('save: Heavy + a miss lowers one step through the Coach writer; Light, pain and swap write nothing', async () => {
    const { state } = await fullSave()
    const sq = liftOf(state, SQ); const bp = liftOf(state, BP)
    expect(sq).toMatchObject({ answer: 'heavy', missedRep: true, effect: 'lowered_one_step' })
    expect(sq.appliedChangeId).toBeTruthy()
    expect(bp).toMatchObject({ answer: 'light', effect: 'offered_step_up', offerStatus: 'open', appliedChangeId: null })
    expect(await pref(SQ)).toMatchObject({ next_load_step: 'lighter', source: 'checkin', deleted_at: null })
    // Nothing applied without its tap: one change (the lowering), no step up, no injury, no swap.
    expect((await coachChanges()).map(c => c.domain)).toEqual(['lift_preference'])
    expect(await pref(BP)).toBeUndefined()
    expect(await count(`SELECT count(*) n FROM injuries WHERE user_id = $1`, [A])).toBe(0)
    expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids['a:bp']])).rows[0].exercise_name).toBe(BP)
    expect(state.checkin!.offers.map(o => [o.kind, o.status])).toEqual([['step_up', 'open'], ['pain', 'open'], ['swap', 'open']])
    // Applied as typed: Wednesday and Saturday of next week, and the 40-minute budget for that week.
    expect(await restDays()).toEqual([shiftDateStr(APPLIES, 2), shiftDateStr(APPLIES, 5)])
    expect(await slice.getCheckinSessionBudgetMin(ctxFor(A).db, A, APPLIES)).toBe(40)
    expect([...(await slice.listCheckinHeldLifts(ctxFor(A).db, A, APPLIES, [SQ, BP, ACC]))]).toEqual([SQ])
    // pain_where is stored as typed, bounded, and only on the check-in.
    expect(state.checkin!.pain).toMatchObject({ exerciseName: BP, where: 'front of the shoulder' })
  })

  it('Heavy without a miss holds, by itself, with no write anywhere else', async () => {
    const { state } = await fullSave({ lifts: [{ sessionExerciseId: ids['a:bp'], answer: 'heavy' }], pain: false, swap: null, daysOff: null, shorterSessionMin: null })
    expect(liftOf(state, BP)).toMatchObject({ effect: 'held', appliedChangeId: null })
    expect(await coachChanges()).toEqual([])
    expect([...(await slice.listCheckinHeldLifts(ctxFor(A).db, A, APPLIES, [SQ, BP]))]).toEqual([BP])
    // Undo of a hold: the lift reads as not held.
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'lift', liftId: liftOf(state, BP).liftId })
    expect([...(await slice.listCheckinHeldLifts(ctxFor(A).db, A, APPLIES, [SQ, BP]))]).toEqual([])
  })

  it('redo: the same row, never two lowerings; a lowering no longer called for is undone', async () => {
    const first = await fullSave()
    const second = await fullSave()
    expect(second.state.checkin!.id).toBe(first.state.checkin!.id)
    expect(liftOf(second.state, SQ).appliedChangeId).toBe(liftOf(first.state, SQ).appliedChangeId)
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(1)
    expect(await count(`SELECT count(*) n FROM weekly_checkin_exercises WHERE user_id = $1`, [A])).toBe(2)

    const third = await fullSave({ lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'about_right' }], daysOff: [3] })
    expect(liftOf(third.state, SQ)).toMatchObject({ effect: 'none', appliedChangeId: null })
    expect((await coachChanges()).every(c => c.undone_at)).toBe(true)
    expect(await pref(SQ)).toMatchObject({ next_load_step: null }) // the writer's undo: no row before → a tombstone
    // BP is no longer answered: its row is tombstoned, not deleted. Saturday is withdrawn.
    expect(await count(`SELECT count(*) n FROM weekly_checkin_exercises WHERE user_id = $1 AND deleted_at IS NOT NULL`, [A])).toBe(1)
    expect(await restDays()).toEqual([shiftDateStr(APPLIES, 2)])
  })

  it('redo after a workout has started since the lowering: it is kept, and not doubled', async () => {
    const first = await fullSave()
    await pool.query(`INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1,'Later',now() + interval '1 minute')`, [A])
    const second = await fullSave({ lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'about_right' }] })
    expect(second.kept.map(k => k.exerciseName)).toEqual([SQ])
    expect(liftOf(second.state, SQ)).toMatchObject({ effect: 'lowered_one_step', appliedChangeId: liftOf(first.state, SQ).appliedChangeId })
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(1)
    await expect(engine.undoCheckinEffect(ctxFor(A), first.state.checkin!.id, { kind: 'lift', liftId: liftOf(first.state, SQ).liftId }))
      .rejects.toMatchObject({ status: 409, code: 'cannot_undo' })
  })

  it('undo of the lowering restores the preference exactly, and leaves the Heavy answer\'s hold (live)', async () => {
    const { state } = await fullSave()
    const after = await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'lift', liftId: liftOf(state, SQ).liftId })
    expect(liftOf(after, SQ)).toMatchObject({ effect: 'held', appliedChangeId: null, holdLive: true })
    expect(await pref(SQ)).toMatchObject({ next_load_step: null })
    expect((await coachChanges())[0].undone_at).not.toBeNull()
  })

  it('Light: decline writes nothing; accept steps up through the same writer; undo puts it back and reopens the offer', async () => {
    const { state } = await fullSave({ lifts: [{ sessionExerciseId: ids['a:bp'], answer: 'light' }] })
    const liftId = liftOf(state, BP).liftId
    const accepted = await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId }, 'accept')
    expect(liftOf(accepted, BP)).toMatchObject({ offerStatus: 'accepted' })
    expect(await pref(BP)).toMatchObject({ next_load_step: 'heavier', source: 'checkin' })
    await expect(engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId }, 'accept')).rejects.toMatchObject({ status: 409 })
    const undone = await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'lift', liftId })
    expect(liftOf(undone, BP)).toMatchObject({ offerStatus: 'open', appliedChangeId: null })
    expect(await pref(BP)).toMatchObject({ next_load_step: null })
    const declined = await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId }, 'decline')
    expect(liftOf(declined, BP)).toMatchObject({ offerStatus: 'declined' })
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(0)
    // A redo with the same answer keeps the decline.
    const redo = await fullSave({ lifts: [{ sessionExerciseId: ids['a:bp'], answer: 'light' }] })
    expect(liftOf(redo.state, BP)).toMatchObject({ offerStatus: 'declined' })
  })

  it('pain: accept logs an injury through the Coach writer (this user\'s, with no free text); undo removes it', async () => {
    const { state } = await fullSave()
    const offer = state.checkin!.offers.find(o => o.kind === 'pain')!
    expect(offer).toMatchObject({ muscles: ['chest'] })
    await expect(engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'pain', muscleName: 'biceps' }, 'accept')).rejects.toMatchObject({ status: 400 })
    const accepted = await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'pain' }, 'accept')
    const injury = (await pool.query(`SELECT id, user_id, muscle_name, notes, deleted_at FROM injuries WHERE user_id = $1`, [A])).rows
    expect(injury).toHaveLength(1)
    expect(injury[0]).toMatchObject({ muscle_name: 'chest', notes: null, deleted_at: null })
    expect(accepted.checkin!.offers.find(o => o.kind === 'pain')).toMatchObject({ status: 'accepted', injuryId: injury[0].id })
    // Changing the pain answer while the injury stands is refused until it is undone.
    await expect(fullSave({ pain: false })).rejects.toMatchObject({ status: 409, code: 'undo_first' })
    const undone = await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'pain' })
    expect(undone.checkin!.offers.find(o => o.kind === 'pain')).toMatchObject({ status: 'open', injuryId: null })
    expect((await pool.query(`SELECT deleted_at FROM injuries WHERE id = $1`, [injury[0].id])).rows[0].deleted_at).not.toBeNull()
    await fullSave({ pain: false })
  })

  it('swap: alternatives for the same muscles; accept swaps the slot through coach_changes; undo restores it', async () => {
    const { state } = await fullSave()
    const offer = state.checkin!.offers.find(o => o.kind === 'swap')
    expect(offer?.kind === 'swap' && offer.alternatives.map(a => a.name)).toContain(ALT)
    await expect(engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'swap', toExerciseId: ids[`lib:${ACC}`] }, 'accept'))
      .rejects.toMatchObject({ status: 400 })
    const accepted = await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'swap', toExerciseId: ids[`lib:${ALT}`] }, 'accept')
    expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids['a:bp']])).rows[0].exercise_name).toBe(ALT)
    const swapOffer = accepted.checkin!.offers.find(o => o.kind === 'swap')!
    expect(swapOffer).toMatchObject({ status: 'accepted' })
    const change = (await coachChanges()).find(c => c.domain === 'session_exercise')!
    expect(swapOffer.kind === 'swap' && swapOffer.changeId).toBe(change.id)
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'swap' })
    expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids['a:bp']])).rows[0].exercise_name).toBe(BP)
  })

  it('undo of the days off and of the shorter session', async () => {
    const { state } = await fullSave()
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })
    expect(await restDays()).toEqual([])
    const after = await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'shorter_session' })
    expect(after.checkin).toMatchObject({ daysOff: [], shorterSessionMin: null })
    expect(await slice.getCheckinSessionBudgetMin(ctxFor(A).db, A, APPLIES)).toBeNull()
    await expect(engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })).rejects.toMatchObject({ status: 409 })
  })

  it('dismiss, then save later on the same row; a saved card cannot be dismissed', async () => {
    const dismissed = await engine.dismissCheckin(ctxFor(A), W0)
    expect(dismissed).toMatchObject({ due: false, checkin: { status: 'dismissed' } })
    const { state } = await fullSave()
    expect(state.checkin).toMatchObject({ id: dismissed.checkin!.id, status: 'saved', dismissedAt: null })
    await expect(engine.dismissCheckin(ctxFor(A), W0)).rejects.toMatchObject({ status: 409, code: 'already_saved' })
  })

  it('a week that is not open is refused', async () => {
    await expect(fullSave({ weekStart: shiftDateStr(W0, -7) })).rejects.toMatchObject({ status: 409, code: 'not_open' })
    await expect(engine.saveCheckin(ctxFor(A, local(1, 18)), {
      weekStart: W0, lifts: [], pain: null, swap: null, daysOff: null, shorterSessionMin: null,
    })).rejects.toMatchObject({ status: 409, code: 'not_open' })
  })

  it('ownership: user B with user A\'s ids is a 404 and writes nothing', async () => {
    const { state } = await fullSave()
    const before = await pool.query(`SELECT * FROM weekly_checkins WHERE user_id = $1`, [A])
    const bCtx = ctxFor(B)
    const b = (over: Partial<import('@/lib/weekly-checkin/engine').SaveInput>) => engine.saveCheckin(bCtx, {
      weekStart: W0, lifts: [{ sessionExerciseId: ids['b:sq'], answer: 'heavy' }], pain: null, swap: null, daysOff: null, shorterSessionMin: null, ...over,
    })
    await expect(b({ lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'heavy' }] })).rejects.toMatchObject({ status: 404 })
    await expect(b({ pain: { sessionExerciseId: ids['a:bp'], where: 'x' } })).rejects.toMatchObject({ status: 404 })
    await expect(b({ swap: { sessionExerciseId: ids['a:bp'] } })).rejects.toMatchObject({ status: 404 })
    // A non-main lift of B's own is not a lift to answer either.
    await expect(b({ lifts: [{ sessionExerciseId: ids['b:acc'], answer: 'heavy' }] })).rejects.toMatchObject({ status: 404 })
    const checkinId = state.checkin!.id
    const liftId = liftOf(state, BP).liftId
    await expect(engine.resolveOffer(bCtx, checkinId, { kind: 'step_up', liftId }, 'accept')).rejects.toMatchObject({ status: 404 })
    await expect(engine.resolveOffer(bCtx, checkinId, { kind: 'pain' }, 'accept')).rejects.toMatchObject({ status: 404 })
    await expect(engine.undoCheckinEffect(bCtx, checkinId, { kind: 'lift', liftId: liftOf(state, SQ).liftId })).rejects.toMatchObject({ status: 404 })
    await expect(engine.undoCheckinEffect(bCtx, checkinId, { kind: 'days_off' })).rejects.toMatchObject({ status: 404 })
    // B's own check-in, with A's lift row id: still a 404.
    const bState = await b({})
    await expect(engine.undoCheckinEffect(bCtx, bState.state.checkin!.id, { kind: 'lift', liftId: liftOf(state, SQ).liftId })).rejects.toMatchObject({ status: 404 })
    await expect(engine.resolveOffer(bCtx, bState.state.checkin!.id, { kind: 'step_up', liftId }, 'accept')).rejects.toMatchObject({ status: 404 })
    // Nothing of A's moved, and B wrote nothing to A's rows or lifts.
    expect((await pool.query(`SELECT * FROM weekly_checkins WHERE user_id = $1`, [A])).rows).toEqual(before.rows)
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(1)
    expect(await coachChanges(B)).toEqual([]) // B's heavy had no miss: a hold
    expect(await count(`SELECT count(*) n FROM injuries WHERE user_id = ANY($1)`, [[A, B]])).toBe(0)
  })

  // ── After review (22 Nov) ──

  const setSqMiss = (sql: string) => pool.query(
    `UPDATE set_logs SET ${sql} WHERE set_number = 2 AND exercise_log_id IN (
       SELECT el.id FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = $1 AND el.exercise_name = $2 AND el.logged_at = $3)`, [A, SQ, local(2, 12.5)])
  const heavyOnly = { lifts: [{ sessionExerciseId: ids['a:sq'] ?? '', answer: 'heavy' as const }], pain: null, swap: null, daysOff: null, shorterSessionMin: null }
  const heavySq = () => fullSave({ ...heavyOnly, lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'heavy' }] })

  it('B1: a miss loaded heavier than planned is not a missed rep; GET and the save agree, and Heavy is held', async () => {
    await setSqMiss('weight_kg = 82.5')
    const state = await engine.readCheckinState(ctxFor(A))
    expect(state.lifts.find(l => l.exerciseName === SQ)!.missedRep).toBe(false)
    const { state: saved } = await heavySq()
    expect(liftOf(saved, SQ)).toMatchObject({ missedRep: false, effect: 'held', holdLive: true })
    expect(await coachChanges()).toEqual([])
  })

  it('B1: a miss after a short rest is excused, so Heavy is held', async () => {
    await pool.query(
      `UPDATE set_logs SET rest_time_sec = 30 WHERE set_number = 1 AND exercise_log_id IN (
         SELECT el.id FROM exercise_logs el JOIN workout_sessions ws ON ws.id = el.workout_session_id
          WHERE ws.user_id = $1 AND el.exercise_name = $2 AND el.logged_at = $3)`, [A, SQ, local(2, 12.5)])
    const state = await engine.readCheckinState(ctxFor(A))
    expect(state.lifts.find(l => l.exerciseName === SQ)!.missedRep).toBe(false)
    expect(state.summary!.lines[2]).toBe('Short rest cost reps on 1 day.')
    expect(liftOf((await heavySq()).state, SQ)).toMatchObject({ effect: 'held' })
  })

  it('B1: an overridden last session is not compared; GET says why, and Heavy is held', async () => {
    await pool.query(`UPDATE workout_sessions SET was_override = true WHERE user_id = $1 AND started_at = $2`, [A, local(2, 12)])
    const state = await engine.readCheckinState(ctxFor(A))
    expect(state.lifts.map(l => [l.exerciseName, l.missedRep, l.lastSession])).toEqual([[SQ, false, 'not_compared'], [BP, false, 'not_compared']])
    expect(state.summary!.lines[1]).toBe(`Logged, not compared this week: ${SQ}, ${BP} (changed from the plan).`)
    expect(liftOf((await heavySq()).state, SQ)).toMatchObject({ missedRep: false, effect: 'held' })
  })

  it('B1: the missed rep stored by the save is the one GET showed (included case)', async () => {
    const state = await engine.readCheckinState(ctxFor(A))
    const { state: saved } = await heavySq()
    expect(liftOf(saved, SQ).missedRep).toBe(state.lifts.find(l => l.exerciseName === SQ)!.missedRep)
    expect(liftOf(saved, SQ)).toMatchObject({ missedRep: true, effect: 'lowered_one_step' })
  })

  it('B2: a lowering the person undid is not re-applied by saving the same answers; changing the answer away and back is the way', async () => {
    const first = await heavySq()
    const liftId = liftOf(first.state, SQ).liftId
    await engine.undoCheckinEffect(ctxFor(A), first.state.checkin!.id, { kind: 'lift', liftId })
    const again = await heavySq()
    expect(liftOf(again.state, SQ)).toMatchObject({ effect: 'held', appliedChangeId: null })
    expect(again.notApplied).toEqual([expect.objectContaining({ exerciseName: SQ, reason: 'undone' })])
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(0)
    expect(await pref(SQ)).toMatchObject({ next_load_step: null })
    // And once more: still not.
    expect((await heavySq()).notApplied.map(n => n.reason)).toEqual(['undone'])
    // Undoing the hold too: the same answer again does not bring the hold back either.
    await engine.undoCheckinEffect(ctxFor(A), first.state.checkin!.id, { kind: 'lift', liftId })
    expect(liftOf((await heavySq()).state, SQ)).toMatchObject({ effect: 'none' })
    // The explicit path: change the answer away, then back.
    await fullSave({ ...heavyOnly, lifts: [{ sessionExerciseId: ids['a:sq'], answer: 'about_right' }] })
    const back = await heavySq()
    expect(liftOf(back.state, SQ)).toMatchObject({ effect: 'lowered_one_step' })
    expect(back.notApplied).toEqual([])
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(1)
  })

  it('B2: a lowering undone from the Coach\'s history is not re-applied either', async () => {
    const first = await heavySq()
    const { undoCoachChange } = await import('@/lib/coach/apply')
    expect(await undoCoachChange(ctxFor(A).db, A, liftOf(first.state, SQ).appliedChangeId!)).toMatchObject({ ok: true })
    const again = await heavySq()
    expect(again.notApplied.map(n => n.reason)).toEqual(['undone'])
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(0)
  })

  it('B2: a step up the person undid is an open offer again; a redo writes nothing, and only a tap re-applies it', async () => {
    const light = () => fullSave({ ...heavyOnly, lifts: [{ sessionExerciseId: ids['a:bp'], answer: 'light' }] })
    const { state } = await light()
    const liftId = liftOf(state, BP).liftId
    await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId }, 'accept')
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'lift', liftId })
    const redo = await light()
    expect(liftOf(redo.state, BP)).toMatchObject({ offerStatus: 'open', appliedChangeId: null })
    expect((await coachChanges()).filter(c => !c.undone_at)).toHaveLength(0)
    expect(await pref(BP)).toMatchObject({ next_load_step: null })
    await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId }, 'accept')
    expect(await pref(BP)).toMatchObject({ next_load_step: 'heavier' })
  })

  it('C4: a held lift says its hold is live (the plan holds it), and no summary line claims the app acted', async () => {
    const { state } = await fullSave({ ...heavyOnly, lifts: [{ sessionExerciseId: ids['a:bp'], answer: 'heavy' }] })
    expect(liftOf(state, BP)).toMatchObject({ effect: 'held', holdLive: true })
    // The summary still states only what the logs show; the hold is carried by `holdLive`, not by text.
    expect(JSON.stringify(state.summary)).not.toMatch(/is held|weight held|holding/i)
  })

  it('C3: an ad-hoc workout and one of another program do not count toward the week', async () => {
    await pool.query(`INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at) VALUES ($1,'Ad hoc',$2,$3)`, [A, local(1, 15), local(1, 16)])
    // Two of the program's three sessions by Tuesday evening: the ad-hoc one is not a third, so the card
    // does not open early (it did when every completed workout counted).
    expect((await engine.readCheckinState(ctxFor(A, local(1, 18)))).due).toBe(false)
    expect((await engine.readCheckinState(ctxFor(A))).summary!.lines[0]).toBe('3 of 3 planned sessions done.')
  })

  it('D2: a save and an undo of a shorter session touch no stored plan (it is fitted where it is served)', async () => {
    const inWeek = new Date(dateStrMidnightInTz(APPLIES, TZ).getTime() + 36 * 3_600_000)
    const plan = { phase: 'accumulation', exercises: [], reasoning: 'stored before the save' }
    await pool.query(
      `INSERT INTO session_periodization (user_id, program_session_id, phase, prescription, prescription_status, prescription_generated_at, prescription_expires_at)
       VALUES ($1,$2,'accumulation',$3::jsonb,'pending',now(),$4)`,
      [A, ids['a:session'], JSON.stringify(plan), inWeek])
    const row = async () => (await pool.query(
      `SELECT prescription::text, prescription_status, prescription_generated_at, prescription_expires_at, updated_at
         FROM session_periodization WHERE user_id = $1 AND program_session_id = $2`, [A, ids['a:session']])).rows[0]
    const before = await row()
    const { state } = await fullSave({ shorterSessionMin: 40 })
    expect(await row()).toEqual(before)
    await fullSave({ shorterSessionMin: 30 })
    expect(await row()).toEqual(before)
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'shorter_session' })
    expect(await row()).toEqual(before)
    expect(await slice.getCheckinSessionBudgetMin(ctxFor(A).db, A, APPLIES)).toBeNull()
  })

  it('E1: after an accepted swap, re-saving the same answers is not refused, keeps the swap, the injury and the step up', async () => {
    const { state } = await fullSave()
    const bpLift = liftOf(state, BP).liftId
    await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'step_up', liftId: bpLift }, 'accept')
    await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'swap', toExerciseId: ids[`lib:${ALT}`] }, 'accept')
    await engine.resolveOffer(ctxFor(A), state.checkin!.id, { kind: 'pain' }, 'accept')
    const liveBefore = (await coachChanges()).filter(c => !c.undone_at).map(c => c.id).sort()
    expect(liveBefore).toHaveLength(4) // lowering, step up, swap, injury

    // The card now lists the swapped-in lift for that slot; the person sends the same slot ids again.
    const redo = await fullSave()
    expect(redo.kept).toEqual([])
    expect((await pool.query(`SELECT exercise_name FROM session_exercises WHERE id = $1`, [ids['a:bp']])).rows[0].exercise_name).toBe(ALT)
    expect(redo.state.checkin!.offers.map(o => [o.kind, o.status])).toEqual([['step_up', 'accepted'], ['pain', 'accepted'], ['swap', 'accepted']])
    expect(redo.state.checkin!.swap).toEqual({ exerciseName: BP, exerciseId: ids[`lib:${BP}`] })
    expect(redo.state.checkin!.pain).toMatchObject({ exerciseName: BP })
    // The press's row carried on through the swapped slot: same row, its step up still live, no new row.
    expect(liftOf(redo.state, BP)).toMatchObject({ liftId: bpLift, offerStatus: 'accepted' })
    expect(redo.state.checkin!.lifts.map(l => l.exerciseName).sort()).toEqual([BP, SQ].sort())
    expect((await coachChanges()).filter(c => !c.undone_at).map(c => c.id).sort()).toEqual(liveBefore)
    expect(await pref(BP)).toMatchObject({ next_load_step: 'heavier' })
    // A different slot for the swap is still refused until it is undone.
    await expect(fullSave({ swap: { sessionExerciseId: ids['a:sq'] } })).rejects.toMatchObject({ status: 409, code: 'undo_first' })
  })

  // ── A1: days off never remove a rest day the person set ──
  const WED = shiftDateStr(APPLIES, 2)
  const SAT = shiftDateStr(APPLIES, 5)
  const byHand = (date: string, resting: boolean) => ctxFor(A).repo.setRestDay(A, date, resting)
  const written = async () => (await pool.query(`SELECT days_off_written::text[] AS w FROM weekly_checkins WHERE user_id = $1`, [A])).rows[0].w

  it('A1: undo of days off keeps a rest day the person set before the check-in, and withdraws the one it wrote', async () => {
    await byHand(WED, true)
    const { state } = await fullSave({ daysOff: [3, 6] })
    expect(await restDays()).toEqual([WED, SAT])
    expect(state.checkin!.daysOffWritten).toEqual([SAT])
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })
    expect(await restDays()).toEqual([WED])
    expect(await written()).toBeNull()
  })

  it('A1: a redo that drops the day keeps the person\'s rest day; one that drops the check-in\'s withdraws it', async () => {
    await byHand(WED, true)
    await fullSave({ daysOff: [3, 6] })
    await fullSave({ daysOff: [6] })
    expect(await restDays()).toEqual([WED, SAT])
    expect(await written()).toEqual([SAT])
    await fullSave({ daysOff: [] })
    expect(await restDays()).toEqual([WED])
    expect(await written()).toBeNull()
  })

  it('A1: two saves do not double-record, and the record survives a redo', async () => {
    await fullSave({ daysOff: [3, 6] })
    await fullSave({ daysOff: [3, 6] })
    expect(await written()).toEqual([WED, SAT])
    expect(await count(`SELECT count(*) n FROM rest_days WHERE user_id = $1`, [A])).toBe(2)
    const { state } = await fullSave({ daysOff: [3, 6] })
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })
    expect(await restDays()).toEqual([])
  })

  it('A1: a recorded date the person un-rests and re-rests by hand after the check-in is theirs now', async () => {
    const { state } = await fullSave({ daysOff: [3, 6] })
    expect(await written()).toEqual([WED, SAT])
    await byHand(SAT, false)
    await byHand(SAT, true)
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })
    expect(await restDays()).toEqual([SAT]) // Wednesday was the check-in's; Saturday is the person's
    expect(await written()).toBeNull()
  })

  it('A1: a recorded date the person un-rested by hand is not re-rested by a redo, and leaves the record', async () => {
    await fullSave({ daysOff: [3, 6] })
    await byHand(WED, false)
    await fullSave({ daysOff: [3, 6] })
    expect(await restDays()).toEqual([SAT])
    expect(await written()).toEqual([SAT])
  })

  // A tap the person makes at the same moment as the save: their row goes live after the engine read
  // which dates it owns and before it writes. The write step itself must not take the row over.
  const restRow = (date: string) => pool.query(`SELECT updated_at, deleted_at FROM rest_days WHERE user_id = $1 AND date = $2`, [A, date]).then(r => r.rows[0])

  it('A1: a rest day the person sets between the save\'s read and its write is neither re-stamped nor recorded', async () => {
    const db = ctxFor(A).db
    const stamp = new Date(NOW.getTime() - 60_000)
    await byHand(SAT, true) // lands after the read point
    const before = await restRow(SAT)
    expect(await slice.claimRestDay(db, A, SAT, stamp)).toBe(false)
    expect(await restRow(SAT)).toEqual(before)
    // A tombstone and a brand-new date are the check-in's to claim.
    await byHand(WED, true)
    await byHand(WED, false)
    expect(await slice.claimRestDay(db, A, WED, stamp)).toBe(true)
    expect(await slice.claimRestDay(db, A, shiftDateStr(APPLIES, 6), stamp)).toBe(true)
    expect((await restRow(WED)).updated_at.getTime()).toBe(stamp.getTime())
    // Through the engine: the save records only what it wrote, and Undo leaves the person's day live.
    await pool.query(`DELETE FROM rest_days WHERE user_id = $1 AND date <> $2`, [A, SAT])
    const { state } = await fullSave({ daysOff: [3, 6] })
    expect(state.checkin!.daysOffWritten).toEqual([WED])
    await engine.undoCheckinEffect(ctxFor(A), state.checkin!.id, { kind: 'days_off' })
    expect(await restDays()).toEqual([SAT])
  })

  it('A1: a recorded date the person re-taps after the save read it as the check-in\'s is left as they left it', async () => {
    const db = ctxFor(A).db
    const { state } = await fullSave({ daysOff: [6] })
    const savedAt = new Date(state.checkin!.savedAt!)
    expect(await slice.checkinOwnedRestDays(db, A, [SAT], savedAt)).toEqual(new Set([SAT]))
    await byHand(SAT, false) // between the ownership read and the withdraw
    await byHand(SAT, true)
    const before = await restRow(SAT)
    expect(await slice.moveOwnedRestDay(db, A, SAT, savedAt, false, new Date())).toBe(false)
    expect(await restRow(SAT)).toEqual(before)
    expect(await restDays()).toEqual([SAT])
  })

  it('identity: a person with no check-in rows holds nothing and keeps every session length', async () => {
    const db = ctxFor(C).db
    expect([...(await slice.listCheckinHeldLifts(db, C, APPLIES, [SQ, BP]))]).toEqual([])
    expect(await slice.getCheckinSessionBudgetMin(db, C, APPLIES)).toBeNull()
    expect(await engine.readCheckinState(ctxFor(C))).toEqual({ due: false, why: null, weekStart: null, summary: null, lifts: [], checkin: null })
  })
})
