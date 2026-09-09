// BF-131 — the AMRAP baseline session is consumed, and the phase exits on its own.
//
// The owner ran both baseline sessions exactly as the banner instructs — Push 2026-09-07 and Pull
// 2026-09-06, one AMRAP set per exercise, both completed — and Health → Training still read
// "baseline needed". `sessions_in_phase` was 1 on both, which is the tell: completion WAS wired and
// wrote the wrong field. The counter moved; `baseline_complete` never did, and the only exit was
// the "Use prior data" button — the one path that discards the baseline session.
//
// Runs only against a local dev Postgres — skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000bf131'

describe.skipIf(!canRun)('the baseline hop (BF-131)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER, `bf131@example.com`])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
  })

  /** A program with one active session carrying `names`, plus its periodization row in `baseline`.
   *  Seeded with SQL rather than the repository, as `periodization-soft-delete.test.ts` does. */
  async function seed(names: string[]) {
    const { rows: [p] } = await pool.query(
      `INSERT INTO programs (user_id, name, is_active) VALUES ($1, 'BF-131', true) RETURNING id`, [USER])
    const { rows: [ps] } = await pool.query(
      `INSERT INTO program_sessions (program_id, name, position) VALUES ($1, 'BF-131 Session', 0) RETURNING id`,
      [p.id])
    const exercises: { id: string; exerciseName: string }[] = []
    for (const [i, name] of names.entries()) {
      const { rows: [se] } = await pool.query(
        `INSERT INTO session_exercises (session_id, exercise_name, position) VALUES ($1, $2, $3) RETURNING id`,
        [ps.id, name, i])
      exercises.push({ id: se.id, exerciseName: name })
    }
    await repo.ensureSessionPeriodization(USER, ps.id)
    return { sessionId: ps.id as string, exercises }
  }

  /** A completed workout whose exercise logs carry the AMRAP-derived 1RMs the screen wrote. */
  async function completedWorkout(sessionId: string, rms: Record<string, number>) {
    const ws = await repo.createWorkoutSession(USER, sessionId, 'BF-131 Session', new Date())
    for (const [name, rm] of Object.entries(rms)) {
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
         VALUES ($1, $2, $3, now())`, [ws.id, name, rm])
    }
    return ws.id
  }

  const stateOf = (sessionId: string) => repo.getSessionPeriodization(USER, sessionId)

  it('completes the baseline from the session that was just run', async () => {
    // The entry's definition of done. Before this, both flags stayed false however many baseline
    // sessions were completed.
    const { sessionId, exercises } = await seed(['Bench Press', 'Row'])
    const wsId = await completedWorkout(sessionId, { 'Bench Press': 100, Row: 80 })

    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300)) // the write is fire-and-forget, by design

    const state = await stateOf(sessionId)
    expect(state?.baselineComplete).toBe(true)
    expect(state?.phase).toBe('accumulation')
    // Keyed by SESSION-EXERCISE id, which is how the periodization signals look a baseline up —
    // not by exercise name, which is what `exercise_logs` carries.
    const byId = state?.baseline1rm ?? {}
    expect(byId[exercises[0].id]).toEqual({ kg: 100, source: 'amrap' })
    expect(byId[exercises[1].id]).toEqual({ kg: 80, source: 'amrap' })
  })

  it("tags a measured anchor 'amrap', distinctly from a carried-over PR", async () => {
    // `source` already had the tag and no producer. The prescription prompt weighs a measured
    // number differently from one carried over ('existing') or typed in the builder ('estimate'),
    // so an anchor that cannot say which it is defeats the distinction.
    const { sessionId, exercises } = await seed(['Bench Press'])
    const wsId = await completedWorkout(sessionId, { 'Bench Press': 100 })
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300))
    expect((await stateOf(sessionId))?.baseline1rm[exercises[0].id].source).toBe('amrap')
  })

  it('keeps a PARTIAL baseline in the phase, and keeps what it measured', async () => {
    // Three of five. Completing here would leave two anchors missing from the map the prescription
    // reads — the "empty, unusable anchor" the skip-baseline route already refuses to write. The
    // measured three are kept so a screen can name what is outstanding, and so a second session
    // does not have to redo them.
    const { sessionId, exercises } = await seed(['A', 'B', 'C', 'D', 'E'])
    const wsId = await completedWorkout(sessionId, { A: 100, B: 90, C: 80 })
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300))

    const state = await stateOf(sessionId)
    expect(state?.baselineComplete).toBe(false)
    expect(state?.phase).toBe('baseline')
    expect(Object.keys(state?.baseline1rm ?? {})).toHaveLength(3)
    expect(state?.baseline1rm[exercises[0].id]).toEqual({ kg: 100, source: 'amrap' })
    expect(state?.baseline1rm[exercises[3].id]).toBeUndefined()
  })

  it('a second session finishes what the first started', async () => {
    // The reason a partial accumulates rather than being discarded. Without the merge, the lifter
    // who logs 3 then 2 never completes: each session sees only its own subset.
    const { sessionId } = await seed(['A', 'B', 'C'])
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')

    const first = await completedWorkout(sessionId, { A: 100, B: 90 })
    await completeWorkoutFromPayload(USER, { workoutSessionId: first })
    await new Promise(r => setTimeout(r, 300))
    expect((await stateOf(sessionId))?.baselineComplete).toBe(false)

    const second = await completedWorkout(sessionId, { C: 80 })
    await completeWorkoutFromPayload(USER, { workoutSessionId: second })
    await new Promise(r => setTimeout(r, 300))

    const state = await stateOf(sessionId)
    expect(state?.baselineComplete).toBe(true)
    expect(Object.keys(state?.baseline1rm ?? {})).toHaveLength(3)
    // The earlier anchors survived — merged, not replaced by the later session's subset.
    expect(Object.values(state?.baseline1rm ?? {}).map(e => e.kg).sort((a, b) => a - b)).toEqual([80, 90, 100])
  })

  it('ignores a log with no 1RM rather than anchoring on nothing', async () => {
    // A bodyweight or cardio entry writes no `estimated_1rm`. Treating that as an anchor of 0 would
    // complete the baseline with a number that prescribes an empty bar.
    const { sessionId } = await seed(['A', 'B'])
    const wsId = await completedWorkout(sessionId, { A: 100 })
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
       VALUES ($1, 'B', NULL, now())`, [wsId])
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300))

    const state = await stateOf(sessionId)
    expect(state?.baselineComplete).toBe(false)
    expect(Object.keys(state?.baseline1rm ?? {})).toHaveLength(1)
  })

  it('leaves a session that is NOT in baseline alone', async () => {
    const { sessionId } = await seed(['A'])
    await repo.advancePhase(USER, sessionId, 'accumulation')
    const wsId = await completedWorkout(sessionId, { A: 100 })
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300))

    const state = await stateOf(sessionId)
    expect(state?.phase).toBe('accumulation')
    expect(state?.baseline1rm).toEqual({})
  })

  it('does not overwrite an anchor on a row already marked complete', async () => {
    // **`baseline_complete` is checked SEPARATELY from the phase, and the obvious fixture cannot
    // show it.** Calling `setBaselineComplete` also moves the row to `accumulation`, so the phase
    // check rejects it first and removing the completed-check changes nothing — measured: both
    // guards deleted together still passed. The state is set directly here, which the schema
    // permits and a re-anchored or hand-corrected row can reach.
    const { sessionId, exercises } = await seed(['A'])
    await pool.query(
      `UPDATE session_periodization SET baseline_complete = true, phase = 'baseline', baseline_1rm = $3
       WHERE user_id = $1 AND program_session_id = $2`,
      [USER, sessionId, JSON.stringify({ [exercises[0].id]: { kg: 55, source: 'existing' } })])

    const wsId = await completedWorkout(sessionId, { A: 100 })
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })
    await new Promise(r => setTimeout(r, 300))

    expect((await stateOf(sessionId))?.baseline1rm[exercises[0].id]).toEqual({ kg: 55, source: 'existing' })
  })

  it("never reads another user's exercise logs", async () => {
    // `exercise_logs` carries no `user_id`, so the read is scoped through `workout_sessions`. A
    // single-user fixture cannot show that scope exists — dropping it survived one. Here the other
    // user's workout carries the only logs, so an unscoped read would anchor this user's baseline
    // from them.
    const OTHER = '00000000-0000-4000-8000-0000000bf132'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [OTHER, 'bf131-other@example.com'])
    try {
      const { sessionId } = await seed(['A'])
      const mine = await repo.createWorkoutSession(USER, sessionId, 'BF-131 Session', new Date())
      const theirs = await repo.createWorkoutSession(OTHER, sessionId, 'BF-131 Session', new Date())
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, logged_at)
         VALUES ($1, 'A', 999, now())`, [theirs.id])

      // **Ask for THEIR session id as this user.** Asking for `mine.id` proves nothing: the
      // workout-session filter already isolates it, so dropping the user scope changes nothing —
      // measured, that mutant survived. The scope only bites when the id belongs to someone else.
      expect(await repo.getSessionExercise1rms(USER, theirs.id)).toEqual([])
      expect(await repo.getSessionExercise1rms(USER, mine.id)).toEqual([])
      // …and the owner still reads their own, so the scope is not simply returning nothing.
      expect(await repo.getSessionExercise1rms(OTHER, theirs.id)).toEqual([{ exerciseName: 'A', estimated1rm: 999 }])
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [OTHER])
    }
  })
})
