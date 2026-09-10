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
  let repo: import('@/lib/data/repository').WorkoutRepository

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

  /** LB-93 — poll for the condition instead of betting on a duration.
   *
   * `completeWorkoutFromPayload` fires `recordBaselineAnchorsFrom` and drops the promise on purpose
   * (a completion must never fail on a periodization write), so a test has nothing to await. The
   * fixed 300 ms sleep this replaces was a bet on how long that write takes, placed against a local
   * Postgres ~870 other test files are also using — it lost under full-suite contention, on
   * branches whose diffs could not have caused it, which is the expensive kind of flake.
   *
   * The timeout is generous because it is only ever paid when the assertion is about to fail
   * anyway; the happy path returns as soon as the write lands, which is why this is FASTER than the
   * sleep it replaces rather than a slower safety margin. */
  async function waitForState(
    sessionId: string,
    predicate: (s: Awaited<ReturnType<typeof stateOf>>) => boolean,
    what: string,
    timeoutMs = 10_000,
  ) {
    const deadline = Date.now() + timeoutMs
    let state = await stateOf(sessionId)
    while (!predicate(state)) {
      if (Date.now() > deadline) {
        throw new Error(`waitForState: timed out after ${timeoutMs}ms waiting for ${what}. Last state: ${JSON.stringify(state)}`)
      }
      await new Promise(r => setTimeout(r, 10))
      state = await stateOf(sessionId)
    }
    return state
  }

  /** The inverse of `waitForState`, for the two cases that assert the write did NOT happen.
   *
   * **You cannot remove the bet from a negative assertion — you can only choose which way it
   * fails.** There is no signal for "the fire-and-forget write decided not to fire", so any such
   * test is really "nothing happened within some window". `waitForState` fails when its window
   * expires; this one PASSES, so contention on a loaded runner produces a false pass rather than a
   * false failure. That direction is the whole point of LB-93: the old fixed sleep failed on
   * branches whose diffs could not have caused it, and cost five runs to rule out.
   *
   * Measured, because "it still has teeth" is a claim and not an assumption: with the call-site
   * guard replaced by `if (true)`, the first of these two goes red and the second does not — which
   * matches that test's own comment saying the completed-check is not what it catches. Deleting the
   * wait outright (the first version of this change) let BOTH survive that mutant. */
  async function expectNoWrite(
    sessionId: string,
    predicate: (s: Awaited<ReturnType<typeof stateOf>>) => boolean,
    what: string,
    windowMs = 500,
  ) {
    const deadline = Date.now() + windowMs
    while (Date.now() < deadline) {
      const state = await stateOf(sessionId)
      if (predicate(state)) {
        throw new Error(`expectNoWrite: ${what} — but it did. State: ${JSON.stringify(state)}`)
      }
      await new Promise(r => setTimeout(r, 10))
    }
  }

  /** The number of anchors recorded so far — the positive signal the "assert it did NOT complete"
   *  cases wait on. You cannot poll for an absence, but each of those tests also asserts how many
   *  anchors the partial write produced, and that IS a thing that happens. */
  const anchorCount = (s: Awaited<ReturnType<typeof stateOf>>) => Object.keys(s?.baseline1rm ?? {}).length

  it('completes the baseline from the session that was just run', async () => {
    // The entry's definition of done. Before this, both flags stayed false however many baseline
    // sessions were completed.
    const { sessionId, exercises } = await seed(['Bench Press', 'Row'])
    const wsId = await completedWorkout(sessionId, { 'Bench Press': 100, Row: 80 })

    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })

    const state = await waitForState(sessionId, s => s?.baselineComplete === true, 'the baseline to complete')
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
    const state = await waitForState(sessionId, s => anchorCount(s) === 1, 'the anchor to be written')
    expect(state?.baseline1rm[exercises[0].id].source).toBe('amrap')
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

    // The partial write IS the positive signal; the negative assertion below is only meaningful
    // once it has landed.
    const state = await waitForState(sessionId, s => anchorCount(s) === 3, 'the three measured anchors')
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
    // Wait for the FIRST write to land before starting the second — otherwise the merge this test
    // exists to prove is racing, and a pass would not mean what it says.
    expect((await waitForState(sessionId, s => anchorCount(s) === 2, "the first session's two anchors"))?.baselineComplete).toBe(false)

    const second = await completedWorkout(sessionId, { C: 80 })
    await completeWorkoutFromPayload(USER, { workoutSessionId: second })

    const state = await waitForState(sessionId, s => s?.baselineComplete === true, 'the merged baseline to complete')
    expect(state?.baselineComplete).toBe(true)
    // Annotated because `?? {}` widens the record away and `Object.values` then yields `unknown[]`.
    const anchors: Record<string, { kg: number }> = state?.baseline1rm ?? {}
    expect(Object.keys(anchors)).toHaveLength(3)
    // The earlier anchors survived — merged, not replaced by the later session's subset.
    expect(Object.values(anchors).map(e => e.kg).sort((a, b) => a - b)).toEqual([80, 90, 100])
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

    const state = await waitForState(sessionId, s => anchorCount(s) === 1, 'the one usable anchor')
    expect(state?.baselineComplete).toBe(false)
    expect(Object.keys(state?.baseline1rm ?? {})).toHaveLength(1)
  })

  it('leaves a session that is NOT in baseline alone', async () => {
    const { sessionId } = await seed(['A'])
    await repo.advancePhase(USER, sessionId, 'accumulation')
    const wsId = await completedWorkout(sessionId, { A: 100 })
    const { completeWorkoutFromPayload } = await import('@trainingai/shared/workout/complete-workout')
    await completeWorkoutFromPayload(USER, { workoutSessionId: wsId })

    // `completeWorkoutFromPayload` fires the anchor write only when
    // `phase === 'baseline' && !baselineComplete`, so nothing should happen here — and this test is
    // the one that proves the phase half of that guard, so it has to watch for a window rather than
    // assert once. See `expectNoWrite` for why the window fails open.
    await expectNoWrite(sessionId, s => anchorCount(s) > 0, 'no anchor should be written outside baseline')
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

    // Watched rather than asserted once, for the same reason as the test above — though by this
    // file's own measurement the completed-check is NOT what this case catches (deleting both
    // guards together still passed it). What it does catch is the anchor being overwritten, so
    // that is what the window watches for.
    await expectNoWrite(
      sessionId,
      s => s?.baseline1rm[exercises[0].id]?.kg !== 55,
      'the seeded anchor should not be overwritten',
    )
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
