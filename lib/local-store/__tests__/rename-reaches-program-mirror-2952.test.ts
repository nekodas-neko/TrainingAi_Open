// Issue 2952: an exercise renamed on the server reaches the phone's program mirror on the next pull,
// not only after the program is next edited.
//
// End to end: the real `getSyncDelta` on Postgres serves the pull, and the real sync engine applies
// it to the shipped `SQLiteLocalStore` on in-memory SQLite at the current device schema. Only the
// HTTP hop is replaced, by a JSON round trip of what the route would send.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => holder.store }))

import { openVectorDb, vectorDb } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'
import { pullDelta, _resetSyncBackoff } from '../sync-engine'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000022952'

describe.skipIf(!canRun)('a server rename reaches the local program mirror (issue 2952)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const using = { program: randomUUID(), session: randomUUID(), exercise: randomUUID() }
  const notUsing = { program: randomUUID(), session: randomUUID(), exercise: randomUUID() }

  const localName = (id: string) =>
    (vectorDb().prepare(`SELECT exercise_name FROM session_exercises WHERE id = ?`).get(id) as { exercise_name: string } | undefined)?.exercise_name

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `rename-mirror-2952-${USER}@example.com`],
    )
    for (const [p, name] of [[using, 'Mirror 2952 Old'], [notUsing, 'Mirror 2952 Other']] as const) {
      await pool.query(`INSERT INTO programs (id, user_id, name) VALUES ($1, $2, $3)`, [p.program, USER, `P ${p.program}`])
      await pool.query(`INSERT INTO program_sessions (id, program_id, name, position) VALUES ($1, $2, 'A', 0)`, [p.session, p.program])
      await pool.query(
        `INSERT INTO session_exercises (id, session_id, exercise_name, position) VALUES ($1, $2, $3, 0)`,
        [p.exercise, p.session, name],
      )
    }
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM programs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM exercise_library WHERE created_by = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(() => {
    _resetSyncBackoff()
    openVectorDb()
    holder.store = new SQLiteLocalStore()
    // The pull asks `/api/sync/pull?since=…`; answer with the real delta for that cursor.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const since = new Date(new URL(url, 'http://local').searchParams.get('since')!)
      const delta = await repo.getSyncDelta(USER, since)
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(delta)) }
    }))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('the next pull replaces the old name, and leaves a program without the exercise as it was', async () => {
    const entry = await repo.createExercise({ name: 'Mirror 2952 Old', muscles: [], equipment: [], createdBy: USER })

    await pullDelta(USER, true)
    expect(localName(using.exercise)).toBe('Mirror 2952 Old')
    expect(localName(notUsing.exercise)).toBe('Mirror 2952 Other')

    // Mark the untouched program's local row, so a re-send of its subtree would show.
    vectorDb().prepare(`UPDATE session_exercises SET exercise_role = 'untouched' WHERE id = ?`).run(notUsing.exercise)
    await new Promise(r => setTimeout(r, 5))
    await repo.renameExercise(USER, entry.id, 'Mirror 2952 New')

    await pullDelta(USER, true)

    expect(localName(using.exercise)).toBe('Mirror 2952 New')
    const untouched = vectorDb().prepare(`SELECT exercise_name, exercise_role FROM session_exercises WHERE id = ?`).get(notUsing.exercise)
    expect(untouched).toEqual({ exercise_name: 'Mirror 2952 Other', exercise_role: 'untouched' })
  })
})
