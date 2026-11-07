// #3654, the current app's half: the server's cursor now overlaps, so a pull re-sends rows the
// device already holds. Each re-send must be a no-op upsert that raises no cache flag, a pending
// local edit must survive it, and the row committed during a pull must reach the device.
//
// End to end: the real `getSyncDelta` on Postgres serves the pull, and the real sync engine applies it
// to the shipped `SQLiteLocalStore` on in-memory SQLite at the current device schema. Only the HTTP
// hop is replaced, by a JSON round trip of what the route would send.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('@/lib/sqlite/sqlite-service', () => import('./parity/node-sqlite-service'))
const { holder } = vi.hoisted(() => ({ holder: { store: null as unknown } }))
vi.mock('@/lib/local-store/index', () => ({ getLocalStore: () => holder.store }))

import { openVectorDb, vectorDb } from './parity/node-sqlite-service'
import { SQLiteLocalStore } from '../sqlite-backend'
import { pullDelta, _resetSyncBackoff } from '../sync-engine'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000036540'

describe.skipIf(!canRun)('a pull that re-sends held rows (#3654)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const session = randomUUID()
  const exerciseLog = randomUUID()
  const setLog = randomUUID()

  const localWeight = () =>
    (vectorDb().prepare(`SELECT weight_kg FROM body_metrics WHERE date = '2026-11-02'`).get() as { weight_kg: number } | undefined)?.weight_kg
  const localSetCount = () =>
    (vectorDb().prepare(`SELECT COUNT(*) AS n FROM set_logs WHERE exercise_log_id = ?`).get(exerciseLog) as { n: number }).n

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `pull-overlap-3654-${USER}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    _resetSyncBackoff()
    openVectorDb()
    holder.store = new SQLiteLocalStore()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const since = new Date(new URL(url, 'http://local').searchParams.get('since')!)
      const delta = await repo.getSyncDelta(USER, since)
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(delta)) }
    }))
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('a re-sent row changes nothing and raises no flag; a changed one does', async () => {
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-11-02', 1)`, [USER])
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1, $2, 'A', now())`,
      [session, USER],
    )
    await pool.query(
      `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1, $2, 'Squat', now())`,
      [exerciseLog, session],
    )
    await pool.query(
      `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps) VALUES ($1, $2, 1, 1, 1)`,
      [setLog, exerciseLog],
    )

    const first = await pullDelta(USER, true)
    expect(first?.domains.biometrics).toBe(true)
    expect(first?.domains.workouts).toBe(true)
    expect(localWeight()).toBe(1)
    expect(localSetCount()).toBe(1)

    // The same rows come back inside the overlap.
    const again = await pullDelta(USER, true)
    expect(again?.synced).toBeGreaterThan(0)
    expect(again?.domains.biometrics).toBe(false)
    expect(again?.domains.workouts).toBe(false)
    expect(localWeight()).toBe(1)
    expect(localSetCount()).toBe(1)

    await new Promise(r => setTimeout(r, 5))
    await pool.query(`UPDATE body_metrics SET weight_kg = 2 WHERE user_id = $1 AND date = '2026-11-02'`, [USER])
    const changed = await pullDelta(USER, true)
    expect(changed?.domains.biometrics).toBe(true)
    expect(changed?.domains.workouts).toBe(false)
    expect(localWeight()).toBe(2)
  })

  it('a re-send does not revert a pending local edit', async () => {
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-11-02', 1)`, [USER])
    await pullDelta(USER, true)
    vectorDb().prepare(`UPDATE body_metrics SET weight_kg = 3, sync_status = 'pending' WHERE date = '2026-11-02'`).run()

    await pullDelta(USER, true)
    expect(localWeight()).toBe(3)
  })

  it('a row committed while a pull runs reaches the device on the next pull', async () => {
    await pool.query(`INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, '2026-11-02', 1)`, [USER])
    await pullDelta(USER, true)

    const writer = await pool.connect()
    try {
      await writer.query('BEGIN')
      await writer.query(`UPDATE body_metrics SET weight_kg = 4 WHERE user_id = $1 AND date = '2026-11-02'`, [USER])
      await new Promise(r => setTimeout(r, 20))
      await pullDelta(USER, true)
      await writer.query('COMMIT')
    } finally {
      writer.release()
    }
    expect(localWeight()).toBe(1)

    const next = await pullDelta(USER, true)
    expect(localWeight()).toBe(4)
    expect(next?.domains.biometrics).toBe(true)
  })
})
