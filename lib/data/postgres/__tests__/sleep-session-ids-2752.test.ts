// Issue 2752 — the server half of the ghost sweep: the full id list a device compares against.
// Tombstoned rows must be in it (a tombstone reaches the device through the pull, and is not a
// ghost), another user's rows must not, and it writes nothing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000275201'
const OTHER = '00000000-0000-4000-8000-000000275202'

describe.skipIf(!canRun)('listSleepSessionIds (#2752)', () => {
  let pool: import('pg').Pool
  let repo: Awaited<ReturnType<typeof import('@/lib/data')['getRepository']>>

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    for (const [id, tag] of [[USER, 'a'], [OTHER, 'b']]) {
      await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
        [id, `ghost-2752-${tag}@example.com`])
      await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [id])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER, OTHER]) {
      await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('lists live and tombstoned rows for this user only, with the read time', async () => {
    const ins = (user: string, start: string, ouraId: string, deleted: boolean) => pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, oura_id, deleted_at)
       VALUES ($1, '2026-10-01', $2::timestamptz, $2::timestamptz + interval '8 hours', $3, ${deleted ? 'now()' : 'NULL'}) RETURNING id`,
      [user, start, ouraId])
    const live = (await ins(USER, '2026-09-30T13:00:00Z', 'ble:1', false)).rows[0].id
    const tomb = (await ins(USER, '2026-09-30T14:00:00Z', 'ble:2', true)).rows[0].id
    await ins(OTHER, '2026-09-30T13:00:00Z', 'ble:1', false)

    const before = Date.now()
    const { asOf, ids } = await repo.listSleepSessionIds(USER)
    expect(ids.sort()).toEqual([live, tomb].sort())
    expect(Math.abs(asOf.getTime() - before)).toBeLessThan(60_000)
    expect((await repo.listSleepSessionIds('00000000-0000-4000-8000-0000002752ff')).ids).toEqual([])
  })
})
