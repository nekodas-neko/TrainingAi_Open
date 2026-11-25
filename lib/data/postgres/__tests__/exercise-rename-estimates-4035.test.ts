// #4035 (answer 1 A, owner-approved 22 Nov): a rename that collides on an `exercise_estimates` row
// removes the person's leftover old-name row, in the rename's transaction, and nothing else. DB-backed
// (CI's Tests job sets DATABASE_URL). Fake users only; every row is removed in afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'crypto'

const canRun = !!process.env.DATABASE_URL
const U = (n: number) => `00000000-0000-4000-8000-000000${String(n).padStart(2, "0")}4035`
const [A, B, C, D, E, CREATOR] = [U(1), U(2), U(3), U(4), U(5), U(6)]
const ALL = [A, B, C, D, E, CREATOR]

describe.skipIf(!canRun)('rename removes the leftover estimate of a colliding person (#4035)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const tag = randomUUID().slice(0, 8)
  let n = 0
  const name = (label: string) => `Rn4035 ${tag} ${label} ${++n}`
  const made: string[] = []
  const day = (d: number) => new Date(Date.UTC(2026, 0, d, 2)).toISOString()

  const make = async (nm: string) => { made.push(nm); return repo.createExercise({ name: nm, muscles: [], equipment: [], createdBy: CREATOR }) }
  const est = (u: string, nm: string, v: number, updated = day(5), id: string | null = null, created = day(1)) =>
    pool.query(
      `INSERT INTO exercise_estimates (user_id, exercise_name, exercise_id, estimated_1rm, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [u, nm, id, v, created, updated])
  const rowsOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT exercise_id, estimated_1rm, created_at, updated_at FROM exercise_estimates WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows
  const snapshotAll = async () =>
    (await pool.query(`SELECT * FROM exercise_estimates WHERE user_id = ANY($1) ORDER BY user_id, exercise_name`, [ALL])).rows

  const renameVia = {
    renameExercise: (id: string, newName: string) => repo.renameExercise(CREATOR, id, newName),
    adminUpdateExercise: (id: string, newName: string) => repo.adminUpdateExercise({ id, name: newName, muscles: [], equipment: [] }),
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of ALL) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-4035-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['personal_records', 'exercise_preferences', 'exercise_estimates']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = ANY($1)`, [ALL])
    }
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [ALL])
    for (const nm of made) await pool.query(`DELETE FROM exercise_library WHERE name = $1`, [nm])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ALL])
  })

  describe.each(Object.keys(renameVia) as (keyof typeof renameVia)[])('five people, through %s', via => {
    it('removes only the colliders\' old-name rows; the mover moves; everyone else is byte-identical', async () => {
      const oldName = name('old'); const newName = name('new'); const other = name('other')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(2)); await est(A, newName, 120, day(6)) // collides, old is older
      await est(E, oldName, 150, day(9)); await est(E, newName, 110, day(6)) // collides, old was typed later
      await est(B, oldName, 70, day(3)) // only the old name: moves
      await est(C, newName, 90, day(4)) // only the new name
      await est(A, other, 55, day(4)); await est(D, other, 65, day(4)) // another exercise; D has nothing here
      const before = await snapshotAll()
      const idOf = (rows: typeof before, u: string, nm: string) => rows.find(r => r.user_id === u && r.exercise_name === nm)

      await renameVia[via](entry.id, newName)
      const after = await snapshotAll()

      // Only A's and E's old-name rows are gone.
      expect(before.length - after.length).toBe(2)
      expect(idOf(after, A, oldName)).toBeUndefined()
      expect(idOf(after, E, oldName)).toBeUndefined()
      // B's row moved, as the same row.
      const bBefore = idOf(before, B, oldName)!; const bAfter = idOf(after, B, newName)!
      expect(bAfter.id).toBe(bBefore.id); expect(bAfter.estimated_1rm).toBe(70)
      expect(idOf(after, B, oldName)).toBeUndefined()
      // C, D and every other-exercise row: identical, all columns.
      for (const [u, nm] of [[C, newName], [D, other], [A, other]] as const) {
        expect(idOf(after, u, nm)).toEqual(idOf(before, u, nm))
      }
      // A's survivor: the old row was older, so nothing about it changed.
      expect(idOf(after, A, newName)).toEqual(idOf(before, A, newName))
      // E's survivor: same row, takes the later-typed figure and its date.
      const eAfter = idOf(after, E, newName)!
      expect(eAfter.id).toBe(idOf(before, E, newName)!.id)
      expect(eAfter.estimated_1rm).toBe(150)
      expect(new Date(eAfter.updated_at).toISOString()).toBe(day(9))
      expect(new Date(eAfter.created_at).toISOString()).toBe(day(1))
    })
  })

  describe('what the survivor holds', () => {
    const collide = async (a: { old: [number, string] | [number, string, string | null]; new: [number, string] | [number, string, string | null] }, who = A) => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await est(who, oldName, a.old[0], a.old[1], (a.old[2] as string | null | undefined) ?? null)
      await est(who, newName, a.new[0], a.new[1], (a.new[2] as string | null | undefined) ?? null)
      await renameVia.renameExercise(entry.id, newName)
      expect(await rowsOf(who, oldName)).toEqual([])
      const rows = await rowsOf(who, newName)
      expect(rows).toHaveLength(1)
      return { rows: rows[0], entry }
    }

    it('a later-typed old figure is carried, with its updated_at, even when it is lower (the latest entry is the person\'s intent)', async () => {
      const { rows } = await collide({ old: [80, day(9)], new: [120, day(5)] })
      expect(rows.estimated_1rm).toBe(80)
      expect(new Date(rows.updated_at).toISOString()).toBe(day(9))
    })
    it('an earlier-typed old figure changes nothing on the survivor', async () => {
      const { rows } = await collide({ old: [200, day(2)], new: [120, day(5)] })
      expect(rows.estimated_1rm).toBe(120)
      expect(new Date(rows.updated_at).toISOString()).toBe(day(5))
    })
    it('the same instant keeps the survivor (as before this change)', async () => {
      const { rows } = await collide({ old: [200, day(5)], new: [120, day(5)] })
      expect(rows.estimated_1rm).toBe(120)
    })
    it('the survivor takes the old row\'s library id when it has none and the id is the renamed exercise\'s', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(2), entry.id); await est(A, newName, 120, day(5), null)
      await renameVia.renameExercise(entry.id, newName)
      expect((await rowsOf(A, newName))[0].exercise_id).toBe(entry.id)
    })
    it('an old row pointing at another exercise hands over no id', async () => {
      const otherEntry = await make(name('elsewhere'))
      const { rows } = await collide({ old: [100, day(2), otherEntry.id], new: [120, day(5), null] })
      expect(rows.exercise_id).toBeNull()
    })
    it('a survivor holding another exercise\'s id ends on the renamed exercise\'s, as personal_records does (#4021)', async () => {
      const otherEntry = await make(name('elsewhere'))
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(2), null); await est(A, newName, 120, day(5), otherEntry.id)
      await renameVia.renameExercise(entry.id, newName)
      expect((await rowsOf(A, newName))[0].exercise_id).toBe(entry.id)
    })
    it('a survivor with the right id keeps it; neither having one stays null', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(2), null); await est(A, newName, 120, day(5), entry.id)
      await renameVia.renameExercise(entry.id, newName)
      expect((await rowsOf(A, newName))[0].exercise_id).toBe(entry.id)
      const { rows } = await collide({ old: [100, day(2)], new: [120, day(5)] }, B)
      expect(rows.exercise_id).toBeNull()
    })
  })

  it('a forced failure at the last statement leaves every table exactly as before', async () => {
    const oldName = name('old'); const newName = name('new')
    const entry = await make(oldName)
    const ws = randomUUID(); const el = randomUUID()
    await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1,$2,'S',now())`, [ws, A])
    await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1,$2,$3,now())`, [el, ws, oldName])
    await pool.query(`INSERT INTO personal_records (user_id, exercise_name, estimated_1rm) VALUES ($1,$2,150), ($1,$3,100)`, [A, oldName, newName])
    await est(A, oldName, 160, day(9)); await est(A, newName, 110, day(5)) // the later-typed old figure would be carried
    await est(B, oldName, 70, day(3))
    await pool.query(`INSERT INTO exercise_preferences (user_id, exercise_name, exercise_id, rep_min, rep_max, source) VALUES ($1,$2,$3,5,9,'editor'), ($1,$4,NULL,10,14,'editor')`, [A, oldName, entry.id, newName])
    const snapshot = async () => ({
      estimates: (await pool.query(`SELECT * FROM exercise_estimates WHERE exercise_name IN ($1,$2) ORDER BY 2,3`, [oldName, newName])).rows,
      records: (await pool.query(`SELECT * FROM personal_records WHERE exercise_name IN ($1,$2) ORDER BY 2,3`, [oldName, newName])).rows,
      logs: (await pool.query(`SELECT exercise_name FROM exercise_logs WHERE id=$1`, [el])).rows,
      prefs: (await pool.query(`SELECT * FROM exercise_preferences WHERE exercise_name IN ($1,$2) ORDER BY 2,3`, [oldName, newName])).rows,
      library: (await pool.query(`SELECT name FROM exercise_library WHERE id=$1`, [entry.id])).rows,
    })
    const before = await snapshot()
    const fn = `rn4035_fail_${tag}`
    await pool.query(`CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN
      IF NEW.name = '${newName}' THEN RAISE EXCEPTION 'forced failure at the last statement'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON exercise_library FOR EACH ROW EXECUTE FUNCTION ${fn}()`)
    try {
      await expect(repo.renameExercise(CREATOR, entry.id, newName)).rejects.toThrow()
      await expect(repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] })).rejects.toThrow()
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON exercise_library`)
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`)
    }
    expect(await snapshot()).toEqual(before)
    expect(before.estimates).toHaveLength(3)
    expect(before.logs[0].exercise_name).toBe(oldName)
  })

  describe('nothing is deleted that should not be', () => {
    it('a rename with no collision deletes nothing: everyone\'s estimate count is unchanged', async () => {
      const oldName = name('old'); const newName = name('new'); const other = name('other')
      const entry = await make(oldName)
      await est(A, oldName, 100); await est(B, oldName, 70); await est(A, other, 55); await est(C, other, 40)
      const count = async () => Number((await pool.query(`SELECT count(*) FROM exercise_estimates WHERE user_id = ANY($1)`, [ALL])).rows[0].count)
      const before = await count()
      await renameVia.adminUpdateExercise(entry.id, newName)
      expect(await count()).toBe(before)
      expect((await rowsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([100])
      expect((await rowsOf(B, newName)).map(r => r.estimated_1rm)).toEqual([70])
    })

    it('a rename to the same name, through both paths, changes nothing', async () => {
      const oldName = name('old')
      const entry = await make(oldName)
      await est(A, oldName, 100); await est(B, oldName, 70)
      const before = await snapshotAll()
      await repo.renameExercise(CREATOR, entry.id, oldName)
      await repo.adminUpdateExercise({ id: entry.id, name: oldName, muscles: [], equipment: ['barbell'] })
      expect(await snapshotAll()).toEqual(before)
    })

    it('a name differing only by case or spacing is not a collision: the old row moves, the lookalike is untouched', async () => {
      const oldName = name('old'); const newName = name('Mixed Case')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(9))
      await est(A, newName.toLowerCase(), 80, day(5)) // differs by case
      await est(B, oldName, 60, day(9))
      await est(B, `${newName} `, 50, day(5)) // trailing space
      await renameVia.renameExercise(entry.id, newName)
      expect((await rowsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([100])
      expect((await rowsOf(A, newName.toLowerCase())).map(r => r.estimated_1rm)).toEqual([80])
      expect((await rowsOf(B, newName)).map(r => r.estimated_1rm)).toEqual([60])
      expect((await rowsOf(B, `${newName} `)).map(r => r.estimated_1rm)).toEqual([50])
      expect(await rowsOf(A, oldName)).toEqual([])
    })
  })

  it('removing a row of a person who was not a collider throws (the guard), so the rename would roll back', async () => {
    const { repointStoredExerciseNames } = await import('@/lib/data/postgres/exercise-name-tables')
    const text = (q: { queryChunks: unknown[] }) => q.queryChunks.map(c => (c && typeof c === 'object' && 'value' in c ? [(c as { value: unknown }).value].flat().join('') : '')).join('')
    const tx = {
      execute: async (q: { queryChunks: unknown[] }) => {
        const s = text(q)
        if (s.includes('DELETE FROM exercise_estimates')) return { rows: [{ user_id: 'someone-else' }] }
        if (s.includes('SELECT s.user_id FROM exercise_estimates')) return { rows: [{ user_id: 'a-collider' }] }
        return { rows: [] }
      },
    }
    await expect(repointStoredExerciseNames(tx as never, 'old', 'new')).rejects.toThrow('person who had no collision')
  })

  describe('a write to the estimate racing the rename', () => {
    const upsertSql = `INSERT INTO exercise_estimates (user_id, exercise_name, estimated_1rm) VALUES ($1,$2,$3)
      ON CONFLICT (user_id, exercise_name) DO UPDATE SET estimated_1rm = EXCLUDED.estimated_1rm, updated_at = now()`
    const within = <T,>(p: Promise<T>, ms = 15000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out: deadlock?')), ms))])
    const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

    it('write first (held open), rename waits for it, and keeps the typed figure; no deadlock', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await est(A, oldName, 100, day(2)); await est(A, newName, 120, day(5))
      const k = await pool.connect()
      let renamed = false
      try {
        await k.query('BEGIN')
        await k.query(upsertSql, [A, newName, 200]) // the typed figure, uncommitted, holding the row
        const rename = renameVia.renameExercise(entry.id, newName).then(() => { renamed = true })
        await settle(400)
        expect(renamed).toBe(false) // blocked on the person's row
        await k.query('COMMIT')
        await within(rename)
      } finally { k.release() }
      expect(await rowsOf(A, oldName)).toEqual([])
      expect((await rowsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([200]) // the figure typed during the rename survives
    })

    it('rename first (held open), the upsert on the new name waits and then lands; both orders end with one row', async () => {
      const { getDb } = await import('@/lib/data/postgres/client')
      const { repointStoredExerciseNames } = await import('@/lib/data/postgres/exercise-name-tables')
      const oldName = name('old'); const newName = name('new')
      await make(oldName)
      await est(A, oldName, 100, day(2)); await est(A, newName, 120, day(5))
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      let inside!: () => void
      const entered = new Promise<void>(r => { inside = r })
      const rename = getDb().transaction(async tx => {
        await repointStoredExerciseNames(tx, oldName, newName)
        inside()
        await gate // the rename's transaction stays open
      })
      await entered
      const write = repo.upsertExerciseEstimate(A, newName, 250)
      await settle(400)
      release()
      await within(Promise.all([rename, write]))
      expect(await rowsOf(A, oldName)).toEqual([])
      expect((await rowsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([250])
    })

    it('a write under the OLD name just after the rename commits is not lost: it lands as its own row, no deadlock', async () => {
      const { getDb } = await import('@/lib/data/postgres/client')
      const { repointStoredExerciseNames } = await import('@/lib/data/postgres/exercise-name-tables')
      const oldName = name('old'); const newName = name('new')
      await make(oldName)
      await est(A, oldName, 100, day(2)); await est(A, newName, 120, day(5))
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      let inside!: () => void
      const entered = new Promise<void>(r => { inside = r })
      const rename = getDb().transaction(async tx => {
        await repointStoredExerciseNames(tx, oldName, newName)
        inside()
        await gate
      })
      await entered
      const write = repo.upsertExerciseEstimate(A, oldName, 300)
      await settle(400)
      release()
      await within(Promise.all([rename, write]))
      // The name no longer exists in the library after a real rename; a typed figure for it is kept, as it
      // was before this change (it is the person's own entry, never derived).
      expect((await rowsOf(A, oldName)).map(r => r.estimated_1rm)).toEqual([300])
      expect((await rowsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([120])
    })

    it('two renames of the same person\'s rows, started together, do not deadlock', async () => {
      const a1 = name('old'); const n1 = name('new'); const a2 = name('old'); const n2 = name('new')
      const e1 = await make(a1); const e2 = await make(a2)
      await est(A, a1, 100, day(2)); await est(A, n1, 120, day(5))
      await est(A, a2, 100, day(2)); await est(A, n2, 120, day(5))
      await within(Promise.all([renameVia.renameExercise(e1.id, n1), renameVia.adminUpdateExercise(e2.id, n2)]))
      expect(await rowsOf(A, a1)).toEqual([]); expect(await rowsOf(A, a2)).toEqual([])
      expect(await rowsOf(A, n1)).toHaveLength(1); expect(await rowsOf(A, n2)).toHaveLength(1)
    })
  })
})
