// #4001: renaming an exercise repoints every per-user table keyed by its name, not just logs and
// records. The first block needs no database: it scans schema.ts so a new `exercise_name` table
// fails until `EXERCISE_NAME_TABLES` says what a rename does with it. The second block drives both
// rename paths through the repository against a real Postgres (CI's Tests job sets DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { randomUUID } from 'crypto'
import * as schema from '@/lib/data/postgres/schema'
import { EXERCISE_NAME_TABLES } from '@/lib/data/postgres/exercise-name-tables'

describe('every table keyed by exercise_name is accounted for by a rename (#4001)', () => {
  const nameKeyed = Object.values(schema)
    .filter(v => is(v, PgTable))
    .map(t => getTableConfig(t as PgTable))
    .filter(c => c.columns.some(col => col.name === 'exercise_name'))
    .map(c => c.name)
    .sort()

  it('the registry lists exactly the tables that have an exercise_name column', () => {
    expect(Object.keys(EXERCISE_NAME_TABLES).sort()).toEqual(nameKeyed)
  })
})

const canRun = !!process.env.DATABASE_URL
const CREATOR = '00000000-0000-4000-8000-000000004001'
const OTHER = '00000000-0000-4000-8000-000000014001'
const STRANGER = '00000000-0000-4000-8000-000000024001'

describe.skipIf(!canRun)('rename repoints estimates, preferences and hr stats (#4001)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const tag = randomUUID().slice(0, 8)
  let n = 0
  const name = (label: string) => `Rn4001 ${tag} ${label} ${++n}`

  const estimate = (u: string, nm: string, v: number) =>
    pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, estimated_1rm) VALUES ($1,$2,$3)`, [u, nm, v])
  const estimatesOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT estimated_1rm FROM exercise_estimates WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows.map(r => r.estimated_1rm)
  const pref = (u: string, nm: string, repMin: number, repMax: number, id: string | null = null, deleted = false) =>
    pool.query(
      `INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rep_min, rep_max, source, deleted_at)
       VALUES ($1,$2,$3,$4,$5,'editor', ${deleted ? 'now()' : 'NULL'})`, [u, nm, id, repMin, repMax])
  const prefsOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT rep_min, deleted_at, exercise_id FROM exercise_preferences WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [CREATOR, OTHER, STRANGER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-4001-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['exercise_estimates', 'exercise_preferences']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1,$2,$3)`, [CREATOR, OTHER, STRANGER])
    }
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE $1`, [`Rn4001 ${tag}%`])
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [CREATOR, OTHER, STRANGER])
  })

  it('a creator rename moves the estimate and the preference (with and without an exercise_id)', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
    await estimate(CREATOR, oldName, 100)
    await pref(CREATOR, oldName, 8, 12, null)
    await repo.renameExercise(CREATOR, entry.id, newName)
    expect(await estimatesOf(CREATOR, newName)).toEqual([100])
    expect(await estimatesOf(CREATOR, oldName)).toEqual([])
    const moved = await prefsOf(CREATOR, newName)
    expect(moved).toHaveLength(1)
    expect(moved[0].deleted_at).toBeNull()
    expect(await prefsOf(CREATOR, oldName)).toEqual([])
  })

  it('a rename moves every user\'s rows, like the logs and program rows that already follow the library name', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
    await estimate(CREATOR, oldName, 100)
    await estimate(OTHER, oldName, 60)
    await pref(OTHER, oldName, 5, 8)
    await repo.renameExercise(CREATOR, entry.id, newName)
    expect(await estimatesOf(OTHER, newName)).toEqual([60])
    expect(await prefsOf(OTHER, newName)).toHaveLength(1)
    expect(await estimatesOf(OTHER, oldName)).toEqual([])
  })

  it('a user who does not own the custom exercise cannot rename it, and nothing moves', async () => {
    const oldName = name('old')
    const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
    await estimate(STRANGER, oldName, 70)
    await expect(repo.renameExercise(STRANGER, entry.id, name('new'))).rejects.toMatchObject({ status: 403 })
    expect(await estimatesOf(STRANGER, oldName)).toEqual([70])
  })

  it('an admin rename of a library exercise moves every user\'s rows, and a same-name edit moves nothing', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
    await estimate(CREATOR, oldName, 90)
    await estimate(OTHER, oldName, 50)
    await pref(OTHER, oldName, 6, 10)
    await repo.adminUpdateExercise({ id: entry.id, name: oldName, muscles: [], equipment: ['barbell'] })
    expect(await estimatesOf(OTHER, oldName)).toEqual([50])
    await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })
    expect(await estimatesOf(CREATOR, newName)).toEqual([90])
    expect(await estimatesOf(OTHER, newName)).toEqual([50])
    expect(await prefsOf(OTHER, newName)).toHaveLength(1)
  })

  it('moves the set_hr_stats denormalised name too', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
    const ws = randomUUID(); const el = randomUUID(); const sl = randomUUID()
    await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1,$2,'S',now())`, [ws, CREATOR])
    await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1,$2,$3,now())`, [el, ws, oldName])
    await pool.query(`INSERT INTO set_logs (id, exercise_log_id, set_number, reps, weight_kg) VALUES ($1,$2,1,5,50)`, [sl, el])
    await pool.query(
      `INSERT INTO set_hr_stats (set_log_id, user_id, workout_session_id, exercise_log_id, exercise_name, set_number) VALUES ($1,$2,$3,$4,$5,1)`,
      [sl, CREATOR, ws, el, oldName])
    await repo.renameExercise(CREATOR, entry.id, newName)
    const rows = (await pool.query(`SELECT exercise_name FROM set_hr_stats WHERE set_log_id=$1`, [sl])).rows
    expect(rows).toEqual([{ exercise_name: newName }])
    await pool.query(`DELETE FROM workout_sessions WHERE id=$1`, [ws])
  })

  describe('collisions: the target name already has a row for that user', () => {
    it('estimates: the target row wins, and the leftover source row is removed (#4035, owner-approved)', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
      await estimate(CREATOR, oldName, 80)
      await estimate(CREATOR, newName, 120)
      await estimate(OTHER, oldName, 40) // no collision for this user: moves
      await repo.renameExercise(CREATOR, entry.id, newName)
      expect(await estimatesOf(CREATOR, newName)).toEqual([120])
      expect(await estimatesOf(CREATOR, oldName)).toEqual([]) // was [80] before #4035 (the leftover stayed)
      expect(await estimatesOf(OTHER, newName)).toEqual([40])
    })

    it('preferences: both live, the target row stays live and the source is tombstoned', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
      await pref(CREATOR, oldName, 5, 8, entry.id)
      await pref(CREATOR, newName, 10, 15)
      await repo.renameExercise(CREATOR, entry.id, newName)
      const target = await prefsOf(CREATOR, newName)
      expect(target).toHaveLength(1)
      expect(target[0].rep_min).toBe(10)
      expect(target[0].deleted_at).toBeNull()
      const source = await prefsOf(CREATOR, oldName)
      expect(source).toHaveLength(1)
      expect(source[0].deleted_at).not.toBeNull()
      expect(source[0].exercise_id).toBeNull()
    })

    it('preferences: a tombstoned target takes the live source\'s choice instead of hiding it', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
      await pref(CREATOR, oldName, 6, 9)
      await pref(CREATOR, newName, 10, 15, null, true)
      await repo.renameExercise(CREATOR, entry.id, newName)
      const target = await prefsOf(CREATOR, newName)
      expect(target[0].rep_min).toBe(6)
      expect(target[0].deleted_at).toBeNull()
      expect((await prefsOf(CREATOR, oldName))[0].deleted_at).not.toBeNull()
    })

    it('preferences: a tombstoned source stays tombstoned and the live target is untouched', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
      await pref(CREATOR, oldName, 6, 9, null, true)
      await pref(CREATOR, newName, 10, 15)
      await repo.renameExercise(CREATOR, entry.id, newName)
      expect((await prefsOf(CREATOR, newName))[0].rep_min).toBe(10)
      expect((await prefsOf(CREATOR, newName))[0].deleted_at).toBeNull()
    })

    it('adminUpdateExercise resolves a collision the same way, in one transaction with the rest', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await repo.createExercise({ name: oldName, muscles: [], equipment: [], createdBy: CREATOR })
      await estimate(CREATOR, oldName, 80)
      await estimate(CREATOR, newName, 120)
      await pref(CREATOR, oldName, 5, 8)
      await pref(CREATOR, newName, 10, 15)
      await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })
      expect(await estimatesOf(CREATOR, newName)).toEqual([120])
      expect((await prefsOf(CREATOR, newName))[0].rep_min).toBe(10)
      expect((await prefsOf(CREATOR, oldName))[0].deleted_at).not.toBeNull()
    })
  })
})
