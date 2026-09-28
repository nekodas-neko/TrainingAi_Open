// DV-19 — the server keeps one activity per (user, date, start_time), and that index covers
// tombstones. An outbox push merges on it, so a NEW activity saved at the minute of a deleted one
// landed on the deleted row and stayed deleted: saved on the phone, gone everywhere else. A stale
// edit to the deleted activity itself must still lose to the delete.
//
// Runs only against a real local dev Postgres — skips cleanly without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000d0019'

describe.skipIf(!canRun)('activity push at the minute of a deleted activity (DV-19)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const walk = (id: string, title: string) => ({
    id, date: '2026-09-24', activityType: 'walk', title,
    startTime: '09:18', endTime: '09:58', durationMin: 40,
  })
  const row = async () => (await pool.query(
    `SELECT id, title, deleted_at IS NOT NULL AS deleted FROM activity_logs WHERE user_id = $1`, [USER],
  )).rows

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, `dv19-${USER}@example.com`],
    )
  })

  beforeEach(async () => { await pool.query(`DELETE FROM activity_logs WHERE user_id = $1`, [USER]) })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM activity_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('a new activity at a deleted one’s minute is live, not born deleted', async () => {
    const old = randomUUID()
    await repo.saveActivityLog(USER, walk(old, 'Deleted walk'), { overwrite: true })
    await repo.deleteActivityLog(USER, old)
    await repo.saveActivityLog(USER, walk(randomUUID(), 'New walk'), { overwrite: true })
    expect(await row()).toEqual([{ id: old, title: 'New walk', deleted: false }])
  })

  it('a stale edit to the deleted activity itself does not bring it back', async () => {
    const id = randomUUID()
    await repo.saveActivityLog(USER, walk(id, 'Walk'), { overwrite: true })
    await repo.deleteActivityLog(USER, id)
    await repo.saveActivityLog(USER, walk(id, 'Edited offline before the delete synced'), { overwrite: true })
    expect((await row())[0].deleted).toBe(true)
  })
})
