// #3896 step 4: the reader of `exercise_preferences` and the one-shot clear, against a real Postgres.
//   - The read is owner-scoped and live-only: another user's row and a tombstoned row are never read.
//   - A lift is matched by its library id first, so a renamed lift is still found; the name fallback
//     never takes a row whose id names a different lift.
//   - The one-shot is consumed only by a log of a plan that carried that exact one-shot (the plan records
//     its write time and the log echoes it), once: never by a log of an older plan, a stale queue entry
//     or another session's plan, never by a retry of a stored log or a deload log, never twice when two
//     consumes race, never by a forged value. An expired one-shot (14 days, database clock) is not
//     applied and is cleared by the next read.
//   - Lifts are matched by exact name, as the `exercise_estimates` readers do.
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
  // Every time here is the database's: `now() - interval` in SQL, as step 5's writer must write it.
  const addShot = (userId: string, name: string, cols: Record<string, unknown>, setAt: string, exerciseId: string | null = null) => {
    const all = { user_id: userId, exercise_name: name, exercise_id: exerciseId, source: 'coach', ...cols }
    const keys = [...Object.keys(all), 'one_shot_set_at']
    return pool.query(
      `INSERT INTO exercise_preferences (${keys.join(', ')}) VALUES (${[...Object.keys(all)].map((_, i) => `$${i + 1}`).join(', ')}, now() - interval '${setAt}')`,
      Object.values(all))
  }
  /** What a plan made now would record for the lift: the reader's `oneShotSetAt`. */
  const servedBy = async (userId: string, name: string) => (await repo.listExercisePreferences(userId, [name])).get(name)!.oneShotSetAt!

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

    it('a lift is matched by its exact name: other case or spacing is another lift (as exercise_estimates is)', async () => {
      await add(USER_A, 'Custom Lift 3896', { rest_sec: 75 })
      const got = await repo.listExercisePreferences(USER_A, ['custom lift 3896', 'Custom Lift 3896 '])
      expect(got.size).toBe(0)
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

  describe('the one-shot is consumed exactly once, and only by a log of the plan that carried it', () => {
    it('the matching consume clears the one-shot and keeps the lasting fields; a retry clears nothing', async () => {
      await addShot(USER_A, LIFT, { rep_min: 10, rep_max: 13, next_load_step: 'lighter', sets_delta: 1 }, '5 minutes', libId)
      const served = await servedBy(USER_A, LIFT)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, served)).toBe(true)
      expect(await oneShotOf(USER_A, LIFT)).toMatchObject({ next_load_step: null, sets_delta: null, one_shot_set_at: null, rep_min: 10, rep_max: 13 })
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, served)).toBe(false)
    })

    it('two concurrent consumes with the same value: exactly one takes it', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'heavier' }, '5 minutes', libId)
      const served = await servedBy(USER_A, LIFT)
      const results = await Promise.all([1, 2, 3].map(() => repo.consumeLiftOneShot(USER_A, LIFT, served)))
      expect(results.filter(Boolean)).toHaveLength(1)
    })

    it('a stale or forged value consumes nothing and is never written', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '5 minutes', libId)
      const before = await oneShotOf(USER_A, LIFT)
      const served = await servedBy(USER_A, LIFT)
      for (const forged of [
        new Date(served.getTime() - 60_000), new Date(served.getTime() + 60_000), new Date(served.getTime() - 3_600_000),
        new Date(served.getTime() + 5), new Date(0), new Date('invalid'),
      ]) {
        expect(await repo.consumeLiftOneShot(USER_A, LIFT, forged)).toBe(false)
      }
      expect(await oneShotOf(USER_A, LIFT)).toEqual(before) // nothing was cleared and nothing was stored
    })

    it('the value is matched to the millisecond the plan recorded, even though the row holds microseconds', async () => {
      await pool.query(
        `INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, source, next_load_step, one_shot_set_at)
         VALUES ($1, $2, $3, 'coach', 'lighter', timestamptz '2026-11-20 10:00:00.123987+00')`, [USER_A, LIFT, libId])
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date('2026-11-20T10:00:00.123Z'))).toBe(true)
    })

    it('another user\'s one-shot is never consumed, even with its exact value', async () => {
      await addShot(USER_B, LIFT, { next_load_step: 'lighter' }, '5 minutes', libId)
      const served = await servedBy(USER_B, LIFT)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, served)).toBe(false)
      expect((await oneShotOf(USER_B, LIFT)).next_load_step).toBe('lighter')
    })

    it('a tombstoned row is never consumed', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter', deleted_at: new Date() }, '5 minutes', libId)
      expect(await repo.consumeLiftOneShot(USER_A, LIFT, new Date())).toBe(false)
    })
  })

  describe('a one-shot expires after 14 days, on the database clock', () => {
    it('is applied at 13 days, and cleared (and not applied) at 15, by the read', async () => {
      await addShot(USER_A, LIFT, { rep_min: 10, rep_max: 12, next_load_step: 'lighter', sets_delta: -1 }, '13 days', libId)
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)).toMatchObject({ nextLoadStep: 'lighter', setsDelta: -1 })
      await pool.query(`UPDATE exercise_preferences SET one_shot_set_at = now() - interval '15 days' WHERE user_id = $1`, [USER_A])
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)).toMatchObject({ repMin: 10, nextLoadStep: null, setsDelta: null, oneShotSetAt: null })
      expect(await oneShotOf(USER_A, LIFT)).toMatchObject({ next_load_step: null, sets_delta: null, one_shot_set_at: null, rep_min: 10 }) // cleared in the table
    })

    it('the clear touches only expired rows, and only the reader\'s own user', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '1 day', libId)
      await addShot(USER_A, OTHER_LIFT, { next_load_step: 'lighter' }, '20 days', otherLibId)
      await addShot(USER_B, LIFT, { next_load_step: 'lighter' }, '20 days', libId)
      await repo.listExercisePreferences(USER_A, [LIFT])
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
      expect((await oneShotOf(USER_A, OTHER_LIFT)).next_load_step).toBeNull()
      expect((await oneShotOf(USER_B, LIFT)).next_load_step).toBe('lighter')
    })

    it('a one-shot written again after it expired is not cleared by the old expiry', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '20 days', libId)
      await pool.query(`UPDATE exercise_preferences SET one_shot_set_at = now() WHERE user_id = $1`, [USER_A])
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)).toMatchObject({ nextLoadStep: 'lighter' })
    })
  })

  describe('through the real log write (logExerciseWithRepo)', () => {
    const log = async (over: Record<string, unknown> = {}) => {
      const { logExerciseWithRepo } = await import('@trainingai/shared/workout/log-exercise-core')
      return logExerciseWithRepo(repo, USER_A, {
        sessionName: '3896 one-shot', exercise: LIFT, weights: [40, 40], sets: 2, reps: [10, 10], ...over,
      } as Parameters<typeof logExerciseWithRepo>[2], TZ)
    }
    const fresh = () => ({ exerciseLogId: crypto.randomUUID(), workoutSessionId: crypto.randomUUID(), setLogIds: [crypto.randomUUID(), crypto.randomUUID()] })

    it('normal: a new log of the plan that carried the one-shot consumes it once; a re-push after a newer one-shot does not', async () => {
      await addShot(USER_A, LIFT, { rep_min: 10, rep_max: 12, sets_delta: -1 }, '5 minutes', libId)
      const ids = fresh()
      await log({ ...ids, liftOneShotSetAt: (await servedBy(USER_A, LIFT)).toISOString() })
      expect(await oneShotOf(USER_A, LIFT)).toMatchObject({ sets_delta: null, one_shot_set_at: null, rep_min: 10 })

      // A newer one-shot, then the outbox re-pushes the log it already stored (echoing the old value).
      const old = new Date(Date.now() - 5 * 60_000).toISOString()
      await pool.query(`UPDATE exercise_preferences SET next_load_step = 'heavier', one_shot_set_at = now() WHERE user_id = $1 AND exercise_name = $2`, [USER_A, LIFT])
      await log({ ...ids, liftOneShotSetAt: old })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('heavier')
      // Even echoing the newer value, a re-push of a stored log is not a new log.
      await log({ ...ids, liftOneShotSetAt: (await servedBy(USER_A, LIFT)).toISOString() })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('heavier')
    })

    it('A: set after today\'s plan was stored; the lift is logged from that older plan: the step stays', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '1 minute', libId)
      await log({ ...fresh() }) // the older plan carried no one-shot, so the payload names none
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
      // ... or names the one-shot that was stored before the current one
      await log({ ...fresh(), liftOneShotSetAt: new Date(Date.now() - 3_600_000).toISOString() })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('B: set while an older offline log was queued; it syncs later: the step stays, the next plan\'s log takes it', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '1 minute', libId)
      // The queued log was made from a plan before the step existed, and reaches the server now.
      await log({ ...fresh(), localDate: '2026-11-20' })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
      await log({ ...fresh(), liftOneShotSetAt: (await servedBy(USER_A, LIFT)).toISOString() })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBeNull()
    })

    it('C: the lift is skipped for weeks: the one-shot expires instead of applying later', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '20 days', libId)
      expect((await repo.listExercisePreferences(USER_A, [LIFT])).get(LIFT)?.nextLoadStep).toBeNull()
      await log({ ...fresh() })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBeNull()
    })

    it('a forged value from the client consumes nothing', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '5 minutes', libId)
      await log({ ...fresh(), liftOneShotSetAt: '2020-01-01T00:00:00.000Z' })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('a log of another session containing the lift consumes it only if that session\'s plan carried it', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '5 minutes', libId)
      await log({ ...fresh(), sessionName: 'Another session' }) // that stored plan predates the step
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('a deloaded log does not consume it, even naming the value', async () => {
      await addShot(USER_A, LIFT, { next_load_step: 'lighter' }, '5 minutes', libId)
      await log({ exerciseDeloaded: true, liftOneShotSetAt: (await servedBy(USER_A, LIFT)).toISOString() })
      expect((await oneShotOf(USER_A, LIFT)).next_load_step).toBe('lighter')
    })

    it('with no preference row the log writes as before and nothing else changes', async () => {
      const r = await log()
      expect(r.superseded).toBe(false)
      expect((await pool.query(`SELECT count(*)::int AS n FROM exercise_preferences WHERE user_id = $1`, [USER_A])).rows[0].n).toBe(0)
    })
  })
})
