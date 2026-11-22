// #4004: a rename must survive a person who already has a record, estimate or preference under the
// new name, resolving it per person inside the rename's transaction. DB-backed (CI's Tests job sets
// DATABASE_URL). The one delete a rename makes is the leftover old-name record row (option A,
// owner-approved on #4004); the tests below pin how narrow it is.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-000000004004'
const B = '00000000-0000-4000-8000-000000014004'
const CREATOR = '00000000-0000-4000-8000-000000024004'
const C = '00000000-0000-4000-8000-000000034004'

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
    for (const id of [A, B, C, CREATOR]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-4004-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id IN ($1,$2,$3,$4)`, [A, B, C, CREATOR])
    for (const t of ['personal_records', 'exercise_preferences', 'exercise_estimates']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id IN ($1,$2,$3,$4)`, [A, B, C, CREATOR])
    }
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE $1`, [`Rn4004 ${tag}%`])
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [A, B, C, CREATOR])
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
    // Exactly one row for the lift: the old-name row is gone.
    expect(await recordsOf(A, oldName)).toEqual([])
    const all = await pool.query(`SELECT 1 FROM personal_records WHERE user_id=$1 AND exercise_name IN ($2,$3)`, [A, oldName, newName])
    expect(all.rows).toHaveLength(1)
  })

  it('the target keeps its figure when the old one is lower or tied; the leftover old-name rows are removed', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 90, day(9))
    await record(A, newName, 100, day(3))
    await record(B, oldName, 100.003, day(9)) // within the 0.005 tie band
    await record(B, newName, 100, day(3))
    await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })
    expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(100)
    expect(new Date((await recordsOf(B, newName))[0].achieved_at).toISOString()).toBe(day(3))
    // The leftover old-name rows are gone: lower, and inside the tie band.
    expect(await recordsOf(A, oldName)).toEqual([])
    expect(await recordsOf(B, oldName)).toEqual([])
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
    expect(await recordsOf(A, oldName)).toEqual([])
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

  it('the record count is one per lift after a collision, not one extra', async () => {
    const { computeAchievements } = await import('@/lib/achievements')
    const prCount = async () => (await computeAchievements(C, 'Australia/Brisbane')).achievements.find(a => a.id === 'first_pr')!.current
    const oldName = name('old'); const newName = name('new'); const unrelated = name('unrelated')
    const entry = await make(oldName)
    await record(C, unrelated, 60)
    await record(C, newName, 100, day(3))
    expect(await prCount()).toBe(2) // before the old-name row exists
    await record(C, oldName, 140, day(9))
    expect(await prCount()).toBe(3) // the collision's second row, as it would read without the cleanup
    await repo.renameExercise(CREATOR, entry.id, newName)
    expect(await prCount()).toBe(2) // back to one row per lift; the unrelated record is untouched
    expect((await recordsOf(C, unrelated))[0].estimated_1rm).toBe(60)
    expect((await recordsOf(C, newName))[0].estimated_1rm).toBe(140)
  })

  describe('the delete is narrow', () => {
    // A rename moves every log, so a log still under the old name is constructed: the repoint runs on
    // its own in a transaction with a log (and its session) the move did not reach.
    const repoint = async (oldName: string, newName: string) => {
      const { getDb } = await import('@/lib/data/postgres/client')
      const { repointStoredExerciseNames } = await import('@/lib/data/postgres/exercise-name-tables')
      await getDb().transaction(tx => repointStoredExerciseNames(tx, oldName, newName))
    }
    const logUnder = async (u: string, nm: string) => {
      const ws = randomUUID()
      await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1,$2,'S',now())`, [ws, u])
      await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1,$2,$3,now())`, [randomUUID(), ws, nm])
    }

    it('keeps the old-name row of a person who still has a log under the old name', async () => {
      const oldName = name('old'); const newName = name('new')
      await record(A, oldName, 120)
      await record(A, newName, 100)
      await logUnder(A, oldName)
      await repoint(oldName, newName)
      expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(120) // still raised
      expect(await recordsOf(A, oldName)).toHaveLength(1) // but supported by a log, so kept
    })

    it('never removes a leftover that is better than the survivor', async () => {
      const oldName = name('old'); const newName = name('new')
      await record(A, oldName, 140, day(9))
      await record(A, newName, 100, day(3))
      // Hold the survivor down: the raise cannot happen, as if the better figure had not been copied.
      const fn = `rn4004_hold_${tag}`
      await pool.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
        IF OLD.exercise_name = '${newName}' THEN RETURN NULL; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
      await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON personal_records FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
      try {
        await repoint(oldName, newName)
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON personal_records`)
        await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`)
      }
      expect((await recordsOf(A, newName))[0].estimated_1rm).toBe(100)
      expect((await recordsOf(A, oldName))[0].estimated_1rm).toBe(140) // the only copy of the better figure survives
    })

    it('removes only the colliding person\'s old-name row; nobody else\'s rows change', async () => {
      const oldName = name('old'); const newName = name('new'); const other = name('other')
      const entry = await make(oldName)
      await record(A, oldName, 150); await record(A, newName, 100) // collides
      await record(B, oldName, 70) // moves
      await record(C, other, 55) // unrelated
      const before = (await pool.query(`SELECT user_id, exercise_name, estimated_1rm, achieved_at FROM personal_records WHERE user_id IN ($1,$2) AND exercise_name = $3`, [B, C, other])).rows
      await repo.renameExercise(CREATOR, entry.id, newName)
      expect(await recordsOf(A, oldName)).toEqual([])
      expect((await recordsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([150])
      expect((await recordsOf(B, newName)).map(r => r.estimated_1rm)).toEqual([70])
      expect(await recordsOf(B, oldName)).toEqual([])
      const after = (await pool.query(`SELECT user_id, exercise_name, estimated_1rm, achieved_at FROM personal_records WHERE user_id IN ($1,$2) AND exercise_name = $3`, [B, C, other])).rows
      expect(after).toEqual(before)
    })

    it('a rename with no collision deletes nothing', async () => {
      const oldName = name('old'); const newName = name('new'); const other = name('other')
      const entry = await make(oldName)
      await record(A, oldName, 150, day(9))
      await record(B, other, 90)
      await record(A, other, 80)
      const total = async () => Number((await pool.query(`SELECT count(*) FROM personal_records WHERE user_id IN ($1,$2,$3)`, [A, B, C])).rows[0].count)
      const before = await total()
      await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })
      expect(await total()).toBe(before)
      expect(await recordsOf(A, newName)).toHaveLength(1)
      expect(await recordsOf(A, oldName)).toEqual([])
    })

    it('a name-only rename of an exercise nobody has a record for deletes nothing', async () => {
      const oldName = name('old'); const newName = name('new'); const other = name('other')
      const entry = await make(oldName)
      await record(A, other, 80)
      const before = Number((await pool.query(`SELECT count(*) FROM personal_records WHERE user_id=$1`, [A])).rows[0].count)
      await repo.renameExercise(CREATOR, entry.id, newName)
      expect(Number((await pool.query(`SELECT count(*) FROM personal_records WHERE user_id=$1`, [A])).rows[0].count)).toBe(before)
    })
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

  it('a person who has neither name is untouched by someone else\'s collision', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await record(A, oldName, 150)
    await record(A, newName, 100)
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10)
    await repo.renameExercise(CREATOR, entry.id, newName)
    for (const nm of [oldName, newName]) {
      expect(await recordsOf(B, nm)).toEqual([])
      expect(await prefsOf(B, nm)).toEqual([])
    }
  })

  it('the raised record keeps its own exercise_id; the old-name row keeps its own, so no two rows are re-pointed at one exercise', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    const other = await make(name('other'))
    await pool.query(`INSERT INTO personal_records (user_id, exercise_name, exercise_id, estimated_1rm, achieved_at) VALUES ($1,$2,$3,140,$4)`, [A, oldName, entry.id, day(9)])
    await pool.query(`INSERT INTO personal_records (user_id, exercise_name, exercise_id, estimated_1rm, achieved_at) VALUES ($1,$2,$3,100,$4)`, [B, oldName, entry.id, day(9)])
    // A's target row has no id; B's target row has a different exercise's id.
    await pool.query(`INSERT INTO personal_records (user_id, exercise_name, exercise_id, estimated_1rm, achieved_at) VALUES ($1,$2,NULL,100,$3)`, [A, newName, day(3)])
    await pool.query(`INSERT INTO personal_records (user_id, exercise_name, exercise_id, estimated_1rm, achieved_at) VALUES ($1,$2,$3,90,$4)`, [B, newName, other.id, day(3)])
    await repo.renameExercise(CREATOR, entry.id, newName)
    const ids = async (u: string, nm: string) =>
      (await pool.query(`SELECT exercise_id, estimated_1rm FROM personal_records WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows[0]
    expect(await ids(A, newName)).toMatchObject({ exercise_id: null, estimated_1rm: 140 })
    expect(await ids(B, newName)).toMatchObject({ exercise_id: other.id, estimated_1rm: 100 })
  })

  it('a tombstoned target preference is revived with the source\'s choices and the renamed exercise\'s id', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10, null)
    await pool.query(`UPDATE exercise_preferences SET deleted_at = now() WHERE user_id=$1 AND exercise_name=$2`, [A, newName])
    await repo.renameExercise(CREATOR, entry.id, newName)
    const survivor = await prefsOf(A, newName)
    expect(survivor).toHaveLength(1)
    expect(survivor[0]).toMatchObject({ rep_min: 5, deleted_at: null, exercise_id: entry.id })
    expect((await prefsOf(A, oldName))[0].deleted_at).not.toBeNull()
  })

  it('a tombstoned target holding a DIFFERENT exercise\'s id is revived pointing at the renamed exercise, never the other one', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    const other = await make(name('other'))
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10, other.id)
    await pool.query(`UPDATE exercise_preferences SET deleted_at = now() WHERE user_id=$1 AND exercise_name=$2`, [A, newName])
    await repo.renameExercise(CREATOR, entry.id, newName)
    const survivor = await prefsOf(A, newName)
    expect(survivor).toHaveLength(1)
    expect(survivor[0]).toMatchObject({ rep_min: 5, deleted_at: null, exercise_id: entry.id })
    // Without a source id the revived row points at nothing rather than at the other exercise.
    const oldName2 = name('old'); const newName2 = name('new')
    const entry2 = await make(oldName2)
    await pref(B, oldName2, 6, null)
    await pref(B, newName2, 11, other.id)
    await pool.query(`UPDATE exercise_preferences SET deleted_at = now() WHERE user_id=$1 AND exercise_name=$2`, [B, newName2])
    await repo.renameExercise(CREATOR, entry2.id, newName2)
    expect((await prefsOf(B, newName2))[0]).toMatchObject({ rep_min: 6, deleted_at: null, exercise_id: null })
  })

  it('a unique violation at the library-name update answers the same 409 as the pre-check', async () => {
    const oldName = name('old'); const racedName = name('raced')
    const entry = await make(oldName)
    const fn = `rn4004_race_${tag}`
    // The name is free at the pre-check; the trigger takes it, as a concurrent create would, just
    // before the library row is updated.
    await pool.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.name = '${racedName}' AND OLD.name <> NEW.name THEN
        INSERT INTO exercise_library (name) VALUES ('${racedName}');
      END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON exercise_library FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
    try {
      await record(A, oldName, 80)
      await expect(repo.renameExercise(CREATOR, entry.id, racedName)).rejects.toMatchObject({ status: 409 })
      expect(await recordsOf(A, oldName)).toHaveLength(1)
      expect(await recordsOf(A, racedName)).toEqual([])
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON exercise_library`)
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`)
    }
  })

  it('renameExercise rolls everything back when its last statement fails', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    const ws = randomUUID(); const el = randomUUID()
    await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1,$2,'S',now())`, [ws, A])
    await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1,$2,$3,now())`, [el, ws, oldName])
    await record(A, oldName, 150, day(9))
    await record(A, newName, 100, day(3))
    await record(B, oldName, 70)
    await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, estimated_1rm) VALUES ($1,$2,120)`, [A, oldName])
    await pool.query(`INSERT INTO exercise_estimates (user_id, exercise_name, estimated_1rm) VALUES ($1,$2,110)`, [A, newName])
    await pref(A, oldName, 5, entry.id)
    await pref(A, newName, 10)
    await pref(B, oldName, 6, null)
    const snapshot = async () => ({
      records: (await pool.query(`SELECT user_id, exercise_name, exercise_id, estimated_1rm, achieved_at FROM personal_records WHERE exercise_name IN ($1,$2) ORDER BY 1,2`, [oldName, newName])).rows,
      logs: (await pool.query(`SELECT exercise_name FROM exercise_logs WHERE id=$1`, [el])).rows,
      estimates: (await pool.query(`SELECT user_id, exercise_name, estimated_1rm FROM exercise_estimates WHERE exercise_name IN ($1,$2) ORDER BY 1,2`, [oldName, newName])).rows,
      prefs: (await pool.query(`SELECT user_id, exercise_name, exercise_id, rep_min, deleted_at FROM exercise_preferences WHERE exercise_name IN ($1,$2) ORDER BY 1,2`, [oldName, newName])).rows,
      library: (await pool.query(`SELECT name FROM exercise_library WHERE id=$1`, [entry.id])).rows,
    })
    const before = await snapshot()
    const fn = `rn4004_fail_${tag}`
    // The library update is the last statement of the rename: make only it fail.
    await pool.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.name = '${newName}' THEN RAISE EXCEPTION 'forced failure at the last statement'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON exercise_library FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
    try {
      await expect(repo.renameExercise(CREATOR, entry.id, newName)).rejects.toThrow()
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON exercise_library`)
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`)
    }
    expect(await snapshot()).toEqual(before)
    expect(before.logs[0].exercise_name).toBe(oldName)
  })
})
