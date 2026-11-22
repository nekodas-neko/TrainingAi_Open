// #4021: three leftovers of the rename's handling of personal records. DB-backed (CI's Tests job sets
// DATABASE_URL); fake users and tagged exercise names, all removed afterwards.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { randomUUID } from 'crypto'

// Fix 3 needs a short statement timeout on the rename's own connection. The repository reads its db
// through getDb(), so the test swaps in a pool of its own with a shortened timeout (client.ts is untouched).
let timeoutDb: unknown = null
vi.mock('@/lib/data/postgres/client', async importOriginal => {
  const orig = await importOriginal<typeof import('@/lib/data/postgres/client')>()
  return { ...orig, getDb: () => (timeoutDb ?? orig.getDb()) }
})

const canRun = !!process.env.DATABASE_URL
const A = '00000000-0000-4000-8000-000000004021'
const B = '00000000-0000-4000-8000-000000014021'
const CREATOR = '00000000-0000-4000-8000-000000024021'
const USERS = [A, B, CREATOR]

describe.skipIf(!canRun)('rename leftovers (#4021)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const tag = randomUUID().slice(0, 8)
  let n = 0
  const name = (label: string) => `Rn4021 ${tag} ${label} ${++n}`
  const day = (d: number) => new Date(Date.UTC(2026, 0, d, 2)).toISOString()

  const record = (u: string, nm: string, v: number, id: string | null = null, achieved = day(5)) =>
    pool.query(`INSERT INTO personal_records (user_id, exercise_name, exercise_id, estimated_1rm, achieved_at) VALUES ($1,$2,$3,$4,$5)`, [u, nm, id, v, achieved])
  const recordsOf = async (u: string, nm: string) =>
    (await pool.query(`SELECT estimated_1rm, exercise_id FROM personal_records WHERE user_id=$1 AND exercise_name=$2`, [u, nm])).rows
  const make = (nm: string, type: 'weighted' | 'bodyweight' = 'weighted') =>
    repo.createExercise({ name: nm, muscles: [], equipment: [], createdBy: CREATOR, exerciseType: type })
  const logUnder = async (u: string, nm: string) => {
    const ws = randomUUID(); const el = randomUUID()
    await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1,$2,'S',now())`, [ws, u])
    await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1,$2,$3,now())`, [el, ws, nm])
    return el
  }
  const logName = async (el: string) => (await pool.query(`SELECT exercise_name FROM exercise_logs WHERE id=$1`, [el])).rows[0].exercise_name as string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const id of USERS) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `rename-4021-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    timeoutDb = null
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = ANY($1)`, [USERS])
    await pool.query(`DELETE FROM personal_records WHERE user_id = ANY($1)`, [USERS])
    await pool.query(`DELETE FROM exercise_library WHERE name LIKE $1`, [`Rn4021 ${tag}%`])
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [USERS])
  })

  describe('1. the surviving record ends on the renamed exercise\'s library id', () => {
    const run = async (survivor: 'stale' | 'right' | 'null', leftover: 'renamed' | 'other' | 'null') => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName, 'bodyweight')
      const other = await make(name('other'), 'weighted')
      await record(A, oldName, 90, leftover === 'renamed' ? entry.id : leftover === 'other' ? other.id : null)
      await record(A, newName, 100, survivor === 'stale' ? other.id : survivor === 'right' ? entry.id : null)
      await repo.renameExercise(CREATOR, entry.id, newName)
      const rows = await recordsOf(A, newName)
      expect(rows).toHaveLength(1)
      expect(await recordsOf(A, oldName)).toEqual([])
      return { entry, other, row: rows[0] }
    }

    it('a stale id on the survivor becomes the renamed exercise\'s, and the list reports its type', async () => {
      const { entry, row } = await run('stale', 'renamed')
      expect(row.exercise_id).toBe(entry.id)
      const recent = await repo.listRecentPersonalRecords(A, new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2027, 0, 1)))
      expect(recent.find(r => r.exerciseName.includes(`${tag} new`))?.exerciseType).toBe('bodyweight')
    })
    it('a stale id on the survivor is replaced when the old row holds another exercise\'s id too', async () => {
      const { entry, row } = await run('stale', 'other')
      expect(row.exercise_id).toBe(entry.id)
    })
    it('the right id stays', async () => {
      const { entry, row } = await run('right', 'null')
      expect(row.exercise_id).toBe(entry.id)
    })
    it('a NULL survivor takes the old row\'s id when it is the renamed exercise\'s', async () => {
      const { entry, row } = await run('null', 'renamed')
      expect(row.exercise_id).toBe(entry.id)
    })
    it('a NULL survivor never takes another exercise\'s id', async () => {
      const { row } = await run('null', 'other')
      expect(row.exercise_id).toBeNull()
    })
    it('neither has an id: stays NULL', async () => {
      const { row } = await run('null', 'null')
      expect(row.exercise_id).toBeNull()
    })
  })

  describe('2. the record step writes under the log\'s current name', () => {
    const when = new Date(Date.UTC(2026, 0, 9))
    it('a rename between the log commit and the record step: the figure lands on the new name, no old-name record', async () => {
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      const el = await logUnder(A, oldName) // the log commits...
      await repo.renameExercise(CREATOR, entry.id, newName) // ...the rename moves it...
      expect(await logName(el)).toBe(newName)
      // ...and then the record step runs with the name it captured before the rename.
      expect(await repo.upsertPersonalRecordIfBetter(A, oldName, 120, when, el)).toBe(true)
      expect((await recordsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([120])
      expect((await recordsOf(A, newName))[0].exercise_id).toBe(entry.id)
      expect(await recordsOf(A, oldName)).toEqual([])
    })

    it('a rename still uncommitted when the record step starts: the step waits for it and writes under the new name', async () => {
      const oldName = name('old'); const newName = name('new')
      await make(oldName)
      const el = await logUnder(A, oldName)
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        await c.query(`UPDATE exercise_logs SET exercise_name=$1 WHERE id=$2`, [newName, el])
        let done = false
        const step = repo.upsertPersonalRecordIfBetter(A, oldName, 130, when, el).then(r => { done = true; return r })
        await new Promise(r => setTimeout(r, 400))
        expect(done).toBe(false) // blocked behind the rename's write of the log
        await c.query('COMMIT')
        expect(await step).toBe(true)
      } finally { c.release() }
      expect((await recordsOf(A, newName)).map(r => r.estimated_1rm)).toEqual([130])
      expect(await recordsOf(A, oldName)).toEqual([])
    })

    it('the normal order still works, and what counts as better is unchanged', async () => {
      const nm = name('plain')
      const el = await logUnder(A, nm)
      expect(await repo.upsertPersonalRecordIfBetter(A, nm, 100, when, el)).toBe(true)
      expect(await repo.upsertPersonalRecordIfBetter(A, nm, 100, when, el)).toBe(false) // a tie is not better
      expect(await repo.upsertPersonalRecordIfBetter(A, nm, 90, when, el)).toBe(false)
      expect(await repo.upsertPersonalRecordIfBetter(A, nm, 110, when, el)).toBe(true)
      expect((await recordsOf(A, nm)).map(r => r.estimated_1rm)).toEqual([110])
      // No log id (older callers): the given name is used as before.
      const bare = name('bare')
      expect(await repo.upsertPersonalRecordIfBetter(A, bare, 50, when)).toBe(true)
      expect(await recordsOf(A, bare)).toHaveLength(1)
    })

    it('another user\'s log id is ignored: the caller\'s name is used', async () => {
      const mine = name('mine'); const theirs = name('theirs')
      const el = await logUnder(B, theirs)
      expect(await repo.upsertPersonalRecordIfBetter(A, mine, 70, when, el)).toBe(true)
      expect(await recordsOf(A, mine)).toHaveLength(1)
      expect(await recordsOf(A, theirs)).toEqual([])
    })

    it('a log stays stored when its record step fails', async () => {
      const nm = name('fails')
      const el = await logUnder(A, nm)
      await expect(repo.upsertPersonalRecordIfBetter('not-a-uuid', nm, 100, when, el)).rejects.toBeTruthy()
      expect(await logName(el)).toBe(nm)
    })
  })

  describe('3. a rename that waits on a lock until the statement timeout answers 409, and changes nothing', () => {
    const snapshot = async (names: string[]) => ({
      records: (await pool.query(`SELECT user_id, exercise_name, exercise_id, estimated_1rm, achieved_at FROM personal_records WHERE exercise_name = ANY($1) ORDER BY 1,2`, [names])).rows,
      logs: (await pool.query(`SELECT id, exercise_name FROM exercise_logs WHERE exercise_name = ANY($1) ORDER BY 1`, [names])).rows,
      library: (await pool.query(`SELECT id, name FROM exercise_library WHERE name = ANY($1) ORDER BY 1`, [names])).rows,
    })

    const withLockedCollider = async (run: (ctx: { entry: { id: string; name: string }; oldName: string; newName: string; before: Awaited<ReturnType<typeof snapshot>> }) => Promise<void>) => {
      const { Pool } = await import('pg')
      const { drizzle } = await import('drizzle-orm/node-postgres')
      const short = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 700 })
      timeoutDb = drizzle(short)
      const oldName = name('old'); const newName = name('new')
      const entry = await make(oldName)
      await record(A, oldName, 90, entry.id)
      await record(A, newName, 100)
      await logUnder(A, oldName)
      const before = await snapshot([oldName, newName])
      const holder = await pool.connect()
      try {
        await holder.query('BEGIN')
        await holder.query(`SELECT 1 FROM personal_records WHERE user_id=$1 AND exercise_name=$2 FOR UPDATE`, [A, newName])
        await run({ entry, oldName, newName, before })
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined)
        holder.release()
        timeoutDb = null
        await short.end()
      }
      expect(await snapshot([oldName, newName])).toEqual(before)
    }

    it('renameExercise: the cancel is recognised and every table is as before', async () => {
      const { isStatementTimeout } = await import('@/lib/api/route-errors')
      await withLockedCollider(async ({ entry, newName }) => {
        const err = await repo.renameExercise(CREATOR, entry.id, newName).then(() => null, e => e)
        expect(err).not.toBeNull()
        expect(isStatementTimeout(err)).toBe(true)
      })
    })

    it('adminUpdateExercise: the cancel is recognised and every table is as before', async () => {
      const { isStatementTimeout } = await import('@/lib/api/route-errors')
      await withLockedCollider(async ({ entry, newName }) => {
        const err = await repo.adminUpdateExercise({ id: entry.id, name: newName, muscles: [], equipment: [] }).then(() => null, e => e)
        expect(err).not.toBeNull()
        expect(isStatementTimeout(err)).toBe(true)
      })
    })
  })
})
