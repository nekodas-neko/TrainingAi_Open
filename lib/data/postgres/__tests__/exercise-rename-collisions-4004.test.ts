// #4004: a rename must survive a person who already has a record, estimate or preference under the
// new name, resolving it per person inside the rename's transaction. DB-backed (CI's Tests job sets
// DATABASE_URL); nothing here deletes a row of user data.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-000000004004'
const B = '00000000-0000-4000-8000-000000014004'
const CREATOR = '00000000-0000-4000-8000-000000024004'

describe.skipIf(!canRun)('rename survives collisions, per person (#4004)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const tag = randomUUID().slice(0, 8)
  let n = 0
  const name = (label: string) => `Rn4004 ${tag} ${label} ${++n}`
  const day = (d: number) => new Date(Date.UTC(2026, 0, d, 2)).toISOString()

  const record = (u: string, nm: string, v: number, achieved = day(5)) =>
    pool.query(`INSERT INTO personal_records (user_id, exercise_name, estimated_1rm, achieved_at) VALUES ($1,$2,$3,$4)`, [u, nm, v, achieved])
  const recordsOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT estimated_1rm, achieved_at FROM personal_records WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows
  const pref = (u: string, nm: string, repMin: number, id: string | null = null) =>
    pool.query(`INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rep_min, rep_max, source) VALUES ($1,$2,$3,$4,$5,'editor')`, [u, nm, id, repMin, repMin + 4])
  const prefsOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT rep_min, deleted_at, exercise_id FROM exercise_preferences WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows
  const make = (nm: string) => repo.createExercise({ name: nm, muscles: [], equipment: [], createdBy: CREATOR })

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of [A, B, CREATOR]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-4004-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['personal_records', 'exercise_preferences', 'exercise_estimates']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1,$2,$3)`, [A, B, CREATOR])
    }
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE $1`, [`Rn4004 ${tag}%`])
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [A, B, CREATOR])
  })

  it('a record under both names no longer aborts the rename; the better figure ends up under the new name', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 140, day(9))
    await record(A, newName, 100, day(3))
    await repo.renameExercise(CREATOR, entry.id, newName)
    const kept = await recordsOf(A, newName)
    expect(kept).toHaveLength(1)
    expect(kept[0].estimated_1rm).toBe(140)
    expect(new Date(kept[0].achieved_at).toISOString()).toBe(day(9))
  })

  it('the target keeps its figure when the old one is lower or tied, and nothing is deleted', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 90, day(9))
    await record(A, newName, 100, day(3))
    await record(B, oldName, 100.003, day(9)) // within the 0.005 tie band
    await record(B, newName, 100, day(3))
    await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })
    expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(100)
    expect(new Date((await recordsOf(B, newName))[0].achieved_at).toISOString()).toBe(day(3))
    // The old-name rows are left in place: personal_records has no tombstone column.
    expect(await recordsOf(A, oldName)).toHaveLength(1)
    expect(await recordsOf(B, oldName)).toHaveLength(1)
  })

  it('one person collides and another does not, in the same rename: records and preferences', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 150)
    await record(A, newName, 100)
    await record(B, oldName, 70) // B has nothing under the new name: moves
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10)
    await pref(B, oldName, 6, null) // moves
    await repo.renameExercise(CREATOR, entry.id, newName)
    expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(150)
    expect((await recordsOf(B, newName)).map(r => r.estimated_1rm)).toEqual([70])
    expect(await recordsOf(B, oldName)).toEqual([])
    // Nobody's data crosses people.
    expect((await recordsOf(A, newName))).toHaveLength(1)
    const aPref = await prefsOf(A, newName)
    expect(aPref).toHaveLength(1)
    expect(aPref[0].rep_min).toBe(10)
    expect((await prefsOf(A, oldName))[0].deleted_at).not.toBeNull()
    const bPref = await prefsOf(B, newName)
    expect(bPref).toHaveLength(1)
    expect(bPref[0].rep_min).toBe(6)
    expect(bPref[0].deleted_at).toBeNull()
    expect(await prefsOf(B, oldName)).toEqual([])
  })

  it('the preference survivor carries the library id of the colliding source', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10, null)
    await repo.renameExercise(CREATOR, entry.id, newName)
    const survivor = await prefsOf(A, newName)
    expect(survivor).toHaveLength(1)
    expect(survivor[0].rep_min).toBe(10)
    expect(survivor[0].exercise_id).toBe(entry.id)
    expect((await prefsOf(A, oldName))[0].exercise_id).toBeNull()
  })

  it('a survivor that already has a library id keeps it', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    const other = await make(name('other'))
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10, other.id)
    await repo.renameExercise(CREATOR, entry.id, newName)
    expect((await prefsOf(A, newName))[0].exercise_id).toBe(other.id)
  })

  it('renameExercise answers 409 when the new name is already in the library, and moves nothing', async () => {
    const oldName = name('old'); const takenName = name('taken')
    const entry = await make(oldName)
    await make(takenName)
    await record(A, oldName, 80)
    await expect(repo.renameExercise(CREATOR, entry.id, takenName)).rejects.toMatchObject({ status: 409 })
    expect(await recordsOf(A, oldName)).toHaveLength(1)
    expect(await recordsOf(A, takenName)).toEqual([])
  })

  it('everything rolls back when a later statement in the transaction fails', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const { repointStoredExerciseNames } = await import('@/lib/data/postgres/exercise-name-tables')
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 150)
    await record(A, newName, 100)
    await record(B, oldName, 70)
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10)
    const db = drizzle(pool)
    await expect(db.transaction(async tx => {
      await repointStoredExerciseNames(tx, oldName, newName)
      throw new Error('a later statement failed')
    })).rejects.toThrow('a later statement failed')
    expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(100)
    expect((await recordsOf(B, oldName)).map(r => r.estimated_1rm)).toEqual([70])
    expect((await prefsOf(A, oldName))[0].deleted_at).toBeNull()
    expect((await prefsOf(A, oldName))[0].exercise_id).toBe(entry.id)
    expect((await prefsOf(A, newName))[0].exercise_id).toBeNull()
  })
})
