// #3896 step 4: the reader of `exercise_preferences` and the one-shot clear, against a real Postgres.
//   - The read is owner-scoped and live-only: another user's row and a tombstoned row are never read.
//   - A lift is matched by its library id first, so a renamed lift is still found; the name fallback
//     never takes a row whose id names a different lift.
//   - The one-shot is consumed once: by the first new log, never by a retry of a stored log, never by
//     a deload log, never twice when two consumes race, and never when it was set after the log arrived.
//
// Runs only against a real Postgres (DATABASE_URL); CI's "Tests" job sets one. Made-up names only.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER_A = '00000000-0000-4000-8000-0000000389a1'
const USER_B = '00000000-0000-4000-8000-0000000389a2'
const LIFT = 'Pref Reader Lift 3896'
const OTHER_LIFT = 'Pref Reader Other Lift 3896'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('exercise_preferences reader and one-shot clear (#3896 step 4)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let libId: string
  let otherLibId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    for (const id of [USER_A, USER_B]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
        [id, `prefs-reader-${id}@example.com`, TZ])
    }
    const lib = (name: string) => pool.query(
      `INSERT INTO exercise_library (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [name])
    libId = (await lib(LIFT)).rows[0].id
    otherLibId = (await lib(OTHER_LIFT)).rows[0].id
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM exercise_preferences WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER_A, USER_B]])
    await pool.query(`DELETE FROM exercise_library WHERE id = ANY($1::uuid[])`, [[libId, otherLibId]])
  })

  const add = (userId: string, name: string, cols: Record<string, unknown> = {}, exerciseId: string | null = null) => {
    const all = { user_id: userId, exercise_name: name, exercise_id: exerciseId, source: 'coach', ...cols }
    const keys = Object.keys(all)
    return pool.query(
      `INSERT INTO exercise_preferences (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(all))
  }
  const oneShotOf = async (userId: string, name: string) => (await pool.query(
    `SELECT next_load_step, sets_delta, one_shot_set_at, rep_min, rep_max FROM exercise_preferences WHERE user_id = $1 AND exercise_name = $2`,
    [userId, name])).rows[0]
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000)

  describe('the read', () => {
    it('reads the owner\'s live row, and never another user\'s', async () => {
      await add(USER_B, LIFT, { rep_min: 15, rep_max: 20 })
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).size).toBe(0)
      await add(USER_A, LIFT, { rep_min: 10, rep_max: 13, rest_sec: 90 })
      const got = await repo.listExercisePreferences(USER_A, [LIFT])
      expect(got.get(LIFT)).toMatchObject({ repMin: 10, repMax: 13, restSec: 90, nextLoadStep: null, setsDelta: null, oneShotSetAt: null })
    })

    it('a tombstoned row is not read', async () => {
      await add(USER_A, LIFT, { rep_min: 10, rep_max: 13, deleted_at: new Date() })
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).size).toBe(0)
    })

    it('a renamed lift is found by its library id', async () => {
      // The row still carries the lift's old name; the session now calls it by the library's name.
      await add(USER_A, 'An Older Name 3896', { rep_min: 8, rep_max: 10 }, libId)
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)).toMatchObject({ repMin: 8, repMax: 10 })
    })

    it('an id match wins over a name match', async () => {
      await add(USER_A, LIFT, { rep_min: 5, rep_max: 6 })
      await add(USER_A, 'An Older Name 3896', { rep_min: 8, rep_max: 10 }, libId)
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)).toMatchObject({ repMin: 8, repMax: 10 })
    })

    it('the name fallback skips a row whose id names a different lift', async () => {
      await add(USER_A, LIFT, { rep_min: 5, rep_max: 6 }, otherLibId)
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).size).toBe(0)
    })

    it('a custom lift (not in the library) is matched by name', async () => {
      await add(USER_A, 'Custom Lift 3896', { rest_sec: 75 })
      expect((await repo.listExercisePreferences(USER_A, ['Custom Lift 3896'])).get('Custom Lift 3896')).toMatchObject({ restSec: 75 })
    })

    it('one query answers several lifts, keyed by the name passed', async () => {
      await add(USER_A, LIFT, { rep_min: 10, rep_max: 12 })
      await add(USER_A, OTHER_LIFT, { rest_sec: 60 })
      const got = await repo.listExercisePreferences(USER_A, [LIFT, OTHER_LIFT, 'Nothing Stored 3896'])
      expect([...got.keys()].sort()).toEqual([OTHER_LIFT, LIFT].sort())
    })
  })

  describe('the one-shot is consumed exactly once', () => {
    it('the first consume clears the one-shot and keeps the lasting fields; a retry clears nothing', async () => {
      await add(USER_A, LIFT, { rep_min: 10, rep_max: 13, next_load_step: 'lighter', sets_delta: 1, one_shot_set_at: minutesAgo(5) }, libId)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date())).toBe(true)
      expect(await oneShotOf(USER_A, LIFT)).toMatchObject({ next_load_step: null, sets_delta: null, one_shot_set_at: null, rep_min: 10, rep_max: 13 })
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date())).toBe(false)
    })

    it('two concurrent consumes: exactly one takes it', async () => {
      await add(USER_A, LIFT, { next_load_step: 'heavier', one_shot_set_at: minutesAgo(5) }, libId)
      const results = await Promise.all([
        repo.consumeLiftOneShot(USER_A, LIFT, new Date()),
        repo.consumeLiftOneShot(USER_A, LIFT, new Date()),
        repo.consumeLiftOneShot(USER_A, LIFT, new Date()),
      ])
      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it('a one-shot set after the log arrived (server time) is not consumed by it', async () => {
      await add(USER_A, LIFT, { next_load_step: 'lighter', one_shot_set_at: new Date() }, libId)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, minutesAgo(1))).toBe(false)
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('another user\'s one-shot is never consumed', async () => {
      await add(USER_B, LIFT, { next_load_step: 'lighter', one_shot_set_at: minutesAgo(5) }, libId)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date())).toBe(false)
      expect((await oneShotOf(USER_B, LIFT)).next_load_step).toBe('lighter')
    })

    it('a tombstoned row is never consumed', async () => {
      await add(USER_A, LIFT, { next_load_step: 'lighter', one_shot_set_at: minutesAgo(5), deleted_at: new Date() }, libId)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date())).toBe(false)
    })
  })

  describe('through the real log write (logExerciseWithRepo)', () => {
    const log = async (over: Record<string, unknown> = {}) => {
      const { logExerciseWithRepo } = await import('@trainingai/shared/workout/log-exercise-core')
      return logExerciseWithRepo(repo, USER_A, {
        sessionName: '3896 one-shot', exercise: LIFT, weights: [40, 40], sets: 2, reps: [10, 10], ...over,
      } as Parameters<typeof logExerciseWithRepo>[2], TZ)
    }

    it('a new log consumes it; pushing the same log again after a new one-shot does not', async () => {
      await add(USER_A, LIFT, { rep_min: 10, rep_max: 12, sets_delta: -1, one_shot_set_at: minutesAgo(5) }, libId)
      const ids = { exerciseLogId: crypto.randomUUID(), workoutSessionId: crypto.randomUUID(), setLogIds: [crypto.randomUUID(), crypto.randomUUID()] }
      await log(ids)
      expect(await oneShotOf(USER_A, LIFT)).toMatchObject({ sets_delta: null, one_shot_set_at: null, rep_min: 10 })

      // A newer one-shot, then the outbox re-pushes the log it already stored.
      await pool.query(
        `UPDATE exercise_preferences SET next_load_step = 'heavier', one_shot_set_at = $3 WHERE user_id = $1 AND exercise_name = $2`,
        [USER_A, LIFT, minutesAgo(1)])
      await log(ids)
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('heavier')
    })

    it('a deloaded log does not consume it', async () => {
      await add(USER_A, LIFT, { next_load_step: 'lighter', one_shot_set_at: minutesAgo(5) }, libId)
      await log({ exerciseDeloaded: true })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('with no preference row the log writes as before and nothing else changes', async () => {
      const r = await log()
      expect(r.superseded).toBe(false)
      expect((await pool.query(`SELECT count(*)::int AS n FROM exercise_preferences WHERE user_id = $1`, [USER_A])).rows[0].n).toBe(0)
    })
  })
})
